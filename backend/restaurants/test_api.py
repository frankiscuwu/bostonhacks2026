from django.test import TestCase
from rest_framework.test import APIClient

from .models import Restaurant
from .tests import inactive_data, restaurant_data


class RestaurantAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.near = Restaurant.objects.create(**restaurant_data())
        self.far = Restaurant.objects.create(**restaurant_data(cuisine="italian", latitude=41.0))
        Restaurant.objects.create(**inactive_data())

    def test_active_and_ordered(self):
        self.assertEqual([r['id'] for r in self.client.get('/api/restaurants/').json()], [self.near.id, self.far.id])

    def test_public_shape(self):
        row = self.client.get('/api/restaurants/').json()[0]
        self.assertEqual(row['name'], 'Boston Noodles')
        self.assertEqual(row['address'], '123 Main St, Boston, MA 02110')
        self.assertIsNone(row['price_level'])
        self.assertIsNone(row['rating'])
        self.assertEqual(row['image_url'], '')
        self.assertNotIn('licstatus', row)

    def test_filters(self):
        for query in ({'cuisine': 'chinese'}, {'cuisine': 'CHIN'},
                      {'latitude': 42.3601, 'longitude': -71.0589, 'max_distance_km': 1},
                      {'cuisine': 'Chinese', 'latitude': 42.3601, 'longitude': -71.0589, 'max_distance_km': 1}):
            with self.subTest(query=query):
                response = self.client.get('/api/restaurants/', query)
                self.assertEqual(response.status_code, 200)
                self.assertEqual([r['id'] for r in response.json()], [self.near.id])
        self.assertEqual(self.client.get('/api/restaurants/', {'cuisine': 'Unknown'}).json(), [])

    def test_invalid_filters(self):
        for query in ({'latitude': 91}, {'max_distance_km': 1}, {'max_distance_km': -1},
                      {'latitude': 'nan', 'longitude': -71, 'max_distance_km': 1},
                      {'latitude': 42, 'longitude': -71}):
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/restaurants/', query).status_code, 400)

    def test_unknown_metadata_is_not_invented(self):
        row = self.client.get('/api/restaurants/').json()[0]
        self.assertIsNone(row['price_level'])
        self.assertIsNone(row['rating'])
        self.assertEqual(row['creator_video_url'], '')
        self.assertEqual(row['image_url'], '')

    def test_unavailable_numeric_filters_are_not_silently_ignored(self):
        for query in ({'max_price': 2}, {'min_rating': 4},
                      {'max_price': 4, 'min_rating': 0}, {'max_price': ''}):
            with self.subTest(query=query):
                response = self.client.get('/api/restaurants/', query)
                self.assertEqual(response.status_code, 400)
                for key in query:
                    self.assertIn(key, response.json())

    def test_vote_header_cors_preflight(self):
        response = self.client.options(
            '/api/rooms/ABC123/vote/', HTTP_ORIGIN='http://localhost:5173',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type,x-participant-token',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Access-Control-Allow-Origin'], 'http://localhost:5173')
        self.assertIn('x-participant-token', response['Access-Control-Allow-Headers'])
