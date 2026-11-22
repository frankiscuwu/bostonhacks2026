"""Server-only Geoapify access. Never log request URLs (they contain the key)."""
import hashlib
import json
import math
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener

from django.core.cache import cache


class GeoapifyUnavailable(Exception):
    def __init__(self, code='geoapify_unavailable'):
        self.code = code
        super().__init__(code)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def coordinates(lat, lon):
    lat, lon = float(lat), float(lon)
    if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('Invalid coordinates')
    return lat, lon


class GeoapifyClient:
    def __init__(self):
        self.key = os.getenv('GEOAPIFY_API_KEY', '').strip()
        self.scope = hashlib.sha256(self.key.encode()).hexdigest()[:12]
        self.deadline = time.monotonic() + 24

    def get(self, endpoint, params, ttl=300):
        if endpoint not in ('geocode/autocomplete', 'geocode/search', 'routing'):
            raise ValueError('Unsupported Geoapify endpoint')
        if not self.key:
            raise GeoapifyUnavailable('geoapify_not_configured')
        # Process-local cache only: address searches and private walking origins
        # must not enter the shared public MBTA file cache.
        key = 'geoapify:' + self.scope + ':' + hashlib.sha256((endpoint + urlencode(sorted(params.items()))).encode()).hexdigest()
        cached = cache.get(key)
        if cached is not None:
            return cached
        if cache.get('geoapify:cooldown:' + self.scope):
            raise GeoapifyUnavailable('geoapify_rate_limited')
        budget = 'geoapify:budget:' + self.scope + ':' + str(int(time.time() // 60))
        cache.add(budget, 0, 65)
        try:
            if cache.incr(budget) > 60:
                raise GeoapifyUnavailable('geoapify_rate_limited')
        except ValueError:
            raise GeoapifyUnavailable('geoapify_rate_limited') from None
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise GeoapifyUnavailable('geoapify_timeout')
        request = Request('https://api.geoapify.com/v1/' + endpoint + '?' + urlencode({**params, 'apiKey': self.key}), headers={'Accept': 'application/json', 'User-Agent': 'ReelHungry/1.0'})
        try:
            with build_opener(NoRedirects()).open(request, timeout=min(7, remaining)) as response:
                body = response.read(3_000_001)
                if len(body) > 3_000_000:
                    raise GeoapifyUnavailable('geoapify_invalid_response')
                result = json.loads(body)
        except HTTPError as exc:
            if exc.code == 429:
                cache.set('geoapify:cooldown:' + self.scope, True, 60)
            code = 'geoapify_authorization_failed' if exc.code in (401, 403) else 'geoapify_rate_limited' if exc.code == 429 else 'geoapify_unavailable'
            raise GeoapifyUnavailable(code) from None
        except (TimeoutError, URLError, OSError, ValueError):
            raise GeoapifyUnavailable() from None
        if not isinstance(result, dict):
            raise GeoapifyUnavailable('geoapify_invalid_response')
        cache.set(key, result, ttl)
        return result

    def search(self, query, autocomplete=True):
        query = query.strip()
        if not 3 <= len(query) <= 200 or any(ord(c) < 32 for c in query):
            raise ValueError('Enter 3–200 characters')
        doc = self.get('geocode/autocomplete' if autocomplete else 'geocode/search', {
            'text': query, 'lang': 'en', 'limit': 5, 'format': 'json',
            'filter': 'circle:-71.06,42.36,70000', 'bias': 'proximity:-71.06,42.36',
        })
        results = []
        rows = doc.get('results')
        if not isinstance(rows, list):
            raise GeoapifyUnavailable('geoapify_invalid_response')
        for row in rows:
            try:
                lat, lon = coordinates(row['lat'], row['lon'])
                if not 41.7 <= lat <= 43.1 or not -72.0 <= lon <= -70.1:
                    continue
                label = row.get('formatted')
                if not isinstance(label, str) or not label:
                    continue
                results.append({'id': str(row.get('place_id', '')), 'label': label[:300], 'latitude': lat, 'longitude': lon})
            except (KeyError, TypeError, ValueError):
                continue
        # Prefer an exact place name over similarly named annexes/bookstores.
        # Still require an explicit selection; never silently resolve ambiguity.
        results.sort(key=lambda row: row['label'].split(',')[0].casefold() != query.casefold())
        return results[:5]

    def walking(self, start, end):
        start, end = coordinates(*start), coordinates(*end)
        doc = self.get('routing', {'waypoints': f'{start[0]},{start[1]}|{end[0]},{end[1]}', 'mode': 'walk', 'units': 'metric', 'lang': 'en'}, ttl=600)
        try:
            feature = doc['features'][0]
            props, geometry = feature['properties'], feature['geometry']
            seconds, metres = float(props['time']), float(props['distance'])
            if not all(math.isfinite(x) and x >= 0 for x in (seconds, metres)):
                raise ValueError
            lines = geometry['coordinates'] if geometry['type'] == 'MultiLineString' else [geometry['coordinates']] if geometry['type'] == 'LineString' else []
            points = []
            for line in lines:
                if points and points[-1] != line[0]:
                    raise ValueError  # do not bridge disconnected pedestrian paths
                for lon, lat in line:
                    coordinates(lat, lon)
                    points.append([lon, lat])
            if len(points) < 2:
                raise ValueError
            # Reject snapped routes whose endpoints don't represent the request.
            from .network import distance
            if distance(start, (points[0][1], points[0][0])) > 100 or distance(end, (points[-1][1], points[-1][0])) > 100:
                raise ValueError
            steps = [s.get('instruction', {}).get('text') for leg in props.get('legs', []) for s in leg.get('steps', [])]
            return {'geometry': {'type': 'LineString', 'coordinates': points}, 'distance_m': round(metres), 'duration_seconds': seconds,
                    'distance_basis': 'pedestrian_route', 'steps': [s[:500] for s in steps if isinstance(s, str)][:60], 'provider': 'Geoapify'}
        except (KeyError, IndexError, TypeError, ValueError):
            raise GeoapifyUnavailable('walking_route_unavailable') from None
