import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function joinRoom(roomId: string, user: { id: string; username: string }) {
    // 1. Create a channel scoped to the specific room
    const room = supabase.channel(`room:${roomId}`, {
        config: {
            broadcast: { self: false }, // Don't echo messages back to sender
            presence: { key: user.id }, // Group presence state by user ID
        },
    });

    // 2. Listen for ephemeral WebSocket events (Broadcast)
    room.on("broadcast", { event: "game-action" }, ({ payload }) => {
        console.log("Received action:", payload);
    });

    // 3. Track who is in the room (Presence)
    room.on("presence", { event: "sync" }, () => {
        const state = room.presenceState();
        console.log("Active users in room:", Object.keys(state));
    })
        .on("presence", { event: "join" }, ({ key, newPresences }) => {
            console.log(`${key} joined`, newPresences);
        })
        .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
            console.log(`${key} left`, leftPresences);
        });

    // 4. Open the WebSocket subscription and announce presence
    room.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await room.track({
                username: user.username,
                online_at: new Date().toISOString(),
            });
        }
    });

    return room;
}
