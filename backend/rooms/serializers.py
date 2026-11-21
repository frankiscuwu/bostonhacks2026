from rest_framework import serializers

from restaurants.serializers import RestaurantSerializer
from .models import Participant, Room


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ("id", "display_name", "filters", "joined_at", "is_active")


class RoomSerializer(serializers.ModelSerializer):
    selected_restaurant = RestaurantSerializer(read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = Room
        fields = ("code", "selected_restaurant", "selected_at", "selected_by", "is_active",
                  "created_at", "participants")


class DisplayNameSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=100, allow_blank=False)


class StrictBooleanField(serializers.BooleanField):
    def to_internal_value(self, data):
        if type(data) is not bool:
            raise serializers.ValidationError("Expected a JSON boolean.")
        return data


class FiltersSerializer(serializers.Serializer):
    cuisines = serializers.ListField(
        child=serializers.CharField(max_length=100), max_length=100, required=False, default=list)
    max_distance_miles = serializers.FloatField(
        min_value=0.1, max_value=100, allow_null=True, required=False, default=None)
    open_now = StrictBooleanField(required=False, default=False)

    def validate_cuisines(self, value):
        return sorted(set(value))
