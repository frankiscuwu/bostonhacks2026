from django.contrib import admin

from .models import Restaurant


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
