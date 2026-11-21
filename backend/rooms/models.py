import secrets
import string
import uuid

from django.core.validators import RegexValidator
from django.db import IntegrityError, models, router, transaction


def generate_room_code():
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def default_filters():
    return {"cuisines": [], "max_distance_miles": None, "open_now": False}


class Room(models.Model):
    code = models.CharField(
        max_length=6, unique=True, default=generate_room_code,
        validators=[RegexValidator(r"\A[A-Z0-9]{6}\Z", "Use six uppercase letters or digits.")],
    )
    # Randomly picked from restaurants matching every participant's filters.
    # The restaurants table is owned outside Django, so no database FK constraint.
    selected_restaurant = models.ForeignKey(
        "restaurants.Restaurant", on_delete=models.SET_NULL, db_constraint=False,
        null=True, blank=True, related_name="selected_in_rooms",
    )
    selected_at = models.DateTimeField(null=True, blank=True)
    selected_by = models.ForeignKey(
        "Participant", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

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
    # See restaurants.matching for the shape.
    filters = models.JSONField(default=default_filters)
    # Device location used as this participant's distance origin. Private: never
    # serialized publicly. Stored rounded to ~100 m (3 decimal places).
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    @property
    def origin(self):
        if self.latitude is None or self.longitude is None:
            return None
        return (self.latitude, self.longitude)
    joined_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.display_name} ({self.room.code})"
