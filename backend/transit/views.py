"""Private per-request directions. Only SELECTs; no location persistence."""
import math
from uuid import UUID

from django.shortcuts import get_object_or_404
from django.utils.cache import patch_vary_headers
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from restaurants.models import Restaurant
from rooms.models import Participant
from .service import directions, warning
from .geoapify import GeoapifyClient, GeoapifyUnavailable


class DirectionsThrottle(SimpleRateThrottle):
    scope = "transit_directions"
    rate = "30/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class DirectionsQuery(serializers.Serializer):
    restaurant_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    origin_lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    origin_lon = serializers.FloatField(min_value=-180, max_value=180, required=False)
    room_code = serializers.RegexField(r"^[A-Z0-9]{6}$", required=False)

    def validate(self, attrs):
        if ("origin_lat" in attrs) != ("origin_lon" in attrs):
            raise serializers.ValidationError("Provide both origin_lat and origin_lon.")
        for name in ("origin_lat", "origin_lon"):
            if name in attrs and not math.isfinite(attrs[name]):
                raise serializers.ValidationError({name: "Coordinates must be finite numbers."})
        return attrs


def private_response(data, status=200):
    response = Response(data, status=status)
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "no-referrer"
    patch_vary_headers(response, ["X-Participant-Token"])
    return response


class AddressThrottle(DirectionsThrottle):
    scope = "transit_addresses"
    rate = "40/min"


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AddressThrottle])
def address_search(request):
    text = request.query_params.get("q", "").strip()
    mode = request.query_params.get("mode", "autocomplete")
    if not 3 <= len(text) <= 200 or any(ord(c) < 32 for c in text) or mode not in ("autocomplete", "geocode"):
        return private_response({"status": "invalid_query", "detail": "Enter a local address with 3–200 characters."}, 400)
    try:
        results = GeoapifyClient().search(text, autocomplete=mode == "autocomplete")
    except GeoapifyUnavailable as exc:
        return private_response({"status": "unavailable", "code": exc.code,
                                 "detail": "Address search is temporarily unavailable. Use current location or advanced coordinates."}, 503)
    return private_response({"status": "ambiguous" if len(results) > 1 else "ok" if results else "no_results", "suggestions": results,
                             "attribution": "Powered by Geoapify · © OpenStreetMap contributors"})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([DirectionsThrottle])
def transit_directions(request):
    query = DirectionsQuery(data=request.query_params)
    if not query.is_valid():
        return private_response({"status": "invalid_location", "errors": query.errors}, 400)
    values = query.validated_data
    restaurant = get_object_or_404(Restaurant, pk=values["restaurant_id"])
    try:
        lat, lon = float(restaurant.latitude), float(restaurant.longitude)
        if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError
    except (TypeError, ValueError):
        return private_response({"status": "invalid_destination", "detail": "The selected restaurant has no valid map location."}, 400)
    destination = {"restaurant_id": restaurant.pk, "name": restaurant.name, "latitude": lat, "longitude": lon}
    source = "provided"
    if "origin_lat" in values:
        origin = values["origin_lat"], values["origin_lon"]
    elif values.get("room_code"):
        try:
            token = UUID(request.headers.get("X-Participant-Token", ""))
        except (ValueError, TypeError, AttributeError):
            return private_response({"detail": "Valid participant credentials are required."}, 403)
        participant = Participant.objects.select_related("room").filter(
            room__code=values["room_code"], identity_token=token, is_active=True,
        ).first()
        if participant is None:
            return private_response({"detail": "Valid participant credentials are required."}, 403)
        if participant.room.selected_restaurant_id != restaurant.pk:
            return private_response({"status": "destination_changed", "detail": "The Jam's selected restaurant changed. Refresh the room before requesting directions."}, 409)
        origin = participant.origin
        source = "saved_participant"
    else:
        origin = None
    if origin is None:
        return private_response({"status": "origin_required", "origin": None, "origin_source": source,
                                 "destination": destination, "legs": [], "warnings": [warning("origin_required", "Choose your starting location; no private saved location is available.")],
                                 "alerts": [], "summary": None, "boarding_station": None, "exit_station": None})
    if not all(math.isfinite(v) for v in origin) or not (-90 <= origin[0] <= 90 and -180 <= origin[1] <= 180):
        return private_response({"status": "invalid_location", "detail": "The starting location is invalid. Choose another location."}, 400)
    try:
        result = directions(origin, destination)
    except (KeyError, TypeError, ValueError):
        # A malformed provider document must not leak a traceback or a key.
        return private_response({"status": "unavailable", "origin": None, "destination": destination,
                                 "legs": [], "warnings": [warning("invalid_mbta_response", "MBTA returned incomplete network data. Please retry later.")], "alerts": [], "summary": None})
    result["origin_source"] = source
    return private_response(result)
