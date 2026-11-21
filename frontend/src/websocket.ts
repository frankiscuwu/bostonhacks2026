// Supabase Realtime is used only as a lightweight notification bus.
// Django is the source of truth: on "room-updated" clients refetch room state
// from the API. No room state, filters or credentials are broadcast here.
import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Presence only says who is online, keyed by Django participant id.
export type PresenceProfile = {
    participantId: number;
};

export type RoomChannelCallbacks = {
    onRoomUpdated?: () => void;
    onPresence?: (onlineIds: Set<number>) => void;
};

const supabase:
    | ReturnType<typeof createClient>
    | null = supabaseUrl && supabasePublishableKey
        ? createClient(supabaseUrl, supabasePublishableKey)
        : null;

export function isRealtimeConfigured() {
    return supabase !== null;
}

export function subscribeToRoom(
    roomCode: string,
    profile: PresenceProfile,
    callbacks: RoomChannelCallbacks = {},
) {
    if (!supabase) return null;

    const channel: RealtimeChannel = supabase.channel(`room:${roomCode}`, {
        config: {
            broadcast: { self: false },
            presence: { key: String(profile.participantId) },
        },
    });

    channel.on("broadcast", { event: "room-updated" }, () => {
        callbacks.onRoomUpdated?.();
    });

    channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<
            string,
            Array<{ profile?: PresenceProfile }>
        >;
        const online = new Set<number>();
        for (const entries of Object.values(state)) {
            for (const entry of entries) {
                if (typeof entry.profile?.participantId === "number") {
                    online.add(entry.profile.participantId);
                }
            }
        }
        callbacks.onPresence?.(online);
    });

    channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            try {
                await channel.track({ profile });
            } catch {
                // Presence is cosmetic; ignore failures.
            }
        }
    });

    return channel;
}

// Tell other clients to refetch from Django. Payload is intentionally empty.
export async function notifyRoomUpdated(channel: RealtimeChannel | null) {
    if (!channel) return;
    try {
        await channel.send({ type: "broadcast", event: "room-updated", payload: {} });
    } catch {
        // Polling covers missed notifications.
    }
}
