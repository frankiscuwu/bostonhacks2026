from django.test import TestCase
from rest_framework.test import APIClient

from .models import Restaurant
from .tests import restaurant_data


class RestaurantAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.near = Restaurant.objects.create(**restaurant_data())
        self.far = Restaurant.objects.create(**restaurant_data(
            cuisine='Italian', price_level=4, rating='3.00', latitude='41.000000'))
        Restaurant.objects.create(**restaurant_data(is_active=False))

    def test_active_and_ordered(self):
        self.assertEqual([r['id'] for r in self.client.get('/api/restaurants/').json()], [self.near.id, self.far.id])

    def test_filters(self):
        for query in ({'cuisine': 'chinese'}, {'max_price': 2}, {'min_rating': 4},
                      {'latitude': 42.3601, 'longitude': -71.0589, 'max_distance_km': 1},
                      {'cuisine': 'Chinese', 'max_price': 2, 'min_rating': 4}):
            with self.subTest(query=query):
                response = self.client.get('/api/restaurants/', query)
                self.assertEqual(response.status_code, 200)
                self.assertEqual([r['id'] for r in response.json()], [self.near.id])
        self.assertEqual(self.client.get('/api/restaurants/', {'cuisine': 'Unknown'}).json(), [])

    def test_invalid_filters(self):
        for query in ({'max_price': 5}, {'min_rating': -1}, {'latitude': 91},
                      {'max_distance_km': 1}, {'max_distance_km': -1}, {'min_rating': 'nan'},
                      {'latitude': 42, 'longitude': -71}):
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/restaurants/', query).status_code, 400)
