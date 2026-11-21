from rest_framework import serializers

from .matching import cuisine_label
from .models import Restaurant, RestaurantVideo


class RestaurantVideoSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestaurantVideo
        fields = ("id", "platform", "url", "embed_id", "embed_url", "thumbnail_url", "author", "caption")


class RestaurantSerializer(serializers.ModelSerializer):
    """Public restaurant shape. The source table has no price or rating, so those
    are always null. ``creator_video_url`` / ``image_url`` come from the first
    attached video (empty when there is none); ``videos`` lists all of them.
    Prefetch ``videos`` when serializing many restaurants."""
    name = serializers.CharField(read_only=True)
    address = serializers.CharField(source="full_address", read_only=True)
    description = serializers.CharField(source="descript", read_only=True, allow_null=True)
    license_category = serializers.CharField(source="licensecat", read_only=True, allow_null=True)
    price_level = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()
    creator_video_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    cuisine_label = serializers.SerializerMethodField()
    videos = RestaurantVideoSerializer(many=True, read_only=True)

    class Meta:
        model = Restaurant
        fields = ("id", "name", "address", "cuisine", "cuisine_label", "price_level", "rating",
                  "latitude", "longitude", "creator_video_url", "image_url", "description",
                  "open_time", "close_time", "license_category", "videos")

    def get_price_level(self, obj):
        return None

    def get_rating(self, obj):
        return None

    @staticmethod
    def _first_video(obj):
        videos = list(obj.videos.all())  # uses the prefetch cache when present
        return videos[0] if videos else None

    def get_creator_video_url(self, obj):
        video = self._first_video(obj)
        return video.url if video else ""

    def get_image_url(self, obj):
        video = self._first_video(obj)
        return video.thumbnail_url if video else ""

    def get_cuisine_label(self, obj):
        return cuisine_label(obj.cuisine)


class RestaurantFilterSerializer(serializers.Serializer):
    cuisine = serializers.CharField(required=False, max_length=100)
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
