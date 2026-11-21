from django.contrib import admin
from django.urls import path
from django.http import JsonResponse


def health_check(request):
    """Return a simple response confirming the backend is running."""
    return JsonResponse({
        "status": "ok",
        "message": "BostonHacks Django backend running!"
    })


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check),
]