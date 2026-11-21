import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { FilterState, Restaurant } from "./data.ts";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type RoomState = {
    restaurants: Restaurant[];
    filters: FilterState;
    activeRestaurantId: string;
};

export type RoomPreferences = {
    cuisines: string[];
    prices: string[];
};

export type RoomParticipant = {
    id: string;
    name: string;
    preferences: RoomPreferences;
};

export type RoomUser = {
    id: string;
    profile: RoomParticipant;
};

export type RoomChannelCallbacks = {
    onState?: (state: RoomState) => void;
    onPresenceChange?: (count: number) => void;
    onParticipants?: (participants: RoomParticipant[]) => void;
    onReady?: () => void;
    onStateRequest?: () => void;
};

const supabase:
    | ReturnType<typeof createClient>
    | null = supabaseUrl && supabasePublishableKey
        ? createClient(supabaseUrl, supabasePublishableKey)
        : null;

export function isRealtimeConfigured() {
    return supabase !== null;
}

export function joinRoom(
    roomId: string,
    user: RoomUser,
    callbacks: RoomChannelCallbacks = {},
) {
    if (!supabase) return null;

    const room: RealtimeChannel = supabase.channel(`room:${roomId}`, {
        config: {
            broadcast: { self: false },
            presence: { key: user.id },
        },
    });

    room.on("broadcast", { event: "room-state" }, ({ payload }) => {
        if (
            payload &&
            typeof payload === "object" &&
            "restaurants" in payload &&
            "filters" in payload &&
            "activeRestaurantId" in payload
        ) {
            callbacks.onState?.(payload as unknown as RoomState);
        }
    });

    room.on("broadcast", { event: "room-state-request" }, () => {
        callbacks.onStateRequest?.();
    });

    room
        .on("presence", { event: "sync" }, () => {
            const presence = room.presenceState() as Record<
                string,
                Array<{ profile?: RoomParticipant }>
            >;
            const participants = Object.entries(presence).flatMap(
                ([id, states]) =>
                    states
                        .map((state) => state.profile)
                        .filter((profile): profile is RoomParticipant =>
                            Boolean(profile),
                        )
                        .map((profile) => ({ ...profile, id })),
            );
            const uniqueParticipants = Array.from(
                new Map(
                    participants.map((participant) => [
                        participant.id,
                        participant,
                    ]),
                ).values(),
            );
            callbacks.onPresenceChange?.(uniqueParticipants.length);
            callbacks.onParticipants?.(uniqueParticipants);
        })
        .on("presence", { event: "join" }, () => {
            const presence = room.presenceState() as Record<
                string,
                Array<{ profile?: RoomParticipant }>
            >;
            const count = Object.keys(presence).length;
            callbacks.onPresenceChange?.(count);
        })
        .on("presence", { event: "leave" }, () => {
            const presence = room.presenceState() as Record<
                string,
                Array<{ profile?: RoomParticipant }>
            >;
            const count = Object.keys(presence).length;
            callbacks.onPresenceChange?.(count);
        });

    room.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await room.track({
                profile: user.profile,
                online_at: new Date().toISOString(),
            });
            callbacks.onReady?.();
        }
    });

    return room;
}

export async function sendRoomState(
    room: RealtimeChannel | null,
    state: RoomState,
) {
    if (!room) return;
    await room.send({
        type: "broadcast",
        event: "room-state",
        payload: state,
    });
}

export async function requestRoomState(room: RealtimeChannel | null) {
    if (!room) return;
    await room.send({
        type: "broadcast",
        event: "room-state-request",
        payload: {},
    });
}

export async function updateRoomProfile(
    room: RealtimeChannel | null,
    profile: RoomParticipant,
) {
    if (!room) return;
    await room.track({
        profile,
        online_at: new Date().toISOString(),
    });
}
