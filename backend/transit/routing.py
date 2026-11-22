"""Dijkstra over directed pattern positions, with at most one train change.

Costs are ranking units (walking metres + stop/transfer penalties), NOT minutes.
Remaining on one representative pattern prevents splicing unrelated branches.
"""
import heapq
import itertools

from .network import distance

MAX_WALK_M = 1500


def station_point(station):
    return station["latitude"], station["longitude"]


def nearby(network, point):
    # Several candidates, not just the closest: another nearby line can avoid a
    # transfer. No walking distance is presented as a routed pedestrian path.
    return sorted((distance(point, station_point(s)), sid) for sid, s in network["stations"].items()
                  if distance(point, station_point(s)) <= MAX_WALK_M)[:6]


def find_journey(network, origin, destination):
    starts, ends = nearby(network, origin), dict((sid, d) for d, sid in nearby(network, destination))
    patterns = network["patterns"]
    positions = {}
    for pi, pattern in enumerate(patterns):
        for si, station in enumerate(pattern["stops"]):
            positions.setdefault(station, []).append((pi, si))
    queue, serial = [], itertools.count()
    for walking, sid in starts:
        for pi, si in positions.get(sid, []):
            heapq.heappush(queue, (walking, next(serial), pi, si, 0, [(pi, si)], walking))
    seen, best = {}, None
    while queue:
        score, _, pi, si, transfers, path, initial_walk = heapq.heappop(queue)
        ridden = any(a == b and j > i for (a, i), (b, j) in zip(path, path[1:]))
        key = pi, si, transfers, ridden
        if seen.get(key, float("inf")) <= score:
            continue
        seen[key] = score
        if best is not None and score > best[0]:
            break
        station = patterns[pi]["stops"][si]
        if station in ends and ridden:
            total = score + ends[station]
            if best is None or total < best[0]:
                best = total, path, initial_walk + ends[station]
        if si + 1 < len(patterns[pi]["stops"]):
            heapq.heappush(queue, (score + 110, next(serial), pi, si + 1, transfers, path + [(pi, si + 1)], initial_walk))
        if transfers == 0 and ridden:
            for pj, sj in positions[station]:
                if pj == pi or sj + 1 == len(patterns[pj]["stops"]):
                    continue
                old, new = patterns[pi], patterns[pj]
                if (old["route_id"], old["direction_id"], old["headsign"]) == (new["route_id"], new["direction_id"], new["headsign"]):
                    continue
                # Only a common MBTA parent station is a transfer. Geographic
                # proximity, similar names, or intersecting polylines are not.
                heapq.heappush(queue, (score + 1800, next(serial), pj, sj, 1, path + [(pj, sj)], initial_walk))
    if best is None:
        return None
    groups = []
    for pi, si in best[1]:
        if groups and groups[-1][0] == pi:
            groups[-1][2] = si
        else:
            groups.append([pi, si, si])
    # A final transfer without boarding a second train is not a journey leg.
    groups = [g for g in groups if g[2] > g[1]]
    return {"segments": groups, "approximate_walk_m": round(best[2])}


def clip_shape(pattern, start, end, stations):
    """Slice actual MBTA geometry, with monotonically matched station positions."""
    shape = pattern.get("shape", [])
    if len(shape) < 2:
        return None
    indices, previous = [], 0
    for sid in pattern["stops"]:
        point = station_point(stations[sid])
        index = min(range(previous, len(shape)), key=lambda i: distance(point, shape[i]))
        if distance(point, shape[index]) > 350:
            return None
        indices.append(index)
        previous = index
    a, b = indices[start], indices[end]
    if b <= a:
        return None
    return {"type": "LineString", "coordinates": [[lon, lat] for lat, lon in shape[a:b + 1]]}


def find_journeys(network, origin, destination, limit=4):
    """Enumerate directed direct/one-transfer alternatives, then bound API work.

    Existing Dijkstra remains the structural fallback. Timetable evaluation, not
    these heuristic scores, selects the final timed itinerary.
    """
    starts, ends = nearby(network, origin), nearby(network, destination)
    patterns = network['patterns']
    candidates = {}
    def add(segments, walking):
        key = tuple(tuple(s) for s in segments)
        score = walking + sum((end - start) * 110 for _, start, end in segments) + (len(segments) - 1) * 1800
        candidates[key] = {'segments': segments, 'approximate_walk_m': round(walking), 'score': score}
    baseline = find_journey(network, origin, destination)
    if baseline:
        add(baseline['segments'], baseline['approximate_walk_m'])
    for access, boarding in starts:
        for egress, exit_station in ends:
            for pi, p in enumerate(patterns):
                if boarding not in p['stops']:
                    continue
                start = p['stops'].index(boarding)
                if exit_station in p['stops'] and (end := p['stops'].index(exit_station)) > start:
                    add([[pi, start, end]], access + egress)
                for pj, q in enumerate(patterns):
                    if pi == pj or exit_station not in q['stops']:
                        continue
                    if (p['route_id'], p['direction_id'], p['headsign']) == (q['route_id'], q['direction_id'], q['headsign']):
                        continue
                    end = q['stops'].index(exit_station)
                    for middle in set(p['stops'][start + 1:]) & set(q['stops'][:end]):
                        add([[pi, start, p['stops'].index(middle)], [pj, q['stops'].index(middle), end]], access + egress)
    ordered = sorted(candidates.values(), key=lambda c: (c['score'], c['segments']))
    # Retain route diversity instead of spending all requests on near-identical
    # boarding stations of one pattern.
    chosen, signatures = [], set()
    for candidate in ordered:
        signature = tuple(s[0] for s in candidate['segments'])
        if signature not in signatures:
            chosen.append(candidate)
            signatures.add(signature)
        if len(chosen) >= limit:
            return chosen
    for candidate in ordered:
        if candidate not in chosen:
            chosen.append(candidate)
        if len(chosen) >= limit:
            break
    return chosen
