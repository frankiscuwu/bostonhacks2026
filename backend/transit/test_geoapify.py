import json
import os
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from .geoapify import GeoapifyClient, GeoapifyUnavailable


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
@patch.dict(os.environ, {'GEOAPIFY_API_KEY': 'geo-unit-secret'})
class GeoapifyTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def response(self, document):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(document).encode()
        return response

    @patch('transit.geoapify.build_opener')
    def test_address_search_is_compact_cached_and_boston_biased(self, opener):
        opener.return_value.open.return_value = self.response({'results': [{'place_id': 'one', 'formatted': '700 Commonwealth Avenue, Boston', 'lat': 42.35, 'lon': -71.1}]})
        client = GeoapifyClient()
        result = client.search('700 Commonwealth Avenue')
        self.assertEqual(result[0]['label'], '700 Commonwealth Avenue, Boston')
        self.assertEqual(client.search('700 Commonwealth Avenue'), result)
        opener.return_value.open.assert_called_once()
        url = opener.return_value.open.call_args.args[0].full_url
        self.assertIn('/geocode/autocomplete?', url)
        self.assertIn('bias=proximity', url)
        self.assertNotIn('geo-unit-secret', str(result))

    @patch('transit.geoapify.build_opener')
    def test_geocode_and_ambiguous_results_require_user_choice(self, opener):
        opener.return_value.open.return_value = self.response({'results': [
            {'formatted': 'Harvard Square, Cambridge', 'lat': 42.37, 'lon': -71.12},
            {'formatted': 'Harvard Street, Boston', 'lat': 42.34, 'lon': -71.1}]})
        result = APIClient().get('/api/transit/addresses/', {'q': 'Harvard', 'mode': 'geocode'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['status'], 'ambiguous')
        self.assertEqual(len(result.json()['suggestions']), 2)
        self.assertIn('/geocode/search?', opener.return_value.open.call_args.args[0].full_url)
        self.assertIn('no-store', result['Cache-Control'])

    @patch('transit.geoapify.build_opener')
    def test_invalid_queries_no_results_and_bad_coordinates(self, opener):
        for text in ('', 'ab', 'x' * 201, 'abc\nxyz'):
            self.assertEqual(APIClient().get('/api/transit/addresses/', {'q': text}).status_code, 400)
        opener.return_value.open.assert_not_called()
        opener.return_value.open.return_value = self.response({'results': [{'formatted': 'bad', 'lat': float('nan'), 'lon': -71}]})
        self.assertEqual(APIClient().get('/api/transit/addresses/', {'q': 'missing address'}).json()['status'], 'no_results')
        for point in ((91, 0), (float('nan'), 0), (42, float('inf'))):
            with self.assertRaises(ValueError):
                GeoapifyClient().walking(point, (42, -71))

    @patch('transit.geoapify.build_opener')
    def test_provider_failures_are_safe_and_rate_limits_cool_down(self, opener):
        for error, code in ((HTTPError('https://provider/?apiKey=geo-unit-secret', 403, 'secret', {}, None), 'geoapify_authorization_failed'),
                            (TimeoutError(), 'geoapify_unavailable'), (URLError('offline'), 'geoapify_unavailable')):
            opener.return_value.open.side_effect = error
            with self.assertRaises(GeoapifyUnavailable) as result:
                GeoapifyClient().search('Boston University')
            self.assertEqual(result.exception.code, code)
            self.assertNotIn('geo-unit-secret', str(result.exception))
        opener.return_value.open.side_effect = HTTPError('https://provider', 429, '', {}, None)
        before = opener.return_value.open.call_count
        for _ in range(2):
            with self.assertRaises(GeoapifyUnavailable) as result:
                GeoapifyClient().search('Harvard Square')
            self.assertEqual(result.exception.code, 'geoapify_rate_limited')
        self.assertEqual(opener.return_value.open.call_count, before + 1)

    @patch('transit.geoapify.build_opener')
    def test_missing_key_and_api_errors_never_reach_browser(self, opener):
        with patch.dict(os.environ, {'GEOAPIFY_API_KEY': ''}):
            response = APIClient().get('/api/transit/addresses/', {'q': 'Boston University'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'geoapify_not_configured')
        opener.return_value.open.assert_not_called()
        self.assertNotIn('geo-unit-secret', response.content.decode())

    @patch('transit.geoapify.build_opener')
    def test_pedestrian_geometry_duration_and_optional_turns(self, opener):
        opener.return_value.open.return_value = self.response({'features': [{'geometry': {'type': 'MultiLineString', 'coordinates': [[[-71.1, 42.35], [-71.101, 42.351]]]},
            'properties': {'time': 140, 'distance': 180, 'legs': [{'steps': [{'instruction': {'text': 'Continue on the footpath'}}]}]}}]})
        route = GeoapifyClient().walking((42.35, -71.1), (42.351, -71.101))
        self.assertEqual(route['duration_seconds'], 140)
        self.assertEqual(route['distance_m'], 180)
        self.assertEqual(route['geometry']['type'], 'LineString')
        self.assertEqual(route['steps'], ['Continue on the footpath'])
        self.assertIn('mode=walk', opener.return_value.open.call_args.args[0].full_url)

    @patch('transit.geoapify.build_opener')
    def test_missing_or_invalid_geometry_never_becomes_a_walking_route(self, opener):
        for document in ({'features': []}, {'features': [{'geometry': {'type': 'LineString', 'coordinates': [[-72, 43], [-73, 44]]}, 'properties': {'time': 10, 'distance': 100}}]}):
            cache.clear()
            opener.return_value.open.return_value = self.response(document)
            with self.assertRaises(GeoapifyUnavailable):
                GeoapifyClient().walking((42.35, -71.1), (42.351, -71.101))
