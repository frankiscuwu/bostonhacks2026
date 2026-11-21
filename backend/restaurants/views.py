import math

from django.http import Http404
from django.shortcuts import get_object_or_404

from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Restaurant, RestaurantVideo
from .serializers import RestaurantFilterSerializer, RestaurantSerializer, RestaurantVideoSerializer


def distance_km(latitude, longitude, restaurant):
    lat1, lat2 = map(math.radians, (latitude, float(restaurant.latitude)))
    dlat = lat2 - lat1
    dlon = math.radians(float(restaurant.longitude) - longitude)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def restaurant_list(request):
    filters = RestaurantFilterSerializer(data=request.query_params)
    filters.is_valid(raise_exception=True)
    values = filters.validated_data
    restaurants = Restaurant.objects.active().order_by("id").prefetch_related("videos")
    if "cuisine" in values:
        # Source values can be semicolon lists such as "donut;coffee_shop".
        restaurants = restaurants.filter(cuisine__icontains=values["cuisine"])
    if "max_distance_km" in values:
        restaurants = [r for r in restaurants if distance_km(values["latitude"], values["longitude"], r) <= values["max_distance_km"]]
    return Response(RestaurantSerializer(restaurants, many=True).data)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def restaurant_videos(request, restaurant_id):
    if restaurant_id > 2**63 - 1:
        raise Http404
    restaurant = get_object_or_404(Restaurant, pk=restaurant_id)
    videos = restaurant.videos.filter(verification_status=RestaurantVideo.VerificationStatus.APPROVED)
    return Response(RestaurantVideoSerializer(videos, many=True).data)
