import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { RefObject } from "react";
import {
    Circle,
    MapContainer,
    Marker,
    Popup,
    TileLayer,
    useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import {
    Heart,
    AlertTriangle,
    MapPin,
    Star,
    ChevronUp,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    Minimize2,
    Copy,
    Trophy,
    RotateCcw,
    Sparkles,
    Pause,
    X,
    Navigation,
    Calendar,
    Clock,
    SlidersHorizontal,
    Shuffle,
    RefreshCw,
    Play,
    ExternalLink,
    TrainFront,
} from "lucide-react";

import { MAX_DISTANCE_MILES } from "./data.ts";
import { useRestaurantImage } from "./onlineImages.ts";
import type { FilterState, Restaurant, RestaurantVideo } from "./data.ts";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
    isRealtimeConfigured,
    notifyRoomUpdated,
    subscribeToRoom,
} from "./websocket.ts";
import {
    BOSTON_COMMON,
    fetchRestaurants,
    haversineMiles,
    mapApiRestaurant,
} from "./restaurantsApi.ts";
import type { LatLng } from "./restaurantsApi.ts";
import { useGeolocation } from "./useGeolocation.ts";
import type { GeolocationStatus } from "./useGeolocation.ts";
import {
    ApiError,
    ROOM_CODE_PATTERN,
    clearSession,
    createRoom as apiCreateRoom,
    ensureMembership,
    getRoom,
    normalizeRoomCode,
    pickRestaurant,
    saveSession,
    updateFilters,
    updateLocation,
} from "./roomsApi.ts";
import type { ApiFilters, RoomSession, RoomState } from "./roomsApi.ts";
import "./App.css";
import { TransitDirectionsPanel } from "./TransitDirections.tsx";
import { TransitRouteLayer } from "./TransitRouteLayer.tsx";
import type { TransitDirections } from "./transitApi.ts";

type ToggleRestaurantHandler = (id: number) => void;
type Toast = { id: number; message: string; accent: string };

type RoomParticipantView = {
    id: number;
    name: string;
    filters: ApiFilters;
    hasLocation: boolean;
    online: boolean;
    isYou: boolean;
};

type ReelCardProps = {
    restaurant: Restaurant;
    isActive: boolean;
    // Which of the restaurant's videos is shown (only the active card changes it).
    mediaIndex: number;
    onChangeMedia: (direction: 1 | -1) => void;
    // Whether this spot also matches everyone else's filters.
    matchesGroup: boolean;
    onToggleQueue: ToggleRestaurantHandler;
};

type VideoScrollerProps = {
    restaurants: Restaurant[];
    activeId: number | null;
    onSelectActive: (id: number) => void;
    onToggleQueue: ToggleRestaurantHandler;
    onResetFilters: () => void;
    feedRef: RefObject<HTMLDivElement | null>;
    // Off: the feed follows only your filters. On: everyone sees the group's matches.
    syncWithGroup: boolean;
    onToggleSync: () => void;
    groupMatchIds: Set<number>;
};

type FilterPanelProps = {
    allRestaurants: Restaurant[];
    // Restaurants matching every participant's filters.
    groupMatchCount: number;
    // Restaurants matching only your own filters.
    myMatchCount: number;
    participantCount: number;
    originLabel: string;
    locationStatus: GeolocationStatus;
    onRetryLocation: () => void;
    filters: FilterState;
    onUpdateFilters: (filters: FilterState) => void;
    onResetFilters: () => void;
};

type FloatingBostonMapProps = {
    restaurants: Restaurant[];
    origin: LatLng;
    originLabel: string;
    activeId: number | null;
    maxDistance: number;
    onSelectPin: (id: number) => void;
    transitRoute: TransitDirections | null;
    onClearTransit: () => void;
};

type JamQueueModalProps = {
    isOpen: boolean;
    onClose: () => void;
    queuedRestaurants: Restaurant[];
    onToggleQueue: ToggleRestaurantHandler;
    onSelectRestaurant: (id: number) => void;
};

type WinnerModalProps = {
    winner: Restaurant | null;
    originLabel: string;
    pickedByName: string | null;
    matchCount: number;
    picking: boolean;
    onClose: () => void;
    onPickAgain: () => void;
    onDirections: () => void;
};

const PLATFORM_LABELS: Record<RestaurantVideo["platform"], string> = {
    tiktok: "TikTok",
    youtube: "YouTube",
};

// iframe URL that starts playing as soon as it loads (it's only loaded after a tap).
function videoPlayerUrl(video: RestaurantVideo) {
    switch (video.platform) {
        case "tiktok":
            return `${video.embedUrl}?autoplay=1&loop=1&rel=0&description=0&music_info=0`;
        case "youtube":
            return `${video.embedUrl}?autoplay=1&playsinline=1&loop=1&playlist=${video.embedId}&rel=0`;
        default:
            return video.embedUrl;
    }
}

