from django.contrib import admin

from .models import Participant, Room, Vote


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("code", "current_restaurant", "current_round", "is_active")
    readonly_fields = ("created_at",)


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("display_name", "room", "is_active", "joined_at")
    exclude = ("identity_token",)


@admin.register(Vote)
class VoteAdmin(admin.ModelAdmin):
    list_display = ("room", "participant", "restaurant", "round_number", "vote")
