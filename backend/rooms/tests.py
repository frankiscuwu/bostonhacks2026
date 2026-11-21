import uuid
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from restaurants.models import Restaurant
from restaurants.tests import restaurant_data
from .models import Participant, Room


class RoomTests(TestCase):
    def setUp(self):
        self.restaurant = Restaurant.objects.create(**restaurant_data())
        self.room = Room.objects.create()
        self.participant = Participant.objects.create(room=self.room, display_name="Alex")

    def test_creation_and_relationships(self):
        for instance in (self.room, self.participant):
            instance.full_clean()
        self.assertTrue(self.room.is_active)
        self.assertIsNone(self.room.selected_restaurant)
        self.assertEqual(self.room.participants.get(), self.participant)
        self.assertEqual(self.participant.filters, {"cuisines": [], "max_distance_miles": None, "open_now": False})
        self.assertIsInstance(self.participant.identity_token, uuid.UUID)
        self.assertNotIn(str(self.participant.identity_token), str(self.participant))

    def test_codes(self):
        codes = [Room.objects.create().code for _ in range(30)]
        self.assertEqual(len(codes), len(set(codes)))
        for code in codes:
            self.assertRegex(code, r"^[A-Z0-9]{6}$")

    def test_collision_retry(self):
        with patch("rooms.models.generate_room_code", return_value="NEW123"):
            room = Room.objects.create(code=self.room.code)
        self.assertEqual(room.code, "NEW123")

    def test_collision_limit(self):
        with patch("rooms.models.generate_room_code", return_value=self.room.code):
            with self.assertRaises(IntegrityError):
                Room.objects.create(code=self.room.code)
        self.assertEqual(Room.objects.count(), 1)

    def test_validation(self):
        for code in ("abc123", "ABC", "ABC!23", "ABC1234"):
            with self.subTest(code=code), self.assertRaises(ValidationError):
                Room(code=code).full_clean()
        with self.assertRaises(ValidationError):
            Participant(room=self.room, display_name="").full_clean()

    def test_identity_uniqueness(self):
        other = Participant.objects.create(room=self.room, display_name="Sam")
        self.assertNotEqual(other.identity_token, self.participant.identity_token)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Participant.objects.create(room=self.room, display_name="Copy", identity_token=other.identity_token)

    def test_deletion(self):
        self.room.selected_restaurant = self.restaurant
        self.room.selected_by = self.participant
        self.room.save()
        self.room.delete()
        self.assertFalse(Participant.objects.exists())
        self.assertTrue(Restaurant.objects.exists())
