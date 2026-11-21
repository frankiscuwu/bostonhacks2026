import os
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Restaurant
from .tests import restaurant_data


class RestaurantPhotoTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.restaurant = Restaurant.objects.create(**restaurant_data())
        self.url = f"/api/restaurants/{self.restaurant.id}/photo/"

    def test_no_key(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("YELP_API_KEY", None)
            self.assertEqual(self.client.get(self.url).json(), {"image_url": None, "source": None})

    @mock.patch.dict(os.environ, {"YELP_API_KEY": "test"})
    def test_matching_business_photo_is_cached(self):
        businesses = [
            {"name": "Some Other Place", "image_url": "https://yelp/other.jpg"},
            {"name": "Boston Noodles", "image_url": "https://yelp/noodles.jpg"},
        ]
        with mock.patch("restaurants.yelp._search", return_value=businesses) as search:
            for _ in range(2):
                row = self.client.get(self.url).json()
                self.assertEqual(row, {"image_url": "https://yelp/noodles.jpg", "source": "yelp"})
        search.assert_called_once()

    @mock.patch.dict(os.environ, {"YELP_API_KEY": "test"})
    def test_unrelated_business_is_ignored(self):
        with mock.patch("restaurants.yelp._search", return_value=[{"name": "Pizza Palace", "image_url": "x"}]):
            self.assertIsNone(self.client.get(self.url).json()["image_url"])

    @mock.patch.dict(os.environ, {"YELP_API_KEY": "test"})
    def test_errors_are_not_cached(self):
        with mock.patch("restaurants.yelp._search", side_effect=OSError("429")) as search:
            self.client.get(self.url)
            self.client.get(self.url)
        self.assertEqual(search.call_count, 2)

    def test_unknown_restaurant(self):
        self.assertEqual(self.client.get("/api/restaurants/999999/photo/").status_code, 404)
