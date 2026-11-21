from rest_framework import serializers

from restaurants.serializers import RestaurantSerializer
from .models import Participant, Room


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ("id", "display_name", "joined_at", "is_active")


class RoomSerializer(serializers.ModelSerializer):
    current_restaurant = RestaurantSerializer(read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = Room
        fields = ("code", "current_restaurant", "current_round", "is_active", "created_at", "participants")


class DisplayNameSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=100, allow_blank=False)


class StrictBooleanField(serializers.BooleanField):
    def to_internal_value(self, data):
        if type(data) is not bool:
            raise serializers.ValidationError("Expected a JSON boolean.")
        return data


class VoteInputSerializer(serializers.Serializer):
    round_number = serializers.IntegerField(min_value=1)
    restaurant_id = serializers.IntegerField(min_value=1)
    vote = StrictBooleanField()
