from django.db import models


class RestaurantQuerySet(models.QuerySet):
    def active(self):
        """Restaurants that can be shown and voted on: licensed and mappable."""
        return self.filter(licstatus="Active", latitude__isnull=False, longitude__isnull=False)


class Restaurant(models.Model):
    """Read-only view of the shared Supabase ``restaurants`` table (Boston food licenses).

    The table is owned outside Django (``managed = False``): Django never creates,
    alters or drops it. Rooms and votes reference rows by ``_id``.
    """

    id = models.BigAutoField(primary_key=True, db_column="_id")
    businessname = models.TextField(null=True, blank=True)
    dbaname = models.TextField(null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    city = models.TextField(null=True, blank=True)
    state = models.TextField(null=True, blank=True)
    zip = models.BigIntegerField(null=True, blank=True)
    licstatus = models.TextField(null=True, blank=True)
    licensecat = models.TextField(null=True, blank=True)
    descript = models.TextField(null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    cuisine = models.TextField(null=True, blank=True)
    open_time = models.TextField(null=True, blank=True)
    close_time = models.TextField(null=True, blank=True)

    objects = RestaurantQuerySet.as_manager()

    class Meta:
        managed = False
        db_table = "restaurants"

    @property
    def name(self):
        return self.dbaname or self.businessname or f"Restaurant #{self.id}"

    @property
    def full_address(self):
        parts = [self.address, self.city, " ".join(p for p in (self.state, f"{self.zip:05d}" if self.zip else None) if p)]
        return ", ".join(p for p in parts if p)

    @property
    def is_active(self):
        return self.licstatus == "Active" and self.latitude is not None and self.longitude is not None

    def __str__(self):
        return self.name


class RestaurantVideo(models.Model):
    """Django-owned video links; never saves or alters the shared restaurant row."""

    class Platform(models.TextChoices):
        YOUTUBE = "youtube", "YouTube"
        TIKTOK = "tiktok", "TikTok"
        INSTAGRAM = "instagram", "Instagram"

    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    restaurant = models.ForeignKey(
        Restaurant, on_delete=models.PROTECT, db_constraint=False, related_name="videos",
    )
    platform = models.CharField(max_length=10, choices=Platform.choices)
    canonical_url = models.URLField(max_length=2048)
    platform_video_id = models.CharField(max_length=100, editable=False, blank=True)
    creator_name = models.CharField(max_length=200, blank=True)
    creator_handle = models.CharField(max_length=100, blank=True)
    verification_status = models.CharField(
        max_length=10, choices=VerificationStatus.choices, default=VerificationStatus.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("id",)
        constraints = [
            models.UniqueConstraint(
                fields=("restaurant", "platform", "platform_video_id"),
                name="unique_restaurant_platform_video",
            ),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError
        from .video_urls import canonicalize_video_url
        super().clean()
        try:
            self.canonical_url, self.platform_video_id = canonicalize_video_url(self.platform, self.canonical_url)
        except ValidationError as exc:
            raise ValidationError({"canonical_url": exc.messages}) from None

    def save(self, *args, **kwargs):
        # Enforce validation for Admin and ordinary ORM saves, not just API inputs.
        self.full_clean()
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"canonical_url", "platform_video_id", "updated_at"}
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.platform}: {self.platform_video_id} (restaurant {self.restaurant_id})"
