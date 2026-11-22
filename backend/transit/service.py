"""Compose a structural itinerary and optional live/scheduled station departures."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .client import MBTAClient, MBTAUnavailable, ROUTES
from .network import get_network, relationship, distance
from .routing import find_journeys, clip_shape, station_point
from .geoapify import GeoapifyClient, GeoapifyUnavailable
from .timing import evaluate, instant
import math
import time


def warning(code, message):
    return {"code": code, "message": message}


def departures(client, pattern, station_id, now):
    filters = {"filter[stop]": station_id, "filter[route]": pattern["route_id"],
               "filter[direction_id]": str(pattern["direction_id"]), "include": "trip.route_pattern"}
    def read(endpoint, params):
        document = client.get(endpoint, params, ttl=20 if endpoint == "predictions" else 60)
        trips = {x["id"]: x for x in document.get("included", []) if x["type"] == "trip"}
        result = []
        for row in document["data"]:
            trip = trips.get(relationship(row, "trip"), {})
            # Route/direction alone cannot distinguish Red Line terminals or
            # short turns. Never display predictions for the wrong pattern.
            if relationship(trip, "route_pattern") != pattern["id"]:
                continue
            attrs = row.get("attributes", {})
            if attrs.get("schedule_relationship") in ("SKIPPED", "CANCELED") or attrs.get("pickup_type") == 1:
                continue
            value = attrs.get("departure_time") or attrs.get("arrival_time")
            if not value:
                continue
            try:
                instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if instant.tzinfo is None or instant < now:
                    continue
            except ValueError:
                continue
            result.append({"time": instant.isoformat(), "source": "realtime" if endpoint == "predictions" else "schedule",
                           "headsign": trip.get("attributes", {}).get("headsign") or pattern["headsign"],
                           "status": attrs.get("status")})
        return sorted(result, key=lambda x: x["time"])[:3]
    try:
        result = read("predictions", filters)
        if result:
            return result
    except MBTAUnavailable:
        pass
    local = now.astimezone(ZoneInfo("America/New_York"))
    service_date = (local - timedelta(days=1) if local.hour < 3 else local).date().isoformat()
    try:
        return read("schedules", {**filters, "filter[date]": service_date, "filter[min_time]": local.strftime("%H:%M"), "sort": "departure_time"})
    except MBTAUnavailable:
        return []


def service_alerts(client, route_ids, now):
    try:
        document = client.get("alerts", {"filter[route]": ",".join(sorted(route_ids))}, ttl=60)
    except MBTAUnavailable:
        return [], [warning("alerts_unavailable", "MBTA service alerts could not be checked. Verify service before travel.")]
    alerts = []
    for row in document["data"]:
        attrs = row.get("attributes", {})
        active = attrs.get("active_period", [])
        if active:
            def current(period):
                try:
                    start = datetime.fromisoformat(period["start"].replace("Z", "+00:00")) if period.get("start") else None
                    end = datetime.fromisoformat(period["end"].replace("Z", "+00:00")) if period.get("end") else None
                    return (start is None or start <= now) and (end is None or now < end)
                except (ValueError, TypeError):
                    return False
            if not any(current(p) for p in active):
                continue
        alerts.append({"id": row["id"], "effect": attrs.get("effect"),
                       "header": attrs.get("header") or "MBTA service advisory", "url": attrs.get("url"),
                       "routes": sorted({e['route'] for e in attrs.get('informed_entity', []) if e.get('route') in ROUTES})})
    alerts.sort(key=lambda a: a.get('effect') not in ('SUSPENSION', 'SHUTTLE'))
    return alerts[:30], []


def directions(origin, destination, client=None, now=None, geo_client=None):
    client, now = client or MBTAClient(), now or datetime.now(timezone.utc)
    deadline = time.monotonic() + 40
    client.deadline = deadline
    geo_client = geo_client or GeoapifyClient()
    warnings = [warning("normal_service_pattern", "Normal rail patterns are shown. Review service advisories; closure rerouting is not supported.")]
    result = {"status": "ok", "origin": {"latitude": origin[0], "longitude": origin[1]},
              "destination": destination, "boarding_station": None, "exit_station": None,
              "legs": [], "warnings": warnings, "alerts": [], "generated_at": now.isoformat(),
              "summary": None, "network_fetched_at": None}
    target = destination["latitude"], destination["longitude"]
    if not all(41.8 <= lat <= 42.8 and -71.8 <= lon <= -70.5 for lat, lon in (origin, target)):
        result.update(status="unsupported")
        warnings.append(warning("outside_coverage", "Only MBTA rapid-transit rail in the Boston area is supported."))
        return result
    try:
        network = get_network(client)
    except MBTAUnavailable as exc:
        result.update(status="unavailable")
        message = "MBTA authorization failed. The server's MBTA API configuration needs attention." if exc.code == "mbta_authorization_failed" else "MBTA network data is temporarily unavailable. Try again shortly."
        warnings.append(warning(exc.code, message))
        return result
    result["network_fetched_at"] = network["fetched_at"]
    result["available_routes"] = network["available_routes"]
    if set(network["available_routes"]) != set(ROUTES):
        warnings.append(warning("partial_network", "Some supported MBTA lines are missing from the current data; route coverage is incomplete."))
    candidates = find_journeys(network, origin, target, limit=3)
    if not candidates:
        result.update(status="no_route")
        warnings.append(warning("no_supported_route", "No rail journey with at most one transfer and stations within 1.5 km straight-line walking distance was found. Buses, commuter rail and longer transfers are not included."))
        return result
    stations, patterns = network["stations"], network["patterns"]
    origin_point = {"name": "Your starting location", **result["origin"]}
    destination_point = {"name": destination["name"], "latitude": target[0], "longitude": target[1]}
    walk_cache = {}
    def walk(a, b):
        key = station_point(a), station_point(b)
        if key not in walk_cache:
            base = {"type": "walk", "from": a, "to": b, "geometry": None,
                    "distance_basis": "straight_line", "approximate_distance_m": round(distance(*key)),
                    "duration_seconds": None, "steps": [], "instruction": f"Walk toward {b['name']}"}
            try:
                base.update(geo_client.walking(*key))
            except GeoapifyUnavailable as exc:
                base['fallback_reason'] = exc.code
            walk_cache[key] = base
        return walk_cache[key]
    evaluated = []
    for candidate in candidates:
        if evaluated and time.monotonic() >= deadline - 3:
            break
        first, last = candidate['segments'][0], candidate['segments'][-1]
        board = stations[patterns[first[0]]['stops'][first[1]]]
        exit_point = stations[patterns[last[0]]['stops'][last[2]]]
        walking = [walk(origin_point, board), walk(exit_point, destination_point)]
        eta = evaluate(client, network, candidate, walking, now)
        evaluated.append((candidate, board, exit_point, walking, eta))
    all_route_ids = {patterns[pi]['route_id'] for item in evaluated for pi, _, _ in item[0]['segments']}
    all_alerts, alert_warnings = service_alerts(client, all_route_ids, now)
    warnings.extend(alert_warnings)
    def applicable(alert, routes):
        return not alert['routes'] or bool(set(alert['routes']) & routes)
    def disrupted(candidate):
        routes = {patterns[pi]['route_id'] for pi, _, _ in candidate['segments']}
        return any(a.get('effect') in ('SUSPENSION', 'SHUTTLE') and applicable(a, routes) for a in all_alerts)
    complete = [item for item in evaluated if item[4]['status'] == 'complete' and not disrupted(item[0])]
    chosen = min(complete, key=lambda item: instant(item[4]['arrival_time'])) if complete else evaluated[0]
    journey, boarding, exit_station, walking, eta = chosen
    result.update(boarding_station=boarding, exit_station=exit_station, eta={k: v for k, v in eta.items() if k != 'rides'}, alternatives_evaluated=len(evaluated))
    if any(w['geometry'] is None for w in walking):
        warnings.append(warning('approximate_walking', 'Pedestrian routing unavailable for part of this journey. Dashed straight-line connectors are not walking routes.'))
    if eta['status'] != 'complete':
        warnings.append(warning('eta_unavailable', 'ETA unavailable: ' + eta['reason'].replace('_', ' ') + '. No arrival time is promised.'))
    legs = [walking[0]]
    for index, (pi, start, end) in enumerate(journey["segments"]):
        pattern = patterns[pi]
        stops = [stations[sid] for sid in pattern["stops"][start:end + 1]]
        if index:
            legs.append({"type": "transfer", "station": stops[0], "from_route": legs[-1]["route"],
                         "to_route": {"id": pattern["route_id"], "name": pattern["name"], "color": pattern["color"]},
                         "instruction": "Change trains within this MBTA station; follow platform signs. Accessibility and transfer walking time are not verified.", "geometry": None})
        timed = eta["rides"][index] if index < len(eta["rides"]) else None
        upcoming = [{"time": timed["departure_time"], "source": timed["departure_source"], "headsign": pattern["headsign"], "status": None}] if timed else departures(client, pattern, stops[0]["id"], now)
        geometry = clip_shape(pattern, start, end, stations)
        if geometry is None:
            warnings.append(warning("geometry_unavailable", f"MBTA geometry for {pattern['name']} is unavailable; only stations are shown on the map."))
        if not upcoming:
            warnings.append(warning("departures_unavailable", f"No matching upcoming departures for {pattern['name']} are available. This does not confirm that service is running."))
        legs.append({"type": "transit", "route": {"id": pattern["route_id"], "name": pattern["name"], "color": pattern["color"]},
                     "pattern_id": pattern["id"], "direction_id": pattern["direction_id"], "direction": pattern["direction"],
                     "headsign": pattern["headsign"], "from": stops[0], "to": stops[-1], "stops": stops,
                     "stop_count": end - start, "geometry": geometry, "departures": upcoming,
                     "departure_source": upcoming[0]["source"] if upcoming else "unavailable", "timing": timed,
                     "departure_is_feasible": eta["status"] == "complete"})
    legs.append(walking[-1])
    result["legs"] = legs
    result["summary"] = {"transfers": len(journey["segments"]) - 1,
                         "stop_count": sum(b - a for _, a, b in journey["segments"]),
                         "approximate_walk_m": journey["approximate_walk_m"],
                         "walking_distance_m": sum(w.get("distance_m", w["approximate_distance_m"]) for w in walking),
                         "duration_minutes": math.ceil(eta["duration_seconds"] / 60) if eta["status"] == "complete" else None}
    selected_routes = {leg['route']['id'] for leg in legs if leg['type'] == 'transit'}
    result['alerts'] = [alert for alert in all_alerts if applicable(alert, selected_routes)]
    if result["alerts"]:
        warnings.append(warning("service_advisories", "MBTA advisories apply to these lines. They may affect only part of a line; inspect them before travel. No shuttle rerouting is provided."))
    if any(alert.get('effect') in ('SUSPENSION', 'SHUTTLE') for alert in result['alerts']):
        # Route-level advisories don't establish which trip/segment still runs.
        # A normal-pattern graph must not promise an ETA through a disruption.
        result['eta'] = {'status': 'unavailable', 'reason': 'service_disruption_route_unverified'}
        result['summary']['duration_minutes'] = None
        for leg in legs:
            if leg['type'] == 'transit':
                leg['departure_is_feasible'] = False
        warnings.append(warning('eta_unavailable', 'A suspension or shuttle advisory affects a selected line. Check MBTA service; normal-pattern ETA is withheld.'))
    if eta["status"] != "complete":
        warnings.append(warning("departure_not_connection", "Unmatched departures are informational only; they may leave before you arrive. Connections are not verified."))
    return result
