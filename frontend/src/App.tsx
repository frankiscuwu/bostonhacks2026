import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { RefObject } from "react";
import {
    Circle,
    MapContainer,
    Marker,
    TileLayer,
    useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import {
    Flame,
    Heart,
    MapPin,
    Star,
    Plus,
    Check,
    ChevronUp,
    ChevronDown,
    Maximize2,
    Minimize2,
    Copy,
    Trophy,
    RotateCcw,
    Sparkles,
    Pause,
    ListMusic,
    X,
    Navigation,
    Calendar,
    Clock,
    SlidersHorizontal,
} from "lucide-react";

import {
    CUISINE_CATEGORIES,
    PRICE_TIERS,
} from "./data.ts";
import type { FilterState, Restaurant } from "./data.ts";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
    isRealtimeConfigured,
    notifyRoomUpdated,
    subscribeToRoom,
    updatePresence,
} from "./websocket.ts";
import type { PresenceProfile, RoomPreferences } from "./websocket.ts";
import { fetchRestaurants, mapApiRestaurant } from "./restaurantsApi.ts";
import {
    ApiError,
    ROOM_CODE_PATTERN,
    clearSession,
    createRoom as apiCreateRoom,
    ensureMembership,
    getResults,
    getRoom,
    isSameOrNewerRoomState,
    normalizeRoomCode,
    saveSession,
    submitVote,
} from "./roomsApi.ts";
import type { ResultRow, RoomSession, RoomState } from "./roomsApi.ts";
import "./App.css"

type ToggleRestaurantHandler = (id: number) => void;
type Toast = { id: number; message: string; accent: string };

// Per-card view of the Django room for the restaurant shown on that card.
type RoomVoteInfo = {
    // "current": being voted on now; "decided": room already moved past it;
    // "upcoming": room has not reached it yet.
    status: "current" | "decided" | "upcoming";
    hasVoted: boolean;
    submitting: boolean;
    votedCount: number;
    requiredCount: number;
    voterNames: string[];
    yesCount: number;
    noCount: number;
};

type CastVoteHandler = (restaurantId: number, vote: boolean) => void;

type RoomParticipantView = {
    id: number;
    name: string;
    preferences: RoomPreferences | null;
    online: boolean;
    isYou: boolean;
};

type ReelCardProps = {
    restaurant: Restaurant;
    isActive: boolean;
    voteInfo: RoomVoteInfo;
    onCastVote: CastVoteHandler;
    onToggleQueue: ToggleRestaurantHandler;
};

type VideoScrollerProps = {
    restaurants: Restaurant[];
    activeId: number | null;
    onSelectActive: (id: number) => void;
    getVoteInfo: (restaurantId: number) => RoomVoteInfo;
    onCastVote: CastVoteHandler;
    onToggleQueue: ToggleRestaurantHandler;
    onResetFilters: () => void;
    feedRef: RefObject<HTMLDivElement | null>;
};

type FilterPanelProps = {
    allRestaurants: Restaurant[];
    filteredRestaurants: Restaurant[];
    filters: FilterState;
    onUpdateFilters: (filters: FilterState) => void;
    onResetFilters: () => void;
    onJumpToRestaurant: (id: number) => void;
};

type FloatingBostonMapProps = {
    restaurants: Restaurant[];
    activeId: number | null;
    maxDistance: number;
    onSelectPin: (id: number) => void;
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
    onClose: () => void;
    onLockIn: (restaurant: Restaurant) => void;
};

