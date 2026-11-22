"""Room mutations serialize on the room row; no shared database tests belong here."""
import random
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied

from restaurants.matching import matches_everyone
from restaurants.models import Restaurant
from .models import Participant, Room
from .serializers import ParticipantSerializer, RoomSerializer

_random = random.SystemRandom()


class Conflict(APIException):
    status_code = 409
    default_detail = "Room state changed. Refresh the room before trying again."


def locked_room(code):
    # Do not select_related the nullable restaurant: PostgreSQL cannot lock the
    # nullable side of an outer join.
    try:
        return Room.objects.select_for_update().get(code=code.upper())
    except Room.DoesNotExist:
        raise NotFound("Room not found.")


def active_criteria(room):
    """One ``(filters, origin)`` pair per active participant."""
    return [(p.filters, p.origin) for p in room.participants.filter(is_active=True)]


# Only the columns restaurants.matching reads; loading whole rows is slow over
# a remote database.
MATCHING_FIELDS = ("id", "cuisine", "latitude", "longitude", "open_time", "close_time")


def matching_restaurants(room, now=None):
    criteria = active_criteria(room)
    restaurants = Restaurant.objects.active().only(*MATCHING_FIELDS).order_by("id")
    return [r for r in restaurants if matches_everyone(r, criteria, now)]


def room_state(room, matches=None):
    """``matches`` lets a caller that already ran matching_restaurants reuse it."""
    data = dict(RoomSerializer(room).data)
    # IDs rather than locations, so clients can preview matches without ever
    # seeing other participants' coordinates.
    if matches is None:
        matches = matching_restaurants(room)
    ids = [r.id for r in matches]
    data["matching_count"] = len(ids)
    data["matching_restaurant_ids"] = ids
    return data


def authenticated_participant(room, token):
    try:
        token = UUID(token or "")
    except (ValueError, TypeError, AttributeError):
        raise PermissionDenied("Invalid participant credentials.")
    participant = room.participants.filter(identity_token=token, is_active=True).first()
    if participant is None:
        raise PermissionDenied("Invalid participant credentials.")
    return participant


def membership(room, participant):
    return {"room": room_state(room), "participant": ParticipantSerializer(participant).data,
            "participant_token": str(participant.identity_token)}


def create_room(display_name):
    with transaction.atomic():
        room = Room.objects.create()
        participant = Participant.objects.create(room=room, display_name=display_name)
        result = membership(room, participant)
    return result


def join_room(code, display_name):
    with transaction.atomic():
        room = locked_room(code)
        if not room.is_active:
            raise Conflict("Room is closed.")
        participant = Participant.objects.create(room=room, display_name=display_name)
        result = membership(room, participant)
    return result


def get_room(code):
    with transaction.atomic():
        result = room_state(locked_room(code))
    return result


def update_filters(code, token, filters):
    with transaction.atomic():
        room = locked_room(code)
        participant = authenticated_participant(room, token)
        participant.filters = filters
        participant.save(update_fields=["filters"])
        result = room_state(room)
    return result


def update_location(code, token, latitude, longitude):
    with transaction.atomic():
        room = locked_room(code)
        participant = authenticated_participant(room, token)
        participant.latitude, participant.longitude = latitude, longitude
        participant.save(update_fields=["latitude", "longitude"])
        result = room_state(room)
    return result


def pick_restaurant(code, token):
    """Randomly choose one restaurant that matches every active participant's filters."""
    with transaction.atomic():
        room = locked_room(code)
        participant = authenticated_participant(room, token)
        if not room.is_active:
            raise Conflict("Room is closed.")
        candidates = matching_restaurants(room)
        if not candidates:
            raise Conflict("No restaurant matches everyone's filters. Loosen some filters and try again.")
        # Set the id, not the instance: candidates only have the matching
        # columns, and serializing one would query each missing field separately.
        room.selected_restaurant_id = _random.choice(candidates).id
        room.selected_at = timezone.now()
        room.selected_by = participant
        room.save(update_fields=["selected_restaurant", "selected_at", "selected_by"])
        result = room_state(room, candidates)
    return result
