from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Restaurant(models.Model):
    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300)
    cuisine = models.CharField(max_length=100)
    price_level = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(4)]
    )
    rating = models.DecimalField(
        max_digits=3, decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
    )
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
    )
    creator_video_url = models.URLField(max_length=2048)
    image_url = models.URLField(max_length=2048, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(price_level__gte=1, price_level__lte=4), name="restaurant_price_range"),
            models.CheckConstraint(condition=models.Q(rating__gte=0, rating__lte=5), name="restaurant_rating_range"),
            models.CheckConstraint(condition=models.Q(latitude__gte=-90, latitude__lte=90), name="restaurant_latitude_range"),
            models.CheckConstraint(condition=models.Q(longitude__gte=-180, longitude__lte=180), name="restaurant_longitude_range"),
        ]

    def __str__(self):
        return self.name
