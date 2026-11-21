// Supabase Realtime is used only as a lightweight notification bus.
// Django is the source of truth: on "room-updated" clients refetch room state
// from the API. No room state, votes or credentials are broadcast here.
import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type RoomPreferences = {
    cuisines: string[];
    prices: string[];
};

// Presence carries only display metadata keyed by Django participant id.
export type PresenceProfile = {
    participantId: number;
    preferences: RoomPreferences;
};

export type RoomChannelCallbacks = {
    onRoomUpdated?: () => void;
    onPresence?: (profiles: Map<number, PresenceProfile>) => void;
    onReady?: () => void;
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
        const profiles = new Map<number, PresenceProfile>();
        for (const entries of Object.values(state)) {
            for (const entry of entries) {
                if (entry.profile && typeof entry.profile.participantId === "number") {
                    profiles.set(entry.profile.participantId, entry.profile);
                }
            }
        }
        callbacks.onPresence?.(profiles);
    });

    channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await channel.track({ profile });
            callbacks.onReady?.();
        }
    });

    return channel;
}

// Tell other clients to refetch from Django. Payload is intentionally minimal.
export async function notifyRoomUpdated(
    channel: RealtimeChannel | null,
    round: number,
) {
    if (!channel) return;
    await channel.send({
        type: "broadcast",
        event: "room-updated",
        payload: { round },
    });
}

export async function updatePresence(
    channel: RealtimeChannel | null,
    profile: PresenceProfile,
) {
    if (!channel) return;
    await channel.track({ profile });
}
