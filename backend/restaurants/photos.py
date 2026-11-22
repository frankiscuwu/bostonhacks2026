"""Restaurant photos from Google Places (New).

1. Text Search for the restaurant's name + address, biased to its coordinates.
2. Accept a result only if its name matches and it is within ``MAX_DISTANCE_M``,
   so a miss returns no photo rather than a photo of some other place.
3. Resolve the first photo to a keyless googleusercontent URL (``photoUri``).

Results are cached: the matched photo resource for a week (Text Search is the
expensive call) and the resolved URL for a day. Misses are cached too.
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

from django.core.cache import caches

from .cuisine_enrichment import distance_m, name_similarity, restaurant_names

logger = logging.getLogger(__name__)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
MEDIA_URL = "https://places.googleapis.com/v1/{name}/media"
MAX_DISTANCE_M = 200
MIN_NAME_SCORE = 0.7
MAX_WIDTH_PX = 800
PLACE_TTL = 7 * 24 * 3600
URL_TTL = 24 * 3600
MISS = ""  # cached marker for "looked up, no confident match"


def api_key():
    return os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()


def _cache():
    return caches["photos"]


def _request_json(request):
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def find_photo_name(restaurant, key):
    """Return the Places photo resource name for this restaurant, or None."""
    names = restaurant_names(restaurant)
    if not names or restaurant.latitude is None or restaurant.longitude is None:
        return None
    lat, lon = float(restaurant.latitude), float(restaurant.longitude)
    body = {
        "textQuery": f"{names[0]}, {restaurant.full_address}",
        "maxResultCount": 3,
        "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 300.0}},
    }
    request = urllib.request.Request(
        SEARCH_URL, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                 "X-Goog-FieldMask": "places.displayName,places.location,places.photos.name"})
    places = _request_json(request).get("places") or []
    for place in places:
        loc = place.get("location") or {}
        photos = place.get("photos") or []
        if "latitude" not in loc or not photos:
            continue
        place_name = (place.get("displayName") or {}).get("text", "")
        if (distance_m(lat, lon, loc["latitude"], loc["longitude"]) <= MAX_DISTANCE_M
                and max(name_similarity(n, place_name) for n in names) >= MIN_NAME_SCORE):
            return photos[0].get("name")
    return None


def resolve_photo_url(photo_name, key):
    query = urllib.parse.urlencode({"maxWidthPx": MAX_WIDTH_PX, "skipHttpRedirect": "true", "key": key})
    url = f"{MEDIA_URL.format(name=photo_name)}?{query}"
    return _request_json(urllib.request.Request(url)).get("photoUri")


def restaurant_photo_url(restaurant):
    """Photo URL for the restaurant, or None when unavailable. Never raises on API errors."""
    key = api_key()
    if not key:
        return None
    cache = _cache()
    url_key, place_key = f"photo-url:{restaurant.id}", f"photo-place:{restaurant.id}"
    url = cache.get(url_key)
    if url is not None:
        return url or None
    try:
        photo_name = cache.get(place_key)
        if photo_name is None:
            photo_name = find_photo_name(restaurant, key) or MISS
            cache.set(place_key, photo_name, PLACE_TTL)
        url = resolve_photo_url(photo_name, key) if photo_name else MISS
    except urllib.error.HTTPError as error:
        # 4xx on the media call usually means a stale photo name: look it up again next time.
        cache.delete(place_key)
        logger.warning("Google Places photo lookup failed for %s: HTTP %s", restaurant.id, error.code)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.warning("Google Places photo lookup failed for %s: %s", restaurant.id, error)
        return None
    url = url or MISS
    cache.set(url_key, url, URL_TTL if url else PLACE_TTL)
    return url or None
