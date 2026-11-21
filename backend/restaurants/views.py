import math

from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Restaurant
from .serializers import RestaurantFilterSerializer, RestaurantSerializer


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
    restaurants = Restaurant.objects.filter(is_active=True).order_by("id")
    if "cuisine" in values:
        restaurants = restaurants.filter(cuisine__iexact=values["cuisine"])
    if "max_price" in values:
        restaurants = restaurants.filter(price_level__lte=values["max_price"])
    if "min_rating" in values:
        restaurants = restaurants.filter(rating__gte=values["min_rating"])
    if "max_distance_km" in values:
        restaurants = [r for r in restaurants if distance_km(values["latitude"], values["longitude"], r) <= values["max_distance_km"]]
    return Response(RestaurantSerializer(restaurants, many=True).data)
