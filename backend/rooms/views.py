from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import services
from .serializers import DisplayNameSerializer, FiltersSerializer


def participant_token(request):
    return request.headers.get("X-Participant-Token")


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def create_room(request):
    serializer = DisplayNameSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(services.create_room(**serializer.validated_data), status=201)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def join_room(request, code):
    serializer = DisplayNameSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(services.join_room(code, **serializer.validated_data), status=201)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def room_detail(request, code):
    return Response(services.get_room(code))


@api_view(["PUT"])
@authentication_classes([])
@permission_classes([AllowAny])
def filters(request, code):
    serializer = FiltersSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(services.update_filters(code, participant_token(request), dict(serializer.validated_data)))


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def pick(request, code):
    return Response(services.pick_restaurant(code, participant_token(request)))
