from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import Restaurant


def restaurant_data(**overrides):
    return dict(name="Boston Noodles", address="123 Main St, Boston", cuisine="Chinese",
                price_level=2, rating="4.50", latitude="42.360100", longitude="-71.058900",
                creator_video_url="https://example.com/video") | overrides


class RestaurantTests(TestCase):
    def test_creation(self):
        restaurant = Restaurant(**restaurant_data())
        restaurant.full_clean()
        restaurant.save()
        self.assertEqual(str(restaurant), "Boston Noodles")
        self.assertTrue(restaurant.is_active)
        self.assertEqual(restaurant.image_url, "")
        self.assertIsNotNone(restaurant.created_at)

    def test_validation(self):
        for field, value in [("name", ""), ("address", ""), ("cuisine", ""),
                             ("price_level", 0), ("price_level", 5), ("rating", -1), ("rating", 6),
                             ("latitude", -91), ("latitude", 91), ("longitude", -181), ("longitude", 181),
                             ("creator_video_url", "invalid"), ("image_url", "invalid")]:
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                Restaurant(**restaurant_data(**{field: value})).full_clean()

    def test_database_ranges(self):
        for field, value in [("price_level", 5), ("rating", 6), ("latitude", 91), ("longitude", 181)]:
            with self.subTest(field=field), self.assertRaises(IntegrityError), transaction.atomic():
                Restaurant.objects.create(**restaurant_data(**{field: value}))
