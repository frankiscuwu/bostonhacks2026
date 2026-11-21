// Client for the Django room/voting API (see backend/API.md).
// Django is the source of truth for rooms, participants, votes and the
// current restaurant. Never put participant tokens in URLs or Realtime payloads.
import { API_BASE_URL } from "./restaurantsApi.ts";
import type { ApiRestaurant } from "./restaurantsApi.ts";

export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeRoomCode(code: string) {
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type ApiParticipant = {
    id: number;
    display_name: string;
    joined_at: string;
    is_active: boolean;
};

export type RoomState = {
    code: string;
    current_restaurant: ApiRestaurant | null;
    current_round: number;
    is_active: boolean;
    created_at: string;
    participants: ApiParticipant[];
    voting_progress: {
        required_count: number;
        voted_count: number;
        voted_participant_ids: number[];
    };
};

export type RoomMembership = {
    room: RoomState;
    participant: ApiParticipant;
    participant_token: string;
};

export type ResultRow = {
    restaurant: ApiRestaurant;
    yes_count: number;
    no_count: number;
    total_votes: number;
    approval_rate: number;
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

export function submitVote(
    code: string,
    token: string,
    vote: { round_number: number; restaurant_id: number; vote: boolean },
) {
    return request<RoomState>(`/api/rooms/${code}/vote/`, {
        method: "POST",
        token,
        body: JSON.stringify(vote),
    });
}

export function getResults(code: string) {
    return request<ResultRow[]>(`/api/rooms/${code}/results/`);
}

// Room state only moves forward: rounds increase, and within a round
// participants and votes only accumulate. Used to drop stale responses that
// arrive out of order.
export function isSameOrNewerRoomState(next: RoomState, current: RoomState | null) {
    if (!current || next.code !== current.code) return true;
    if (next.current_round !== current.current_round) {
        return next.current_round > current.current_round;
    }
    return (
        next.participants.length + next.voting_progress.voted_count >=
        current.participants.length + current.voting_progress.voted_count
    );
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
