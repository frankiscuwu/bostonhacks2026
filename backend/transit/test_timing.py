from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .timing import timed_ride, evaluate
from .routing import find_journeys
from .service import directions
from .test_routing import fixture_network, point, destination


class TimingTests(SimpleTestCase):
    now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)

    def doc(self, pid='red', trip='train', start='platform-a', end='platform-c', departure=5, arrival=15):
        def row(stop, minute, seq):
            time = (self.now + timedelta(minutes=minute)).isoformat()
            return {'id': trip + stop, 'attributes': {'arrival_time': time, 'departure_time': time, 'stop_sequence': seq},
                    'relationships': {'stop': {'data': {'id': stop}}, 'trip': {'data': {'id': trip}}}}
        return {'data': [row(start, departure, 1), row(end, arrival, 3)],
                'included': [{'type': 'trip', 'id': trip, 'relationships': {'route_pattern': {'data': {'id': pid}}}}]}

    def mbta_client(self, predictions=None, schedules=None):
        client = Mock()
        client.get.side_effect = lambda endpoint, *args, **kw: (predictions or {'data': []}) if endpoint == 'predictions' else (schedules or {'data': []})
        return client

    def test_live_same_trip_ordered_events(self):
        ride = timed_ride(self.mbta_client(self.doc()), fixture_network()['patterns'][0], 0, 2, self.now + timedelta(minutes=3), self.now)
        self.assertEqual(ride['source'], 'realtime')
        self.assertEqual(ride['duration_seconds'], 600)
        self.assertEqual(ride['wait_seconds'], 120)

    def test_scheduled_fallback_and_missing_schedule_information(self):
        p = fixture_network()['patterns'][0]
        ride = timed_ride(self.mbta_client(schedules=self.doc()), p, 0, 2, self.now, self.now)
        self.assertEqual(ride['source'], 'schedule')
        self.assertIsNone(timed_ride(self.mbta_client(), p, 0, 2, self.now, self.now))

    def test_missed_train_does_not_reappear_from_its_schedule(self):
        ride = timed_ride(self.mbta_client(self.doc(departure=1), self.doc(departure=8)), fixture_network()['patterns'][0], 0, 2, self.now + timedelta(minutes=3), self.now)
        self.assertIsNone(ride)

    def test_cancelled_trip_wrong_branch_and_reversed_order_are_rejected(self):
        p = fixture_network()['patterns'][0]
        wrong = self.doc(pid='wrong-branch')
        reversed_doc = self.doc()
        reversed_doc['data'][1]['attributes']['stop_sequence'] = 0
        cancelled = self.doc()
        cancelled['data'][0]['attributes']['schedule_relationship'] = 'CANCELED'
        for doc in (wrong, reversed_doc, cancelled):
            self.assertIsNone(timed_ride(self.mbta_client(doc), p, 0, 2, self.now, self.now))

    def test_live_board_and_scheduled_alight_are_explicitly_mixed(self):
        live = self.doc(departure=6)
        live['data'] = live['data'][:1]
        ride = timed_ride(self.mbta_client(live, self.doc()), fixture_network()['patterns'][0], 0, 2, self.now, self.now)
        self.assertEqual(ride['source'], 'mixed')
        self.assertEqual(ride['duration_seconds'], 540)

    def test_eta_aggregation_uses_walk_wait_and_actual_train_times(self):
        result = evaluate(self.mbta_client(self.doc()), fixture_network(), {'segments': [[0, 0, 2]]}, [{'duration_seconds': 180}, {'duration_seconds': 120}], self.now)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['duration_seconds'], 1020)
        self.assertEqual(result['walking_seconds'], 300)
        self.assertEqual(result['waiting_seconds'], 120)
        self.assertEqual(result['transit_seconds'], 600)

    def test_feasible_and_missed_same_platform_connections(self):
        network = fixture_network()
        journey = {'segments': [[0, 0, 1], [1, 1, 2]]}
        for departure, status in ((12, 'complete'), (9, 'unavailable')):
            def get(endpoint, params, **kwargs):
                return self.doc(start='platform-a', end='platform-b', arrival=10) if params['filter[route]'] == 'Red' else self.doc(pid='orange', trip='second', start='platform-b', end='platform-y', departure=departure, arrival=20)
            client = Mock(); client.get.side_effect = get
            result = evaluate(client, network, journey, [{'duration_seconds': 60}, {'duration_seconds': 60}], self.now)
            self.assertEqual(result['status'], status)

    def test_unknown_platform_transfer_and_missing_walks_suppress_eta(self):
        network = fixture_network()
        network['patterns'][1]['platforms'][1] = 'different-platform'
        result = evaluate(self.mbta_client(self.doc(end='platform-b', arrival=10)), network, {'segments': [[0, 0, 1], [1, 1, 2]]}, [{'duration_seconds': 60}, {'duration_seconds': 60}], self.now)
        self.assertEqual(result['reason'], 'platform_transfer_time_unverified')
        self.assertEqual(evaluate(self.mbta_client(), network, {}, [{'duration_seconds': None}], self.now)['reason'], 'walking_time_unavailable')

    def test_alternatives_are_real_directed_patterns(self):
        network = fixture_network()
        result = find_journeys(network, point(network, 'a'), point(network, 'y'))
        self.assertTrue(result)
        self.assertEqual(len(result[0]['segments']), 2)
        self.assertTrue(all(end > start for c in result for _, start, end in c['segments']))

    def test_service_uses_real_walks_and_fastest_feasible_alternative(self):
        network = fixture_network()
        # Alternate representative pattern serves the same real sequence.
        other = dict(network['patterns'][0], id='red-fast')
        network['patterns'].append(other)
        client = self.mbta_client()
        geo = Mock()
        geo.walking.return_value = {'geometry': {'type': 'LineString', 'coordinates': [[-71.16, 42.4], [-71.04, 42.4]]}, 'distance_m': 100, 'duration_seconds': 60, 'distance_basis': 'pedestrian_route', 'steps': []}
        def get(endpoint, params, **kwargs):
            if endpoint == 'alerts': return {'data': []}
            a = self.doc(arrival=20)
            b = self.doc(pid='red-fast', trip='fast', departure=6, arrival=12)
            return {'data': a['data'] + b['data'], 'included': a['included'] + b['included']}
        client.get.side_effect = get
        with patch('transit.service.get_network', return_value=network):
            result = directions(point(network, 'a'), destination(network, 'c'), client=client, geo_client=geo, now=self.now)
        self.assertEqual(result['eta']['status'], 'complete')
        self.assertEqual(result['legs'][1]['pattern_id'], 'red-fast')
        self.assertEqual(result['summary']['duration_minutes'], 13)

    def test_cancelled_live_trip_without_metadata_cannot_return_via_schedule(self):
        live = self.doc()
        live['included'] = []
        live['data'][0]['attributes']['schedule_relationship'] = 'CANCELED'
        self.assertIsNone(timed_ride(self.mbta_client(live, self.doc()), fixture_network()['patterns'][0], 0, 2, self.now, self.now))

    def test_overnight_service_date_uses_gtfs_extended_hours(self):
        now = datetime(2026, 11, 22, 6, tzinfo=timezone.utc)  # 01:00 Boston
        client = self.mbta_client()
        timed_ride(client, fixture_network()['patterns'][0], 0, 2, now, now)
        params = client.get.call_args.args[1]
        self.assertEqual(params['filter[date]'], '2026-11-21')
        self.assertEqual(params['filter[min_time]'], '25:00')

    def test_disruption_withholds_normal_pattern_eta(self):
        network = fixture_network()
        client = self.mbta_client()
        client.get.side_effect = lambda endpoint, *args, **kwargs: {'data': [{'id': 'closure', 'attributes': {'effect': 'SHUTTLE', 'header': 'Shuttle service'}}]} if endpoint == 'alerts' else self.doc()
        geo = Mock()
        geo.walking.return_value = {'geometry': None, 'duration_seconds': 60, 'distance_m': 80, 'distance_basis': 'pedestrian_route', 'steps': []}
        with patch('transit.service.get_network', return_value=network):
            result = directions(point(network, 'a'), destination(network, 'c'), client=client, geo_client=geo, now=self.now)
        self.assertEqual(result['eta']['status'], 'unavailable')
        self.assertEqual(result['eta']['reason'], 'service_disruption_route_unverified')
        self.assertNotIn('arrival_time', result['eta'])
        self.assertIsNone(result['summary']['duration_minutes'])
        self.assertFalse(result['legs'][1]['departure_is_feasible'])

    def test_closed_line_is_not_preferred_over_an_available_alternative(self):
        network = fixture_network()
        network['patterns'].append(dict(network['patterns'][0], id='green', route_id='Green-E'))
        client = Mock()
        def get(endpoint, params, **kwargs):
            if endpoint == 'alerts':
                return {'data': [{'id': 'red-closure', 'attributes': {'effect': 'SUSPENSION', 'informed_entity': [{'route': 'Red'}]}}]}
            fast = self.doc(arrival=12)
            slow = self.doc(pid='green', trip='green-train', arrival=20)
            return {'data': fast['data'] + slow['data'], 'included': fast['included'] + slow['included']}
        client.get.side_effect = get
        geo = Mock()
        geo.walking.return_value = {'geometry': None, 'duration_seconds': 60, 'distance_m': 80, 'distance_basis': 'pedestrian_route', 'steps': []}
        with patch('transit.service.get_network', return_value=network):
            result = directions(point(network, 'a'), destination(network, 'c'), client=client, geo_client=geo, now=self.now)
        self.assertEqual(result['eta']['status'], 'complete')
        self.assertEqual(result['legs'][1]['route']['id'], 'Green-E')
        self.assertEqual(result['alerts'], [])