// ============================================================================
// COMPONENT 1: REEL CARD (Simulated Vertical Video Card with Double-Tap & Motion)
// ============================================================================
function ReelCard({
    restaurant,
    isActive,
    voteInfo,
    onCastVote,
    onToggleQueue,
}: ReelCardProps) {
    const canVote =
        voteInfo.status === "current" &&
        !voteInfo.hasVoted &&
        !voteInfo.submitting;

    const [isPaused, setIsPaused] = useState(false);
    const [showHeartBurst, setShowHeartBurst] = useState(false);
    const lastTapRef = useRef<number>(0);

    const handleSurfaceTap = () => {
        const now = Date.now();
        if (now - lastTapRef.current < 280) {
            // Double-tap triggers heart burst + vote
            setShowHeartBurst(true);
            if (canVote) {
                onCastVote(restaurant.id, true);
            }
            setTimeout(() => setShowHeartBurst(false), 850);
        } else {
            // Single tap toggles simulated video playback pause/play
            setIsPaused((prev) => !prev);
        }
        lastTapRef.current = now;
    };

    const getAvatarBadge = (voter: string) =>
        voter === "YOU" ? "bg-[#1DB954] text-black" : "bg-white/20 text-white";

    const voteSummary =
        voteInfo.status === "current"
            ? `${voteInfo.votedCount}/${voteInfo.requiredCount} voted`
            : voteInfo.yesCount + voteInfo.noCount > 0
              ? `${voteInfo.yesCount} yes • ${voteInfo.noCount} no`
              : voteInfo.status === "upcoming"
                ? "Up next in room"
                : "No votes";

    return (
        <article
            data-id={restaurant.id}
            onClick={handleSurfaceTap}
            className="reel-card w-full h-full snap-start relative overflow-hidden flex flex-col justify-end cursor-pointer select-none"
        >
            {/* Simulated Looping Video Backdrop with Ken Burns Motion */}
            <div className="absolute inset-0 overflow-hidden bg-[#101010]">
                <img
                    src={restaurant.image}
                    alt={restaurant.name}
                    loading="lazy"
                    onError={(e) => {
                        e.currentTarget.src = `https://placehold.co/600x900/181818/1DB954?text=${encodeURIComponent(
                            restaurant.name,
                        )}`;
                    }}
                    className={`w-full h-full object-cover opacity-90 transition-transform duration-700 ${
                        isActive && !isPaused
                            ? "animate-ken-burns"
                            : "scale-105"
                    }`}
                />

                {/* Deep Readability Gradient & Accent Vignette */}
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.08) 38%, rgba(12,12,12,0.92) 78%, rgba(12,12,12,0.99) 100%)",
                    }}
                />

                {/* Ambient Floating Steam / Sparkle Particles */}
                {!isPaused && (
                    <>
                        <div className="absolute bottom-48 left-12 w-3 h-3 rounded-full bg-white/30 blur-[2px] particle-1 pointer-events-none" />
                        <div className="absolute bottom-52 left-28 w-4 h-4 rounded-full bg-[#1DB954]/30 blur-[3px] particle-2 pointer-events-none" />
                        <div className="absolute bottom-44 right-24 w-2.5 h-2.5 rounded-full bg-amber-300/35 blur-[2px] particle-3 pointer-events-none" />
                    </>
                )}
            </div>

            {/* Center Play/Pause Indicator or Double-Tap Heart Burst */}
            {showHeartBurst && (
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                    <div className="animate-heart-burst p-5 rounded-full bg-[#FF5E3A]/25 backdrop-blur-md border border-[#FF5E3A]/50 shadow-[0_0_40px_rgba(255,94,58,0.7)]">
                        <Heart className="w-16 h-16 text-[#FF5E3A] fill-[#FF5E3A]" />
                    </div>
                </div>
            )}

            {isPaused && !showHeartBurst && (
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
                className="relative z-20 p-5 sm:p-6 pt-12 space-y-3.5 cursor-default"
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

                    {restaurant.price && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-white/10 text-white">
                            {restaurant.price}
                        </span>
                    )}
                </div>

                {/* Name, Cuisine & Signature Dish */}
                <div>
                    <div className="flex items-baseline justify-between gap-2">
                        <h2 className="font-display font-extrabold text-2xl sm:text-[26px] leading-tight text-white tracking-tight">
                            {restaurant.name}
                        </h2>
                        <span className="text-xs font-bold text-[#1DB954] shrink-0">
                            {restaurant.cuisine}
                        </span>
                    </div>
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
                    <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/55">
                        {voteInfo.status === "current"
                            ? "Now voting • Double-tap for yes"
                            : "Browse only • vote when it's up"}
                    </span>
                </div>

                {/* Collaborative Jam Vote Bar */}
                <div className="pt-2.5 border-t border-white/15 flex items-center justify-between gap-2">
                    {/* Friend Avatars Who Voted */}
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex -space-x-1.5 shrink-0">
                            {voteInfo.voterNames.map((voter) => (
                                <span
                                    key={voter}
                                    title={voter}
                                    className={`w-6 h-6 rounded-full ${getAvatarBadge(
                                        voter,
                                    )} border border-black flex items-center justify-center text-[10px] font-extrabold shadow`}
                                >
                                    {voter === "YOU" ? "YOU" : voter[0]?.toUpperCase()}
                                </span>
                            ))}
                        </div>
                        <span className="text-xs font-semibold text-white/85 truncate">
                            {voteSummary}
                        </span>
                    </div>

                    {/* Interactive Queue & Vote Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => onToggleQueue(restaurant.id)}
                            className={`px-3 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 flex items-center gap-1 ${
                                restaurant.inQueue
                                    ? "bg-white/15 text-[#1DB954] border-[#1DB954]/50"
                                    : "bg-black/60 hover:bg-white/15 text-white border-white/20"
                            }`}
                        >
                            {restaurant.inQueue ? (
                                <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Queued</span>
                                </>
                            ) : (
                                <>
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Jam Queue</span>
                                </>
                            )}
                        </button>

                        {voteInfo.status === "current" && !voteInfo.hasVoted ? (
                            <>
                                <button
                                    onClick={() => onCastVote(restaurant.id, false)}
                                    disabled={!canVote}
                                    className="px-3 py-2 rounded-full text-xs font-bold border bg-black/60 hover:bg-rose-500/20 text-white border-white/20 transition-all active:scale-90 flex items-center gap-1 disabled:opacity-50"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    <span>Pass</span>
                                </button>
                                <button
                                    onClick={() => onCastVote(restaurant.id, true)}
                                    disabled={!canVote}
                                    className="px-3.5 py-2 rounded-full text-xs font-extrabold transition-all active:scale-90 flex items-center gap-1.5 shadow-lg bg-[#1DB954] hover:bg-[#1ed760] text-black shadow-[#1DB954]/30 disabled:opacity-50"
                                >
                                    <Flame className="w-3.5 h-3.5 fill-black" />
                                    <span>
                                        {voteInfo.submitting ? "Voting…" : "Yes"}
                                    </span>
                                </button>
                            </>
                        ) : (
                            <span
                                className={`px-3.5 py-2 rounded-full text-xs font-extrabold flex items-center gap-1.5 ${
                                    voteInfo.status === "current"
                                        ? "bg-[#FF5E3A] text-white"
                                        : "bg-white/10 text-white/60"
                                }`}
                            >
                                {voteInfo.status === "current" ? (
                                    <>
                                        <Check className="w-3.5 h-3.5" />
                                        <span>Waiting for others</span>
                                    </>
                                ) : voteInfo.status === "decided" ? (
                                    <span>Decided</span>
                                ) : (
                                    <span>Not up yet</span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}

// ============================================================================
// COMPONENT 2: VERTICAL VIDEO SCROLLER (Left Segment Container)
// ============================================================================
function VideoScroller({
    restaurants,
    activeId,
    onSelectActive,
    getVoteInfo,
    onCastVote,
    onToggleQueue,
    onResetFilters,
    feedRef,
}: VideoScrollerProps) {
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const activeIndex = useMemo(() => {
        const idx = restaurants.findIndex((r) => r.id === activeId);
        return idx === -1 ? 0 : idx;
    }, [restaurants, activeId]);

    const activeSpot = restaurants[activeIndex] || null;

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
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navigateReel]);

    return (
        <section
            aria-label="Boston Restaurant Video Reels"
            className="w-full lg:w-[44%] xl:w-[42%] h-[80vh] lg:h-full bg-[#0c0c0c] border-b lg:border-b-0 lg:border-r border-white/10 relative flex items-center justify-center p-3 sm:p-5 select-none"
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
                                        <div className="h-full bg-[#1DB954] reel-progress-active" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-[#1DB954] animate-pulse" />
                            <span className="text-[11px] font-bold tracking-wide text-white/95">
                                BOSTON REELS •{" "}
                                {restaurants.length > 0
                                    ? `${activeIndex + 1} / ${restaurants.length}`
                                    : "0 / 0"}
                            </span>
                        </div>

                        {activeSpot && (
                            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-full">
                                <div className="flex items-end gap-[2px] h-3.5">
                                    <span className="w-[2.5px] bg-[#1DB954] rounded-full eq-bar-1" />
                                    <span className="w-[2.5px] bg-[#1DB954] rounded-full eq-bar-2" />
                                    <span className="w-[2.5px] bg-[#1DB954] rounded-full eq-bar-3" />
                                    <span className="w-[2.5px] bg-[#1DB954] rounded-full eq-bar-4" />
                                </div>
                                <span className="text-[11px] font-medium text-white/90 truncate max-w-[130px]">
                                    {activeSpot.vibe}
                                </span>
                            </div>
                        )}
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
                                No Boston spots match those exact filters
                            </h3>
                            <p className="text-xs text-white/60 mt-1.5 max-w-xs leading-relaxed">
                                Your group constraints are super specific! Try
                                widening the distance radius or clearing a
                                cuisine toggle.
                            </p>
                            <button
                                onClick={onResetFilters}
                                className="mt-5 px-5 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-xs transition shadow-lg"
                            >
                                Reset All Filters
                            </button>
                        </div>
                    ) : (
                        restaurants.map((restaurant) => (
                            <ReelCard
                                key={`${restaurant.id}-${restaurant.id === activeSpot?.id}`}
                                restaurant={restaurant}
                                isActive={restaurant.id === activeSpot?.id}
                                voteInfo={getVoteInfo(restaurant.id)}
                                onCastVote={onCastVote}
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
function JamHeader({
    queueCount,
    onCopyInvite,
    onOpenQueue,
    onPickWinner,
    roomCode,
    participants,
    roomStatus,
}: {
    queueCount: number;
    onCopyInvite: () => void;
    onOpenQueue: () => void;
    onPickWinner: () => void;
    roomCode: string;
    participants: RoomParticipantView[];
    roomStatus: string;
}) {
    const onlineCount = participants.filter((p) => p.online).length;
    return (
        <header className="sticky top-0 z-20 bg-[#121212]/90 backdrop-blur-xl border-b border-white/10 px-5 sm:px-8 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3.5">
                {/* Brand Identity & Room Code */}
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#1DB954] to-[#0f7a34] flex items-center justify-center shadow-[0_0_24px_rgba(29,185,84,0.4)] shrink-0">
                        <Sparkles className="w-6 h-6 text-black" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="font-display font-extrabold text-lg sm:text-xl tracking-tight text-white">
                                Boston Food Jam
                            </h1>
                            <button
                                onClick={onCopyInvite}
                                title="Copy Jam Invite Link"
                                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30 hover:bg-[#1DB954]/25 transition active:scale-95"
                            >
                                <span>ROOM: {roomCode}</span>
                                <Copy className="w-3 h-3" />
                            </button>
                        </div>

                        <p className="text-xs text-white/65 mt-0.5 flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1DB954] animate-ping" />
                            <span>
                                <strong className="text-white/90">
                                    {participants.length}{" "}
                                    {participants.length === 1 ? "person" : "people"}
                                </strong>{" "}
                                in this room
                                {isRealtimeConfigured() && ` • ${onlineCount} online`}
                            </span>
                        </p>
                        <p className="text-xs text-[#1DB954] font-semibold mt-0.5">
                            {roomStatus}
                        </p>
                    </div>
                </div>

                {/* Active Participants, Jam Queue Drawer Trigger & Winner CTA */}
                <div className="flex items-center gap-2.5 sm:gap-3">
                    {/* Friend Avatars */}
                    <div
                        className="hidden xl:flex participant-avatars"
                        title={participants
                            .map((participant) => participant.name)
                            .join(", ")}
                    >
                        {participants.slice(0, 6).map((participant) => (
                            <div
                                key={participant.id}
                                className="participant-avatar"
                                title={`${participant.name}: ${participant.preferences?.cuisines.join(", ") || "Any cuisine"} • ${participant.preferences?.prices.join(", ") || "Any price"}`}
                            >
                                {participant.name.slice(0, 2).toUpperCase()}
                                {participant.online && (
                                    <span className="participant-online" />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Jam Queue Pill Button */}
                    <button
                        onClick={onOpenQueue}
                        className="px-3.5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-xs transition flex items-center gap-1.5 active:scale-95"
                    >
                        <ListMusic className="w-3.5 h-3.5 text-[#1DB954]" />
                        <span>Queue</span>
                        <span className="px-1.5 py-0.2 rounded-full bg-[#1DB954] text-black text-[10px] font-extrabold">
                            {queueCount}
                        </span>
                    </button>

                    {/* Pick Jam Winner Button */}
                    <button
                        onClick={onPickWinner}
                        className="px-4 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-xs sm:text-sm tracking-tight shadow-[0_6px_22px_rgba(29,185,84,0.4)] hover:shadow-[0_8px_28px_rgba(29,185,84,0.6)] transition-all active:scale-95 flex items-center gap-1.5"
                    >
                        <Trophy className="w-4 h-4" />
                        <span>Show Results</span>
                    </button>
                </div>
            </div>
            {participants.length > 0 && (
                <div className="participant-list">
                    {participants.map((participant) => (
                        <div className="participant-chip" key={participant.id}>
                            <span className="participant-chip-name">
                                {participant.name}
                                {participant.isYou && " (you)"}
                            </span>
                            <span>
                                {participant.preferences?.cuisines.join(", ") ||
                                    "Any cuisine"}
                            </span>
                            <span>
                                {participant.preferences?.prices.join(", ") ||
                                    "Any price"}
                            </span>
                        </div>
                    ))}
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
    filteredRestaurants,
    filters,
    onUpdateFilters,
    onResetFilters,
    onJumpToRestaurant,
}: FilterPanelProps) {
    const cuisineCategories = useMemo(
        () =>
            [
                "All",
                ...Array.from(
                    new Set(allRestaurants.map((restaurant) => restaurant.cuisine)),
                ).sort(),
            ],
        [allRestaurants],
    );

    // Compute cuisine counts dynamically
    const cuisineCounts = useMemo(() => {
        const counts: Record<string, number> = { All: allRestaurants.length };
        cuisineCategories.slice(1).forEach((c) => {
            counts[c] = allRestaurants.filter((r) => r.cuisine === c).length;
        });
        return counts;
    }, [allRestaurants, cuisineCategories]);

    const toggleCuisine = (cuisine: string) => {
        if (cuisine === "All") {
            onUpdateFilters({ ...filters, cuisines: [] });
            return;
        }
        const exists = filters.cuisines.includes(cuisine);
        const next = exists
            ? filters.cuisines.filter((c) => c !== cuisine)
            : [...filters.cuisines, cuisine];
        onUpdateFilters({ ...filters, cuisines: next });
    };

    const togglePrice = (price: string) => {
        const exists = filters.prices.includes(price);
        const next = exists
            ? filters.prices.filter((p) => p !== price)
            : [...filters.prices, price];
        onUpdateFilters({ ...filters, prices: next });
    };

    const toggleAvailability = (
        key: "openNow" | "tablesTonight" | "walkInFriendly",
    ) => {
        onUpdateFilters({
            ...filters,
            [key]: !filters[key],
        });
    };

    // Top voted spots across Boston for quick jump
    const topVotedSpots = useMemo(() => {
        return [...allRestaurants]
            .filter((r) => r.votes > 0)
            .sort((a, b) => b.votes - a.votes || (b.rating ?? 0) - (a.rating ?? 0))
            .slice(0, 4);
    }, [allRestaurants]);

    // Only show controls the restaurant data can actually answer.
    const hasRatings = allRestaurants.some((r) => r.rating !== null);
    const hasPrices = allRestaurants.some((r) => r.price !== null);
    const hasAvailability = {
        openNow: allRestaurants.some((r) => r.openNow !== null),
        tablesTonight: allRestaurants.some((r) => r.tablesTonight),
        walkInFriendly: allRestaurants.some((r) => r.walkInFriendly),
    };

    const distanceLabel =
        filters.maxDistance <= 1.0
            ? "Walkable Downtown / Back Bay"
            : filters.maxDistance <= 3.5
              ? "Quick T-Ride / Cambridge & Seaport"
              : "Greater Boston Metro";
    const allAvailabilityOptions: Array<{
        key: "openNow" | "tablesTonight" | "walkInFriendly";
        label: string;
    }> = [
        { key: "openNow", label: "Open Now" },
        { key: "tablesTonight", label: "Tables Tonight" },
        { key: "walkInFriendly", label: "Walk-in Friendly" },
    ];
    const availabilityOptions = allAvailabilityOptions.filter(
        (opt) => hasAvailability[opt.key],
    );

    return (
        <div className="px-5 sm:px-8 py-6 space-y-6 max-w-4xl">
            {/* Live Match Counter & Reset Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#181818] border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center font-display font-extrabold text-lg border border-[#1DB954]/25">
                        {filteredRestaurants.length}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-white">
                            {filteredRestaurants.length} of{" "}
                            {allRestaurants.length} Boston restaurants matched
                        </p>
                        <p className="text-xs text-white/55">
                            Centered near Boston Common • {distanceLabel}
                        </p>
                    </div>
                </div>

                <button
                    onClick={onResetFilters}
                    className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/85 hover:text-white border border-white/10 transition flex items-center gap-1.5 active:scale-95"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Filters</span>
                </button>
            </div>

            {/* Sliders Grid: Max Distance & Minimum Rating */}
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
                            {filters.maxDistance.toFixed(1)} mi
                        </span>
                    </div>

                    <input
                        id="distance-slider"
                        type="range"
                        min="0.2"
                        max="10.0"
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
                        <span>0.2 mi (Walk)</span>
                        <span>3.5 mi (Cambridge)</span>
                        <span>10.0 mi</span>
                    </div>
                </div>

                {/* Minimum Rating Slider */}
                {hasRatings && (
                <div className="bg-[#181818] border border-white/10 rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <label
                            htmlFor="rating-slider"
                            className="text-sm font-bold text-white flex items-center gap-2"
                        >
                            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                            <span>Minimum Rating</span>
                        </label>
                        <span className="px-2.5 py-1 rounded-lg bg-amber-400/15 text-amber-300 font-display font-bold text-sm">
                            {filters.minRating.toFixed(1)} ★
                        </span>
                    </div>

                    <input
                        id="rating-slider"
                        type="range"
                        min="3.5"
                        max="5.0"
                        step="0.1"
                        value={filters.minRating}
                        onChange={(e) =>
                            onUpdateFilters({
                                ...filters,
                                minRating: parseFloat(e.target.value),
                            })
                        }
                        className="jam-slider my-2"
                    />

                    <div className="flex justify-between text-[11px] text-white/45 mt-1.5 font-medium">
                        <span>3.5 ★</span>
                        <span>4.3 ★</span>
                        <span>5.0 ★ Elite</span>
                    </div>
                </div>
                )}
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

                <div className="flex flex-wrap gap-2">
                    {cuisineCategories.map((cuisine) => {
                        const isSelected =
                            cuisine === "All"
                                ? filters.cuisines.length === 0
                                : filters.cuisines.includes(cuisine);
                        return (
                            <button
                                key={cuisine}
                                onClick={() => toggleCuisine(cuisine)}
                                className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 active:scale-95 ${
                                    isSelected
                                        ? "bg-[#1DB954] text-black border-[#1DB954] shadow-[0_0_16px_rgba(29,185,84,0.35)]"
                                        : "bg-white/5 hover:bg-white/10 text-white/85 border-white/10"
                                }`}
                            >
                                <span>{cuisine}</span>
                                <span
                                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                                        isSelected
                                            ? "bg-black/20 text-black font-bold"
                                            : "bg-white/10 text-white/60"
                                    }`}
                                >
                                    {cuisineCounts[cuisine] ?? 0}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Cost Tier & Availability Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Price Tiers */}
                {hasPrices && (
                <div className="bg-[#181818] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3.5">
                        <h2 className="text-sm font-bold text-white">
                            Cost / Price Tier
                        </h2>
                        <span className="text-xs text-white/45">
                            Multi-select
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        {PRICE_TIERS.map((tier) => {
                            const active = filters.prices.includes(tier);
                            return (
                                <button
                                    key={tier}
                                    onClick={() => togglePrice(tier)}
                                    className={`py-2.5 rounded-xl text-xs font-extrabold border transition-all active:scale-95 ${
                                        active
                                            ? "bg-[#1DB954] text-black border-[#1DB954] shadow-[0_0_14px_rgba(29,185,84,0.35)]"
                                            : "bg-white/5 hover:bg-white/10 text-white/85 border-white/10"
                                    }`}
                                >
                                    {tier}
                                </button>
                            );
                        })}
                    </div>
                </div>
                )}

                {/* Availability Toggles */}
                {availabilityOptions.length > 0 && (
                <div className="bg-[#181818] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3.5">
                        <h2 className="text-sm font-bold text-white">
                            Availability
                        </h2>
                        <span className="text-xs text-white/45">
                            Must match
                        </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3 gap-2">
                        {availabilityOptions.map((opt) => {
                            const active = filters[opt.key];
                            return (
                                <button
                                    key={opt.key}
                                    onClick={() => toggleAvailability(opt.key)}
                                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                                        active
                                            ? "bg-[#1DB954]/20 text-[#1DB954] border-[#1DB954]"
                                            : "bg-white/5 hover:bg-white/10 text-white/75 border-white/10"
                                    }`}
                                >
                                    <span
                                        className={`w-2 h-2 rounded-full ${
                                            active
                                                ? "bg-[#1DB954]"
                                                : "bg-white/30"
                                        }`}
                                    />
                                    <span className="truncate">
                                        {opt.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                )}
            </div>

            {/* Live Jam Leaderboard Quick Jump */}
            <div className="bg-[#181818] border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3.5">
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <Flame className="w-4 h-4 text-[#FF5E3A] fill-[#FF5E3A]" />
                        <span>Most Yes Votes in This Room</span>
                    </h2>
                    <span className="text-xs text-white/50">
                        Click to jump to reel
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {topVotedSpots.map((spot) => {
                        const isHiddenByFilter = !filteredRestaurants.some(
                            (r) => r.id === spot.id,
                        );
                        return (
                            <button
                                key={spot.id}
                                onClick={() => onJumpToRestaurant(spot.id)}
                                className={`flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 transition text-left ${
                                    isHiddenByFilter ? "opacity-55" : ""
                                }`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                        src={spot.image}
                                        alt={spot.name}
                                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                                    />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">
                                            {spot.name}
                                        </p>
                                        <p className="text-[11px] text-white/55 truncate">
                                            {[
                                                spot.neighborhood,
                                                spot.cuisine,
                                                spot.price,
                                                spot.rating !== null && `${spot.rating.toFixed(1)} ★`,
                                            ]
                                                .filter(Boolean)
                                                .join(" • ")}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {spot.inQueue && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#1DB954]/20 text-[#1DB954] text-[10px] font-bold">
                                            QUEUE
                                        </span>
                                    )}
                                    <span className="px-2 py-1 rounded-full bg-[#FF5E3A]/20 text-[#FF5E3A] text-xs font-extrabold flex items-center gap-1">
                                        <Flame className="w-3 h-3 fill-[#FF5E3A]" />
                                        {spot.votes}
                                    </span>
                                </div>
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
    expanded,
}: {
    activeSpot: Restaurant | null;
    expanded: boolean;
}) {
    const map = useMap();
    useEffect(() => {
        const timer = window.setTimeout(() => map.invalidateSize(), 50);
        return () => window.clearTimeout(timer);
    }, [expanded, map]);
    useEffect(() => {
        if (activeSpot) {
            map.panTo([activeSpot.latitude, activeSpot.longitude], {
                animate: true,
            });
        }
    }, [activeSpot, map]);
    return null;
}

function FloatingBostonMap({
    restaurants,
    activeId,
    maxDistance,
    onSelectPin,
}: FloatingBostonMapProps) {
    const [expanded, setExpanded] = useState(false);

    const activeSpot = useMemo(
        () =>
            restaurants.find((restaurant) => restaurant.id === activeId) ??
            restaurants[0] ??
            null,
        [restaurants, activeId],
    );

    const userPosition: LatLngExpression = [42.3551, -71.0624];

    const pinIcon = (selected: boolean) =>
        L.divIcon({
            className: "boston-map-pin-wrap",
            html: `<div class="boston-map-pin${selected ? " selected" : ""}"></div>`,
            iconSize: [selected ? 18 : 14, selected ? 18 : 14],
            iconAnchor: [selected ? 9 : 7, selected ? 9 : 7],
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
                        {activeSpot
                            ? `${activeSpot.name} • ${activeSpot.distance.toFixed(1)} mi`
                            : `Boston Radar • ${restaurants.length} pins`}
                    </span>
                </div>

                <button
                    onClick={() => setExpanded((prev) => !prev)}
                    className="ml-2 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-[#1DB954] text-white hover:text-black text-[11px] font-bold transition flex items-center gap-1 shrink-0"
                >
                    <span>{expanded ? "Minimize" : "Expand"}</span>
                    {expanded ? (
                        <Minimize2 className="w-3 h-3" />
                    ) : (
                        <Maximize2 className="w-3 h-3" />
                    )}
                </button>
            </div>

            {/* Real interactive OpenStreetMap/CARTO map */}
            <div className="relative flex-1 w-full h-full bg-[#0e1116] overflow-hidden">
                <MapContainer
                    center={[42.3551, -71.0624]}
                    zoom={expanded ? 13 : 12}
                    scrollWheelZoom={expanded}
                    zoomControl={expanded}
                    attributionControl={true}
                    className="boston-real-map"
                >
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <BostonMapViewport
                        activeSpot={activeSpot}
                        expanded={expanded}
                    />

                    <Circle
                        center={userPosition}
                        radius={Math.min(maxDistance, 20) * 1609.344}
                        pathOptions={{
                            color: "#1DB954",
                            fillColor: "#1DB954",
                            fillOpacity: 0.06,
                            opacity: 0.35,
                            dashArray: "5 5",
                        }}
                    />
                    <Marker
                        position={userPosition}
                        icon={L.divIcon({
                            className: "boston-map-user-wrap",
                            html: '<div class="boston-map-user"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7],
                        })}
                    />

                    {restaurants.map((spot) => (
                        <Marker
                            key={spot.id}
                            position={[spot.latitude, spot.longitude]}
                            icon={pinIcon(spot.id === activeSpot?.id)}
                            eventHandlers={{
                                click: () => onSelectPin(spot.id),
                            }}
                        />
                    ))}
                </MapContainer>

                {/* Bottom Floating Info Card when Expanded */}
                {expanded && activeSpot && (
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
                                • {activeSpot.distance.toFixed(1)} mi from
                                Boston Common
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

    const sortedQueue = [...queuedRestaurants].sort(
        (a, b) => b.votes - a.votes,
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
            <div className="w-full max-w-lg rounded-3xl bg-[#181818] border border-white/15 p-6 shadow-2xl">
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                        <ListMusic className="w-5 h-5 text-[#1DB954]" />
                        <h3 className="font-display font-extrabold text-lg text-white">
                            Shared Jam Queue ({sortedQueue.length})
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/75 hover:text-white transition"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="py-4 max-h-[60vh] overflow-y-auto space-y-2.5">
                    {sortedQueue.length === 0 ? (
                        <p className="text-sm text-white/60 text-center py-8">
                            No restaurants in the Jam Queue yet. Tap "+ Jam
                            Queue" on any reel to shortlist spots!
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
                                    <img
                                        src={spot.image}
                                        alt={spot.name}
                                        className="w-12 h-12 rounded-xl object-cover shrink-0"
                                    />
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-white truncate">
                                            {spot.name}
                                        </p>
                                        <p className="text-xs text-white/60 truncate">
                                            {[spot.neighborhood, spot.cuisine, spot.price, `${spot.votes} yes`]
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
function WinnerModal({ winner, onClose, onLockIn }: WinnerModalProps) {
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
            <div className="relative w-full max-w-md rounded-3xl bg-[#181818] border border-[#1DB954]/45 p-6 sm:p-7 text-center shadow-[0_25px_85px_rgba(29,185,84,0.35)] overflow-hidden">
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
                    <span>Jam Group Match</span>
                </div>

                <div className="w-24 h-24 mx-auto rounded-2xl overflow-hidden border-2 border-[#1DB954] shadow-xl mb-4">
                    <img
                        src={winner.image}
                        alt={winner.name}
                        className="w-full h-full object-cover"
                    />
                </div>

                <h3 className="font-display font-extrabold text-2xl text-white">
                    {winner.name}
                </h3>
                <p className="text-sm text-white/75 mt-1">
                    {[
                        winner.neighborhood,
                        winner.cuisine,
                        winner.price,
                        winner.rating !== null && `${winner.rating.toFixed(1)} ★`,
                    ]
                        .filter(Boolean)
                        .join(" • ")}
                </p>

                <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-1">
                    <p className="text-xs text-white/55">
                        {winner.distance.toFixed(1)} mi from Boston Common
                        {winner.hours && ` • ${winner.hours}`}
                    </p>
                    <p className="text-sm font-bold text-[#1DB954]">
                        {winner.votes} yes {winner.votes === 1 ? "vote" : "votes"} • Top Group Consensus
                    </p>
                </div>

                <div className="mt-6 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-bold text-white transition"
                    >
                        Keep Jamming
                    </button>
                    <button
                        onClick={() => onLockIn(winner)}
                        className="flex-1 py-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-sm font-extrabold text-black transition shadow-lg flex items-center justify-center gap-1.5"
                    >
                        <Navigation className="w-4 h-4" />
                        <span>Lock In Spot</span>
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
    maxDistance: 5.0,
    minRating: 4.0,
    cuisines: [],
    prices: [],
    openNow: false,
    tablesTonight: false,
    walkInFriendly: false,
};

const FEED_WINDOW = 30;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown error";
}

function getRoomCodeFromUrl() {
    const match = window.location.pathname.match(
        /^\/(?:room|join)\/([A-Za-z0-9]{6})\/?$/,
    );
    return match?.[1]?.toUpperCase() ?? null;
}

export default function App() {
    const [roomCode, setRoomCode] = useState<string | null>(
        getRoomCodeFromUrl,
    );
    const [roomCodeInput, setRoomCodeInput] = useState("");
    const [entryError, setEntryError] = useState("");
    const [creatingRoom, setCreatingRoom] = useState(false);
    const [profileName, setProfileName] = useState(() =>
        window.localStorage.getItem("boston-jam-name") ?? "",
    );
    const [profileCuisines, setProfileCuisines] = useState<string[]>(() => {
        try {
            return JSON.parse(
                window.localStorage.getItem("boston-jam-cuisines") ?? "[]",
            ) as string[];
        } catch {
            return [];
        }
    });
    const [profilePrices, setProfilePrices] = useState<string[]>(() => {
        try {
            return JSON.parse(
                window.localStorage.getItem("boston-jam-prices") ?? "[]",
            ) as string[];
        } catch {
            return [];
        }
    });
    const [profileComplete, setProfileComplete] = useState(
        () =>
            Boolean(
                window.localStorage.getItem("boston-jam-name")?.trim(),
            ),
    );
    const roomChannelRef = useRef<RealtimeChannel | null>(null);
    const roomCodeRef = useRef<string | null>(roomCode);
    const profileNameRef = useRef(profileName);
    const preferencesRef = useRef<RoomPreferences>({
        cuisines: profileCuisines,
        prices: profilePrices,
    });

    // Django-backed room state (source of truth).
    const [session, setSession] = useState<RoomSession | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const [roomError, setRoomError] = useState("");
    const [results, setResults] = useState<ResultRow[]>([]);
    const [presence, setPresence] = useState<Map<number, PresenceProfile>>(
        () => new Map(),
    );
    const [submittingVote, setSubmittingVote] = useState(false);
    const lastFollowedRestaurantRef = useRef<number | null>(null);
    const finishedAnnouncedRef = useRef(false);

    // Restaurant catalog from Django (browse only; the room decides voting order).
    const [catalog, setCatalog] = useState<Restaurant[]>([]);
    const [restaurantsLoading, setRestaurantsLoading] = useState(true);
    const [restaurantsError, setRestaurantsError] = useState("");
    const [queuedIds, setQueuedIds] = useState<Set<number>>(() => new Set());
    const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

    const [activeRestaurantId, setActiveRestaurantId] = useState<number | null>(
        null,
    );
    const [isQueueOpen, setIsQueueOpen] = useState(false);
    const [winnerSpot, setWinnerSpot] = useState<Restaurant | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const feedRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        profileNameRef.current = profileName;
        preferencesRef.current = {
            cuisines: profileCuisines,
            prices: profilePrices,
        };
    }, [profileName, profileCuisines, profilePrices]);

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
        setRoomCode(code);
        setSession(null);
        setRoom(null);
        setRoomError("");
        setResults([]);
        setPresence(new Map());
        setWinnerSpot(null);
        lastFollowedRestaurantRef.current = null;
        finishedAnnouncedRef.current = false;
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
        window.localStorage.setItem(
            "boston-jam-cuisines",
            JSON.stringify(profileCuisines),
        );
        window.localStorage.setItem(
            "boston-jam-prices",
            JSON.stringify(profilePrices),
        );
        setProfileComplete(true);
        return true;
    }, [profileName, profileCuisines, profilePrices]);

    const toggleProfileCuisine = (cuisine: string) => {
        setProfileCuisines((current) =>
            current.includes(cuisine)
                ? current.filter((item) => item !== cuisine)
                : [...current, cuisine],
        );
    };

    const toggleProfilePrice = (price: string) => {
        setProfilePrices((current) =>
            current.includes(price)
                ? current.filter((item) => item !== price)
                : [...current, price],
        );
    };

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

    const applyRoomState = useCallback((state: RoomState) => {
        if (state.code !== roomCodeRef.current) return;
        setRoom((prev) => (isSameOrNewerRoomState(state, prev) ? state : prev));
    }, []);

    const refreshRoom = useCallback(async () => {
        const code = roomCodeRef.current;
        if (!code) return;
        try {
            const [state, rows] = await Promise.all([
                getRoom(code),
                getResults(code),
            ]);
            if (code !== roomCodeRef.current) return;
            applyRoomState(state);
            setResults(rows);
        } catch (error) {
            if (code !== roomCodeRef.current) return;
            if (error instanceof ApiError && error.status === 404) {
                setRoomError("Room not found. Check the code and try again.");
            }
        }
    }, [applyRoomState]);

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
                    setRoomError("Room not found. Check the code and try again.");
                } else if (error instanceof ApiError && error.status === 409) {
                    addToast("This room already finished voting. Showing results.", "#f59e0b");
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
        void refreshRoom();
        const refreshIfVisible = () => {
            if (document.visibilityState === "visible") void refreshRoom();
        };
        const interval = window.setInterval(
            refreshIfVisible,
            isRealtimeConfigured() ? 10_000 : 3_000,
        );
        document.addEventListener("visibilitychange", refreshIfVisible);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", refreshIfVisible);
        };
    }, [roomCode, profileComplete, refreshRoom]);

    // Realtime: "room-updated" pings trigger a refetch; presence shares preferences.
    useEffect(() => {
        if (!roomCode || !session) return;
        const channel = subscribeToRoom(
            roomCode,
            {
                participantId: session.participantId,
                preferences: preferencesRef.current,
            },
            {
                onRoomUpdated: () => void refreshRoom(),
                onPresence: (profiles) => {
                    setPresence(profiles);
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

    useEffect(() => {
        if (!session) return;
        void updatePresence(roomChannelRef.current, {
            participantId: session.participantId,
            preferences: { cuisines: profileCuisines, prices: profilePrices },
        });
    }, [session, profileCuisines, profilePrices]);

    const currentRestaurantId =
        room?.is_active ? (room.current_restaurant?.id ?? null) : null;

    const resultsById = useMemo(
        () => new Map(results.map((row) => [row.restaurant.id, row])),
        [results],
    );

    // Catalog decorated with room results; the room's current restaurant is
    // always included even if the catalog was loaded before it existed.
    const restaurants = useMemo(() => {
        let base = catalog;
        const current = room?.current_restaurant;
        if (current && !catalog.some((r) => r.id === current.id)) {
            base = [...catalog, mapApiRestaurant(current)].sort(
                (a, b) => a.id - b.id,
            );
        }
        return base.map((r) => ({
            ...r,
            votes: resultsById.get(r.id)?.yes_count ?? 0,
            inQueue: queuedIds.has(r.id),
        }));
    }, [catalog, room, resultsById, queuedIds]);

    // Filters are local to each viewer and never hide the restaurant being voted on.
    const filteredRestaurants = useMemo(() => {
        return restaurants.filter((r) => {
            if (r.id === currentRestaurantId) return true;
            if (r.distance > filters.maxDistance) return false;
            if (r.rating !== null && r.rating < filters.minRating) return false;
            if (
                filters.cuisines.length > 0 &&
                !filters.cuisines.includes(r.cuisine)
            )
                return false;
            if (
                filters.prices.length > 0 &&
                r.price !== null &&
                !filters.prices.includes(r.price)
            )
                return false;
            if (filters.openNow && !r.openNow) return false;
            if (filters.tablesTonight && !r.tablesTonight) return false;
            if (filters.walkInFriendly && !r.walkInFriendly) return false;
            return true;
        });
    }, [restaurants, filters, currentRestaurantId]);

    // Rooms vote in ID order through thousands of restaurants, so the feed only
    // renders the current restaurant and the next few upcoming matches.
    const feedRestaurants = useMemo(() => {
        const start =
            currentRestaurantId === null
                ? 0
                : Math.max(
                      0,
                      filteredRestaurants.findIndex(
                          (r) => r.id >= currentRestaurantId,
                      ),
                  );
        return filteredRestaurants.slice(start, start + FEED_WINDOW);
    }, [filteredRestaurants, currentRestaurantId]);

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

    // When Django advances the room, everyone jumps to the new restaurant.
    useEffect(() => {
        if (
            currentRestaurantId === null ||
            lastFollowedRestaurantRef.current === currentRestaurantId
        )
            return;
        lastFollowedRestaurantRef.current = currentRestaurantId;
        setTimeout(() => setActiveRestaurantId(currentRestaurantId), 0);
        scrollToRestaurant(currentRestaurantId);
    }, [currentRestaurantId, scrollToRestaurant]);

    // Keep activeRestaurantId synchronized when filters change
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

    const winnerFromResults = useCallback(() => {
        const top = results[0];
        if (!top) return null;
        const restaurant =
            restaurants.find((r) => r.id === top.restaurant.id) ??
            mapApiRestaurant(top.restaurant);
        return { ...restaurant, votes: top.yes_count };
    }, [results, restaurants]);

    // Announce the winner once when Django reports the room finished.
    useEffect(() => {
        if (!room || room.is_active || finishedAnnouncedRef.current) return;
        const winner = winnerFromResults();
        if (!winner) return;
        finishedAnnouncedRef.current = true;
        setTimeout(() => setWinnerSpot(winner), 0);
    }, [room, winnerFromResults]);

    const participantViews = useMemo<RoomParticipantView[]>(
        () =>
            (room?.participants ?? [])
                .filter((p) => p.is_active)
                .map((p) => ({
                    id: p.id,
                    name: p.display_name,
                    preferences: presence.get(p.id)?.preferences ?? null,
                    online: presence.has(p.id),
                    isYou: p.id === session?.participantId,
                })),
        [room, presence, session],
    );

    const hasVotedThisRound = Boolean(
        session &&
            room?.voting_progress.voted_participant_ids.includes(
                session.participantId,
            ),
    );

    const getVoteInfo = (restaurantId: number): RoomVoteInfo => {
        const row = resultsById.get(restaurantId);
        const base = {
            hasVoted: false,
            submitting: false,
            votedCount: 0,
            requiredCount: 0,
            voterNames: [] as string[],
            yesCount: row?.yes_count ?? 0,
            noCount: row?.no_count ?? 0,
        };
        if (!room) return { ...base, status: "upcoming" };
        if (restaurantId === currentRestaurantId) {
            const progress = room.voting_progress;
            const names = new Map(
                room.participants.map((p) => [p.id, p.display_name]),
            );
            return {
                ...base,
                status: "current",
                hasVoted: hasVotedThisRound,
                submitting: submittingVote,
                votedCount: progress.voted_count,
                requiredCount: progress.required_count,
                voterNames: progress.voted_participant_ids.map((id) =>
                    id === session?.participantId ? "YOU" : (names.get(id) ?? "?"),
                ),
            };
        }
        if (currentRestaurantId === null || restaurantId < currentRestaurantId) {
            return { ...base, status: "decided" };
        }
        return { ...base, status: "upcoming" };
    };

    // All votes go through Django; the room advances only after every
    // active participant has voted on the current restaurant.
    const handleCastVote = async (restaurantId: number, vote: boolean) => {
        if (!room || !roomCode || submittingVote) return;
        if (!session) {
            addToast("You're viewing this room without a seat, so you can't vote.", "#94a3b8");
            return;
        }
        const current = room.current_restaurant;
        if (!room.is_active || !current || current.id !== restaurantId) {
            addToast("That restaurant isn't up for a vote right now.", "#94a3b8");
            return;
        }
        setSubmittingVote(true);
        try {
            const state = await submitVote(roomCode, session.token, {
                round_number: room.current_round,
                restaurant_id: restaurantId,
                vote,
            });
            applyRoomState(state);
            addToast(
                vote ? `🔥 Yes to ${current.name}` : `Passed on ${current.name}`,
                vote ? "#FF5E3A" : "#94a3b8",
            );
            void notifyRoomUpdated(roomChannelRef.current, state.current_round);
            void getResults(roomCode)
                .then((rows) => {
                    if (roomCodeRef.current === roomCode) setResults(rows);
                })
                .catch(() => undefined);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
                addToast("The room already moved on. Showing the latest round.", "#f59e0b");
            } else if (error instanceof ApiError && error.status === 403) {
                clearSession(roomCode);
                setSession(null);
                setRoomError("Your seat in this room is no longer valid. Reload the page to rejoin.");
            } else {
                addToast(`Vote failed: ${errorMessage(error)}`, "#f43f5e");
            }
            void refreshRoom();
        } finally {
            setSubmittingVote(false);
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
                    ? `Added ${restaurant.name} to Jam Queue`
                    : `Removed ${restaurant.name} from Jam Queue`,
            );
        }
    };

    const handleResetFilters = () => {
        setFilters(DEFAULT_FILTERS);
        addToast("Reset all Boston filters");
    };

    const handleJumpToRestaurant = (id: number) => {
        if (currentRestaurantId !== null && id < currentRestaurantId) {
            addToast("The room already voted on that spot.", "#94a3b8");
            return;
        }
        const isVisible = filteredRestaurants.some((r) => r.id === id);
        if (!isVisible) {
            setFilters({
                ...DEFAULT_FILTERS,
                maxDistance: 10.0,
                minRating: 0,
            });
            addToast("Expanded filters to show selected spot", "#FF5E3A");
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

    const handlePickWinner = () => {
        const winner = winnerFromResults();
        if (!winner) {
            addToast("No votes yet. Vote on the current spot first!", "#94a3b8");
            return;
        }
        setWinnerSpot(winner);
    };

    const queuedRestaurants = useMemo(
        () => restaurants.filter((r) => r.inQueue),
        [restaurants],
    );

    const roomStatus = !room
        ? "Connecting to room…"
        : !room.is_active
          ? "Voting finished • see the results"
          : `Round ${room.current_round} • ${room.current_restaurant?.name ?? ""} • ${room.voting_progress.voted_count}/${room.voting_progress.required_count} voted${
                !session
                    ? " • viewing only"
                    : hasVotedThisRound
                      ? " • waiting for others"
                      : " • your vote"
            }`;

    if (!roomCode && profileComplete) {
        return (
            <main className="room-entry">
                <div className="room-entry-card">
                    <div className="room-entry-brand">
                        <Sparkles className="room-entry-brand-icon" />
                        <span>Boston Food Jam</span>
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
                        <button
                            type="submit"
                            className="room-entry-secondary"
                        >
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
                        <span>Boston Food Jam</span>
                    </div>
                    <h1>
                        {roomCode
                            ? `Join room ${roomCode}`
                            : "Choose a room"}
                    </h1>
                    <p>
                        Add your name and food preferences, then create or join a Jam.
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

                        <fieldset>
                            <legend>Preferred cuisines</legend>
                            <div className="room-choice-grid">
                                {CUISINE_CATEGORIES.filter(
                                    (category) => category !== "All",
                                ).map((cuisine) => (
                                    <button
                                        type="button"
                                        key={cuisine}
                                        className={
                                            profileCuisines.includes(cuisine)
                                                ? "room-choice selected"
                                                : "room-choice"
                                        }
                                        onClick={() =>
                                            toggleProfileCuisine(cuisine)
                                        }
                                    >
                                        {cuisine}
                                    </button>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Price preferences</legend>
                            <div className="room-choice-grid room-choice-prices">
                                {PRICE_TIERS.map((price) => (
                                    <button
                                        type="button"
                                        key={price}
                                        className={
                                            profilePrices.includes(price)
                                                ? "room-choice selected"
                                                : "room-choice"
                                        }
                                        onClick={() =>
                                            toggleProfilePrice(price)
                                        }
                                    >
                                        {price}
                                    </button>
                                ))}
                            </div>
                        </fieldset>

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
                        <span>Boston Food Jam</span>
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
                    getVoteInfo={getVoteInfo}
                    onCastVote={(id, vote) => void handleCastVote(id, vote)}
                    onToggleQueue={handleToggleQueue}
                    onResetFilters={handleResetFilters}
                    feedRef={feedRef}
                />

                {/* SEGMENT 2: RIGHT JAM HEADER & LIVE FILTER PANEL */}
                <section
                    aria-label="Collaborative Jam Controls and Filters"
                    className="w-full lg:w-[56%] xl:w-[58%] h-auto lg:h-full flex flex-col bg-[#121212] overflow-y-auto custom-scroll pb-56 lg:pb-48"
                >
                    <JamHeader
                        queueCount={queuedRestaurants.length}
                        onCopyInvite={handleCopyInvite}
                        onOpenQueue={() => setIsQueueOpen(true)}
                        onPickWinner={handlePickWinner}
                        roomCode={roomCode}
                        participants={participantViews}
                        roomStatus={roomStatus}
                    />

                    <FilterPanel
                        allRestaurants={restaurants}
                        filteredRestaurants={filteredRestaurants}
                        filters={filters}
                        onUpdateFilters={setFilters}
                        onResetFilters={handleResetFilters}
                        onJumpToRestaurant={handleJumpToRestaurant}
                    />
                </section>
            </main>

            {/* SEGMENT 3: FLOATING EXPANDABLE BOSTON MAP CORNER */}
            <FloatingBostonMap
                restaurants={feedRestaurants}
                activeId={activeRestaurantId}
                maxDistance={filters.maxDistance}
                onSelectPin={handleJumpToRestaurant}
            />

            {/* SHARED JAM QUEUE MODAL */}
            <JamQueueModal
                isOpen={isQueueOpen}
                onClose={() => setIsQueueOpen(false)}
                queuedRestaurants={queuedRestaurants}
                onToggleQueue={handleToggleQueue}
                onSelectRestaurant={handleJumpToRestaurant}
            />

            {/* MATCH WINNER CELEBRATION MODAL */}
            <WinnerModal
                winner={winnerSpot}
                onClose={() => setWinnerSpot(null)}
                onLockIn={(spot) => {
                    setWinnerSpot(null);
                    addToast(`🎉 Locked in ${spot.name} for your Boston crew!`);
                }}
            />
        </div>
    );
}
