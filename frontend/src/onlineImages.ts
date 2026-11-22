import { useEffect, useRef, useState } from "react";
import type { Restaurant } from "./data.ts";
import { API_BASE_URL } from "./restaurantsApi.ts";

// Photos for restaurants that have no creator video (and so no thumbnail):
// the restaurant's own photo from Google Places, via our backend (which keeps
// the API key, verifies the match by name + distance, and caches). When there
// is no confident match the card shows no photo rather than a generic one.

async function lookUpImage(restaurant: Restaurant): Promise<string | null> {
    const response = await fetch(
        `${API_BASE_URL}/api/restaurants/${restaurant.id}/photo/`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { url?: string | null };
    return data.url || null;
}

const imageCache = new Map<number, Promise<string | null>>();
// Settled lookups, so remounted cards show their photo immediately.
const resolvedImages = new Map<number, string | null>();

export function findOnlineImage(restaurant: Restaurant) {
    let image = imageCache.get(restaurant.id);
    if (!image) {
        image = lookUpImage(restaurant)
            .catch(() => null)
            .then((url) => {
                resolvedImages.set(restaurant.id, url);
                return url;
            });
        imageCache.set(restaurant.id, image);
    }
    return image;
}

// The restaurant's own photo (video thumbnail) when it has one; otherwise an
// online photo, looked up once the element scrolls near the viewport.
// `src` is undefined until a real photo is known (never a text placeholder).
export function useRestaurantImage<T extends Element>(restaurant: Restaurant) {
    const ref = useRef<T | null>(null);
    const [online, setOnline] = useState<{ id: number; url: string } | null>(
        null,
    );
    const needsLookup = !restaurant.hasPhoto;
    const cached = resolvedImages.get(restaurant.id);

    useEffect(() => {
        const element = ref.current;
        if (!needsLookup || !element || resolvedImages.has(restaurant.id)) return;
        let cancelled = false;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                observer.disconnect();
                findOnlineImage(restaurant).then((url) => {
                    if (!cancelled && url) setOnline({ id: restaurant.id, url });
                });
            },
            { rootMargin: "100% 0px" },
        );
        observer.observe(element);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [needsLookup, restaurant]);

    const src = !needsLookup
        ? restaurant.image
        : online?.id === restaurant.id
          ? online.url
          : (cached ?? undefined);
    return { ref, src };
}