// ============================================================================
// COMPONENT 1: REEL CARD (Simulated Vertical Video Card with Double-Tap & Motion)
// ============================================================================
function ReelCard({
    restaurant,
    isActive,
    mediaIndex,
    onChangeMedia,
    matchesGroup,
    onToggleQueue,
}: ReelCardProps) {
    const [isPaused, setIsPaused] = useState(false);
    // The active card loads its creator video right away (cards remount when they
    // become active/inactive, so only one player is ever loaded at a time).
    const [isPlaying, setIsPlaying] = useState(
        () => isActive && Boolean(restaurant.video),
    );
    const videos = restaurant.videos;
    const video = videos[mediaIndex] ?? restaurant.video;
    const hasMultiple = isActive && videos.length > 1;
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const showPlayer = Boolean(video && isActive && isPlaying);
    const { ref: cardRef, src: imageSrc } =
        useRestaurantImage<HTMLElement>(restaurant);

    const handleSurfaceTap = () => {
        if (video) {
            // A tap on a card with a real video starts it.
            if (isActive && !isPlaying) setIsPlaying(true);
        } else {
            // A tap on an image card pauses/resumes the Ken Burns motion.
            setIsPaused((prev) => !prev);
        }
    };

    return (
        <article
            ref={cardRef}
            data-id={restaurant.id}
            onClick={handleSurfaceTap}
            onTouchStart={(e) => {
                const t = e.touches[0];
                touchStart.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
                const start = touchStart.current;
                touchStart.current = null;
                if (!start || !hasMultiple) return;
                const t = e.changedTouches[0];
                const dx = t.clientX - start.x;
                const dy = t.clientY - start.y;
                // Horizontal swipe flips between this spot's videos.
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    onChangeMedia(dx < 0 ? 1 : -1);
                }
            }}
            className="reel-card w-full h-full snap-start relative overflow-hidden flex flex-col justify-end cursor-pointer select-none"
        >
            {/* Creator video (after tap) or image backdrop with Ken Burns motion */}
            <div className="reel-media absolute inset-0 overflow-hidden bg-[#101010]">
                {showPlayer && video ? (
                    <iframe
                        key={video.embedUrl}
                        src={videoPlayerUrl(video)}
                        title={`${restaurant.name} on ${PLATFORM_LABELS[video.platform]}`}
                        className={`reel-player reel-player--${video.platform}`}
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                    />
                ) : (
                    imageSrc && (
                        <img
                            src={imageSrc}
                            alt={restaurant.name}
                            loading="lazy"
                            onError={(e) => {
                                e.currentTarget.style.visibility = "hidden";
                            }}
                            className={`w-full h-full object-cover opacity-90 transition-transform duration-700 ${
                                isActive && !isPaused
                                    ? "animate-ken-burns"
                                    : "scale-105"
                            }`}
                        />
                    )
                )}

                {/* Readability gradient. Over a playing video it covers only the
                    lower part and starts fully transparent, so the video fades
                    into the details instead of ending at a hard dark edge. */}
                <div
                    className={`absolute inset-0 pointer-events-none ${showPlayer ? "z-10 top-[58%]" : ""}`}
                    style={{
                        background: showPlayer
                            ? "linear-gradient(180deg, rgba(12,12,12,0) 0%, rgba(12,12,12,0.18) 35%, rgba(12,12,12,0.55) 75%, rgba(12,12,12,0.8) 100%)"
                            : "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.08) 38%, rgba(12,12,12,0.92) 78%, rgba(12,12,12,0.99) 100%)",
                    }}
                />

                {/* Ambient Floating Steam / Sparkle Particles */}
                {!isPaused && !showPlayer && (
                    <>
                        <div className="absolute bottom-48 left-12 w-3 h-3 rounded-full bg-white/30 blur-[2px] particle-1 pointer-events-none" />
                        <div className="absolute bottom-52 left-28 w-4 h-4 rounded-full bg-[#1DB954]/30 blur-[3px] particle-2 pointer-events-none" />
                        <div className="absolute bottom-44 right-24 w-2.5 h-2.5 rounded-full bg-amber-300/35 blur-[2px] particle-3 pointer-events-none" />
                    </>
                )}
            </div>

            {/* Left / right between this spot's videos */}
            {hasMultiple && (
                <>
                    <div className="absolute top-[86px] inset-x-0 z-20 flex justify-center gap-1.5 pointer-events-none">
                        {videos.map((v, i) => (
                            <span
                                key={`${v.embedUrl}-${i}`}
                                className={`h-1.5 rounded-full transition-all ${
                                    i === mediaIndex
                                        ? "w-4 bg-white"
                                        : "w-1.5 bg-white/45"
                                }`}
                            />
                        ))}
                    </div>
                    {mediaIndex > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onChangeMedia(-1);
                            }}
                            title="Previous video (Left Arrow)"
                            aria-label="Previous video"
                            className="absolute left-3 top-1/3 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/65 hover:bg-[#1DB954] text-white hover:text-black backdrop-blur-md border border-white/15 flex items-center justify-center transition-all shadow-lg active:scale-90"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    )}
                    {mediaIndex < videos.length - 1 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onChangeMedia(1);
                            }}
                            title="Next video (Right Arrow)"
                            aria-label="Next video"
                            className="absolute right-3 top-1/3 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/65 hover:bg-[#1DB954] text-white hover:text-black backdrop-blur-md border border-white/15 flex items-center justify-center transition-all shadow-lg active:scale-90"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    )}
                </>
            )}

            {/* Tap-to-play for cards with a real creator video */}
            {video && isActive && !isPlaying && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsPlaying(true);
                    }}
                    className="absolute inset-x-0 top-1/3 z-20 mx-auto w-fit flex flex-col items-center gap-2 group"
                    aria-label={`Play video on ${PLATFORM_LABELS[video.platform]}`}
                >
                    <span className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-2xl group-hover:bg-[#1DB954] group-hover:text-black transition">
                        <Play className="w-7 h-7 fill-current ml-1" />
                    </span>
                    <span className="px-3 py-1 rounded-full bg-black/60 text-[11px] font-bold text-white">
                        Watch on {PLATFORM_LABELS[video.platform]}
                        {video.author &&
                            ` • @${video.author.replace(/^@/, "")}`}
                    </span>
                </button>
            )}

            {isPaused && !video && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="px-4 py-2.5 rounded-full bg-black/65 backdrop-blur-md border border-white/20 flex items-center gap-2 text-xs font-bold text-white shadow-xl">
                        <Pause className="w-4 h-4 text-[#1DB954]" />
                        <span>Paused • Tap to resume</span>
                    </div>
                </div>
            )}

            {/* Bottom Restaurant Overlay Details & Jam Voting Controls */}
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative z-20 p-5 sm:p-6 pt-12 space-y-3.5 cursor-default [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]"
            >
                {/* Top Metadata Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {restaurant.openNow !== null && (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                                restaurant.openNow
                                    ? "bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/40"
                                    : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            }`}
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    restaurant.openNow
                                        ? "bg-[#1DB954]"
                                        : "bg-rose-400"
                                }`}
                            />
                            {restaurant.openNow ? "Open Now" : "Closed"}
                            {restaurant.hours && (
                                <span className="font-normal opacity-75">
                                    {restaurant.hours}
                                </span>
                            )}
                        </span>
                    )}

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/10 backdrop-blur-md text-white/90 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#1DB954]" />
                        {restaurant.neighborhood} •{" "}
                        {restaurant.distance.toFixed(1)} mi
                    </span>

                    {restaurant.rating !== null && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-300 flex items-center gap-1">
                            <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
                            {restaurant.rating.toFixed(1)}
                        </span>
                    )}

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/40">
                        {restaurant.cuisine}
                    </span>

                    {restaurant.price && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-white/10 text-white">
                            {restaurant.price}
                        </span>
                    )}
                </div>

                {/* Name, Cuisine & Signature Dish */}
                <div>
                    <h2 className="font-display font-extrabold text-2xl sm:text-[26px] leading-tight text-white tracking-tight">
                        {restaurant.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-white/80 mt-1 leading-relaxed">
                        {restaurant.dishHighlight}
                    </p>
                </div>

                {/* Availability & Perk Badges */}
                <div className="flex flex-wrap gap-1.5 text-[11px] text-white/70">
                    {restaurant.tablesTonight && (
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-[#1DB954]" />{" "}
                            Tables Tonight
                        </span>
                    )}
                    {restaurant.walkInFriendly && (
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-sky-400" /> Walk-in
                            Friendly
                        </span>
                    )}
                    {video && (
                        <a
                            href={video.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 flex items-center gap-1 text-white/80 hover:text-white"
                        >
                            <ExternalLink className="w-3 h-3 text-[#1DB954]" />
                            {video.author
                                ? `@${video.author.replace(/^@/, "")}`
                                : "Original post"}{" "}
                            on {PLATFORM_LABELS[video.platform]}
                            {videos.length > 1 &&
                                ` (${mediaIndex + 1}/${videos.length})`}
                        </a>
                    )}
                </div>

                {/* Group Match Status & Like */}
                <div className="pt-2.5 border-t border-white/15 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/70 truncate">
                        {matchesGroup
                            ? "Matches everyone's filters"
                            : "Matches your filters"}
                    </span>

                    <button
                        onClick={() => onToggleQueue(restaurant.id)}
                        className={`px-3 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 flex items-center gap-1 shrink-0 ${
                            restaurant.inQueue
                                ? "bg-white/15 text-[#1DB954] border-[#1DB954]/50"
                                : "bg-black/60 hover:bg-white/15 text-white border-white/20"
                        }`}
                    >
                        <Heart
                            className={`w-3.5 h-3.5 ${restaurant.inQueue ? "fill-current" : ""}`}
                        />
                        <span>{restaurant.inQueue ? "Liked" : "Like"}</span>
                    </button>
                </div>
            </div>
        </article>
    );
}

// Small restaurant photo (own thumbnail, or one looked up online).
function RestaurantThumb({
    restaurant,
    className,
}: {
    restaurant: Restaurant;
    className: string;
}) {
    const { ref, src } = useRestaurantImage<HTMLImageElement>(restaurant);
    return (
        <img
            ref={ref}
            src={src}
            alt={src ? restaurant.name : ""}
            className={`${className} bg-white/5`}
        />
    );
}

// ============================================================================
// COMPONENT 2: VERTICAL VIDEO SCROLLER (Left Segment Container)
// ============================================================================
function VideoScroller({
    restaurants,
    activeId,
    onSelectActive,
    onToggleQueue,
    onResetFilters,
    feedRef,
    syncWithGroup,
    onToggleSync,
    groupMatchIds,
}: VideoScrollerProps) {
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const activeIndex = useMemo(() => {
        const idx = restaurants.findIndex((r) => r.id === activeId);
        return idx === -1 ? 0 : idx;
    }, [restaurants, activeId]);

    const activeSpot = restaurants[activeIndex] || null;

    // Video shown within the active spot; resets when the active spot changes.
    // "Synced with group" shows briefly after turning sync on, then the button
    // goes back to its normal look.
    const [showSynced, setShowSynced] = useState(false);
    const syncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
        },
        [],
    );
    const handleSyncClick = () => {
        if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
        const turningOn = !syncWithGroup;
        setShowSynced(turningOn);
        if (turningOn) {
            syncedTimerRef.current = setTimeout(() => setShowSynced(false), 2500);
        }
        onToggleSync();
    };
    const syncedLook = syncWithGroup && showSynced;

    const [media, setMedia] = useState({ id: activeSpot?.id, index: 0 });
    const mediaIndex = media.id === activeSpot?.id ? media.index : 0;
    const changeMedia = useCallback(
        (direction: 1 | -1) => {
            if (!activeSpot) return;
            const count = activeSpot.videos.length;
            const next = mediaIndex + direction;
            if (next < 0 || next >= count) return;
            setMedia({ id: activeSpot.id, index: next });
        },
        [activeSpot, mediaIndex],
    );

    const handleScroll = () => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
            const container = feedRef.current;
            if (!container) return;
            const cards = Array.from(
                container.querySelectorAll<HTMLElement>(".reel-card"),
            );
            if (cards.length === 0) return;

            const containerRect = container.getBoundingClientRect();
            const center = containerRect.top + containerRect.height / 2;

            let closest = cards[0];
            let minDiff = Infinity;
            cards.forEach((card) => {
                const rect = card.getBoundingClientRect();
                const cardCenter = rect.top + rect.height / 2;
                const diff = Math.abs(center - cardCenter);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = card;
                }
            });

            const newId = Number(closest.dataset.id);
            if (Number.isFinite(newId) && newId !== activeId) {
                onSelectActive(newId);
            }
        }, 60);
    };

    const navigateReel = useCallback(
        (direction: 1 | -1) => {
            if (restaurants.length === 0) return;
            const nextIdx =
                (activeIndex + direction + restaurants.length) %
                restaurants.length;
            const nextSpot = restaurants[nextIdx];
            onSelectActive(nextSpot.id);
            const targetEl = feedRef.current?.querySelector(
                `[data-id="${nextSpot.id}"]`,
            );
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        },
        [restaurants, activeIndex, onSelectActive, feedRef],
    );

    // Keyboard Up / Down arrow support
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                navigateReel(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                navigateReel(-1);
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                changeMedia(1);
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                changeMedia(-1);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navigateReel, changeMedia]);

    return (
        <section
            aria-label="Boston Restaurant Video Reels"
            className="w-full lg:w-[40%] xl:w-[38%] h-[80vh] lg:h-full bg-[#0c0c0c] border-b lg:border-b-0 lg:border-r border-white/10 relative flex items-center justify-center p-3 sm:p-5 select-none"
        >
            {/* Dynamic Ambient Glow Behind Active Reel */}
            <div
                className="absolute inset-0 opacity-25 pointer-events-none transition-all duration-700"
                style={{
                    background: `radial-gradient(circle at 50% 45%, ${
                        activeSpot ? activeSpot.accent : "#1DB954"
                    } 0%, transparent 68%)`,
                }}
            />

            {/* Smartphone-Proportioned Vertical Reel Viewport */}
            <div className="relative w-full max-w-[430px] h-full max-h-[830px] rounded-[28px] overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.88)] border border-white/15 bg-[#181818]">
                {/* Top Segmented Reel Progress Bars & Live Status */}
                <div className="absolute top-0 inset-x-0 z-30 p-3.5 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none">
                    {restaurants.length > 0 && (
                        <div className="flex gap-1.5 mb-3">
                            {restaurants.map((r, i) => (
                                <div
                                    key={r.id}
                                    className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden"
                                >
                                    {i < activeIndex && (
                                        <div className="h-full w-full bg-white/90" />
                                    )}
                                    {i === activeIndex && (
                                        <div
                                            key={mediaIndex}
                                            className="h-full bg-[#1DB954] reel-progress-active"
                                            style={
                                                {
                                                    // Creator videos get longer before auto-advancing.
                                                    "--reel-duration": r.video
                                                        ? "30s"
                                                        : "9s",
                                                } as React.CSSProperties
                                            }
                                            onAnimationEnd={() => {
                                                // Play through this spot's videos, then move on.
                                                if (
                                                    mediaIndex <
                                                    r.videos.length - 1
                                                )
                                                    changeMedia(1);
                                                else navigateReel(1);
                                            }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={handleSyncClick}
                            aria-pressed={syncWithGroup}
                            title={
                                syncWithGroup
                                    ? "Showing spots that match everyone. Click to go back to your own filters."
                                    : "Show only spots that match everyone's filters"
                            }
                            className={`pointer-events-auto flex items-center gap-1.5 backdrop-blur-md border px-3 py-1.5 rounded-full text-[11px] font-bold transition active:scale-95 ${
                                syncedLook
                                    ? "bg-[#1DB954] text-black border-[#1DB954]"
                                    : "bg-black/60 text-white/95 border-white/15 hover:bg-white/15"
                            }`}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {syncedLook
                                ? "Synced with group"
                                : "Sync scroller with group"}
                        </button>
                    </div>
                </div>

                {/* Snap-Scrolling Feed or Empty State */}
                <div
                    ref={feedRef}
                    onScroll={handleScroll}
                    className="w-full h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar scroll-smooth"
                >
                    {restaurants.length === 0 ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-4">
                                🍽️
                            </div>
                            <h3 className="font-display font-bold text-lg text-white">
                                {syncWithGroup
                                    ? "No spot matches everyone's filters"
                                    : "No spot matches your filters"}
                            </h3>
                            <p className="text-xs text-white/60 mt-1.5 max-w-xs leading-relaxed">
                                {syncWithGroup
                                    ? "Your group's combined filters are too specific. Try widening the distance or clearing a cuisine, or ask a friend to loosen theirs."
                                    : "Try widening the distance or clearing a cuisine."}
                            </p>
                            <button
                                onClick={onResetFilters}
                                className="mt-5 px-5 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-xs transition shadow-lg"
                            >
                                Reset My Filters
                            </button>
                        </div>
                    ) : (
                        restaurants.map((restaurant) => (
                            <ReelCard
                                key={`${restaurant.id}-${restaurant.id === activeSpot?.id}`}
                                restaurant={restaurant}
                                isActive={restaurant.id === activeSpot?.id}
                                mediaIndex={
                                    restaurant.id === activeSpot?.id
                                        ? mediaIndex
                                        : 0
                                }
                                onChangeMedia={changeMedia}
                                matchesGroup={groupMatchIds.has(restaurant.id)}
                                onToggleQueue={onToggleQueue}
                            />
                        ))
                    )}
                </div>

                {/* Floating Up / Down Reel Navigation Buttons */}
                {restaurants.length > 1 && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2.5">
                        <button
                            onClick={() => navigateReel(-1)}
                            title="Previous Restaurant (Up Arrow)"
                            aria-label="Previous Restaurant"
                            className="w-10 h-10 rounded-full bg-black/65 hover:bg-[#1DB954] text-white hover:text-black backdrop-blur-md border border-white/15 flex items-center justify-center transition-all shadow-lg active:scale-90"
                        >
                            <ChevronUp className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => navigateReel(1)}
                            title="Next Restaurant (Down Arrow)"
                            aria-label="Next Restaurant"
                            className="w-10 h-10 rounded-full bg-black/65 hover:bg-[#1DB954] text-white hover:text-black backdrop-blur-md border border-white/15 flex items-center justify-center transition-all shadow-lg active:scale-90"
                        >
                            <ChevronDown className="w-5 h-5" />
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}

// ============================================================================
// COMPONENT 3: COLLABORATIVE JAM HEADER (Top of Right Segment)
// ============================================================================
function describeFilters(filters: ApiFilters, hasLocation: boolean) {
    return [
        filters.cuisines.length > 0
            ? filters.cuisines.join(", ")
            : "Any cuisine",
        filters.max_distance_miles !== null
            ? `≤ ${filters.max_distance_miles} mi ${hasLocation ? "from them" : "of Boston Common"}`
            : "Any distance",
        filters.open_now && "Open now",
    ].filter(Boolean) as string[];
}

function JamHeader({
    queueCount,
    onCopyInvite,
    onOpenQueue,
    onPick,
    picking,
    canPick,
    roomCode,
    participants,
    roomStatus,
}: {
    queueCount: number;
    onCopyInvite: () => void;
    onOpenQueue: () => void;
    onPick: () => void;
    picking: boolean;
    canPick: boolean;
    roomCode: string;
    participants: RoomParticipantView[];
    roomStatus: string;
}) {
    const [showFilters, setShowFilters] = useState(false);
    const showOnline = isRealtimeConfigured();
    const onlineCount = participants.filter((p) => p.online).length;
    return (
        <header className="sticky top-0 z-20 bg-[#121212]/90 backdrop-blur-xl border-b border-white/10 px-5 sm:px-8 py-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Brand, room code & match status */}
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1DB954] to-[#0f7a34] flex items-center justify-center shadow-[0_0_20px_rgba(29,185,84,0.35)] shrink-0">
                        <Sparkles className="w-5 h-5 text-black" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="font-display font-extrabold text-lg sm:text-xl leading-tight tracking-tight text-white">
                            ReelHungry
                        </h1>
                        <div className="mt-0.5 flex items-center gap-2 text-xs min-w-0">
                            <button
                                onClick={onCopyInvite}
                                title="Copy invite link"
                                className="inline-flex items-center gap-1 font-bold text-[#1DB954] hover:text-[#1ed760] transition shrink-0"
                            >
                                <span>Room {roomCode}</span>
                                <Copy className="w-3 h-3" />
                            </button>
                            <span className="text-white/25">•</span>
                            <span className="text-white/60 truncate" title={roomStatus}>
                                {roomStatus}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Likes & group pick */}
                <div className="flex items-center gap-2.5 shrink-0">
                    {/* Likes Pill Button */}
                    <button
                        onClick={onOpenQueue}
                        className="px-3.5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-xs transition flex items-center gap-1.5 active:scale-95"
                    >
                        <Heart className="w-3.5 h-3.5 text-[#1DB954]" />
                        <span>Likes</span>
                        <span className="px-1.5 py-0.2 rounded-full bg-[#1DB954] text-black text-[10px] font-extrabold">
                            {queueCount}
                        </span>
                    </button>

                    {/* Random Group Pick Button */}
                    <button
                        onClick={onPick}
                        disabled={picking || !canPick}
                        title={
                            canPick
                                ? "Randomly pick one spot that matches everyone's filters"
                                : "No spot matches everyone's filters yet"
                        }
                        className="px-4 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-xs sm:text-sm tracking-tight shadow-[0_6px_22px_rgba(29,185,84,0.4)] hover:shadow-[0_8px_28px_rgba(29,185,84,0.6)] transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Shuffle className="w-4 h-4" />
                        <span>{picking ? "Picking…" : "Pick for us"}</span>
                    </button>
                </div>
            </div>
            {participants.length > 0 && (
                <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                            {participants.length}{" "}
                            {participants.length === 1 ? "person" : "people"}
                            {showOnline && ` • ${onlineCount} online`}
                        </span>
                        <button
                            onClick={() => setShowFilters((prev) => !prev)}
                            className="text-[11px] font-semibold text-white/55 hover:text-white flex items-center gap-0.5 transition"
                        >
                            {showFilters ? "Hide filters" : "Show filters"}
                            {showFilters ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>
                    <div className="participant-list">
                        {participants.map((participant) => {
                            const filterParts = describeFilters(
                                participant.filters,
                                participant.hasLocation,
                            );
                            return (
                                <div
                                    key={participant.id}
                                    className={`participant-chip ${showFilters ? "is-expanded" : ""}`}
                                    title={
                                        showFilters
                                            ? undefined
                                            : `${participant.name}: ${filterParts.join(" • ")}`
                                    }
                                >
                                    <div className="participant-avatar">
                                        {participant.name.slice(0, 2).toUpperCase()}
                                        {showOnline && participant.online && (
                                            <span className="participant-online" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="participant-chip-name">
                                            {participant.name}
                                            {participant.isYou && (
                                                <span className="participant-you"> (you)</span>
                                            )}
                                        </div>
                                        {showFilters && (
                                            <div className="participant-chip-filters">
                                                {filterParts.join(" • ")}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </header>
    );
}

// ============================================================================
// COMPONENT 4: LIVE FILTER PANEL (Right Segment Controls)
// ============================================================================
function FilterPanel({
    allRestaurants,
    groupMatchCount,
    myMatchCount,
    participantCount,
    originLabel,
    locationStatus,
    onRetryLocation,
    filters,
    onUpdateFilters,
    onResetFilters,
}: FilterPanelProps) {
    // Cuisines sorted by how many restaurants have them ("Other" last).
    const cuisineCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const restaurant of allRestaurants) {
            counts.set(
                restaurant.cuisine,
                (counts.get(restaurant.cuisine) ?? 0) + 1,
            );
        }
        return [...counts.entries()].sort(
            ([a, countA], [b, countB]) =>
                Number(a === "Other") - Number(b === "Other") ||
                countB - countA ||
                a.localeCompare(b),
        );
    }, [allRestaurants]);

    const toggleCuisine = (cuisine: string | null) => {
        if (cuisine === null) {
            onUpdateFilters({ ...filters, cuisines: [] });
            return;
        }
        const next = filters.cuisines.includes(cuisine)
            ? filters.cuisines.filter((c) => c !== cuisine)
            : [...filters.cuisines, cuisine];
        onUpdateFilters({ ...filters, cuisines: next.sort() });
    };

    const anyDistance = filters.maxDistance >= MAX_DISTANCE_MILES;

    return (
        <div className="px-5 sm:px-8 py-6 space-y-6">
            {/* Group Match Counter & Reset Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#181818] border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center font-display font-extrabold text-lg border border-[#1DB954]/25">
                        {groupMatchCount}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-white">
                            {groupMatchCount} of {allRestaurants.length} spots
                            match{" "}
                            {participantCount > 1
                                ? `all ${participantCount} people`
                                : "your filters"}
                        </p>
                        <p className="text-xs text-white/55">
                            {participantCount > 1 &&
                                `${myMatchCount} match your own filters • `}
                            "Pick for us" chooses one of these at random
                        </p>
                    </div>
                </div>

                <button
                    onClick={onResetFilters}
                    className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/85 hover:text-white border border-white/10 transition flex items-center gap-1.5 active:scale-95"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset My Filters</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Distance Slider */}
                <div className="bg-[#181818] border border-white/10 rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <label
                            htmlFor="distance-slider"
                            className="text-sm font-bold text-white flex items-center gap-2"
                        >
                            <MapPin className="w-4 h-4 text-[#1DB954]" />
                            <span>Max Distance</span>
                        </label>
                        <span className="px-2.5 py-1 rounded-lg bg-[#1DB954]/15 text-[#1DB954] font-display font-bold text-sm">
                            {anyDistance
                                ? "Any"
                                : `${filters.maxDistance.toFixed(1)} mi`}
                        </span>
                    </div>

                    <input
                        id="distance-slider"
                        type="range"
                        min="0.2"
                        max={MAX_DISTANCE_MILES}
                        step="0.2"
                        value={filters.maxDistance}
                        onChange={(e) =>
                            onUpdateFilters({
                                ...filters,
                                maxDistance: parseFloat(e.target.value),
                            })
                        }
                        className="jam-slider my-2"
                    />

                    <div className="flex justify-between text-[11px] text-white/45 mt-1.5 font-medium">
                        <span>0.2 mi</span>
                        <span>Any</span>
                    </div>

                    <p className="text-[11px] text-white/55 mt-2 flex items-center gap-1.5 flex-wrap">
                        <Navigation className="w-3 h-3 text-sky-400" />
                        <span>
                            {locationStatus === "granted"
                                ? `Measured from ${originLabel}`
                                : locationStatus === "pending"
                                  ? "Finding your location… using Boston Common for now"
                                  : locationStatus === "denied"
                                    ? "Location blocked • measuring from Boston Common"
                                    : "Location unavailable • measuring from Boston Common"}
                        </span>
                        {(locationStatus === "denied" ||
                            locationStatus === "unavailable") && (
                            <button
                                onClick={onRetryLocation}
                                className="underline text-sky-300 hover:text-sky-200"
                            >
                                Try again
                            </button>
                        )}
                    </p>
                </div>

                {/* Open Now Toggle */}
                <div className="bg-[#181818] border border-white/10 rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3.5">
                        <h2 className="text-sm font-bold text-white">
                            Availability
                        </h2>
                        <span className="text-xs text-white/45">
                            Uses posted hours
                        </span>
                    </div>
                    <button
                        onClick={() =>
                            onUpdateFilters({
                                ...filters,
                                openNow: !filters.openNow,
                            })
                        }
                        className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                            filters.openNow
                                ? "bg-[#1DB954]/20 text-[#1DB954] border-[#1DB954]"
                                : "bg-white/5 hover:bg-white/10 text-white/75 border-white/10"
                        }`}
                    >
                        <span
                            className={`w-2 h-2 rounded-full ${
                                filters.openNow ? "bg-[#1DB954]" : "bg-white/30"
                            }`}
                        />
                        <span>Open Now only</span>
                    </button>
                    <p className="text-[11px] text-white/45 mt-4">
                        Spots without posted hours are excluded when this is on.
                    </p>
                </div>
            </div>

            {/* Cuisine Multi-Select Pills */}
            <div className="bg-[#181818] border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3.5">
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4 text-[#1DB954]" />
                        <span>Cuisines & Cravings</span>
                    </h2>
                    <span className="text-xs text-white/50">
                        {filters.cuisines.length === 0
                            ? "All cuisines active"
                            : `${filters.cuisines.length} selected`}
                    </span>
                </div>

                <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto custom-scroll">
                    {[
                        [null, allRestaurants.length] as const,
                        ...cuisineCounts,
                    ].map(([cuisine, count]) => {
                        const isSelected =
                            cuisine === null
                                ? filters.cuisines.length === 0
                                : filters.cuisines.includes(cuisine);
                        return (
                            <button
                                key={cuisine ?? "All"}
                                onClick={() => toggleCuisine(cuisine)}
                                className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 active:scale-95 ${
                                    isSelected
                                        ? "bg-[#1DB954] text-black border-[#1DB954] shadow-[0_0_16px_rgba(29,185,84,0.35)]"
                                        : "bg-white/5 hover:bg-white/10 text-white/85 border-white/10"
                                }`}
                            >
                                <span>{cuisine ?? "All"}</span>
                                <span
                                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                                        isSelected
                                            ? "bg-black/20 text-black font-bold"
                                            : "bg-white/10 text-white/60"
                                    }`}
                                >
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// COMPONENT 5: EXPANDABLE FLOATING BOSTON MAP (Bottom-Right Corner)
// ============================================================================
function BostonMapViewport({
    activeSpot,
    transitActive,
}: {
    activeSpot: Restaurant | null;
    transitActive: boolean;
}) {
    const map = useMap();
    // The box animates its size, so a fixed delay re-measures mid-transition
    // and leaves blank tiles. Re-measure whenever the container actually resizes.
    useEffect(() => {
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map]);
    useEffect(() => {
        if (activeSpot && !transitActive) {
            map.panTo([activeSpot.latitude, activeSpot.longitude], {
                animate: true,
            });
        }
    }, [activeSpot, map, transitActive]);
    return null;
}

function FloatingBostonMap({
    restaurants,
    origin,
    originLabel,
    activeId,
    maxDistance,
    onSelectPin,
    transitRoute,
    onClearTransit,
}: FloatingBostonMapProps) {
    const [manuallyExpanded, setExpanded] = useState(false);
    const expanded = manuallyExpanded || Boolean(transitRoute);

    const activeSpot = useMemo(
        () =>
            restaurants.find((restaurant) => restaurant.id === activeId) ??
            restaurants[0] ??
            null,
        [restaurants, activeId],
    );

    const userPosition: LatLngExpression = transitRoute?.origin
        ? [transitRoute.origin.latitude, transitRoute.origin.longitude]
        : [origin.latitude, origin.longitude];

    const pinIcon = (selected: boolean) =>
        L.divIcon({
            className: "boston-map-pin-wrap",
            html: `<div class="boston-map-pin${selected ? " selected" : ""}"><span></span></div>`,
            iconSize: [selected ? 34 : 28, selected ? 42 : 36],
            iconAnchor: [selected ? 17 : 14, selected ? 40 : 34],
        });

    return (
        <aside
            aria-label="Interactive Boston Map"
            className={`fixed bottom-4 right-4 z-40 rounded-2xl bg-[#16181d]/95 backdrop-blur-xl border border-white/15 shadow-[0_20px_55px_rgba(0,0,0,0.88)] overflow-hidden transition-all duration-300 ease-out flex flex-col ${
                expanded
                    ? "w-[92vw] sm:w-[520px] h-[400px] sm:h-[430px]"
                    : "w-[280px] h-[192px]"
            }`}
        >
            {/* Map Header Bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-black/55 border-b border-white/10 z-10 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[#1DB954] shrink-0" />
                    <span className="text-xs font-bold text-white truncate">
                        {transitRoute ? "MBTA + pedestrian route" : activeSpot
                            ? `${activeSpot.name} • ${activeSpot.distance.toFixed(1)} mi`
                            : `Boston Radar • ${restaurants.length} pins`}
                    </span>
                </div>

                <button
                    onClick={() => transitRoute ? onClearTransit() : setExpanded((prev) => !prev)}
                    className="ml-2 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-[#1DB954] text-white hover:text-black text-[11px] font-bold transition flex items-center gap-1 shrink-0"
                >
                    <span>{transitRoute ? "Close route" : expanded ? "Minimize" : "Expand"}</span>
                    {expanded ? (
                        <Minimize2 className="w-3 h-3" />
                    ) : (
                        <Maximize2 className="w-3 h-3" />
                    )}
                </button>
            </div>

            {/* Real interactive OpenStreetMap map */}
            <div className="relative flex-1 w-full h-full bg-[#0e1116] overflow-hidden">
                <MapContainer
                    center={userPosition}
                    zoom={expanded ? 13 : 12}
                    scrollWheelZoom={expanded}
                    zoomControl={expanded}
                    attributionControl={true}
                    className="boston-real-map"
                >
                    <TileLayer
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                        attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
                    />
                    <TileLayer
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <BostonMapViewport
                        activeSpot={activeSpot}
                        transitActive={Boolean(transitRoute)}
                    />

                    {transitRoute && <TransitRouteLayer route={transitRoute} expanded={expanded} />}
                    {!transitRoute && <Circle
                        center={userPosition}
                        radius={Math.min(maxDistance, 20) * 1609.344}
                        pathOptions={{
                            color: "#1DB954",
                            fillColor: "#1DB954",
                            fillOpacity: 0.06,
                            opacity: 0.35,
                            dashArray: "5 5",
                        }}
                    />}
                    <Marker
                        position={userPosition}
                        icon={L.divIcon({
                            className: "boston-map-user-wrap",
                            html: '<div class="boston-map-user"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7],
                        })}
                    />

                    {!transitRoute && restaurants.map((spot) => (
                        <Marker
                            key={spot.id}
                            position={[spot.latitude, spot.longitude]}
                            icon={pinIcon(spot.id === activeSpot?.id)}
                            eventHandlers={{
                                click: () => onSelectPin(spot.id),
                            }}
                        >
                            <Popup
                                closeButton={false}
                                className="boston-map-popup"
                                offset={[0, -24]}
                            >
                                <button
                                    type="button"
                                    className="map-popup-card"
                                    onClick={() => onSelectPin(spot.id)}
                                >
                                    <span className="map-popup-name">
                                        {spot.name}
                                    </span>
                                    <span className="map-popup-meta">
                                        {[
                                            spot.cuisine,
                                            spot.price,
                                            spot.distance.toFixed(1) + " mi",
                                        ]
                                            .filter(Boolean)
                                            .join(" • ")}
                                    </span>
                                </button>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>

                {/* Bottom Floating Info Card when Expanded */}
                {expanded && activeSpot && !transitRoute && (
                    <div className="absolute bottom-3 inset-x-3 bg-[#181818]/95 backdrop-blur-md border border-white/15 rounded-xl p-3 flex items-center justify-between gap-3 shadow-2xl">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white truncate">
                                    {activeSpot.name}
                                </span>
                                <span className="text-xs font-extrabold text-[#1DB954]">
                                    {activeSpot.price}
                                </span>
                            </div>
                            <p className="text-xs text-white/65 truncate">
                                {activeSpot.neighborhood} • {activeSpot.cuisine}{" "}
                                • {activeSpot.distance.toFixed(1)} mi from{" "}
                                {originLabel}
                            </p>
                        </div>
                        <button
                            onClick={() => onSelectPin(activeSpot.id)}
                            className="px-3 py-1.5 rounded-lg bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-xs shrink-0 transition"
                        >
                            Focus Reel
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
}

// ============================================================================
// COMPONENT 6: JAM QUEUE DRAWER MODAL
// ============================================================================
function JamQueueModal({
    isOpen,
    onClose,
    queuedRestaurants,
    onToggleQueue,
    onSelectRestaurant,
}: JamQueueModalProps) {
    if (!isOpen) return null;

    const sortedQueue = [...queuedRestaurants].sort((a, b) =>
        a.name.localeCompare(b.name),
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
            <div className="w-full max-w-lg rounded-3xl bg-[#181818] border border-white/15 p-6 shadow-2xl">
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                        <Heart className="w-5 h-5 text-[#1DB954]" />
                        <h3 className="font-display font-extrabold text-lg text-white">
                            My Likes ({sortedQueue.length})
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/75 hover:text-white transition"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <p className="mt-4 px-3 py-2.5 rounded-xl bg-amber-400/10 border border-amber-400/30 text-xs text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>
                        Likes aren't saved. They only live on this device and
                        disappear when you refresh or leave the page, and
                        other people in the room can't see them.
                    </span>
                </p>

                <div className="py-4 max-h-[60vh] overflow-y-auto space-y-2.5">
                    {sortedQueue.length === 0 ? (
                        <p className="text-sm text-white/60 text-center py-8">
                            No likes yet. Tap "Like" on any reel to shortlist
                            spots!
                        </p>
                    ) : (
                        sortedQueue.map((spot, idx) => (
                            <div
                                key={spot.id}
                                className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10"
                            >
                                <div
                                    onClick={() => {
                                        onSelectRestaurant(spot.id);
                                        onClose();
                                    }}
                                    className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                                >
                                    <span className="text-xs font-extrabold text-white/40 w-4">
                                        #{idx + 1}
                                    </span>
                                    <RestaurantThumb restaurant={spot} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-white truncate">
                                            {spot.name}
                                        </p>
                                        <p className="text-xs text-white/60 truncate">
                                            {[
                                                spot.neighborhood,
                                                spot.cuisine,
                                                `${spot.distance.toFixed(1)} mi`,
                                            ]
                                                .filter(Boolean)
                                                .join(" • ")}
                                        </p>
                                    </div>
                                </div>

                                <button
                                    onClick={() => onToggleQueue(spot.id)}
                                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-rose-500/20 text-white/80 hover:text-rose-300 text-xs font-semibold transition"
                                >
                                    Remove
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// COMPONENT 7: CELEBRATORY WINNER MODAL
// ============================================================================
function WinnerModal({
    winner,
    originLabel,
    pickedByName,
    matchCount,
    picking,
    onClose,
    onPickAgain,
    onDirections,
}: WinnerModalProps) {
    if (!winner) return null;

    const confettiColors = [
        "#1DB954",
        "#FF5E3A",
        "#38bdf8",
        "#facc15",
        "#ffffff",
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl bg-[#181818] border border-[#1DB954]/45 p-6 sm:p-7 text-center shadow-[0_25px_85px_rgba(29,185,84,0.35)]">
                {/* Confetti Particles */}
                <div className="absolute inset-0 pointer-events-none">
                    {Array.from({ length: 28 }).map((_, i) => (
                        <div
                            key={i}
                            className="confetti-piece"
                            style={{
                                left: `${(i * 37) % 100}%`,
                                backgroundColor:
                                    confettiColors[i % confettiColors.length],
                                animationDelay: `${(i % 7) * 0.08}s`,
                            }}
                        />
                    ))}
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1DB954]/20 text-[#1DB954] text-xs font-extrabold tracking-wider uppercase mb-4">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>The Group's Random Pick</span>
                </div>

                <div className="w-24 h-24 mx-auto rounded-2xl overflow-hidden border-2 border-[#1DB954] shadow-xl mb-4">
                    <RestaurantThumb restaurant={winner} className="w-full h-full object-cover" />
                </div>

                <h3 className="font-display font-extrabold text-2xl text-white">
                    {winner.name}
                </h3>
                <p className="text-sm text-white/75 mt-1">
                    {[
                        winner.neighborhood,
                        winner.cuisine,
                        winner.price,
                        winner.rating !== null &&
                            `${winner.rating.toFixed(1)} ★`,
                    ]
                        .filter(Boolean)
                        .join(" • ")}
                </p>

                <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-1">
                    <p className="text-xs text-white/55">
                        {winner.distance.toFixed(1)} mi from {originLabel}
                        {winner.hours && ` • ${winner.hours}`}
                    </p>
                    <p className="text-sm font-bold text-[#1DB954]">
                        Picked{pickedByName ? ` by ${pickedByName}` : ""} from{" "}
                        {matchCount} {matchCount === 1 ? "spot" : "spots"} that
                        match everyone
                    </p>
                </div>

                <button className="transit-primary transit-launch" onClick={onDirections}>
                    <TrainFront size={17} /> Get MBTA Directions
                </button>
                <div className="mt-6 flex gap-3">
                    <button
                        onClick={onPickAgain}
                        disabled={picking}
                        className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-bold text-white transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                        <Shuffle className="w-4 h-4" />
                        <span>{picking ? "Picking…" : "Pick again"}</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-sm font-extrabold text-black transition shadow-lg flex items-center justify-center gap-1.5"
                    >
                        <X className="w-4 h-4" />
                        <span>Close</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// MAIN ROOT APPLICATION COMPONENT
// ============================================================================
const DEFAULT_FILTERS: FilterState = {
    maxDistance: MAX_DISTANCE_MILES,
    cuisines: [],
    openNow: false,
};

// Only the active card loads a player; photo cards fetch their image when near view.
const FEED_WINDOW = 100;

// Random feed position per restaurant, fixed for this page load so the feed
// doesn't reshuffle every time the room updates.
const feedRank = new Map<number, number>();
function randomFeedOrder<T extends { id: number }>(items: T[]) {
    const rank = (id: number) => {
        let r = feedRank.get(id);
        if (r === undefined) {
            r = Math.random();
            feedRank.set(id, r);
        }
        return r;
    };
    return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}
const FILTER_SAVE_DELAY_MS = 400;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown error";
}

function getRoomCodeFromUrl() {
    const match = window.location.pathname.match(
        /^\/(?:room|join)\/([A-Za-z0-9]{6})\/?$/,
    );
    return match?.[1]?.toUpperCase() ?? null;
}

function toApiFilters(filters: FilterState): ApiFilters {
    return {
        cuisines: [...filters.cuisines].sort(),
        max_distance_miles:
            filters.maxDistance >= MAX_DISTANCE_MILES
                ? null
                : Math.round(filters.maxDistance * 10) / 10,
        open_now: filters.openNow,
    };
}

function fromApiFilters(filters: ApiFilters): FilterState {
    return {
        cuisines: [...filters.cuisines].sort(),
        maxDistance: filters.max_distance_miles ?? MAX_DISTANCE_MILES,
        openNow: filters.open_now,
    };
}

function sameFilters(a: ApiFilters, b: ApiFilters) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// Mirrors restaurants/matching.py in Django, which is authoritative for picks.
function matchesFilters(restaurant: Restaurant, filters: ApiFilters) {
    if (
        filters.cuisines.length > 0 &&
        !filters.cuisines.includes(restaurant.cuisine)
    )
        return false;
    if (
        filters.max_distance_miles !== null &&
        restaurant.distance > filters.max_distance_miles
    )
        return false;
    if (filters.open_now && restaurant.openNow !== true) return false;
    return true;
}

export default function App() {
    const [roomCode, setRoomCode] = useState<string | null>(getRoomCodeFromUrl);
    const [roomCodeInput, setRoomCodeInput] = useState("");
    const [entryError, setEntryError] = useState("");
    const [creatingRoom, setCreatingRoom] = useState(false);
    const [profileName, setProfileName] = useState(
        () => window.localStorage.getItem("boston-jam-name") ?? "",
    );
    const [profileComplete, setProfileComplete] = useState(() =>
        Boolean(window.localStorage.getItem("boston-jam-name")?.trim()),
    );
    const roomChannelRef = useRef<RealtimeChannel | null>(null);
    const roomCodeRef = useRef<string | null>(roomCode);
    const profileNameRef = useRef(profileName);

    // Django-backed room state (source of truth).
    const [session, setSession] = useState<RoomSession | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const [roomError, setRoomError] = useState("");
    const [onlineIds, setOnlineIds] = useState<Set<number>>(() => new Set());
    const [picking, setPicking] = useState(false);
    // Drops responses that started before a newer one was applied.
    const requestSeqRef = useRef(0);
    const appliedSeqRef = useRef(0);
    // Whether local filters were loaded from this participant's saved filters.
    // Until then nothing is saved, so defaults never overwrite saved filters.
    const [filtersHydrated, setFiltersHydrated] = useState(false);
    // selected_at already shown; undefined until the first room state arrives.
    const seenSelectionRef = useRef<string | null | undefined>(undefined);

    // Restaurant catalog from Django.
    const [catalog, setCatalog] = useState<Restaurant[]>([]);
    const [restaurantsLoading, setRestaurantsLoading] = useState(true);
    const [restaurantsError, setRestaurantsError] = useState("");
    const [queuedIds, setQueuedIds] = useState<Set<number>>(() => new Set());
    // This participant's filters (saved to Django, shared with the room).
    const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

    const [activeRestaurantId, setActiveRestaurantId] = useState<number | null>(
        null,
    );
    // Off by default: each person scrolls the spots matching their own filters.
    const [syncWithGroup, setSyncWithGroup] = useState(false);
    const [isQueueOpen, setIsQueueOpen] = useState(false);
    const [showPick, setShowPick] = useState(false);
    const [transitOpen, setTransitOpen] = useState(false);
    const [transitRoute, setTransitRoute] = useState<TransitDirections | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const feedRef = useRef<HTMLDivElement>(null);

    // Device GPS while in a room; distances fall back to Boston Common.
    const geo = useGeolocation(Boolean(roomCode && profileComplete));
    const origin = useMemo(() => geo.location ?? BOSTON_COMMON, [geo.location]);
    const originLabel = geo.location ? "you" : "Boston Common";
    // Last location saved to Django for this room ("none" = cleared).
    const savedLocationKeyRef = useRef<string | null>(null);

    useEffect(() => {
        profileNameRef.current = profileName;
    }, [profileName]);

    useEffect(() => {
        let cancelled = false;
        void fetchRestaurants()
            .then((rows) => {
                if (!cancelled) setCatalog(rows);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setRestaurantsError(errorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setRestaurantsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const addToast = useCallback((message: string, accent = "#1DB954") => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, message, accent }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 2500);
    }, []);

    // Switch rooms and reset all room-scoped state.
    const switchRoom = useCallback((code: string | null) => {
        roomCodeRef.current = code;
        appliedSeqRef.current = 0;
        savedLocationKeyRef.current = null;
        setFiltersHydrated(false);
        seenSelectionRef.current = undefined;
        setRoomCode(code);
        setSession(null);
        setRoom(null);
        setRoomError("");
        setOnlineIds(new Set());
        setShowPick(false);
        setTransitOpen(false);
        setTransitRoute(null);
        setFilters(DEFAULT_FILTERS);
    }, []);

    const enterRoom = useCallback(
        (code: string) => {
            const normalizedCode = normalizeRoomCode(code);
            if (!ROOM_CODE_PATTERN.test(normalizedCode)) {
                setEntryError("Room codes are 6 letters or numbers.");
                return;
            }
            setEntryError("");
            window.history.pushState({}, "", `/room/${normalizedCode}`);
            switchRoom(normalizedCode);
        },
        [switchRoom],
    );

    const leaveRoom = useCallback(() => {
        window.history.pushState({}, "", "/");
        switchRoom(null);
    }, [switchRoom]);

    const saveProfile = useCallback(() => {
        const normalizedName = profileName.trim();
        if (!normalizedName) return false;
        window.localStorage.setItem("boston-jam-name", normalizedName);
        setProfileComplete(true);
        return true;
    }, [profileName]);

    // Django generates the room code and the host's participant credential.
    const createRoom = useCallback(async () => {
        if (creatingRoom || !saveProfile()) return;
        setCreatingRoom(true);
        setEntryError("");
        try {
            const membership = await apiCreateRoom(profileName.trim());
            saveSession(membership);
            enterRoom(membership.room.code);
        } catch (error) {
            setEntryError(`Couldn't create a room: ${errorMessage(error)}`);
        } finally {
            setCreatingRoom(false);
        }
    }, [creatingRoom, saveProfile, profileName, enterRoom]);

    useEffect(() => {
        const handlePopState = () => switchRoom(getRoomCodeFromUrl());
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [switchRoom]);

    // Run a room request and apply its state unless a newer one already landed.
    const runRoomRequest = useCallback(
        async (request: () => Promise<RoomState>) => {
            const code = roomCodeRef.current;
            const seq = ++requestSeqRef.current;
            const state = await request();
            if (
                state.code === code &&
                code === roomCodeRef.current &&
                seq > appliedSeqRef.current
            ) {
                appliedSeqRef.current = seq;
                setRoom(state);
            }
            return state;
        },
        [],
    );

    const refreshRoom = useCallback(async () => {
        const code = roomCodeRef.current;
        if (!code) return;
        try {
            await runRoomRequest(() => getRoom(code));
        } catch (error) {
            if (code !== roomCodeRef.current) return;
            if (error instanceof ApiError && error.status === 404) {
                setRoomError("Room not found. Check the code and try again.");
            }
        }
    }, [runRoomRequest]);

    const handleSeatLost = useCallback((code: string) => {
        clearSession(code);
        setSession(null);
        setRoomError(
            "Your seat in this room is no longer valid. Reload the page to rejoin.",
        );
    }, []);

    // Join the room once per browser (the token is reused from storage).
    useEffect(() => {
        if (!roomCode || !profileComplete) return;
        let cancelled = false;
        ensureMembership(roomCode, profileNameRef.current.trim() || "Guest")
            .then((nextSession) => {
                if (cancelled) return;
                setSession(nextSession);
                void refreshRoom();
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                if (error instanceof ApiError && error.status === 404) {
                    setRoomError(
                        "Room not found. Check the code and try again.",
                    );
                } else if (error instanceof ApiError && error.status === 409) {
                    addToast(
                        "This room is closed. You can only look around.",
                        "#f59e0b",
                    );
                } else {
                    setRoomError(`Couldn't join room: ${errorMessage(error)}`);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [roomCode, profileComplete, refreshRoom, addToast]);

    // Initial fetch plus a polling fallback in case a Realtime ping is missed.
    useEffect(() => {
        if (!roomCode || !profileComplete) return;
        const initial = window.setTimeout(() => void refreshRoom(), 0);
        const refreshIfVisible = () => {
            if (document.visibilityState === "visible") void refreshRoom();
        };
        const interval = window.setInterval(
            refreshIfVisible,
            isRealtimeConfigured() ? 10_000 : 3_000,
        );
        document.addEventListener("visibilitychange", refreshIfVisible);
        return () => {
            window.clearTimeout(initial);
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", refreshIfVisible);
        };
    }, [roomCode, profileComplete, refreshRoom]);

    // Realtime: "room-updated" pings trigger a refetch; presence shows who's online.
    useEffect(() => {
        if (!roomCode || !session) return;
        const channel = subscribeToRoom(
            roomCode,
            { participantId: session.participantId },
            {
                onRoomUpdated: () => void refreshRoom(),
                onPresence: (ids) => {
                    setOnlineIds(ids);
                    // Someone joined or left; their membership is in Django.
                    void refreshRoom();
                },
            },
        );
        roomChannelRef.current = channel;
        return () => {
            void channel?.unsubscribe();
            roomChannelRef.current = null;
        };
    }, [roomCode, session, refreshRoom]);

    const me = useMemo(
        () =>
            room?.participants.find((p) => p.id === session?.participantId) ??
            null,
        [room, session],
    );
    const myApiFilters = useMemo(() => toApiFilters(filters), [filters]);

    // Load this participant's saved filters once (e.g. after a page refresh).
    useEffect(() => {
        if (!me || filtersHydrated) return;
        const saved = fromApiFilters(me.filters);
        const timeout = window.setTimeout(() => {
            setFilters(saved);
            setFiltersHydrated(true);
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [me, filtersHydrated]);

    const saveMyFilters = useCallback(
        async (next: ApiFilters) => {
            const code = roomCodeRef.current;
            if (!code || !session) return;
            try {
                await runRoomRequest(() =>
                    updateFilters(code, session.token, next),
                );
                void notifyRoomUpdated(roomChannelRef.current);
            } catch (error) {
                if (error instanceof ApiError && error.status === 403) {
                    handleSeatLost(code);
                } else {
                    addToast(
                        `Couldn't save your filters: ${errorMessage(error)}`,
                        "#f43f5e",
                    );
                }
            }
        },
        [session, runRoomRequest, handleSeatLost, addToast],
    );

    // Save filter changes to Django (debounced) so everyone's pick uses them.
    const filtersDirty = Boolean(
        me && filtersHydrated && !sameFilters(myApiFilters, me.filters),
    );
    useEffect(() => {
        if (!filtersDirty) return;
        const timeout = window.setTimeout(
            () => void saveMyFilters(myApiFilters),
            FILTER_SAVE_DELAY_MS,
        );
        return () => window.clearTimeout(timeout);
    }, [filtersDirty, myApiFilters, saveMyFilters]);

    // Share your location with Django so your distance filter is measured from
    // you. Cleared if location is blocked, so a stale position isn't used.
    const wantedLocation =
        geo.status === "granted" && geo.location
            ? geo.location
            : geo.status === "denied" || geo.status === "unavailable"
              ? null
              : undefined; // still waiting for the browser
    const wantedLocationKey =
        wantedLocation === undefined
            ? null
            : wantedLocation === null
              ? "none"
              : `${wantedLocation.latitude},${wantedLocation.longitude}`;

    const saveMyLocation = useCallback(async () => {
        const code = roomCodeRef.current;
        if (!code || !session || wantedLocationKey === null) return;
        if (savedLocationKeyRef.current === wantedLocationKey) return;
        // Nothing to clear if Django never had a location for you.
        if (wantedLocation === null && me && !me.has_location) {
            savedLocationKeyRef.current = wantedLocationKey;
            return;
        }
        savedLocationKeyRef.current = wantedLocationKey;
        try {
            await runRoomRequest(() =>
                updateLocation(code, session.token, wantedLocation ?? null),
            );
            void notifyRoomUpdated(roomChannelRef.current);
        } catch (error) {
            savedLocationKeyRef.current = null;
            if (error instanceof ApiError && error.status === 403) {
                handleSeatLost(code);
            }
        }
    }, [
        session,
        me,
        wantedLocation,
        wantedLocationKey,
        runRoomRequest,
        handleSeatLost,
    ]);

    useEffect(() => {
        if (!me || wantedLocationKey === null) return;
        const timeout = window.setTimeout(() => void saveMyLocation(), 0);
        return () => window.clearTimeout(timeout);
    }, [me, wantedLocationKey, saveMyLocation]);

    const pickedId = room?.selected_restaurant?.id ?? null;

    // Catalog plus the picked restaurant, in case the catalog predates it.
    const restaurants = useMemo(() => {
        let base = catalog;
        const picked = room?.selected_restaurant;
        if (picked && !catalog.some((r) => r.id === picked.id)) {
            base = [...catalog, mapApiRestaurant(picked)];
        }
        return base.map((r) => ({
            ...r,
            distance: haversineMiles(r.latitude, r.longitude, origin),
            inQueue: queuedIds.has(r.id),
        }));
    }, [catalog, room, queuedIds, origin]);

    // Django computes matches (it knows everyone's location; clients don't).
    // Your own unsaved filter changes narrow the preview immediately.
    const groupMatches = useMemo(() => {
        const serverIds = new Set(room?.matching_restaurant_ids ?? []);
        return restaurants.filter(
            (r) => serverIds.has(r.id) && matchesFilters(r, myApiFilters),
        );
    }, [restaurants, room, myApiFilters]);

    const myMatches = useMemo(
        () => restaurants.filter((r) => matchesFilters(r, myApiFilters)),
        [restaurants, myApiFilters],
    );
    const myMatchCount = myMatches.length;
    const groupMatchIds = useMemo(
        () => new Set(groupMatches.map((r) => r.id)),
        [groupMatches],
    );

    // The feed shows spots matching your own filters, or (when synced) spots
    // matching everyone, in a random order. Spots with a creator video come
    // first; the rest follow with a photo looked up online. A pick only opens the popup.
    const feedRestaurants = useMemo(() => {
        const source = randomFeedOrder(
            syncWithGroup ? groupMatches : myMatches,
        );
        return [
            ...source.filter((r) => r.video),
            ...source.filter((r) => !r.video),
        ].slice(0, FEED_WINDOW);
    }, [syncWithGroup, groupMatches, myMatches]);

    const scrollToRestaurant = useCallback((id: number) => {
        setTimeout(() => {
            const targetEl = feedRef.current?.querySelector(
                `[data-id="${id}"]`,
            );
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 60);
    }, []);

    // Show the pick to everyone when Django reports a new one.
    useEffect(() => {
        if (!room) return;
        const selectedAt = room.selected_at;
        if (seenSelectionRef.current === undefined) {
            seenSelectionRef.current = selectedAt;
            return;
        }
        if (!selectedAt || selectedAt === seenSelectionRef.current) return;
        seenSelectionRef.current = selectedAt;
        setTimeout(() => setShowPick(true), 0);
    }, [room]);

    // Keep activeRestaurantId synchronized when the feed changes
    useEffect(() => {
        if (
            feedRestaurants.length > 0 &&
            !feedRestaurants.some((r) => r.id === activeRestaurantId)
        ) {
            const nextActiveId = feedRestaurants[0].id;
            setTimeout(() => {
                setActiveRestaurantId(nextActiveId);
                if (feedRef.current) feedRef.current.scrollTop = 0;
            }, 0);
        }
    }, [feedRestaurants, activeRestaurantId]);

    const participantViews = useMemo<RoomParticipantView[]>(
        () =>
            (room?.participants ?? [])
                .filter((p) => p.is_active)
                .map((p) => ({
                    id: p.id,
                    name: p.display_name,
                    filters:
                        p.id === session?.participantId
                            ? myApiFilters
                            : p.filters,
                    hasLocation:
                        p.id === session?.participantId
                            ? geo.location !== null
                            : p.has_location,
                    online: onlineIds.has(p.id),
                    isYou: p.id === session?.participantId,
                })),
        [room, onlineIds, session, myApiFilters, geo.location],
    );

    // Django picks at random from restaurants matching everyone's saved filters.
    const handlePick = async () => {
        const code = roomCodeRef.current;
        if (!code || picking) return;
        if (!session) {
            addToast(
                "You're viewing this room without a seat, so you can't pick.",
                "#94a3b8",
            );
            return;
        }
        setPicking(true);
        try {
            // Make sure Django has your latest location and filters before it picks.
            await saveMyLocation();
            if (me && !sameFilters(myApiFilters, me.filters)) {
                await runRoomRequest(() =>
                    updateFilters(code, session.token, myApiFilters),
                );
            }
            const state = await runRoomRequest(() =>
                pickRestaurant(code, session.token),
            );
            void notifyRoomUpdated(roomChannelRef.current);
            if (state.selected_restaurant) {
                addToast(
                    `🎲 Picked ${state.selected_restaurant.name}!`,
                    "#FF5E3A",
                );
            }
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
                addToast(error.message, "#f59e0b");
            } else if (error instanceof ApiError && error.status === 403) {
                handleSeatLost(code);
            } else {
                addToast(`Pick failed: ${errorMessage(error)}`, "#f43f5e");
            }
            void refreshRoom();
        } finally {
            setPicking(false);
        }
    };

    const handleToggleQueue = (id: number) => {
        const restaurant = restaurants.find((r) => r.id === id);
        const adding = !queuedIds.has(id);
        setQueuedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        if (restaurant) {
            addToast(
                adding
                    ? `Liked ${restaurant.name}`
                    : `Removed ${restaurant.name} from Likes`,
            );
        }
    };

    const handleResetFilters = () => {
        setFilters(DEFAULT_FILTERS);
        addToast("Reset your filters");
    };

    const handleJumpToRestaurant = (id: number) => {
        if (!feedRestaurants.some((r) => r.id === id)) {
            addToast(
                syncWithGroup
                    ? "That spot doesn't match everyone's filters."
                    : "That spot doesn't match your filters.",
                "#94a3b8",
            );
            return;
        }
        setActiveRestaurantId(id);
        scrollToRestaurant(id);
    };

    const handleCopyInvite = () => {
        if (!roomCode) return;
        const temp = document.createElement("input");
        temp.value = `${window.location.origin}/room/${roomCode}`;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
        addToast(`Copied Jam invite link (${roomCode})`);
    };

    const queuedRestaurants = useMemo(
        () => restaurants.filter((r) => r.inQueue),
        [restaurants],
    );

    const pickedRestaurant = restaurants.find((r) => r.id === pickedId) ?? null;
    const pickedByName =
        room?.participants.find((p) => p.id === room.selected_by)
            ?.display_name ?? null;

    const roomStatus = !room
        ? "Connecting to room…"
        : groupMatches.length === 0
          ? "No spot matches everyone's filters yet"
          : `${groupMatches.length} ${groupMatches.length === 1 ? "spot matches" : "spots match"} everyone${!session ? " • viewing only" : ""}`;

    if (!roomCode && profileComplete) {
        return (
            <main className="room-entry">
                <div className="room-entry-card">
                    <div className="room-entry-brand">
                        <Sparkles className="room-entry-brand-icon" />
                        <span>ReelHungry</span>
                    </div>
                    <h1>Choose a room</h1>
                    <p>Welcome, {profileName}. Create or join a Jam.</p>
                    <button
                        type="button"
                        onClick={() => void createRoom()}
                        disabled={creatingRoom}
                        className="room-entry-primary"
                    >
                        {creatingRoom ? "Creating…" : "New room"}
                    </button>
                    <div className="room-entry-divider">
                        <span>or join existing</span>
                    </div>
                    <form
                        className="room-entry-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            enterRoom(roomCodeInput);
                        }}
                    >
                        <label htmlFor="room-code">Room code</label>
                        <input
                            id="room-code"
                            value={roomCodeInput}
                            onChange={(event) =>
                                setRoomCodeInput(
                                    event.target.value.toUpperCase(),
                                )
                            }
                            placeholder="e.g. A1B2C3"
                            autoComplete="off"
                            maxLength={6}
                        />
                        <button type="submit" className="room-entry-secondary">
                            Enter room
                        </button>
                    </form>
                    {entryError && (
                        <p className="room-entry-warning" role="alert">
                            {entryError}
                        </p>
                    )}
                </div>
            </main>
        );
    }

    if (!roomCode || !profileComplete) {
        return (
            <main className="room-entry">
                <div className="room-entry-card">
                    <div className="room-entry-brand">
                        <Sparkles className="room-entry-brand-icon" />
                        <span>ReelHungry</span>
                    </div>
                    <h1>
                        {roomCode ? `Join room ${roomCode}` : "Choose a room"}
                    </h1>
                    <p>
                        Add your name, then create or join a Jam. You'll set
                        your food filters inside the room.
                    </p>

                    <form
                        className="room-profile-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!saveProfile()) return;
                            if (roomCode) {
                                setProfileComplete(true);
                            }
                        }}
                    >
                        <label htmlFor="profile-name">Your name</label>
                        <input
                            id="profile-name"
                            value={profileName}
                            onChange={(event) =>
                                setProfileName(event.target.value)
                            }
                            placeholder="What should everyone call you?"
                            autoComplete="name"
                            maxLength={40}
                            required
                        />

                        {roomCode ? (
                            <button
                                type="submit"
                                className="room-entry-primary"
                            >
                                Join {roomCode}
                            </button>
                        ) : null}
                    </form>

                    {!roomCode && (
                        <>
                            <button
                                type="button"
                                onClick={() => void createRoom()}
                                disabled={creatingRoom}
                                className="room-entry-primary room-entry-room-button"
                            >
                                {creatingRoom ? "Creating…" : "New room"}
                            </button>

                            <div className="room-entry-divider">
                                <span>or join existing</span>
                            </div>

                            <form
                                className="room-entry-form"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    if (!saveProfile()) return;
                                    enterRoom(roomCodeInput);
                                }}
                            >
                                <label htmlFor="room-code">Room code</label>
                                <input
                                    id="room-code"
                                    value={roomCodeInput}
                                    onChange={(event) =>
                                        setRoomCodeInput(
                                            event.target.value.toUpperCase(),
                                        )
                                    }
                                    placeholder="e.g. A1B2C3"
                                    autoComplete="off"
                                    maxLength={6}
                                />
                                <button
                                    type="submit"
                                    className="room-entry-secondary"
                                >
                                    Enter room
                                </button>
                            </form>
                        </>
                    )}

                    {entryError && (
                        <p className="room-entry-warning" role="alert">
                            {entryError}
                        </p>
                    )}

                    {!isRealtimeConfigured() && (
                        <p className="room-entry-warning">
                            Realtime is not configured, so room updates will
                            refresh every few seconds instead of instantly.
                        </p>
                    )}
                </div>
            </main>
        );
    }

    if (roomError && !room) {
        return (
            <main className="room-entry">
                <div className="room-entry-card">
                    <div className="room-entry-brand">
                        <Sparkles className="room-entry-brand-icon" />
                        <span>ReelHungry</span>
                    </div>
                    <h1>Room {roomCode}</h1>
                    <p role="alert">{roomError}</p>
                    <button
                        type="button"
                        onClick={leaveRoom}
                        className="room-entry-primary"
                    >
                        Back to rooms
                    </button>
                </div>
            </main>
        );
    }

    return (
        <div className="bg-[#121212] text-white min-h-screen lg:h-screen lg:overflow-hidden flex flex-col font-sans">
            {roomError && (
                <div
                    className="fixed top-4 right-4 z-50 max-w-sm px-4 py-2 rounded-xl border border-rose-500/40 bg-[#181818]/95 text-xs text-rose-200 shadow-xl"
                    role="alert"
                >
                    {roomError}
                </div>
            )}
            {(restaurantsLoading || restaurantsError) && (
                <div
                    className="fixed bottom-4 left-4 z-50 px-4 py-2 rounded-xl border border-white/15 bg-[#181818]/95 text-xs shadow-xl"
                    role="status"
                >
                    {restaurantsLoading
                        ? "Loading restaurants..."
                        : `Restaurant API error: ${restaurantsError}`}
                </div>
            )}
            {/* Non-Blocking Toast Banner Stack */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className="px-4 py-2 rounded-full bg-[#181818]/95 border border-white/15 text-xs font-semibold text-white shadow-2xl backdrop-blur-md flex items-center gap-2"
                    >
                        <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: t.accent }}
                        />
                        <span>{t.message}</span>
                    </div>
                ))}
            </div>

            {/* Main 2-Column Split Workspace */}
            <main className="flex-1 flex flex-col lg:flex-row w-full h-full lg:overflow-hidden relative">
                {/* SEGMENT 1: LEFT VERTICAL VIDEO REELS SCROLLER */}
                <VideoScroller
                    restaurants={feedRestaurants}
                    activeId={activeRestaurantId}
                    onSelectActive={setActiveRestaurantId}
                    onToggleQueue={handleToggleQueue}
                    onResetFilters={handleResetFilters}
                    feedRef={feedRef}
                    syncWithGroup={syncWithGroup}
                    onToggleSync={() => setSyncWithGroup((on) => !on)}
                    groupMatchIds={groupMatchIds}
                />

                {/* SEGMENT 2: RIGHT JAM HEADER & LIVE FILTER PANEL */}
                <section
                    aria-label="Collaborative Jam Controls and Filters"
                    className="w-full lg:w-[60%] xl:w-[62%] h-auto lg:h-full flex flex-col bg-[#121212] overflow-y-auto custom-scroll pb-56 lg:pb-48"
                >
                    <JamHeader
                        queueCount={queuedRestaurants.length}
                        onCopyInvite={handleCopyInvite}
                        onOpenQueue={() => setIsQueueOpen(true)}
                        onPick={() => void handlePick()}
                        picking={picking}
                        canPick={Boolean(session) && groupMatches.length > 0}
                        roomCode={roomCode}
                        participants={participantViews}
                        roomStatus={roomStatus}
                    />

                    <section className="transit-destination" aria-label="Jam destination">
                        {pickedRestaurant ? <>
                            <p className="transit-eyebrow">YOUR JAM’S SELECTED RESTAURANT</p>
                            <h2>{pickedRestaurant.name}</h2>
                            <p>Same destination, your own route. Open directions anytime without picking again.</p>
                            <button className="transit-launch" onClick={() => setTransitOpen(true)}>
                                <TrainFront size={17} /> Get MBTA Directions
                            </button>
                        </> : <>
                            <h2>Choose where your Jam eats</h2>
                            <p>Set your preferences below, then press “Pick for us” above. Your selected restaurant and MBTA directions will appear here.</p>
                        </>}
                    </section>

                    <FilterPanel
                        allRestaurants={restaurants}
                        groupMatchCount={groupMatches.length}
                        myMatchCount={myMatchCount}
                        participantCount={participantViews.length}
                        originLabel={originLabel}
                        locationStatus={geo.status}
                        onRetryLocation={geo.retry}
                        filters={filters}
                        onUpdateFilters={setFilters}
                        onResetFilters={handleResetFilters}
                    />
                </section>
            </main>

            {/* SEGMENT 3: FLOATING EXPANDABLE BOSTON MAP CORNER */}
            <FloatingBostonMap
                restaurants={feedRestaurants}
                origin={origin}
                originLabel={originLabel}
                activeId={activeRestaurantId}
                maxDistance={filters.maxDistance}
                onSelectPin={handleJumpToRestaurant}
                transitRoute={transitRoute?.destination.restaurant_id === pickedId ? transitRoute : null}
                onClearTransit={() => setTransitRoute(null)}
            />

            {transitOpen && pickedRestaurant && <TransitDirectionsPanel
                key={`${roomCode}-${pickedRestaurant.id}-${session?.participantId ?? "viewer"}`}
                restaurant={pickedRestaurant}
                roomCode={roomCode}
                session={session}
                deviceLocation={geo.location}
                onClose={() => setTransitOpen(false)}
                onRoute={setTransitRoute}
                onRefreshRoom={() => void refreshRoom()}
            />}

            {/* SHARED JAM QUEUE MODAL */}
            <JamQueueModal
                isOpen={isQueueOpen}
                onClose={() => setIsQueueOpen(false)}
                queuedRestaurants={queuedRestaurants}
                onToggleQueue={handleToggleQueue}
                onSelectRestaurant={handleJumpToRestaurant}
            />

            {/* RANDOM GROUP PICK MODAL */}
            <WinnerModal
                winner={showPick ? pickedRestaurant : null}
                originLabel={originLabel}
                pickedByName={pickedByName}
                matchCount={room?.matching_count ?? groupMatches.length}
                picking={picking}
                onClose={() => setShowPick(false)}
                onPickAgain={() => void handlePick()}
                onDirections={() => { setShowPick(false); setTransitOpen(true); }}
            />
        </div>
    );
}
