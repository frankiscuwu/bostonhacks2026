"""Public canonical topology, cached once per worker rather than per origin."""
import math
import re
import threading
from datetime import datetime, timezone

from .client import MBTAClient, MBTAUnavailable, ROUTES, cache

_lock = threading.Lock()


def relationship(item, name):
    value = item.get("relationships", {}).get(name, {}).get("data")
    return value.get("id") if isinstance(value, dict) else None


def distance(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = lat2 - lat1, math.radians(b[1] - a[1])
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(min(1, max(0, value))))


def decode_polyline(encoded):
    """Google encoded polyline, as returned by MBTA /shapes (lat/lon)."""
    points, index, lat, lon = [], 0, 0, 0
    try:
        while index < len(encoded):
            values = []
            for _ in range(2):
                value = shift = 0
                while True:
                    byte = ord(encoded[index]) - 63
                    index += 1
                    if byte < 0 or byte > 63 or shift > 30:
                        return []
                    value |= (byte & 31) << shift
                    shift += 5
                    if byte < 32:
                        break
                values.append(~(value >> 1) if value & 1 else value >> 1)
            lat += values[0]
            lon += values[1]
            point = (lat / 100_000, lon / 100_000)
            if not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180):
                return []
            points.append(point)
    except (IndexError, TypeError):
        return []
    return points


def build_network(client):
    route_filter = ",".join(ROUTES)
    routes = client.get("routes", {"filter[id]": route_filter}, ttl=3600)
    parents = client.get("stops", {"filter[route]": route_filter, "filter[location_type]": "1"}, ttl=3600)
    patterns = client.get("route_patterns", {
        "filter[route]": route_filter, "filter[canonical]": "true",
        "include": "representative_trip.stops,representative_trip.shape",
        "fields[stop]": "name,latitude,longitude,parent_station",
        "fields[trip]": "headsign,direction_id,stops,shape,route_pattern",
    }, ttl=3600)
    resources = {(r["type"], r["id"]): r for r in patterns.get("included", [])}
    parent_map = {r["id"]: r for r in parents["data"]}
    route_map = {r["id"]: r["attributes"] for r in routes["data"] if r["id"] in ROUTES}
    stations, paths = {}, []
    for pattern in patterns["data"]:
        attrs = pattern.get("attributes", {})
        route_id = relationship(pattern, "route")
        # Exclude diversions/short turns; this MVP describes normal rail patterns.
        if route_id not in route_map or attrs.get("typicality") not in (1, 5):
            continue
        trip = resources.get(("trip", relationship(pattern, "representative_trip")))
        if not trip or trip.get("attributes", {}).get("direction_id") not in (0, 1):
            continue
        sequence = trip.get("relationships", {}).get("stops", {}).get("data", [])
        stops, platforms = [], []
        valid = True
        # Retain MBTA's representative-trip stop sequence exactly. Never sort
        # IDs or connect the unordered set of all stations sharing a route name.
        for ref in sequence:
            stop = resources.get(("stop", ref["id"]))
            if not stop:
                valid = False
                break
            station_id = relationship(stop, "parent_station") or stop["id"]
            station = parent_map.get(station_id, stop)
            a = station.get("attributes", {})
            lat, lon = a.get("latitude"), a.get("longitude")
            if lat is None or lon is None or not all(math.isfinite(float(v)) for v in (lat, lon)):
                valid = False
                break
            stations[station_id] = {"id": station_id, "name": a.get("name", station_id), "latitude": float(lat), "longitude": float(lon)}
            if not stops or stops[-1] != station_id:
                stops.append(station_id)
                platforms.append(stop["id"])
        if not valid or len(stops) < 2 or len(set(stops)) != len(stops):
            continue  # unsupported loops/partial data must not create shortcuts
        shape = resources.get(("shape", relationship(trip, "shape")), {})
        geometry = decode_polyline(shape.get("attributes", {}).get("polyline", ""))
        direction_id = trip["attributes"]["direction_id"]
        route = route_map[route_id]
        directions = route.get("direction_names") or []
        color = route.get("color") or "555555"
        if not re.fullmatch(r"[A-Fa-f0-9]{6}", color):
            color = "555555"
        paths.append({
            "id": pattern["id"], "route_id": route_id, "name": route.get("long_name") or route.get("short_name") or route_id,
            "color": "#" + color, "direction_id": direction_id,
            "direction": directions[direction_id] if len(directions) > direction_id else None,
            "headsign": trip["attributes"].get("headsign"), "stops": stops,
            "platforms": platforms, "shape": geometry,
        })
    if not paths:
        raise MBTAUnavailable("mbta_topology_unavailable")
    used_stations = {sid for path in paths for sid in path["stops"]}
    stations = {sid: station for sid, station in stations.items() if sid in used_stations}
    return {"stations": stations, "patterns": paths, "fetched_at": datetime.now(timezone.utc).isoformat(),
            "available_routes": sorted({p["route_id"] for p in paths})}


def get_network(client=None):
    client = client or MBTAClient()
    key = "mbta:network:v1:" + client.scope
    result = cache.get(key)
    if result is not None:
        return result
    # Prevent a cold-cache stampede in a worker. Deployments with many workers
    # should configure a shared Django cache and warm it before opening traffic.
    if not _lock.acquire(timeout=1):
        raise MBTAUnavailable("mbta_network_loading")
    try:
        result = cache.get(key)
        if result is None:
            result = build_network(client)
            cache.set(key, result, 3600)
        return result
    finally:
        _lock.release()
