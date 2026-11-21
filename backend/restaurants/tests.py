from django.test import TestCase

from .models import Restaurant


def restaurant_data(**overrides):
    return dict(businessname="Boston Noodles LLC", dbaname="Boston Noodles", address="123 Main St",
                city="Boston", state="MA", zip=2110, licstatus="Active", cuisine="chinese",
                descript="Eating & Drinking", latitude=42.3601, longitude=-71.0589) | overrides


def inactive_data(**overrides):
    return restaurant_data(licstatus="Inactive", **overrides)


class RestaurantTests(TestCase):
    def test_uses_shared_table(self):
        self.assertEqual(Restaurant._meta.db_table, "restaurants")
        self.assertFalse(Restaurant._meta.managed)
        self.assertEqual(Restaurant._meta.pk.column, "_id")

    def test_display_fields(self):
        restaurant = Restaurant.objects.create(**restaurant_data())
        self.assertEqual(str(restaurant), "Boston Noodles")
        self.assertEqual(restaurant.full_address, "123 Main St, Boston, MA 02110")
        self.assertTrue(restaurant.is_active)
        self.assertEqual(Restaurant(**restaurant_data(dbaname=None)).name, "Boston Noodles LLC")

    def test_active_requires_license_and_coordinates(self):
        active = Restaurant.objects.create(**restaurant_data())
        Restaurant.objects.create(**inactive_data())
        Restaurant.objects.create(**restaurant_data(latitude=None))
        self.assertEqual(list(Restaurant.objects.active()), [active])


class MatchingTests(TestCase):
    def test_cuisine_label(self):
        from .matching import cuisine_label
        self.assertEqual(cuisine_label("donut;coffee_shop"), "Donut")
        self.assertEqual(cuisine_label("bubble_tea"), "Bubble Tea")
        self.assertEqual(cuisine_label(None), "Other")
        self.assertEqual(cuisine_label(""), "Other")

    def test_open_hours(self):
        from datetime import datetime
        from .matching import BOSTON_TZ, is_open_now
        at = lambda hour: datetime(2026, 11, 21, hour, 0, tzinfo=BOSTON_TZ)
        day = Restaurant(**restaurant_data(open_time="11:00", close_time="22:00"))
        night = Restaurant(**restaurant_data(open_time="17:00", close_time="02:00"))
        self.assertTrue(is_open_now(day, at(12)))
        self.assertFalse(is_open_now(day, at(23)))
        self.assertTrue(is_open_now(night, at(1)))
        self.assertFalse(is_open_now(night, at(12)))
        self.assertIsNone(is_open_now(Restaurant(**restaurant_data()), at(12)))
