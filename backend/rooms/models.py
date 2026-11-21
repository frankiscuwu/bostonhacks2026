import secrets
import string
import uuid

from django.core.validators import MinValueValidator, RegexValidator
from django.db import IntegrityError, models, router, transaction


def generate_room_code():
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


class Room(models.Model):
    code = models.CharField(
        max_length=6, unique=True, default=generate_room_code,
        validators=[RegexValidator(r"\A[A-Z0-9]{6}\Z", "Use six uppercase letters or digits.")],
    )
    # The restaurants table is owned outside Django, so no database FK constraint.
    current_restaurant = models.ForeignKey(
        "restaurants.Restaurant", on_delete=models.PROTECT, db_constraint=False,
        null=True, blank=True, related_name="current_rooms",
    )
    current_round = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(current_round__gte=1), name="room_round_positive"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            return super().save(*args, **kwargs)
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        for attempt in range(10):
            try:
                # A savepoint keeps an outer transaction usable after a collision.
                with transaction.atomic(using=using):
                    return super().save(*args, **kwargs)
            except IntegrityError:
                if attempt == 9 or not type(self).objects.using(using).filter(code=self.code).exists():
                    raise
                self.code = generate_room_code()

    def __str__(self):
        return self.code


class Participant(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="participants")
    display_name = models.CharField(max_length=100)
    # Treat as a credential. Public serializers must explicitly exclude this field.
    identity_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.display_name} ({self.room.code})"


class Vote(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="votes")
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name="votes")
    restaurant = models.ForeignKey("restaurants.Restaurant", on_delete=models.PROTECT,
                                   db_constraint=False, related_name="votes")
    round_number = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    vote = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["participant", "round_number"], name="unique_participant_round_vote"),
            models.CheckConstraint(condition=models.Q(round_number__gte=1), name="vote_round_positive"),
        ]

    def __str__(self):
        return f"{self.participant.display_name}: {self.vote} (round {self.round_number})"
