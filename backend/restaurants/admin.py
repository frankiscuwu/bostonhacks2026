from django.contrib import admin

from .models import Restaurant


@admin.register(Restaurant)
class RestaurantAdmin(admin.ModelAdmin):
    list_display = ("name", "cuisine", "price_level", "rating", "is_active")
    list_filter = ("cuisine", "price_level", "is_active")
    search_fields = ("name", "address")
