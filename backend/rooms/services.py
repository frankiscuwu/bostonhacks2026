"""Room mutations serialize on the room row; no shared database tests belong here."""
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from rest_framework.exceptions import APIException, NotFound, PermissionDenied

from restaurants.models import Restaurant
from restaurants.serializers import RestaurantSerializer
from .models import Participant, Room, Vote
from .serializers import ParticipantSerializer, RoomSerializer


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


def room_state(room):
    data = dict(RoomSerializer(room).data)
    required = room.participants.filter(is_active=True)
    voted = room.votes.filter(round_number=room.current_round,
                              restaurant_id=room.current_restaurant_id,
                              participant__is_active=True)
    data["voting_progress"] = {
        "required_count": required.count() if room.is_active else 0,
        "voted_count": voted.count() if room.is_active else 0,
        "voted_participant_ids": list(voted.order_by("participant_id").values_list("participant_id", flat=True)) if room.is_active else [],
    }
    return data


def create_room(display_name):
    with transaction.atomic():
        first = Restaurant.objects.filter(is_active=True).order_by("id").first()
        room = Room.objects.create(current_restaurant=first, is_active=first is not None)
        participant = Participant.objects.create(room=room, display_name=display_name)
        result = {"room": room_state(room), "participant": ParticipantSerializer(participant).data,
                  "participant_token": str(participant.identity_token)}
    return result


def join_room(code, display_name):
    with transaction.atomic():
        room = locked_room(code)
        if not room.is_active:
            raise Conflict("Room is finished.")
        participant = Participant.objects.create(room=room, display_name=display_name)
        result = {"room": room_state(room), "participant": ParticipantSerializer(participant).data,
                  "participant_token": str(participant.identity_token)}
    return result


def get_room(code):
    with transaction.atomic():
        result = room_state(locked_room(code))
    return result


def submit_vote(code, token, *, round_number, restaurant_id, vote):
    try:
        token = UUID(token or "")
    except (ValueError, TypeError, AttributeError):
        raise PermissionDenied("Invalid participant credentials.")
    with transaction.atomic():
        room = locked_room(code)
        participant = room.participants.filter(identity_token=token, is_active=True).first()
        if participant is None:
            raise PermissionDenied("Invalid participant credentials.")
        if not room.is_active or room.current_restaurant_id is None:
            raise Conflict("Room is finished.")
        if room.current_round != round_number or room.current_restaurant_id != restaurant_id:
            raise Conflict()
        try:
            with transaction.atomic():
                Vote.objects.create(room=room, participant=participant, restaurant_id=restaurant_id,
                                    round_number=round_number, vote=vote)
        except IntegrityError:
            raise Conflict("A vote has already been submitted for this round.")
        required = room.participants.filter(is_active=True)
        voted_ids = room.votes.filter(round_number=round_number, restaurant_id=restaurant_id).values("participant_id")
        if not required.exclude(id__in=voted_ids).exists():
            next_restaurant = Restaurant.objects.filter(is_active=True, id__gt=restaurant_id).order_by("id").first()
            room.current_round += 1
            room.current_restaurant = next_restaurant
            room.is_active = next_restaurant is not None
            room.save(update_fields=["current_round", "current_restaurant", "is_active"])
        result = room_state(room)
    return result


def room_results(code):
    with transaction.atomic():
        room = locked_room(code)
        # Include all historical votes, even if a participant later becomes inactive.
        restaurants = Restaurant.objects.filter(votes__room=room).annotate(
            yes_count=Count("votes", filter=Q(votes__vote=True)), total_votes=Count("votes"),
        )
        rows = []
        for restaurant in restaurants:
            rows.append({"restaurant": RestaurantSerializer(restaurant).data,
                         "yes_count": restaurant.yes_count,
                         "no_count": restaurant.total_votes - restaurant.yes_count,
                         "total_votes": restaurant.total_votes,
                         "approval_rate": restaurant.yes_count / restaurant.total_votes})
        rows.sort(key=lambda row: (-row["approval_rate"], -row["yes_count"], row["restaurant"]["id"]))
    return rows
