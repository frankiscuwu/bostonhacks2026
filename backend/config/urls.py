from django.contrib import admin
from django.urls import path
from django.http import JsonResponse
from restaurants.views import restaurant_list, restaurant_photo
from rooms import views as room_views


def health_check(request):
    """Return a simple response confirming the backend is running."""
    return JsonResponse({
        "status": "ok",
        "message": "BostonHacks Django backend running!"
    })


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check),
    path("api/restaurants/", restaurant_list),
    path("api/restaurants/<int:restaurant_id>/photo/", restaurant_photo),
    path("api/rooms/", room_views.create_room),
    path("api/rooms/<str:code>/join/", room_views.join_room),
    path("api/rooms/<str:code>/", room_views.room_detail),
    path("api/rooms/<str:code>/filters/", room_views.filters),
    path("api/rooms/<str:code>/location/", room_views.location),
    path("api/rooms/<str:code>/pick/", room_views.pick),
]
