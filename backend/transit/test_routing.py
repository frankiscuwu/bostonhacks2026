import os
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .client import MBTAUnavailable
from .network import build_network, decode_polyline
from .routing import find_journey, clip_shape
from .service import directions, departures, service_alerts


def fixture_network():
    coords = {"a": (42.40, -71.16), "b": (42.40, -71.10), "c": (42.40, -71.04),
              "x": (42.46, -71.10), "y": (42.34, -71.10)}
    stations = {sid: {"id": sid, "name": sid.upper(), "latitude": lat, "longitude": lon}
                for sid, (lat, lon) in coords.items()}
    return {"stations": stations, "patterns": [pattern("red", "Red", ["a", "b", "c"]),
                                                pattern("orange", "Orange", ["x", "b", "y"])],
            "fetched_at": "2026-11-21T12:00:00+00:00", "available_routes": ["Red", "Orange"]}


def pattern(pid, route_id, stops, direction=0, headsign="Terminal"):
    return {"id": pid, "route_id": route_id, "name": route_id, "color": "#DA291C",
            "direction_id": direction, "direction": "Outbound" if direction == 0 else "Inbound",
            "headsign": headsign, "stops": stops, "platforms": ["platform-" + sid for sid in stops], "shape": []}


def point(network, sid):
    station = network["stations"][sid]
    return station["latitude"], station["longitude"]


def destination(network, sid):
    return {"restaurant_id": 123, "name": "Test restaurant", "latitude": point(network, sid)[0], "longitude": point(network, sid)[1]}


class RoutingTests(SimpleTestCase):
    def test_direct_route_uses_ordered_pattern_positions(self):
        network = fixture_network()
        route = find_journey(network, point(network, "a"), point(network, "c"))
        self.assertEqual(route["segments"], [[0, 0, 2]])

    def test_one_transfer_at_shared_parent_station(self):
        network = fixture_network()
        route = find_journey(network, point(network, "a"), point(network, "y"))
        self.assertEqual(route["segments"], [[0, 0, 1], [1, 1, 2]])

    def test_direction_is_not_reversed_without_an_actual_pattern(self):
        network = fixture_network()
        self.assertIsNone(find_journey(network, point(network, "c"), point(network, "a")))
        network["patterns"].append(pattern("red-back", "Red", ["c", "b", "a"], 1, "Alewife"))
        self.assertEqual(find_journey(network, point(network, "c"), point(network, "a"))["segments"], [[2, 0, 2]])

    def test_green_branches_require_a_real_change(self):
        network = fixture_network()
        network["patterns"] = [pattern("b", "Green-B", ["a", "b", "c"], headsign="Government Center"),
                               pattern("e", "Green-E", ["x", "b", "y"], headsign="Heath Street")]
        self.assertEqual(find_journey(network, point(network, "a"), point(network, "y"))["segments"], [[0, 0, 1], [1, 1, 2]])

    def test_same_route_name_does_not_create_fake_edges(self):
        network = fixture_network()
        network["patterns"] = [pattern("red-a", "Red", ["a", "b"]), pattern("red-b", "Red", ["x", "y"])]
        self.assertIsNone(find_journey(network, point(network, "a"), point(network, "y")))

    def test_two_transfers_are_not_returned(self):
        network = fixture_network()
        network["patterns"] = [pattern("red", "Red", ["a", "b"]),
                               pattern("orange", "Orange", ["b", "c"]), pattern("blue", "Blue", ["c", "x"])]
        self.assertIsNone(find_journey(network, point(network, "a"), point(network, "x")))

    def test_considers_a_second_nearby_station(self):
        network = fixture_network()
        network["stations"]["near"] = {"id": "near", "name": "Nearby", "latitude": 42.40, "longitude": -71.149}
        network["patterns"].append(pattern("direct", "Blue", ["near", "y"]))
        self.assertEqual(find_journey(network, point(network, "a"), point(network, "y"))["segments"], [[2, 0, 1]])

    def test_no_nearby_station(self):
        self.assertIsNone(find_journey(fixture_network(), (42.7, -71.5), (42.4, -71.04)))

    def test_real_geometry_is_clipped_or_absent_never_invented(self):
        network = fixture_network()
        path = network["patterns"][0]
        self.assertIsNone(clip_shape(path, 0, 2, network["stations"]))
        path["shape"] = [point(network, sid) for sid in ("a", "b", "c")]
        geometry = clip_shape(path, 1, 2, network["stations"])
        self.assertEqual(geometry["coordinates"], [[-71.1, 42.4], [-71.04, 42.4]])

    def test_polyline_decode(self):
        self.assertEqual(decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)])
        self.assertEqual(decode_polyline("~"), [])


