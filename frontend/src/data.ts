export type RestaurantVideo = {
    platform: "tiktok" | "youtube";
    // Link to the post on the platform.
    url: string;
    embedId: string;
    // iframe player URL.
    embedUrl: string;
    author: string;
    caption: string;
};

export type Restaurant = {
    // Django restaurant primary key.
    id: number;
    name: string;
    neighborhood: string;
    cuisine: string;
    distance: number;
    // Null when the source table has no price/rating data.
    price: string | null;
    rating: number | null;
    reviews: number;
    // Null when opening hours are unknown.
    openNow: boolean | null;
    hours: string | null;
    tablesTonight: boolean;
    walkInFriendly: boolean;
    vibe: string;
    accent: string;
    // Local-only personal shortlist.
    inQueue: boolean;
    coords: { x: number; y: number };
    latitude: number;
    longitude: number;
    dishHighlight: string;
    image: string;
    // False when `image` is a placeholder (no creator video thumbnail).
    hasPhoto: boolean;
    // First attached TikTok / YouTube video, if any.
    video: RestaurantVideo | null;
    // Every attached video, in order (video === videos[0]).
    videos: RestaurantVideo[];
};

// One participant's filters as edited in the UI. Saved to Django per participant;
// the room's random pick only uses restaurants matching everyone's filters.
export type FilterState = {
    // Miles from your location (GPS, else Boston Common); MAX_DISTANCE_MILES means "any".
    maxDistance: number;
    cuisines: string[];
    openNow: boolean;
};

export const MAX_DISTANCE_MILES = 10;
