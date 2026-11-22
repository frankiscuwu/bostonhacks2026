from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import Restaurant
from .tests import inactive_data, restaurant_data

LOCMEM = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "photos": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "photos-test"},
}


def place(name="Boston Noodles", lat=42.3601, lon=-71.0589, photos=("places/abc/photos/p1",)):
    return {"displayName": {"text": name}, "location": {"latitude": lat, "longitude": lon},
            "photos": [{"name": p} for p in photos]}


@override_settings(CACHES=LOCMEM)
@mock.patch.dict("os.environ", {"GOOGLE_PLACES_API_KEY": "test-key"})
class RestaurantPhotoTests(TestCase):
    def setUp(self):
        from django.core.cache import caches
        caches["photos"].clear()
        self.client = APIClient()
        self.restaurant = Restaurant.objects.create(**restaurant_data())

    def get(self, restaurant=None):
        return self.client.get(f"/api/restaurants/{(restaurant or self.restaurant).id}/photo/")

    def respond(self, places):
        def fake(request):
            if request.full_url.endswith(":searchText"):
                return {"places": places}
            self.assertIn("places/abc/photos/p1/media", request.full_url)
            return {"photoUri": "https://lh3.googleusercontent.com/photo"}
        return mock.patch("restaurants.photos._request_json", side_effect=fake)

    def test_matching_place_returns_photo_and_caches(self):
        with self.respond([place()]) as calls:
            self.assertEqual(self.get().json(), {"url": "https://lh3.googleusercontent.com/photo"})
            self.get()
        self.assertEqual(calls.call_count, 2)  # search + media once; second request is cached

    def test_rejects_wrong_name_or_far_away(self):
        for wrong in (place(name="Fenway Park"), place(lat=42.40)):
            from django.core.cache import caches
            caches["photos"].clear()
            with self.respond([wrong]):
                self.assertEqual(self.get().json(), {"url": None})

    def test_misses_are_cached(self):
        with self.respond([]) as calls:
            self.get()
            self.get()
        self.assertEqual(calls.call_count, 1)

    def test_api_error_returns_null(self):
        import urllib.error
        with mock.patch("restaurants.photos._request_json", side_effect=urllib.error.URLError("down")):
            self.assertEqual(self.get().json(), {"url": None})

    def test_no_key_returns_null_without_calling(self):
        with mock.patch.dict("os.environ", {"GOOGLE_PLACES_API_KEY": ""}), \
                mock.patch("restaurants.photos._request_json") as calls:
            self.assertEqual(self.get().json(), {"url": None})
        calls.assert_not_called()

    def test_inactive_restaurant_404(self):
        inactive = Restaurant.objects.create(**inactive_data())
        self.assertEqual(self.get(inactive).status_code, 404)
