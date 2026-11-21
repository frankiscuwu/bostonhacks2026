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
    // Yes votes for this restaurant in the current room (from /results/).
    votes: number;
    // Local-only personal shortlist.
    inQueue: boolean;
    coords: { x: number; y: number };
    latitude: number;
    longitude: number;
    dishHighlight: string;
    image: string;
};

export type FilterState = {
    maxDistance: number;
    minRating: number;
    cuisines: string[];
    prices: string[];
    openNow: boolean;
    tablesTonight: boolean;
    walkInFriendly: boolean;
};

export const CUISINE_CATEGORIES = [
    "All",
    "Italian",
    "Seafood",
    "Ramen & Asian",
    "New American",
    "Tacos & Latin",
    "Bakery & Cafe",
    "Steakhouse",
];

export const PRICE_TIERS = ["$", "$$", "$$$", "$$$$"];
