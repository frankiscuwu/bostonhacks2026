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

export type RoomChannelCallbacks = {
    onState?: (state: RoomState) => void;
    onPresenceChange?: (count: number) => void;
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
    user: { id: string; username: string },
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
            callbacks.onPresenceChange?.(
                Object.keys(room.presenceState()).length,
            );
        })
        .on("presence", { event: "join" }, () => {
            callbacks.onPresenceChange?.(
                Object.keys(room.presenceState()).length,
            );
        })
        .on("presence", { event: "leave" }, () => {
            callbacks.onPresenceChange?.(
                Object.keys(room.presenceState()).length,
            );
        });

    room.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await room.track({
                username: user.username,
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
