from rest_framework import serializers

from .models import Restaurant


class RestaurantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Restaurant
        fields = ("id", "name", "address", "cuisine", "price_level", "rating",
                  "latitude", "longitude", "creator_video_url", "image_url", "description")


class RestaurantFilterSerializer(serializers.Serializer):
    cuisine = serializers.CharField(required=False, max_length=100)
    max_price = serializers.IntegerField(required=False, min_value=1, max_value=4)
    min_rating = serializers.FloatField(required=False, min_value=0, max_value=5)
    latitude = serializers.FloatField(required=False, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, min_value=-180, max_value=180)
    max_distance_km = serializers.FloatField(required=False, min_value=0, max_value=20050)

    def validate(self, attrs):
        import math
        for value in attrs.values():
            if isinstance(value, float) and not math.isfinite(value):
                raise serializers.ValidationError("Filter values must be finite.")
        coordinates = ("latitude", "longitude", "max_distance_km")
        if any(key in attrs for key in coordinates) and not all(key in attrs for key in coordinates):
            raise serializers.ValidationError("Distance filtering requires latitude, longitude, and max_distance_km.")
        return attrs
