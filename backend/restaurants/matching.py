"""Restaurant filtering shared by the catalog API and room picks.

Participant filters (stored on rooms.Participant.filters):

    {"cuisines": ["Pizza", "Italian"], "max_distance_miles": 3.0, "open_now": false}

- ``cuisines``: cuisine labels (see ``cuisine_label``); empty means any cuisine.
- ``max_distance_miles``: straight-line miles from the participant's own location
  (from their device's GPS), or from Boston Common if they shared none; null means any.
- ``open_now``: when true, only restaurants with known hours that are open now.

A room pick only considers restaurants that satisfy *every* participant's filters.
"""
import math
from datetime import datetime
from zoneinfo import ZoneInfo

BOSTON_COMMON = (42.3551, -71.0624)
BOSTON_TZ = ZoneInfo("America/New_York")
DEFAULT_FILTERS = {"cuisines": [], "max_distance_miles": None, "open_now": False}


def cuisine_label(raw):
    """``"donut;coffee_shop"`` -> ``"Donut"``; missing -> ``"Other"``."""
    first = (raw or "").split(";")[0].strip()
    if not first:
        return "Other"
    return " ".join(word.capitalize() for word in first.split("_") if word)


def distance_miles(restaurant, origin=BOSTON_COMMON):
    lat1, lat2 = map(math.radians, (origin[0], float(restaurant.latitude)))
    dlat = lat2 - lat1
    dlon = math.radians(float(restaurant.longitude) - origin[1])
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def _minutes(value):
    try:
        hours, minutes = str(value).strip()[:5].split(":")
        return int(hours) * 60 + int(minutes)
    except (ValueError, AttributeError):
        return None


def is_open_now(restaurant, now=None):
    """True/False from open_time/close_time in Boston time; None when hours are unknown."""
    opens, closes = _minutes(restaurant.open_time), _minutes(restaurant.close_time)
    if opens is None or closes is None:
        return None
    now = (now or datetime.now(BOSTON_TZ)).astimezone(BOSTON_TZ)
    current = now.hour * 60 + now.minute
    if opens <= closes:
        return opens <= current < closes
    return current >= opens or current < closes  # past midnight, e.g. 17:00-02:00


def normalize_filters(filters):
    return DEFAULT_FILTERS | (filters or {})


def matches(restaurant, filters, now=None, origin=None):
    filters = normalize_filters(filters)
    cuisines = filters["cuisines"]
    if cuisines and cuisine_label(restaurant.cuisine) not in cuisines:
        return False
    max_distance = filters["max_distance_miles"]
    if max_distance is not None and distance_miles(restaurant, origin or BOSTON_COMMON) > max_distance:
        return False
    if filters["open_now"] and is_open_now(restaurant, now) is not True:
        return False
    return True


def matches_everyone(restaurant, criteria, now=None):
    """``criteria`` is a list of ``(filters, origin)`` pairs, one per participant."""
    return all(matches(restaurant, filters, now, origin) for filters, origin in criteria)