class TopologyTests(SimpleTestCase):
    def fixture(self):
        route = {"id": "Red", "type": "route", "attributes": {"long_name": "Red Line", "color": "DA291C", "direction_names": ["Southbound", "Northbound"]}}
        trip = {"id": "canonical", "type": "trip", "attributes": {"headsign": "Braintree", "direction_id": 0}, "relationships": {"stops": {"data": [{"id": sid} for sid in ("900", "100", "500")]}}}
        stops = [{"id": sid, "type": "stop", "attributes": {"name": sid, "latitude": 42.4, "longitude": lon}, "relationships": {"parent_station": {"data": {"id": "parent-" + sid}}}}
                 for sid, lon in (("900", -71.16), ("100", -71.1), ("500", -71.04))]
        route_pattern = {"id": "Red-pattern", "type": "route_pattern", "attributes": {"typicality": 1}, "relationships": {"route": {"data": {"id": "Red"}}, "representative_trip": {"data": {"id": "canonical"}}}}
        return {"routes": {"data": [route]}, "stops": {"data": []}, "route_patterns": {"data": [route_pattern], "included": [trip, *stops]}}

    def test_retains_mbta_stop_order_and_headsign(self):
        responses = self.fixture()
        client = Mock()
        client.get.side_effect = lambda endpoint, *a, **kw: responses[endpoint]
        result = build_network(client)
        self.assertEqual(result["patterns"][0]["stops"], ["parent-900", "parent-100", "parent-500"])
        self.assertEqual(result["patterns"][0]["headsign"], "Braintree")
        self.assertEqual(result["patterns"][0]["direction"], "Southbound")

    def test_missing_intermediate_stop_never_creates_a_shortcut(self):
        responses = self.fixture()
        responses["route_patterns"]["included"] = [x for x in responses["route_patterns"]["included"] if x["id"] != "100"]
        client = Mock()
        client.get.side_effect = lambda endpoint, *a, **kw: responses[endpoint]
        with self.assertRaises(MBTAUnavailable):
            build_network(client)


@patch.dict(os.environ, {"GEOAPIFY_API_KEY": ""})
class DepartureTests(SimpleTestCase):
    now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)

    def document(self, pattern_id="red", relationship=None):
        return {"data": [{"id": "p", "attributes": {"departure_time": "2026-11-21T12:05:00+00:00", "schedule_relationship": relationship}, "relationships": {"trip": {"data": {"id": "train"}}}}],
                "included": [{"id": "train", "type": "trip", "attributes": {"headsign": "Braintree"}, "relationships": {"route_pattern": {"data": {"id": pattern_id}}}}]}

    def test_realtime_prediction_and_headsign(self):
        client = Mock()
        client.get.return_value = self.document()
        result = departures(client, fixture_network()["patterns"][0], "a", self.now)
        self.assertEqual(result[0]["source"], "realtime")
        self.assertEqual(result[0]["headsign"], "Braintree")

    def test_missing_predictions_fall_back_to_explicitly_scheduled(self):
        client = Mock()
        client.get.side_effect = lambda endpoint, *a, **kw: {"data": []} if endpoint == "predictions" else self.document()
        self.assertEqual(departures(client, fixture_network()["patterns"][0], "a", self.now)[0]["source"], "schedule")

    def test_wrong_branch_cancelled_or_stale_predictions_not_shown(self):
        stale = self.document()
        stale["data"][0]["attributes"]["departure_time"] = "2026-11-20T12:00:00+00:00"
        for document in (self.document("wrong-branch"), self.document(relationship="SKIPPED"), stale):
            client = Mock()
            client.get.side_effect = lambda endpoint, *a, **kw: document if endpoint == "predictions" else {"data": []}
            self.assertEqual(departures(client, fixture_network()["patterns"][0], "a", self.now), [])

    def test_active_alerts_are_returned_without_inventing_reroutes(self):
        client = Mock()
        client.get.return_value = {"data": [
            {"id": "active", "attributes": {"header": "Service disruption", "effect": "SUSPENSION", "active_period": [{"start": "2026-11-21T11:00:00Z", "end": "2026-11-21T13:00:00Z"}]}},
            {"id": "future", "attributes": {"header": "Future alert", "active_period": [{"start": "2026-11-22T00:00:00Z"}]}},
        ]}
        alerts, warnings = service_alerts(client, {"Red"}, self.now)
        self.assertEqual([a["id"] for a in alerts], ["active"])
        self.assertEqual(alerts[0]["effect"], "SUSPENSION")
        self.assertEqual(warnings, [])

    def test_optional_provider_failures_keep_honest_structural_route(self):
        network = fixture_network()
        client = Mock()
        client.get.side_effect = MBTAUnavailable()
        with patch("transit.service.get_network", return_value=network):
            result = directions(point(network, "a"), destination(network, "c"), client=client, now=self.now)
        self.assertEqual(result["status"], "ok")
        self.assertIsNone(result["summary"]["duration_minutes"])
        self.assertIsNone(result["legs"][0]["geometry"])
        self.assertEqual(result["legs"][0]["distance_basis"], "straight_line")
        self.assertIn("alerts_unavailable", {w["code"] for w in result["warnings"]})
        self.assertIn("departures_unavailable", {w["code"] for w in result["warnings"]})

    def test_network_failure_and_outside_coverage(self):
        with patch("transit.service.get_network", side_effect=MBTAUnavailable()):
            self.assertEqual(directions((42.4, -71.1), destination(fixture_network(), "c"))["status"], "unavailable")
        with patch("transit.service.get_network") as load:
            self.assertEqual(directions((0, 0), destination(fixture_network(), "c"))["status"], "unsupported")
            load.assert_not_called()
