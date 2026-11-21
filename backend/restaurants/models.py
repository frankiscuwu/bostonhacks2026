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
    """A TikTok / Instagram / YouTube video about a restaurant (Django-managed).

    Kept in its own table instead of a column on the shared ``restaurants`` table,
    which Django only reads. See restaurants/videos.py for URL parsing.
    """

    class Platform(models.TextChoices):
        TIKTOK = "tiktok", "TikTok"
        INSTAGRAM = "instagram", "Instagram"
        YOUTUBE = "youtube", "YouTube"

    # The restaurants table is owned outside Django, so no database FK constraint.
    restaurant = models.ForeignKey(Restaurant, on_delete=models.CASCADE, db_constraint=False,
                                   related_name="videos")
    platform = models.CharField(max_length=20, choices=Platform.choices)
    url = models.URLField(max_length=500, help_text="Canonical link to the post.")
    embed_id = models.CharField(max_length=100, help_text="Platform video id / shortcode.")
    embed_url = models.URLField(max_length=500, help_text="URL to load in an iframe.")
    thumbnail_url = models.URLField(max_length=2048, blank=True)
    author = models.CharField(max_length=200, blank=True)
    caption = models.TextField(blank=True)
    added_by = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(fields=["restaurant", "platform", "embed_id"],
                                    name="unique_restaurant_video"),
        ]

    def __str__(self):
        return f"{self.get_platform_display()} {self.embed_id} → restaurant {self.restaurant_id}"
