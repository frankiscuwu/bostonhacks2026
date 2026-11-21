export type Restaurant = {
    id: string;
    name: string;
    neighborhood: string;
    cuisine: string;
    distance: number;
    price: string;
    rating: number;
    reviews: number;
    openNow: boolean;
    tablesTonight: boolean;
    walkInFriendly: boolean;
    vibe: string;
    accent: string;
    votes: number;
    userVoted: boolean;
    inQueue: boolean;
    voters: string[];
    coords: { x: number; y: number };
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

export type Participant = {
    id: string;
    name: string;
    short: string;
    color: string;
    status: string;
};

export const INITIAL_BOSTON_RESTAURANTS = [
    {
        id: "neptune-oyster",
        name: "Neptune Oyster",
        neighborhood: "North End",
        cuisine: "Seafood",
        distance: 0.9,
        price: "$$$",
        rating: 4.9,
        reviews: 3420,
        openNow: true,
        tablesTonight: false,
        walkInFriendly: true,
        vibe: "Hot Buttered Lobster Roll",
        accent: "#FF5E3A",
        votes: 4,
        userVoted: true,
        inQueue: true,
        voters: ["YOU", "Maya", "Liam", "Chloe"],
        coords: { x: 318, y: 112 },
        dishHighlight:
            "Warm Maine lobster roll on toasted brioche & fresh Wellfleet oysters",
        image: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "yume-wo-katare",
        name: "Yume Wo Katare",
        neighborhood: "Cambridge",
        cuisine: "Ramen & Asian",
        distance: 3.4,
        price: "$$",
        rating: 4.8,
        reviews: 2190,
        openNow: true,
        tablesTonight: false,
        walkInFriendly: true,
        vibe: "Dream-Fueled Jiro Ramen",
        accent: "#1DB954",
        votes: 4,
        userVoted: true,
        inQueue: true,
        voters: ["YOU", "Maya", "Sam", "Liam"],
        coords: { x: 112, y: 68 },
        dishHighlight:
            "Thick hand-cut noodles, rich garlic pork broth & shout your dream",
        image: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "giacomos-north-end",
        name: "Giacomo's Ristorante",
        neighborhood: "North End",
        cuisine: "Italian",
        distance: 1.0,
        price: "$$",
        rating: 4.7,
        reviews: 2890,
        openNow: true,
        tablesTonight: false,
        walkInFriendly: true,
        vibe: "Hanover St. Fra Diavolo",
        accent: "#f59e0b",
        votes: 3,
        userVoted: false,
        inQueue: false,
        voters: ["Maya", "Liam", "Chloe"],
        coords: { x: 325, y: 102 },
        dishHighlight:
            "Lobster, shrimp & calamari fra diavolo over housemade linguine",
        image: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "row-34",
        name: "Row 34",
        neighborhood: "Seaport",
        cuisine: "Seafood",
        distance: 1.4,
        price: "$$$",
        rating: 4.8,
        reviews: 2640,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: true,
        vibe: "Seaport Oysters & Craft Beer",
        accent: "#38bdf8",
        votes: 3,
        userVoted: false,
        inQueue: true,
        voters: ["Maya", "Chloe", "Sam"],
        coords: { x: 382, y: 215 },
        dishHighlight:
            "Island Creek oysters, warm buttered crab roll & New England IPAs",
        image: "https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "toro-south-end",
        name: "Toro",
        neighborhood: "South End",
        cuisine: "New American",
        distance: 1.6,
        price: "$$$",
        rating: 4.7,
        reviews: 3110,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: true,
        vibe: "Barcelona Tapas Energy",
        accent: "#FF5E3A",
        votes: 2,
        userVoted: false,
        inQueue: false,
        voters: ["Liam", "Sam"],
        coords: { x: 222, y: 288 },
        dishHighlight:
            "Grilled street corn (Maíz Asado), jamón ibérico & bone marrow",
        image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "mikes-pastry",
        name: "Mike's Pastry",
        neighborhood: "North End",
        cuisine: "Bakery & Cafe",
        distance: 1.0,
        price: "$",
        rating: 4.6,
        reviews: 7850,
        openNow: true,
        tablesTonight: false,
        walkInFriendly: true,
        vibe: "Iconic White Box Cannoli",
        accent: "#1DB954",
        votes: 3,
        userVoted: true,
        inQueue: false,
        voters: ["YOU", "Maya", "Chloe"],
        coords: { x: 312, y: 96 },
        dishHighlight:
            "Fresh ricotta & chocolate chip cannoli tied in classic white string",
        image: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "lone-star-taco",
        name: "Lone Star Taco Bar",
        neighborhood: "Cambridge",
        cuisine: "Tacos & Latin",
        distance: 3.1,
        price: "$",
        rating: 4.5,
        reviews: 1540,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: true,
        vibe: "Late-Night Street Tacos",
        accent: "#f59e0b",
        votes: 2,
        userVoted: false,
        inQueue: false,
        voters: ["Sam", "Liam"],
        coords: { x: 162, y: 112 },
        dishHighlight:
            "Crispy beef barbacoa tacos, grilled elote & smoky mezcal margaritas",
        image: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "grill-23",
        name: "Grill 23 & Bar",
        neighborhood: "Back Bay",
        cuisine: "Steakhouse",
        distance: 0.5,
        price: "$$$$",
        rating: 4.9,
        reviews: 2490,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: false,
        vibe: "100-Day Dry-Aged Ribeye",
        accent: "#ef4444",
        votes: 2,
        userVoted: false,
        inQueue: false,
        voters: ["Maya", "Sam"],
        coords: { x: 226, y: 204 },
        dishHighlight:
            "100-day dry-aged prime ribeye & warm brioche popovers in Back Bay",
        image: "https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "winsor-dim-sum",
        name: "Winsor Dim Sum House",
        neighborhood: "Chinatown",
        cuisine: "Ramen & Asian",
        distance: 0.4,
        price: "$",
        rating: 4.5,
        reviews: 1830,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: true,
        vibe: "Steaming Bamboo Baskets",
        accent: "#1DB954",
        votes: 2,
        userVoted: false,
        inQueue: false,
        voters: ["Chloe", "Sam"],
        coords: { x: 282, y: 215 },
        dishHighlight:
            "Crystal shrimp har gow, pork siu mai & golden crispy taro puffs",
        image: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "eventide-fenway",
        name: "Eventide Fenway",
        neighborhood: "Fenway",
        cuisine: "Seafood",
        distance: 1.8,
        price: "$$",
        rating: 4.7,
        reviews: 1960,
        openNow: true,
        tablesTonight: false,
        walkInFriendly: true,
        vibe: "Brown Butter Lobster Bao",
        accent: "#38bdf8",
        votes: 1,
        userVoted: false,
        inQueue: false,
        voters: ["Maya"],
        coords: { x: 118, y: 242 },
        dishHighlight:
            "Signature brown-butter lobster roll served on steamed Asian bun",
        image: "https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "alden-harlow",
        name: "Alden & Harlow",
        neighborhood: "Harvard Sq",
        cuisine: "New American",
        distance: 3.6,
        price: "$$$",
        rating: 4.8,
        reviews: 2310,
        openNow: true,
        tablesTonight: true,
        walkInFriendly: false,
        vibe: "Secret Burger & Charred Broccoli",
        accent: "#a855f7",
        votes: 2,
        userVoted: false,
        inQueue: false,
        voters: ["Liam", "Chloe"],
        coords: { x: 96, y: 84 },
        dishHighlight:
            "Off-menu Creekstone secret burger & pickled corn pancakes",
        image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "paramount-beacon-hill",
        name: "The Paramount",
        neighborhood: "Beacon Hill",
        cuisine: "Bakery & Cafe",
        distance: 0.4,
        price: "$$",
        rating: 4.6,
        reviews: 2740,
        openNow: false,
        tablesTonight: true,
        walkInFriendly: true,
        vibe: "Charles St. Brioche French Toast",
        accent: "#f59e0b",
        votes: 1,
        userVoted: false,
        inQueue: false,
        voters: ["Chloe"],
        coords: { x: 256, y: 158 },
        dishHighlight:
            "Griddled brioche French toast & skillet huevos rancheros on Charles St",
        image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80",
    },
];

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

export const JAM_PARTICIPANTS = [
    {
        id: "you",
        name: "You",
        short: "YOU",
        color: "bg-[#1DB954] text-black",
        status: "leading the Jam",
    },
    {
        id: "maya",
        name: "Maya",
        short: "M",
        color: "bg-amber-400 text-black",
        status: "voted for Neptune Oyster",
    },
    {
        id: "liam",
        name: "Liam",
        short: "L",
        color: "bg-rose-500 text-white",
        status: "browsing North End",
    },
    {
        id: "chloe",
        name: "Chloe",
        short: "C",
        color: "bg-sky-400 text-black",
        status: "queued Row 34 Seaport",
    },
    {
        id: "sam",
        name: "Sam",
        short: "S",
        color: "bg-purple-400 text-black",
        status: "craving Ramen & Tacos",
    },
];
