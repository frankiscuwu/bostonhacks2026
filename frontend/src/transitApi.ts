import { API_BASE_URL } from "./restaurantsApi.ts";
import type { LatLng } from "./restaurantsApi.ts";

export type TransitPoint = LatLng & { id?: string; name: string };
export type TransitLine = { id: string; name: string; color: string };
export type TransitGeometry = { type: "LineString"; coordinates: [number, number][] };
export type TransitDeparture = { time: string; source: "realtime" | "schedule"; headsign: string | null; status: string | null };
export type TransitLeg = {
    type: "transit"; route: TransitLine; pattern_id: string;
    direction_id: number; direction: string | null; headsign: string | null;
    from: TransitPoint; to: TransitPoint; stops: TransitPoint[]; stop_count: number;
    geometry: TransitGeometry | null; departures: TransitDeparture[];
    departure_source: "realtime" | "schedule" | "unavailable";
    departure_is_feasible?: boolean;
    timing?: { departure_time: string; arrival_time: string; duration_seconds: number; wait_seconds: number; source: string } | null;
};
export type WalkingLeg = { type: "walk"; from: TransitPoint; to: TransitPoint; approximate_distance_m: number; distance_basis: "straight_line" | "pedestrian_route"; geometry: TransitGeometry | null; instruction: string; distance_m?: number; duration_seconds?: number | null; steps?: string[] };
export type TransferLeg = { type: "transfer"; station: TransitPoint; from_route: TransitLine; to_route: TransitLine; instruction: string; geometry: null };
export type TransitDirections = {
    status: "ok" | "origin_required" | "no_route" | "unsupported" | "unavailable";
    origin: LatLng | null; origin_source?: "saved_participant" | "provided";
    destination: TransitPoint & { restaurant_id: number };
    boarding_station?: TransitPoint | null; exit_station?: TransitPoint | null;
    legs: (TransitLeg | WalkingLeg | TransferLeg)[];
    warnings: { code: string; message: string }[];
    alerts: { id: string; effect: string | null; header: string; url: string | null }[];
    summary: { transfers: number; stop_count: number; approximate_walk_m: number; walking_distance_m?: number; duration_minutes: number | null } | null;
    eta?: { status: "complete" | "unavailable"; reason?: string | null; arrival_time?: string; duration_seconds?: number; walking_seconds?: number; waiting_seconds?: number; transit_seconds?: number; source?: "realtime" | "schedule" | "mixed"; boarding_buffer_seconds?: number };
    generated_at?: string; network_fetched_at?: string;
};

export class TransitError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export async function fetchTransitDirections(
    restaurantId: number,
    startingPoint: LatLng | { roomCode: string; token: string } | null,
    signal: AbortSignal,
): Promise<TransitDirections> {
    const params = new URLSearchParams({ restaurant_id: String(restaurantId) });
    const headers: Record<string, string> = {};
    if (startingPoint && "roomCode" in startingPoint) {
        params.set("room_code", startingPoint.roomCode);
        headers["X-Participant-Token"] = startingPoint.token;
    } else if (startingPoint) {
        params.set("origin_lat", String(startingPoint.latitude));
        params.set("origin_lon", String(startingPoint.longitude));
    }
    const response = await fetch(`${API_BASE_URL}/api/transit/directions/?${params}`, {
        method: "GET", headers, signal, cache: "no-store", referrerPolicy: "no-referrer",
    });
    const data = await response.json().catch(() => null) as (TransitDirections & { detail?: string }) | null;
    if (!response.ok) {
        const message = data?.detail ?? (response.status === 429
            ? "Too many requests. Wait a minute before retrying."
            : response.status === 400 ? "Check the starting and destination coordinates."
            : response.status === 403 ? "Your participant session expired. Rejoin the Jam or choose a starting point."
            : "Directions could not be loaded. Please retry.");
        throw new TransitError(response.status, message);
    }
    if (!data || !["ok", "origin_required", "no_route", "unsupported", "unavailable"].includes(data.status)
        || !Array.isArray(data.legs) || !Array.isArray(data.warnings) || !data.destination) {
        throw new TransitError(502, "The directions service returned an unexpected response.");
    }
    return data;
}

export type AddressSuggestion = LatLng & { id: string; label: string };
export async function searchAddresses(query: string, mode: "autocomplete" | "geocode", signal: AbortSignal): Promise<AddressSuggestion[]> {
    const params = new URLSearchParams({ q: query, mode });
    const response = await fetch(`${API_BASE_URL}/api/transit/addresses/?${params}`, { signal, cache: "no-store", referrerPolicy: "no-referrer" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.suggestions)) throw new Error(data?.detail ?? "Address search unavailable. Try current location or advanced coordinates.");
    return data.suggestions;
}
