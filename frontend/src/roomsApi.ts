// Client for the Django room API (see backend/API.md).
// Django is the source of truth for rooms, participants, their filters and
// the room's randomly picked restaurant. Never put participant tokens in URLs
// or Realtime payloads.
import { API_BASE_URL } from "./restaurantsApi.ts";
import type { ApiRestaurant } from "./restaurantsApi.ts";

export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeRoomCode(code: string) {
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type ApiFilters = {
    cuisines: string[];
    max_distance_miles: number | null;
    open_now: boolean;
};

export type ApiParticipant = {
    id: number;
    display_name: string;
    filters: ApiFilters;
    // Whether this participant shared a location; coordinates are never exposed.
    has_location: boolean;
    joined_at: string;
    is_active: boolean;
};

export type RoomState = {
    code: string;
    // Randomly picked from restaurants matching every participant's filters.
    selected_restaurant: ApiRestaurant | null;
    selected_at: string | null;
    selected_by: number | null;
    is_active: boolean;
    created_at: string;
    participants: ApiParticipant[];
    // Restaurants matching everyone's saved filters, with each person's distance
    // measured from their own location (computed by Django).
    matching_count: number;
    matching_restaurant_ids: number[];
};

export type RoomMembership = {
    room: RoomState;
    participant: ApiParticipant;
    participant_token: string;
};

export class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function request<T>(
    path: string,
    init: RequestInit & { token?: string } = {},
): Promise<T> {
    const { token, headers, ...rest } = init;
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { "X-Participant-Token": token } : {}),
            ...headers,
        },
    });
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = (await response.json()) as { detail?: string };
            if (body?.detail) message = body.detail;
        } catch {
            // Non-JSON error body; keep the status message.
        }
        throw new ApiError(response.status, message);
    }
    return (await response.json()) as T;
}

export function createRoom(displayName: string) {
    return request<RoomMembership>("/api/rooms/", {
        method: "POST",
        body: JSON.stringify({ display_name: displayName }),
    });
}

export function joinRoom(code: string, displayName: string) {
    return request<RoomMembership>(`/api/rooms/${code}/join/`, {
        method: "POST",
        body: JSON.stringify({ display_name: displayName }),
    });
}

export function getRoom(code: string) {
    return request<RoomState>(`/api/rooms/${code}/`);
}

export function updateFilters(code: string, token: string, filters: ApiFilters) {
    return request<RoomState>(`/api/rooms/${code}/filters/`, {
        method: "PUT",
        token,
        body: JSON.stringify(filters),
    });
}

// Your device location (rounded to ~100 m by Django), or nulls to clear it.
// Stays private: Django never returns it to other clients.
export function updateLocation(
    code: string,
    token: string,
    location: { latitude: number; longitude: number } | null,
) {
    return request<RoomState>(`/api/rooms/${code}/location/`, {
        method: "PUT",
        token,
        body: JSON.stringify(location ?? { latitude: null, longitude: null }),
    });
}

// Django randomly picks one restaurant matching every participant's filters.
export function pickRestaurant(code: string, token: string) {
    return request<RoomState>(`/api/rooms/${code}/pick/`, {
        method: "POST",
        token,
        body: "{}",
    });
}

// ---------------------------------------------------------------------------
// Participant session storage. Django has no credential recovery, so the token
// is kept per room in localStorage to survive refreshes.
// ---------------------------------------------------------------------------
export type RoomSession = {
    code: string;
    participantId: number;
    token: string;
};

const sessionKey = (code: string) => `boston-jam-session:${code}`;

export function loadSession(code: string): RoomSession | null {
    try {
        const raw = window.localStorage.getItem(sessionKey(code));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as RoomSession;
        if (parsed?.code === code && parsed.token && parsed.participantId) {
            return parsed;
        }
    } catch {
        // Storage unavailable or corrupt; treat as no session.
    }
    return null;
}

export function saveSession(membership: RoomMembership): RoomSession {
    const session: RoomSession = {
        code: membership.room.code,
        participantId: membership.participant.id,
        token: membership.participant_token,
    };
    try {
        window.localStorage.setItem(sessionKey(session.code), JSON.stringify(session));
    } catch {
        // Session will only last for this page load.
    }
    return session;
}

export function clearSession(code: string) {
    try {
        window.localStorage.removeItem(sessionKey(code));
    } catch {
        // ignore
    }
}

// Joins are not idempotent (each call creates a participant). Deduplicate
// concurrent joins for the same room, e.g. React StrictMode double effects.
const pendingJoins = new Map<string, Promise<RoomSession>>();

export function ensureMembership(code: string, displayName: string): Promise<RoomSession> {
    const existing = loadSession(code);
    if (existing) return Promise.resolve(existing);
    let pending = pendingJoins.get(code);
    if (!pending) {
        pending = joinRoom(code, displayName)
            .then(saveSession)
            .finally(() => pendingJoins.delete(code));
        pendingJoins.set(code, pending);
    }
    return pending;
}
