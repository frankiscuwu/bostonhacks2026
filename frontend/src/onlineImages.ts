import { useEffect, useRef, useState } from "react";
import type { Restaurant } from "./data.ts";

// Photos for restaurants that have no creator video (and so no thumbnail).
// Uses the Wikimedia Commons API: keyless and CORS-enabled (origin=*).
// 1. A photo whose title names the restaurant (e.g. "Neptune Oyster, Boston.jpg").
// 2. Otherwise a photo of the cuisine, picked per restaurant so cards differ.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 720;

type CommonsResponse = {
    query?: {
        pages?: Record<
            string,
            { index?: number; imageinfo?: { thumburl?: string; url?: string }[] }
        >;
    };
};

async function searchCommons(search: string, limit: number): Promise<string[]> {
    const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*",
        generator: "search",
        gsrnamespace: "6", // File: pages
        gsrsearch: `${search} filetype:bitmap`,
        gsrlimit: String(limit),
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: String(THUMB_WIDTH),
    });
    const response = await fetch(`${COMMONS_API}?${params}`);
    if (!response.ok) return [];
    const data = (await response.json()) as CommonsResponse;
    return Object.values(data.query?.pages ?? {})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((page) => page.imageinfo?.[0]?.thumburl ?? page.imageinfo?.[0]?.url)
        .filter((url): url is string => Boolean(url));
}

// "100 Federal Market & Barista- 10th Floor" -> "100 Federal Market"
function searchableName(name: string) {
    return name
        .split(/\s[-–(]|[-–]\s|[,(@#&]/)[0]
        .replace(/["]/g, "")
        .trim();
}

const cuisineCache = new Map<string, Promise<string[]>>();
const imageCache = new Map<number, Promise<string | null>>();
// Settled lookups, so remounted cards show their photo immediately.
const resolvedImages = new Map<number, string | null>();

function cuisinePhotos(cuisine: string) {
    const key = cuisine.toLowerCase();
    let photos = cuisineCache.get(key);
    if (!photos) {
        const query = key === "other" ? "restaurant meal" : `${key} food dish`;
        photos = searchCommons(query, 30).catch(() => []);
        cuisineCache.set(key, photos);
    }
    return photos;
}

async function lookUpImage(restaurant: Restaurant): Promise<string | null> {
    const name = searchableName(restaurant.name);
    // Very short names ("Bar", "Cafe 9") match unrelated photos.
    if (name.length >= 5) {
        const named = await searchCommons(`intitle:"${name}" Boston`, 1).catch(
            () => [],
        );
        if (named[0]) return named[0];
    }
    const photos = await cuisinePhotos(restaurant.cuisine);
    return photos.length > 0 ? photos[restaurant.id % photos.length] : null;
}

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
