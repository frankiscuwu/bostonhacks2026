import { useCallback, useEffect, useState } from "react";

import type { LatLng } from "./restaurantsApi.ts";

export type GeolocationStatus =
    | "pending"
    | "granted"
    | "denied"
    | "unavailable";

// Watches the device location (asks the browser for permission once).
// Positions are rounded to ~100 m: precise enough for "within 1 mi", and
// small moves don't cause re-saves.
export function useGeolocation(enabled: boolean) {
    const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
    const [location, setLocation] = useState<LatLng | null>(null);
    const [status, setStatus] = useState<GeolocationStatus>(
        supported ? "pending" : "unavailable",
    );
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!enabled || !supported) return;
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const next = {
                    latitude: Math.round(position.coords.latitude * 1000) / 1000,
                    longitude: Math.round(position.coords.longitude * 1000) / 1000,
                };
                setLocation((prev) =>
                    prev &&
                    prev.latitude === next.latitude &&
                    prev.longitude === next.longitude
                        ? prev
                        : next,
                );
                setStatus("granted");
            },
            (error) => {
                setStatus(
                    error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
                );
            },
            { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [enabled, supported, attempt]);

    // Lets the user retry after dismissing or denying the prompt.
    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    return { location, status, retry };
}
