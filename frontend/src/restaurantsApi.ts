import type { Restaurant, RestaurantVideo } from "./data.ts";

export type ApiVideo = {
    id: number;
    platform: RestaurantVideo["platform"];
    url: string;
    embed_id: string;
    embed_url: string;
    thumbnail_url: string;
    author: string;
    caption: string;
};

export type ApiRestaurant = {
    id: number;
    name: string;
    address: string;
    cuisine: string | null;
    // Display label computed by Django; filters match on this value.
    cuisine_label?: string;
    price_level: number | null;
    rating: number | string | null;
    latitude: number | string;
    longitude: number | string;
    creator_video_url: string;
    videos?: ApiVideo[];
    image_url: string;
    description: string | null;
    open_time?: string | null;
    close_time?: string | null;
};

// "donut;coffee_shop" -> "Donut"; null -> "Other".
export function formatCuisine(raw: string | null | undefined) {
    const first = raw?.split(";")[0]?.trim();
    if (!first) return "Other";
    return first
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function minutesOf(time: string | null | undefined) {
    const match = time?.match(/^(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function isOpenAt(openTime: string | null | undefined, closeTime: string | null | undefined, now = new Date()) {
    const open = minutesOf(openTime);
    const close = minutesOf(closeTime);
    if (open === null || close === null) return null;
    const current = now.getHours() * 60 + now.getMinutes();
    // Handles hours that run past midnight, e.g. 17:00-02:00.
    return open <= close
        ? current >= open && current < close
        : current >= open || current < close;
}

// Django API origin. Vite inlines VITE_API_URL at *build* time, so production
// hosts (e.g. Vercel) must set it in their environment and rebuild. The
// localhost fallback is for `npm run dev` only: in a deployed build it would
// point at each visitor's own machine.
const configuredApiUrl = (
    import.meta.env.VITE_API_URL as string | undefined
)?.replace(/\/$/, "");

if (!configuredApiUrl && import.meta.env.PROD) {
    console.error(
        "VITE_API_URL is not set for this production build; API requests will fail. " +
            "Set it to the deployed Django URL (https://…) and redeploy.",
    );
}

export const API_BASE_URL =
    configuredApiUrl ||
    (import.meta.env.PROD ? "/api-not-configured" : "http://127.0.0.1:8000");

export type LatLng = { latitude: number; longitude: number };

// Fallback distance origin when the device location is unavailable.
export const BOSTON_COMMON: LatLng = { latitude: 42.3551, longitude: -71.0624 };

export function haversineMiles(
    latitude: number,
    longitude: number,
    origin: LatLng = BOSTON_COMMON,
): number {
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadiusMiles = 3958.8;
    const latDelta = toRadians(latitude - origin.latitude);
    const lonDelta = toRadians(longitude - origin.longitude);
    const lat1 = toRadians(origin.latitude);
    const lat2 = toRadians(latitude);
    const haversine =
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
    return earthRadiusMiles * 2 * Math.atan2(
        Math.sqrt(haversine),
        Math.sqrt(1 - haversine),
    );
}

function projectCoordinates(latitude: number, longitude: number) {
    const west = -71.12;
    const east = -71.02;
    const north = 42.38;
    const south = 42.32;
    return {
        x: Math.round(80 + ((longitude - west) / (east - west)) * 340),
        y: Math.round(300 - ((latitude - south) / (north - south)) * 240),
    };
}

function neighborhoodFromAddress(address: string) {
    const segments = address
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
    const neighborhood = segments.find(
        (segment) =>
            !/\d/.test(segment) &&
            !/Boston/i.test(segment) &&
            !/MA/i.test(segment),
    );
    return neighborhood ?? "Boston";
}

export function mapApiRestaurant(row: ApiRestaurant): Restaurant {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const rating = row.rating === null ? null : Number(row.rating);
    const priceLevel =
        row.price_level === null
            ? null
            : Math.max(1, Math.min(4, Number(row.price_level) || 1));
    const cuisine = row.cuisine_label ?? formatCuisine(row.cuisine);
    const hours =
        row.open_time && row.close_time
            ? `${row.open_time}–${row.close_time}`
            : null;
    const accentColors = ["#1DB954", "#FF5E3A", "#38bdf8", "#f59e0b", "#a855f7"];
    const accent = accentColors[row.id % accentColors.length];

    return {
        id: row.id,
        name: row.name,
        neighborhood: neighborhoodFromAddress(row.address),
        cuisine,
        distance: haversineMiles(latitude, longitude),
        price: priceLevel === null ? null : "$".repeat(priceLevel),
        rating: rating !== null && Number.isFinite(rating) ? rating : null,
        reviews: 0,
        openNow: isOpenAt(row.open_time, row.close_time),
        hours,
        // Not available in the source data.
        tablesTonight: false,
        walkInFriendly: false,
        vibe: row.description || cuisine,
        accent,
        inQueue: false,
        coords: projectCoordinates(latitude, longitude),
        latitude,
        longitude,
        dishHighlight: [row.description, row.address].filter(Boolean).join(" • ") || cuisine,
        hasPhoto: Boolean(row.image_url),
        image:
            row.image_url ||
            `https://placehold.co/600x900/181818/1DB954?text=${encodeURIComponent(row.name)}`,
        video: row.videos?.[0]
            ? {
                  platform: row.videos[0].platform,
                  url: row.videos[0].url,
                  embedId: row.videos[0].embed_id,
                  embedUrl: row.videos[0].embed_url,
                  author: row.videos[0].author,
                  caption: row.videos[0].caption,
              }
            : null,
        videoCount: row.videos?.length ?? 0,
    };
}

export async function fetchRestaurants(): Promise<Restaurant[]> {
    const response = await fetch(`${API_BASE_URL}/api/restaurants/`);
    if (!response.ok) {
        throw new Error(`Restaurant API returned HTTP ${response.status}`);
    }
    const rows = (await response.json()) as ApiRestaurant[];
    return rows.map(mapApiRestaurant);
}
