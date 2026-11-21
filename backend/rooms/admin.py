from django.contrib import admin

from .models import Participant, Room


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("code", "selected_restaurant", "selected_at", "is_active")
    readonly_fields = ("created_at", "selected_at")


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("display_name", "room", "is_active", "joined_at")
    exclude = ("identity_token",)
