import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from restaurants.models import Restaurant
from restaurants.tests import inactive_data, restaurant_data
from .models import Participant, Room, Vote


class RoomAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.first = Restaurant.objects.create(**restaurant_data())
        self.second = Restaurant.objects.create(**restaurant_data(dbaname="Second"))
        self.third = Restaurant.objects.create(**inactive_data(dbaname="Inactive"))
        response = self.client.post('/api/rooms/', {'display_name': 'Host'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.creation = response.json()
        self.code = self.creation['room']['code']
        self.token = self.creation['participant_token']
        self.base = f'/api/rooms/{self.code}/'

    def join(self, name='Guest'):
        return self.client.post(self.base + 'join/', {'display_name': name}, format='json')

    def vote(self, token=None, round_number=1, restaurant=None, vote=True):
        headers = {} if token is None else {'HTTP_X_PARTICIPANT_TOKEN': token}
        return self.client.post(self.base + 'vote/', {
            'round_number': round_number, 'restaurant_id': restaurant or self.first.id,
            'vote': vote}, format='json', **headers)

    def test_create_room(self):
        room = self.creation['room']
        self.assertEqual(room['current_restaurant']['id'], self.first.id)
        self.assertEqual(room['current_round'], 1)
        self.assertEqual(room['voting_progress']['required_count'], 1)
        self.assertEqual(Participant.objects.get().identity_token, uuid.UUID(self.token))

    def test_join_and_public_state_no_tokens(self):
        joined = self.join()
        self.assertEqual(joined.status_code, 201)
        guest_token = joined.json()['participant_token']
        self.assertNotEqual(guest_token, self.token)
        for url in (self.base, self.base + 'results/', '/api/restaurants/'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            content = response.content.decode()
            for secret in (self.token, guest_token, 'identity_token', 'participant_token'):
                self.assertNotIn(secret, content)
        self.assertEqual(self.client.get(self.base).json()['voting_progress']['required_count'], 2)

    def test_successful_vote_advances(self):
        response = self.vote(self.token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['current_restaurant']['id'], self.second.id)
        self.assertEqual(response.json()['current_round'], 2)
        self.assertEqual(response.json()['voting_progress']['voted_count'], 0)
        self.assertEqual(Vote.objects.count(), 1)

    def test_waits_for_everyone_and_prevents_duplicate(self):
        guest = self.join().json()['participant_token']
        response = self.vote(self.token)
        self.assertEqual(response.json()['current_round'], 1)
        self.assertEqual(response.json()['voting_progress']['voted_count'], 1)
        self.assertEqual(self.vote(self.token, vote=False).status_code, 409)
        self.assertEqual(Vote.objects.count(), 1)
        response = self.vote(guest, vote=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['current_round'], 2)
        self.assertEqual(Vote.objects.count(), 2)

    def test_mid_round_join_blocks_advance(self):
        guest = self.join().json()['participant_token']
        self.vote(self.token)
        late = self.join('Late').json()['participant_token']
        response = self.vote(guest)
        self.assertEqual(response.json()['current_round'], 1)
        self.assertEqual(response.json()['voting_progress']['required_count'], 3)
        self.assertEqual(self.vote(late).json()['current_round'], 2)

    def test_join_after_advance_joins_new_round(self):
        self.vote(self.token)
        response = self.join()
        self.assertEqual(response.json()['room']['current_round'], 2)
        self.assertEqual(response.json()['room']['voting_progress']['required_count'], 2)

    def test_invalid_missing_and_inactive_tokens(self):
        for token in (None, '', 'invalid', str(uuid.uuid4())):
            with self.subTest(token_present=bool(token)):
                response = self.vote(token)
                self.assertEqual(response.status_code, 403)
        Participant.objects.update(is_active=False)
        self.assertEqual(self.vote(self.token).status_code, 403)
        self.assertEqual(Vote.objects.count(), 0)

    def test_wrong_room_token(self):
        other = self.client.post('/api/rooms/', {'display_name': 'Other'}, format='json').json()
        self.assertEqual(self.vote(other['participant_token']).status_code, 403)
        self.assertEqual(Vote.objects.count(), 0)

    def test_stale_round_and_wrong_restaurant(self):
        self.assertEqual(self.vote(self.token, restaurant=self.second.id).status_code, 409)
        self.assertEqual(self.vote(self.token, round_number=2).status_code, 409)
        self.vote(self.token)
        self.assertEqual(self.vote(self.token).status_code, 409)
        self.assertEqual(Vote.objects.count(), 1)

    def test_completed_room(self):
        self.vote(self.token)
        response = self.vote(self.token, round_number=2, restaurant=self.second.id)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['is_active'])
        self.assertIsNone(response.json()['current_restaurant'])
        self.assertEqual(response.json()['current_round'], 3)
        self.assertEqual(self.join().status_code, 409)
        self.assertEqual(self.vote(self.token, round_number=3).status_code, 409)

    def test_empty_restaurant_list(self):
        Restaurant.objects.update(licstatus="Inactive")
        response = self.client.post('/api/rooms/', {'display_name': 'Empty'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['room']['is_active'])
        self.assertIsNone(response.json()['room']['current_restaurant'])
        self.assertEqual(self.client.get('/api/restaurants/').json(), [])

    def test_results_rank_approval(self):
        guest = self.join().json()['participant_token']
        self.vote(self.token, vote=False)
        self.vote(guest)
        self.vote(self.token, round_number=2, restaurant=self.second.id)
        self.vote(guest, round_number=2, restaurant=self.second.id)
        rows = self.client.get(self.base + 'results/').json()
        self.assertEqual([r['restaurant']['id'] for r in rows], [self.second.id, self.first.id])
        self.assertEqual(rows[0]['approval_rate'], 1)
        self.assertEqual(rows[1]['approval_rate'], 0.5)
        self.assertEqual(rows[1]['yes_count'], 1)
        self.assertEqual(rows[1]['no_count'], 1)
        self.assertEqual(rows[1]['total_votes'], 2)

    def test_results_do_not_count_other_rooms(self):
        other = Room.objects.create(current_restaurant=self.first)
        participant = Participant.objects.create(room=other, display_name='Other')
        Vote.objects.create(room=other, participant=participant, restaurant=self.first, round_number=1, vote=True)
        self.assertEqual(self.client.get(self.base + 'results/').json(), [])

    def test_input_and_missing_rooms(self):
        for name in ('', '   ', 'a' * 101):
            self.assertEqual(self.client.post('/api/rooms/', {'display_name': name}, format='json').status_code, 400)
        self.assertEqual(self.vote(self.token, vote='false').status_code, 400)
        for path, method in (('', 'get'), ('results/', 'get'), ('join/', 'post'), ('vote/', 'post')):
            data = {'display_name': 'Name', 'round_number': 1, 'restaurant_id': self.first.id, 'vote': True}
            response = getattr(self.client, method)('/api/rooms/ZZZZZZ/' + path, data, format='json', HTTP_X_PARTICIPANT_TOKEN=self.token)
            self.assertEqual(response.status_code, 404)

    def test_inactive_participants_are_not_required(self):
        self.join()
        Participant.objects.exclude(identity_token=self.token).update(is_active=False)
        response = self.vote(self.token, vote=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['current_round'], 2)
        self.assertFalse(Vote.objects.get().vote)

    def test_results_with_overlapping_other_room_votes(self):
        self.vote(self.token, vote=False)
        other = Room.objects.create(current_restaurant=self.first)
        participant = Participant.objects.create(room=other, display_name='Other')
        Vote.objects.create(room=other, participant=participant, restaurant=self.first, round_number=1, vote=True)
        row = self.client.get(self.base + 'results/').json()[0]
        self.assertEqual(row['total_votes'], 1)
        self.assertEqual(row['yes_count'], 0)

    def test_missing_vote_fields(self):
        for data in ({'vote': True}, {'round_number': 1, 'restaurant_id': self.first.id}, {}):
            self.assertEqual(self.client.post(self.base + 'vote/', data, format='json',
                HTTP_X_PARTICIPANT_TOKEN=self.token).status_code, 400)
        self.assertFalse(Vote.objects.exists())

    def test_unknown_metadata_in_room_and_results(self):
        room_restaurant = self.client.get(self.base).json()['current_restaurant']
        self.assertIsNone(room_restaurant['price_level'])
        self.assertIsNone(room_restaurant['rating'])
        self.assertEqual(room_restaurant['creator_video_url'], '')
        self.assertEqual(self.vote(self.token).status_code, 200)
        result_restaurant = self.client.get(self.base + 'results/').json()[0]['restaurant']
        self.assertIsNone(result_restaurant['rating'])
        self.assertEqual(result_restaurant['image_url'], '')
