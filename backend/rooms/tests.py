import uuid
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase

from restaurants.models import Restaurant
from restaurants.tests import restaurant_data
from .models import Participant, Room, Vote


class RoomTests(TestCase):
    def setUp(self):
        self.restaurant = Restaurant.objects.create(**restaurant_data())
        self.room = Room.objects.create(current_restaurant=self.restaurant)
        self.participant = Participant.objects.create(room=self.room, display_name="Alex")

    def vote(self, **overrides):
        return Vote.objects.create(**(dict(room=self.room, participant=self.participant,
            restaurant=self.restaurant, round_number=1, vote=True) | overrides))

    def test_creation_and_relationships(self):
        vote = self.vote()
        for instance in (self.room, self.participant, vote):
            instance.full_clean()
        self.assertEqual(self.room.current_round, 1)
        self.assertTrue(self.room.is_active)
        self.assertEqual(self.room.participants.get(), self.participant)
        self.assertEqual(self.room.votes.get(), vote)
        self.assertEqual(self.participant.votes.get(), vote)
        self.assertEqual(self.restaurant.votes.get(), vote)
        self.assertIsInstance(self.participant.identity_token, uuid.UUID)
        self.assertNotIn(str(self.participant.identity_token), str(self.participant))
        self.assertIsNotNone(vote.created_at)
        self.assertIsNotNone(self.participant.joined_at)
        self.assertIsNotNone(self.room.created_at)
        self.assertIsNone(Room.objects.create().current_restaurant)

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
        for instance in (Room(current_round=0), Participant(room=self.room, display_name=""),
                         Vote(room=self.room, participant=self.participant, restaurant=self.restaurant,
                              round_number=0, vote=True)):
            with self.assertRaises(ValidationError):
                instance.full_clean()

    def test_identity_uniqueness(self):
        other = Participant.objects.create(room=self.room, display_name="Sam")
        self.assertNotEqual(other.identity_token, self.participant.identity_token)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Participant.objects.create(room=self.room, display_name="Copy", identity_token=other.identity_token)

    def test_duplicate_votes(self):
        self.vote()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.vote(vote=False)
        self.vote(round_number=2, vote=False)
        other = Participant.objects.create(room=self.room, display_name="Sam")
        self.vote(participant=other)
        self.assertEqual(Vote.objects.count(), 3)

    def test_database_round_ranges(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Room.objects.create(current_round=0)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.vote(round_number=0)

    def test_deletion(self):
        self.vote()
        with self.assertRaises(ProtectedError):
            self.restaurant.delete()
        self.room.delete()
        self.assertFalse(Participant.objects.exists())
        self.assertFalse(Vote.objects.exists())
        self.assertTrue(Restaurant.objects.exists())
