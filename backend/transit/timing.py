"""Time-dependent evaluation using same-trip MBTA stop events, never speeds."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .client import MBTAUnavailable
from .network import relationship

BOARDING_BUFFER_SECONDS = 60  # explicit planning allowance, not measured walking


def instant(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


def timed_ride(client, pattern, start, end, ready, now):
    """Match board/alight events of one exact trip, pattern and stop order.

    Predictions override schedules for the SAME event/trip. Never replace a live
    missed/cancelled departure with its more convenient scheduled counterpart.
    """
    boarding, exit_stop = pattern['platforms'][start], pattern['platforms'][end]
    filters = {'filter[stop]': boarding + ',' + exit_stop, 'filter[route]': pattern['route_id'],
               'filter[direction_id]': str(pattern['direction_id']), 'include': 'trip.route_pattern'}
    events, cancelled = {}, set()
    for endpoint in ('predictions', 'schedules'):
        params = dict(filters)
        if endpoint == 'schedules':
            local = now.astimezone(ZoneInfo('America/New_York'))
            service_day = (local - timedelta(hours=3)).date()
            def gtfs_time(value):
                date_offset = (value.date() - service_day).days
                return f'{value.hour + 24 * date_offset:02d}:{value.minute:02d}'
            params.update({'filter[date]': service_day.isoformat(), 'filter[min_time]': gtfs_time(local),
                           'filter[max_time]': gtfs_time(local + timedelta(minutes=90)), 'sort': 'departure_time'})
        try:
            doc = client.get(endpoint, params, ttl=15 if endpoint == 'predictions' else 60)
        except MBTAUnavailable:
            continue
        trips = {r['id']: r for r in doc.get('included', []) if r['type'] == 'trip'}
        for row in doc.get('data', []):
            trip_id, stop = relationship(row, 'trip'), relationship(row, 'stop')
            if stop not in (boarding, exit_stop):
                continue
            a = row.get('attributes', {})
            if a.get('schedule_relationship') in ('CANCELED', 'SKIPPED') or (stop == boarding and a.get('pickup_type') == 1) or (stop == exit_stop and a.get('drop_off_type') == 1):
                cancelled.add(trip_id)
                continue
            trip = trips.get(trip_id, {})
            if relationship(trip, 'route_pattern') != pattern['id']:
                continue
            value = instant(a.get('departure_time') or a.get('arrival_time')) if stop == boarding else instant(a.get('arrival_time') or a.get('departure_time'))
            sequence = a.get('stop_sequence')
            if value is None or not isinstance(sequence, int):
                continue
            # Live rows are inserted first and always win over scheduled rows.
            events.setdefault(trip_id, {}).setdefault(stop, (value, sequence, 'realtime' if endpoint == 'predictions' else 'schedule'))
    feasible = []
    for trip_id, stops in events.items():
        if trip_id in cancelled or boarding not in stops or exit_stop not in stops:
            continue
        departure, board_seq, board_source = stops[boarding]
        arrival, exit_seq, exit_source = stops[exit_stop]
        if departure < ready + timedelta(seconds=BOARDING_BUFFER_SECONDS) or arrival <= departure or exit_seq <= board_seq:
            continue
        feasible.append({'trip_id': trip_id, 'departure_time': departure.isoformat(), 'arrival_time': arrival.isoformat(),
                         'duration_seconds': (arrival - departure).total_seconds(),
                         'wait_seconds': (departure - ready).total_seconds(),
                         'source': board_source if board_source == exit_source else 'mixed',
                         'departure_source': board_source, 'arrival_source': exit_source})
    return min(feasible, key=lambda r: instant(r['arrival_time'])) if feasible else None


def evaluate(client, network, journey, walks, now):
    if any(w.get('duration_seconds') is None for w in walks):
        return {'status': 'unavailable', 'reason': 'walking_time_unavailable', 'rides': []}
    ready = now + timedelta(seconds=walks[0]['duration_seconds'])
    rides, wait, train, transfer = [], 0, 0, 0
    for index, (pi, start, end) in enumerate(journey['segments']):
        pattern = network['patterns'][pi]
        if index:
            old_pi, _, old_end = journey['segments'][index - 1]
            old = network['patterns'][old_pi]
            if old['platforms'][old_end] != pattern['platforms'][start]:
                return {'status': 'unavailable', 'reason': 'platform_transfer_time_unverified', 'rides': rides}
            # The exact same platform requires no routed inter-station walk.
            # The boarding allowance is still enforced by timed_ride.
        ride = timed_ride(client, pattern, start, end, ready, now)
        if ride is None:
            return {'status': 'unavailable', 'reason': 'no_feasible_trip_times', 'rides': rides}
        rides.append(ride)
        ready = instant(ride['arrival_time'])
        wait += ride['wait_seconds']
        train += ride['duration_seconds']
    walking = sum(w['duration_seconds'] for w in walks)
    arrival = ready + timedelta(seconds=walks[-1]['duration_seconds'])
    return {'status': 'complete', 'reason': None, 'rides': rides, 'arrival_time': arrival.isoformat(),
            'duration_seconds': (arrival - now).total_seconds(), 'walking_seconds': walking,
            'waiting_seconds': wait, 'transit_seconds': train, 'transfer_seconds': transfer,
            'source': 'realtime' if all(r['source'] == 'realtime' for r in rides) else 'schedule' if all(r['source'] == 'schedule' for r in rides) else 'mixed',
            'boarding_buffer_seconds': BOARDING_BUFFER_SECONDS}
