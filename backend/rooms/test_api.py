import uuid
from datetime import datetime
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from restaurants.matching import BOSTON_TZ
from restaurants.models import Restaurant
from restaurants.tests import inactive_data, restaurant_data
from .models import Participant, Room


class RoomAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        # Boston Common is (42.3551, -71.0624).
        self.pizza = Restaurant.objects.create(**restaurant_data(dbaname="Pizza Place", cuisine="pizza",
                                                                 latitude=42.3551, longitude=-71.0624))
        self.sushi = Restaurant.objects.create(**restaurant_data(dbaname="Sushi Bar", cuisine="sushi;japanese",
                                                                 latitude=42.3551, longitude=-71.0624,
                                                                 open_time="11:00", close_time="22:00"))
        self.far_pizza = Restaurant.objects.create(**restaurant_data(dbaname="Far Pizza", cuisine="pizza",
                                                                     latitude=42.30, longitude=-71.0624))
        Restaurant.objects.create(**inactive_data(dbaname="Closed License", cuisine="pizza"))
        response = self.client.post('/api/rooms/', {'display_name': 'Host'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.creation = response.json()
        self.code = self.creation['room']['code']
        self.token = self.creation['participant_token']
        self.base = f'/api/rooms/{self.code}/'

    def join(self, name='Guest'):
        return self.client.post(self.base + 'join/', {'display_name': name}, format='json')

    def set_filters(self, token, **filters):
        headers = {} if token is None else {'HTTP_X_PARTICIPANT_TOKEN': token}
        return self.client.put(self.base + 'filters/', filters, format='json', **headers)

    def pick(self, token=None):
        headers = {} if token is None else {'HTTP_X_PARTICIPANT_TOKEN': token}
        return self.client.post(self.base + 'pick/', {}, format='json', **headers)

    def test_create_room(self):
        room = self.creation['room']
        self.assertIsNone(room['selected_restaurant'])
        self.assertEqual(room['matching_count'], 3)
        self.assertEqual(room['participants'][0]['filters'],
                         {'cuisines': [], 'max_distance_miles': None, 'open_now': False})
        self.assertEqual(Participant.objects.get().identity_token, uuid.UUID(self.token))

    def test_join_and_public_state_no_tokens(self):
        joined = self.join()
        self.assertEqual(joined.status_code, 201)
        guest_token = joined.json()['participant_token']
        self.assertNotEqual(guest_token, self.token)
        self.pick(self.token)
        for url in (self.base, '/api/restaurants/'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            content = response.content.decode()
            for secret in (self.token, guest_token, 'identity_token', 'participant_token'):
                self.assertNotIn(secret, content)
        self.assertEqual(len(self.client.get(self.base).json()['participants']), 2)

    def test_update_filters(self):
        response = self.set_filters(self.token, cuisines=['Pizza', 'Pizza'], max_distance_miles=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['participants'][0]['filters'],
                         {'cuisines': ['Pizza'], 'max_distance_miles': 1.0, 'open_now': False})
        self.assertEqual(response.json()['matching_count'], 1)

    def test_pick_matches_every_participants_filters(self):
        guest = self.join().json()['participant_token']
        self.set_filters(self.token, cuisines=['Pizza', 'Sushi'])
        self.set_filters(guest, max_distance_miles=1)
        self.assertEqual(self.client.get(self.base).json()['matching_count'], 2)
        picked = set()
        for _ in range(40):
            response = self.pick(guest)
            self.assertEqual(response.status_code, 200)
            picked.add(response.json()['selected_restaurant']['id'])
        self.assertEqual(picked, {self.pizza.id, self.sushi.id})
        room = Room.objects.get()
        self.assertIsNotNone(room.selected_at)
        self.assertEqual(room.selected_by.identity_token, uuid.UUID(guest))

    def test_pick_with_conflicting_filters(self):
        guest = self.join().json()['participant_token']
        self.set_filters(self.token, cuisines=['Pizza'])
        self.set_filters(guest, cuisines=['Sushi'])
        response = self.pick(self.token)
        self.assertEqual(response.status_code, 409)
        self.assertIsNone(Room.objects.get().selected_restaurant)

    def test_inactive_participants_filters_ignored(self):
        guest = self.join().json()['participant_token']
        self.set_filters(guest, cuisines=['Sushi'])
        Participant.objects.filter(identity_token=guest).update(is_active=False)
        self.set_filters(self.token, cuisines=['Pizza'])
        self.assertEqual(self.client.get(self.base).json()['matching_count'], 2)

    def test_open_now_filter(self):
        self.set_filters(self.token, open_now=True)
        with patch('restaurants.matching.datetime') as mock_datetime:
            mock_datetime.now.return_value = datetime(2026, 11, 21, 12, 0, tzinfo=BOSTON_TZ)
            self.assertEqual(self.pick(self.token).json()['selected_restaurant']['id'], self.sushi.id)
            mock_datetime.now.return_value = datetime(2026, 11, 21, 23, 0, tzinfo=BOSTON_TZ)
            self.assertEqual(self.pick(self.token).status_code, 409)

    def test_invalid_missing_and_inactive_tokens(self):
        for token in (None, '', 'invalid', str(uuid.uuid4())):
            with self.subTest(token_present=bool(token)):
                self.assertEqual(self.pick(token).status_code, 403)
                self.assertEqual(self.set_filters(token, open_now=True).status_code, 403)
        Participant.objects.update(is_active=False)
        self.assertEqual(self.pick(self.token).status_code, 403)

    def test_wrong_room_token(self):
        other = self.client.post('/api/rooms/', {'display_name': 'Other'}, format='json').json()
        self.assertEqual(self.pick(other['participant_token']).status_code, 403)
        self.assertEqual(self.set_filters(other['participant_token'], open_now=True).status_code, 403)

    def test_closed_room(self):
        Room.objects.update(is_active=False)
        self.assertEqual(self.join().status_code, 409)
        self.assertEqual(self.pick(self.token).status_code, 409)

    def test_empty_restaurant_list(self):
        Restaurant.objects.update(licstatus="Inactive")
        self.assertEqual(self.client.get(self.base).json()['matching_count'], 0)
        self.assertEqual(self.pick(self.token).status_code, 409)

    def test_invalid_filters(self):
        for data in ({'open_now': 'true'}, {'max_distance_miles': 0}, {'max_distance_miles': 'far'},
                     {'cuisines': 'Pizza'}, {'cuisines': [''] }):
            with self.subTest(data=data):
                self.assertEqual(self.set_filters(self.token, **data).status_code, 400)

    def test_input_and_missing_rooms(self):
        for name in ('', '   ', 'a' * 101):
            self.assertEqual(self.client.post('/api/rooms/', {'display_name': name}, format='json').status_code, 400)
        for path, method in (('', 'get'), ('join/', 'post'), ('pick/', 'post'), ('filters/', 'put')):
            response = getattr(self.client, method)('/api/rooms/ZZZZZZ/' + path, {'display_name': 'Name'},
                                                    format='json', HTTP_X_PARTICIPANT_TOKEN=self.token)
            self.assertEqual(response.status_code, 404)
