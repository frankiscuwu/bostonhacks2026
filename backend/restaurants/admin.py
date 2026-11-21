from django.contrib import admin

from .models import Restaurant, RestaurantVideo


@admin.register(Restaurant)
class RestaurantAdmin(admin.ModelAdmin):
    """Read-only: the restaurants table is owned outside Django."""
    list_display = ("id", "name", "cuisine", "city", "licstatus")
    list_filter = ("licstatus", "licensecat")
    search_fields = ("businessname", "dbaname", "address")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(RestaurantVideo)
class RestaurantVideoAdmin(admin.ModelAdmin):
    list_display = ("id", "restaurant_id", "platform", "creator_handle", "verification_status", "updated_at")
    list_filter = ("platform", "verification_status")
    search_fields = ("creator_name", "creator_handle", "canonical_url", "platform_video_id")
    raw_id_fields = ("restaurant",)
    readonly_fields = ("platform_video_id", "created_at", "updated_at")
