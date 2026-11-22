import os
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from restaurants.models import Restaurant
from restaurants.tests import restaurant_data
from rooms.models import Participant, Room
from .test_routing import fixture_network


@patch.dict(os.environ, {"GEOAPIFY_API_KEY": ""})
class DirectionsAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.restaurant = Restaurant.objects.create(**restaurant_data(latitude=42.4, longitude=-71.04))
        self.room = Room.objects.create(selected_restaurant=self.restaurant)
        self.me = Participant.objects.create(room=self.room, display_name="Me", latitude=42.4, longitude=-71.16)
        self.other = Participant.objects.create(room=self.room, display_name="Other", latitude=42.46, longitude=-71.1)
        self.url = "/api/transit/directions/"
        self.query = {"restaurant_id": self.restaurant.pk, "origin_lat": 42.4, "origin_lon": -71.16}
        self.network_patch = patch("transit.service.get_network", return_value=fixture_network())
        self.network_patch.start()
        self.addCleanup(self.network_patch.stop)
        self.mbta_patch = patch("transit.client.MBTAClient.get", return_value={"data": []})
        self.mbta_patch.start()
        self.addCleanup(self.mbta_patch.stop)

    def test_explicit_origin_and_read_only_query_contract(self):
        before = [list(m.objects.values()) for m in (Restaurant, Room, Participant)]
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.url, self.query)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["boarding_station"]["id"], "a")
        self.assertEqual(response.json()["exit_station"]["id"], "c")
        self.assertTrue(all(q["sql"].lstrip().upper().startswith("SELECT") for q in queries))
        self.assertEqual([list(m.objects.values()) for m in (Restaurant, Room, Participant)], before)
        self.assertIn("no-store", response["Cache-Control"])

    def test_backend_urls_and_catalog_destination(self):
        # The API backend intentionally has no HTML homepage.
        self.assertEqual(self.client.get("/").status_code, 404)
        self.assertEqual(self.client.get("/api/health/").json()["status"], "ok")
        catalog = self.client.get("/api/restaurants/")
        self.assertEqual(catalog.status_code, 200)
        self.assertIn(self.restaurant.pk, [restaurant["id"] for restaurant in catalog.json()])
        response = self.client.get(self.url, self.query)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["destination"]["restaurant_id"], self.restaurant.pk)

    def test_saved_locations_are_private_and_personalized(self):
        query = {"restaurant_id": self.restaurant.pk, "room_code": self.room.code}
        first = self.client.get(self.url, query, HTTP_X_PARTICIPANT_TOKEN=str(self.me.identity_token)).json()
        other = self.client.get(self.url, query, HTTP_X_PARTICIPANT_TOKEN=str(self.other.identity_token)).json()
        self.assertEqual(first["origin"], {"latitude": 42.4, "longitude": -71.16})
        self.assertEqual(other["origin"], {"latitude": 42.46, "longitude": -71.1})
        self.assertEqual((first["status"], other["status"]), ("ok", "ok"))
        self.assertEqual((first["summary"]["transfers"], other["summary"]["transfers"]), (0, 1))
        self.assertNotEqual(first["origin"], other["origin"])
        self.assertNotIn(str(self.me.identity_token), str(first))
        self.assertNotIn(str(self.other.identity_token), str(first))
        room = self.client.get(f"/api/rooms/{self.room.code}/").json()
        for p in room["participants"]:
            self.assertNotIn("latitude", p)
            self.assertNotIn("longitude", p)

    def test_private_origin_requires_active_membership(self):
        query = {"restaurant_id": self.restaurant.pk, "room_code": self.room.code}
        for token in ("", "invalid", str(uuid4())):
            self.assertEqual(self.client.get(self.url, query, HTTP_X_PARTICIPANT_TOKEN=token).status_code, 403)
        self.me.is_active = False
        self.me.save(update_fields=["is_active"])
        self.assertEqual(self.client.get(self.url, query, HTTP_X_PARTICIPANT_TOKEN=str(self.me.identity_token)).status_code, 403)

    def test_missing_saved_origin_requests_user_input(self):
        self.me.latitude = self.me.longitude = None
        self.me.save(update_fields=["latitude", "longitude"])
        response = self.client.get(self.url, {"restaurant_id": self.restaurant.pk, "room_code": self.room.code}, HTTP_X_PARTICIPANT_TOKEN=str(self.me.identity_token))
        self.assertEqual(response.json()["status"], "origin_required")
        self.assertIsNone(response.json()["origin"])

    def test_changed_group_destination_requires_refresh(self):
        self.room.selected_restaurant = None
        self.room.save(update_fields=["selected_restaurant"])
        response = self.client.get(self.url, {"restaurant_id": self.restaurant.pk, "room_code": self.room.code}, HTTP_X_PARTICIPANT_TOKEN=str(self.me.identity_token))
        self.assertEqual(response.status_code, 409)

    def test_invalid_coordinates_and_missing_restaurant(self):
        for overrides in ({"origin_lat": "nan"}, {"origin_lon": "inf"}, {"origin_lat": 91}, {"origin_lon": -181}, {"origin_lat": "bad"}, {"restaurant_id": -1}):
            with self.subTest(overrides=overrides):
                self.assertEqual(self.client.get(self.url, self.query | overrides).status_code, 400)
        self.assertEqual(self.client.get(self.url, {"restaurant_id": self.restaurant.pk, "origin_lat": 42}).status_code, 400)
        self.assertEqual(self.client.get(self.url, self.query | {"restaurant_id": 999999}).status_code, 404)
        self.restaurant.latitude = None
        self.restaurant.save(update_fields=["latitude"])
        self.assertEqual(self.client.get(self.url, self.query).json()["status"], "invalid_destination")

    def test_no_route_and_write_methods(self):
        response = self.client.get(self.url, self.query | {"origin_lat": 42.7, "origin_lon": -71.5})
        self.assertEqual(response.json()["status"], "no_route")
        for method in ("post", "put", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)(self.url, self.query).status_code, 405)
