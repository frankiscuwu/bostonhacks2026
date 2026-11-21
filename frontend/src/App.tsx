import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { RefObject } from "react";
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
    INITIAL_BOSTON_RESTAURANTS,
    PRICE_TIERS,
} from "./data.ts";
import type { FilterState, Restaurant } from "./data.ts";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
    isRealtimeConfigured,
    joinRoom,
    requestRoomState,
    sendRoomState,
    updateRoomProfile,
} from "./websocket.ts";
import type {
    RoomParticipant,
    RoomPreferences,
} from "./websocket.ts";
import "./App.css"

type ToggleRestaurantHandler = (id: string) => void;
type Toast = { id: number; message: string; accent: string };

type ReelCardProps = {
    restaurant: Restaurant;
    isActive: boolean;
    onToggleVote: ToggleRestaurantHandler;
    onToggleQueue: ToggleRestaurantHandler;
};

type VideoScrollerProps = {
    restaurants: Restaurant[];
    activeId: string;
    onSelectActive: (id: string) => void;
    onToggleVote: ToggleRestaurantHandler;
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
    onJumpToRestaurant: (id: string) => void;
};

type FloatingBostonMapProps = {
    restaurants: Restaurant[];
    activeId: string;
    maxDistance: number;
    onSelectPin: (id: string) => void;
};

type JamQueueModalProps = {
    isOpen: boolean;
    onClose: () => void;
    queuedRestaurants: Restaurant[];
    onToggleQueue: ToggleRestaurantHandler;
    onSelectRestaurant: (id: string) => void;
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
    onToggleVote,
    onToggleQueue,
}: ReelCardProps) {
    const [isPaused, setIsPaused] = useState(false);
    const [showHeartBurst, setShowHeartBurst] = useState(false);
    const lastTapRef = useRef<number>(0);

    const handleSurfaceTap = () => {
        const now = Date.now();
        if (now - lastTapRef.current < 280) {
            // Double-tap triggers heart burst + vote
            setShowHeartBurst(true);
            if (!restaurant.userVoted) {
                onToggleVote(restaurant.id);
            }
            setTimeout(() => setShowHeartBurst(false), 850);
        } else {
            // Single tap toggles simulated video playback pause/play
            setIsPaused((prev) => !prev);
        }
        lastTapRef.current = now;
    };

    const getAvatarBadge = (voter: string) => {
        const map: Record<string, string> = {
            YOU: "bg-[#1DB954] text-black",
            Maya: "bg-amber-400 text-black",
            Liam: "bg-rose-500 text-white",
            Chloe: "bg-sky-400 text-black",
            Sam: "bg-purple-400 text-black",
        };
        return map[voter] || "bg-white/20 text-white";
    };

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
                        {restaurant.openNow ? "Open Now" : "Opens 5 PM"}
                    </span>

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/10 backdrop-blur-md text-white/90 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#1DB954]" />
                        {restaurant.neighborhood} •{" "}
                        {restaurant.distance.toFixed(1)} mi
                    </span>

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-300 flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
                        {restaurant.rating.toFixed(1)}
                        <span className="text-amber-200/70 font-normal">
                            ({restaurant.reviews.toLocaleString()})
                        </span>
                    </span>

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-white/10 text-white">
                        {restaurant.price}
                    </span>
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
                        Double-tap reel to ♥
                    </span>
                </div>

                {/* Collaborative Jam Vote Bar */}
                <div className="pt-2.5 border-t border-white/15 flex items-center justify-between gap-2">
                    {/* Friend Avatars Who Voted */}
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex -space-x-1.5 shrink-0">
                            {restaurant.voters.map((voter) => (
                                <span
                                    key={voter}
                                    title={voter}
                                    className={`w-6 h-6 rounded-full ${getAvatarBadge(
                                        voter,
                                    )} border border-black flex items-center justify-center text-[10px] font-extrabold shadow`}
                                >
                                    {voter === "YOU" ? "YOU" : voter[0]}
                                </span>
                            ))}
                        </div>
                        <span className="text-xs font-semibold text-white/85 truncate">
                            {restaurant.votes} Jam{" "}
                            {restaurant.votes === 1 ? "vote" : "votes"}
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

                        <button
                            onClick={() => onToggleVote(restaurant.id)}
                            className={`px-3.5 py-2 rounded-full text-xs font-extrabold transition-all active:scale-90 flex items-center gap-1.5 shadow-lg ${
                                restaurant.userVoted
                                    ? "bg-[#FF5E3A] text-white shadow-[#FF5E3A]/40"
                                    : "bg-[#1DB954] hover:bg-[#1ed760] text-black shadow-[#1DB954]/30"
                            }`}
                        >
                            <Flame
                                className={`w-3.5 h-3.5 ${
                                    restaurant.userVoted
                                        ? "fill-white"
                                        : "fill-black"
                                }`}
                            />
                            <span>
                                {restaurant.userVoted ? "Voted" : "Vote"}
                            </span>
                        </button>
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
    onToggleVote,
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

            const newId = closest.dataset.id;
            if (newId && newId !== activeId) {
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
                                onToggleVote={onToggleVote}
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
    presenceCount,
    participants,
}: {
    queueCount: number;
    onCopyInvite: () => void;
    onOpenQueue: () => void;
    onPickWinner: () => void;
    roomCode: string;
    presenceCount: number;
    participants: RoomParticipant[];
}) {
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
                                    {presenceCount} {presenceCount === 1 ? "person" : "people"}
                                </strong>{" "}
                                in this room
                            </span>
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
                                title={`${participant.name}: ${participant.preferences.cuisines.join(", ") || "Any cuisine"} • ${participant.preferences.prices.join(", ") || "Any price"}`}
                            >
                                {participant.name.slice(0, 2).toUpperCase()}
                                <span className="participant-online" />
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
                        <span>Pick Jam Winner</span>
                    </button>
                </div>
            </div>
            {participants.length > 0 && (
                <div className="participant-list">
                    {participants.map((participant) => (
                        <div className="participant-chip" key={participant.id}>
                            <span className="participant-chip-name">
                                {participant.name}
                            </span>
                            <span>
                                {participant.preferences.cuisines.join(", ") ||
                                    "Any cuisine"}
                            </span>
                            <span>
                                {participant.preferences.prices.join(", ") ||
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
    // Compute cuisine counts dynamically
    const cuisineCounts = useMemo(() => {
        const counts: Record<string, number> = { All: allRestaurants.length };
        CUISINE_CATEGORIES.slice(1).forEach((c) => {
            counts[c] = allRestaurants.filter((r) => r.cuisine === c).length;
        });
        return counts;
    }, [allRestaurants]);

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
            .sort((a, b) => b.votes - a.votes || b.rating - a.rating)
            .slice(0, 4);
    }, [allRestaurants]);

    const distanceLabel =
        filters.maxDistance <= 1.0
            ? "Walkable Downtown / Back Bay"
            : filters.maxDistance <= 3.5
              ? "Quick T-Ride / Cambridge & Seaport"
              : "Greater Boston Metro";
    const availabilityOptions: Array<{
        key: "openNow" | "tablesTonight" | "walkInFriendly";
        label: string;
    }> = [
        { key: "openNow", label: "Open Now" },
        { key: "tablesTonight", label: "Tables Tonight" },
        { key: "walkInFriendly", label: "Walk-in Friendly" },
    ];

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
                    {CUISINE_CATEGORIES.map((cuisine) => {
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

                {/* Availability Toggles */}
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
            </div>

            {/* Live Jam Leaderboard Quick Jump */}
            <div className="bg-[#181818] border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3.5">
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <Flame className="w-4 h-4 text-[#FF5E3A] fill-[#FF5E3A]" />
                        <span>Top Voted in Boston Jam</span>
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
                                            {spot.neighborhood} • {spot.price} •{" "}
                                            {spot.rating.toFixed(1)} ★
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
function FloatingBostonMap({
    restaurants,
    activeId,
    maxDistance,
    onSelectPin,
}: FloatingBostonMapProps) {
    const [expanded, setExpanded] = useState(false);

    const activeSpot = useMemo(() => {
        return (
            restaurants.find((r) => r.id === activeId) || restaurants[0] || null
        );
    }, [restaurants, activeId]);

    // Scale radius circle visually based on maxDistance (0.2mi to 10mi -> 22px to 175px)
    const radiusPx = Math.min(185, Math.max(22, maxDistance * 24));

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

            {/* Stylized Dark-Mode Vector Map of Boston */}
            <div className="relative flex-1 w-full h-full bg-[#0e1116] overflow-hidden">
                <svg
                    viewBox="0 0 500 380"
                    preserveAspectRatio="xMidYMid slice"
                    className="w-full h-full"
                >
                    <defs>
                        <linearGradient
                            id="bostonWater"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                        >
                            <stop offset="0%" stopColor="#0b1f33" />
                            <stop offset="100%" stopColor="#081320" />
                        </linearGradient>
                        <filter
                            id="pinNeonGlow"
                            x="-50%"
                            y="-50%"
                            width="200%"
                            height="200%"
                        >
                            <feGaussianBlur
                                stdDeviation="4"
                                result="coloredBlur"
                            />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Base Landmass */}
                    <rect width="500" height="380" fill="#141820" />

                    {/* Urban Street Grid */}
                    <g stroke="#1e2430" strokeWidth="1">
                        <line x1="0" y1="75" x2="500" y2="75" />
                        <line x1="0" y1="150" x2="500" y2="150" />
                        <line x1="0" y1="225" x2="500" y2="225" />
                        <line x1="0" y1="300" x2="500" y2="300" />
                        <line x1="100" y1="0" x2="100" y2="380" />
                        <line x1="200" y1="0" x2="200" y2="380" />
                        <line x1="300" y1="0" x2="300" y2="380" />
                        <line x1="400" y1="0" x2="400" y2="380" />
                    </g>

                    {/* Charles River & Boston Harbor */}
                    <path
                        d="M 0,145 Q 115,152 195,125 T 315,72 L 355,0 L 500,0 L 500,320 L 420,285 Q 375,230 345,195 Q 320,165 322,125 Q 250,155 180,175 Q 90,192 0,185 Z"
                        fill="url(#bostonWater)"
                        stroke="#1a3652"
                        strokeWidth="1.5"
                    />

                    {/* Fort Point Channel */}
                    <path
                        d="M 332,190 L 352,265 L 366,260 L 348,186 Z"
                        fill="url(#bostonWater)"
                    />

                    {/* Iconic Boston Bridges */}
                    <line
                        x1="155"
                        y1="143"
                        x2="172"
                        y2="176"
                        stroke="#2f394a"
                        strokeWidth="3"
                    />
                    <line
                        x1="245"
                        y1="112"
                        x2="262"
                        y2="146"
                        stroke="#2f394a"
                        strokeWidth="3"
                    />
                    <line
                        x1="298"
                        y1="78"
                        x2="310"
                        y2="102"
                        stroke="#2f394a"
                        strokeWidth="3"
                    />

                    {/* Boston Common & Public Garden */}
                    <polygon
                        points="242,175 282,170 288,205 246,210"
                        fill="#162e23"
                        stroke="#1f4734"
                        strokeWidth="1"
                    />

                    {/* Distance Radius Circle Synced with Max Distance Slider */}
                    <circle
                        cx="265"
                        cy="190"
                        r={radiusPx}
                        fill="#1DB954"
                        fillOpacity="0.06"
                        stroke="#1DB954"
                        strokeOpacity="0.32"
                        strokeWidth="1.2"
                        strokeDasharray="4 4"
                    />

                    {/* Neighborhood Labels */}
                    <g
                        fill="#64748b"
                        fontFamily="Inter, sans-serif"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="0.06em"
                        textAnchor="middle"
                    >
                        <text x="145" y="95">
                            CAMBRIDGE
                        </text>
                        <text x="86" y="62">
                            HARVARD SQ
                        </text>
                        <text x="318" y="128">
                            NORTH END
                        </text>
                        <text x="205" y="205">
                            BACK BAY
                        </text>
                        <text x="245" y="148">
                            BEACON HILL
                        </text>
                        <text x="115" y="258">
                            FENWAY
                        </text>
                        <text x="235" y="282">
                            SOUTH END
                        </text>
                        <text x="392" y="232">
                            SEAPORT
                        </text>
                    </g>

                    {/* Dashed Route Line from User (Boston Common) to Active Restaurant */}
                    {activeSpot && (
                        <line
                            x1="265"
                            y1="190"
                            x2={activeSpot.coords.x}
                            y2={activeSpot.coords.y}
                            stroke="#1DB954"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                            opacity="0.9"
                        />
                    )}

                    {/* User Anchor Pin (Boston Common) */}
                    <g transform="translate(265, 190)">
                        <circle r="11" fill="#38bdf8" opacity="0.22" />
                        <circle
                            r="4.5"
                            fill="#38bdf8"
                            stroke="#ffffff"
                            strokeWidth="1.5"
                        />
                        <text
                            y="-9"
                            textAnchor="middle"
                            fill="#bae6fd"
                            fontSize="8"
                            fontWeight="800"
                        >
                            YOU
                        </text>
                    </g>

                    {/* Filtered Restaurant Pins */}
                    {restaurants.map((spot) => {
                        const isSelected = spot.id === activeSpot?.id;
                        return (
                            <g
                                key={spot.id}
                                onClick={() => onSelectPin(spot.id)}
                                transform={`translate(${spot.coords.x}, ${spot.coords.y})`}
                                className="cursor-pointer"
                            >
                                {isSelected && (
                                    <circle
                                        r="14"
                                        fill="#1DB954"
                                        className="radar-ring"
                                    />
                                )}
                                <circle
                                    r={isSelected ? 8 : 5.5}
                                    fill={isSelected ? "#1DB954" : "#FF5E3A"}
                                    stroke="#ffffff"
                                    strokeWidth={isSelected ? 2.2 : 1.4}
                                    filter={
                                        isSelected
                                            ? "url(#pinNeonGlow)"
                                            : undefined
                                    }
                                />
                                {(isSelected || expanded) && (
                                    <g
                                        transform={`translate(0, ${isSelected ? -14 : -11})`}
                                    >
                                        <rect
                                            x="-48"
                                            y="-11"
                                            width="96"
                                            height="14"
                                            rx="4"
                                            fill="#0f172a"
                                            fillOpacity="0.9"
                                            stroke={
                                                isSelected
                                                    ? "#1DB954"
                                                    : "#334155"
                                            }
                                            strokeWidth="0.8"
                                        />
                                        <text
                                            y="-2"
                                            textAnchor="middle"
                                            fill={
                                                isSelected
                                                    ? "#1DB954"
                                                    : "#e2e8f0"
                                            }
                                            fontFamily="Inter, sans-serif"
                                            fontSize="8"
                                            fontWeight="700"
                                        >
                                            {spot.name.length > 15
                                                ? `${spot.name.slice(0, 14)}…`
                                                : spot.name}
                                        </text>
                                    </g>
                                )}
                            </g>
                        );
                    })}
                </svg>

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
                                            {spot.neighborhood} • {spot.cuisine}{" "}
                                            • {spot.price} • {spot.votes} votes
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
                    {winner.neighborhood} • {winner.cuisine} • {winner.price} •{" "}
                    {winner.rating.toFixed(1)} ★
                </p>

                <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-1">
                    <p className="text-xs text-white/55">
                        {winner.distance.toFixed(1)} mi from Boston Common •{" "}
                        {winner.tablesTonight
                            ? "Tables Available Tonight"
                            : "Walk-in Line Ready"}
                    </p>
                    <p className="text-sm font-bold text-[#1DB954]">
                        {winner.votes} Jam Votes • Top Group Consensus
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
export default function App() {
    const getRoomCodeFromUrl = () => {
        const match = window.location.pathname.match(
            /^\/(?:room|join)\/([A-Za-z0-9-]+)\/?$/,
        );
        return match?.[1]?.toUpperCase() ?? null;
    };

    const [roomCode, setRoomCode] = useState<string | null>(
        getRoomCodeFromUrl,
    );
    const [roomCodeInput, setRoomCodeInput] = useState("");
    const [roomPresenceCount, setRoomPresenceCount] = useState(1);
    const [roomParticipants, setRoomParticipants] = useState<RoomParticipant[]>([]);
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
    const userIdRef = useRef<string | null>(null);

    const [restaurants, setRestaurants] = useState<Restaurant[]>(
        INITIAL_BOSTON_RESTAURANTS,
    );
    const [filters, setFilters] = useState<FilterState>({
        maxDistance: 5.0,
        minRating: 4.0,
        cuisines: [],
        prices: [],
        openNow: false,
        tablesTonight: false,
        walkInFriendly: false,
    });

    const [activeRestaurantId, setActiveRestaurantId] = useState(
        INITIAL_BOSTON_RESTAURANTS[0].id,
    );
    const roomStateRef = useRef({
        restaurants,
        filters,
        activeRestaurantId,
    });
    const [isQueueOpen, setIsQueueOpen] = useState(false);
    const [winnerSpot, setWinnerSpot] = useState<Restaurant | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const feedRef = useRef<HTMLDivElement>(null);

    const addToast = useCallback((message: string, accent = "#1DB954") => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, message, accent }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 2500);
    }, []);

    const enterRoom = useCallback((code: string) => {
        const normalizedCode = code
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9-]/g, "");
        if (!normalizedCode) return;
        window.history.pushState({}, "", `/room/${normalizedCode}`);
        setRoomCode(normalizedCode);
    }, []);

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

    const createRoom = useCallback(() => {
        if (!saveProfile()) return;
        const bytes = crypto.getRandomValues(new Uint8Array(4));
        const code = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
        )
            .join("")
            .slice(0, 8)
            .toUpperCase();
        enterRoom(code);
    }, [enterRoom, saveProfile]);

    useEffect(() => {
        const handlePopState = () => setRoomCode(getRoomCodeFromUrl());
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    useEffect(() => {
        if (!roomCode) {
            roomChannelRef.current = null;
            return;
        }
        userIdRef.current ??= crypto.randomUUID();
        const preferences: RoomPreferences = {
            cuisines: profileCuisines,
            prices: profilePrices,
        };
        const participant: RoomParticipant = {
            id: userIdRef.current,
            name: profileName.trim() || "Guest",
            preferences,
        };

        const channel = joinRoom(
            roomCode,
            { id: userIdRef.current, profile: participant },
            {
                onState: (state) => {
                    setRestaurants(state.restaurants);
                    setFilters(state.filters);
                    setActiveRestaurantId(state.activeRestaurantId);
                },
                onPresenceChange: setRoomPresenceCount,
                onParticipants: setRoomParticipants,
                onReady: () => {
                    void requestRoomState(roomChannelRef.current);
                },
                onStateRequest: () => {
                    void sendRoomState(roomChannelRef.current, roomStateRef.current);
                },
            },
        );
        roomChannelRef.current = channel;

        return () => {
            if (channel) {
                channel.unsubscribe();
            }
            roomChannelRef.current = null;
        };
    }, [roomCode, profileName, profileCuisines, profilePrices]);

    useEffect(() => {
        if (!profileComplete) return;
        const participant: RoomParticipant = {
            id: userIdRef.current ?? "local",
            name: profileName.trim() || "Guest",
            preferences: {
                cuisines: profileCuisines,
                prices: profilePrices,
            },
        };
        void updateRoomProfile(roomChannelRef.current, participant);
    }, [profileComplete, profileName, profileCuisines, profilePrices]);

    useEffect(() => {
        if (!roomCode) return;
        roomStateRef.current = {
            restaurants,
            filters,
            activeRestaurantId,
        };
        const timeout = window.setTimeout(() => {
            void sendRoomState(roomChannelRef.current, {
                restaurants,
                filters,
                activeRestaurantId,
            });
        }, 80);
        return () => window.clearTimeout(timeout);
    }, [roomCode, restaurants, filters, activeRestaurantId]);

    // Filtered Restaurants Memoized
    const filteredRestaurants = useMemo(() => {
        return restaurants.filter((r) => {
            if (r.distance > filters.maxDistance) return false;
            if (r.rating < filters.minRating) return false;
            if (
                filters.cuisines.length > 0 &&
                !filters.cuisines.includes(r.cuisine)
            )
                return false;
            if (filters.prices.length > 0 && !filters.prices.includes(r.price))
                return false;
            if (filters.openNow && !r.openNow) return false;
            if (filters.tablesTonight && !r.tablesTonight) return false;
            if (filters.walkInFriendly && !r.walkInFriendly) return false;
            return true;
        });
    }, [restaurants, filters]);

    // Keep activeRestaurantId synchronized when filters change
    useEffect(() => {
        if (
            filteredRestaurants.length > 0 &&
            !filteredRestaurants.some((r) => r.id === activeRestaurantId)
        ) {
            const nextActiveId = filteredRestaurants[0].id;
            setTimeout(() => {
                setActiveRestaurantId(nextActiveId);
                if (feedRef.current) feedRef.current.scrollTop = 0;
            }, 0);
        }
    }, [filteredRestaurants, activeRestaurantId]);

    const handleToggleVote = (id: string) => {
        setRestaurants((prev) =>
            prev.map((r) => {
                if (r.id !== id) return r;
                const nextVoted = !r.userVoted;
                addToast(
                    nextVoted
                        ? `🔥 Voted for ${r.name}!`
                        : `Removed vote for ${r.name}`,
                    nextVoted ? "#FF5E3A" : "#94a3b8",
                );
                return {
                    ...r,
                    userVoted: nextVoted,
                    votes: nextVoted ? r.votes + 1 : Math.max(0, r.votes - 1),
                    voters: nextVoted
                        ? ["YOU", ...r.voters.filter((v) => v !== "YOU")]
                        : r.voters.filter((v) => v !== "YOU"),
                };
            }),
        );
    };

    const handleToggleQueue = (id: string) => {
        setRestaurants((prev) =>
            prev.map((r) => {
                if (r.id !== id) return r;
                const nextQueue = !r.inQueue;
                addToast(
                    nextQueue
                        ? `Added ${r.name} to Jam Queue`
                        : `Removed ${r.name} from Jam Queue`,
                    "#1DB954",
                );
                return { ...r, inQueue: nextQueue };
            }),
        );
    };

    const handleResetFilters = () => {
        setFilters({
            maxDistance: 5.0,
            minRating: 4.0,
            cuisines: [],
            prices: [],
            openNow: false,
            tablesTonight: false,
            walkInFriendly: false,
        });
        addToast("Reset all Boston filters");
    };

    const handleJumpToRestaurant = (id: string) => {
        const isVisible = filteredRestaurants.some((r) => r.id === id);
        if (!isVisible) {
            setFilters({
                maxDistance: 10.0,
                minRating: 3.5,
                cuisines: [],
                prices: [],
                openNow: false,
                tablesTonight: false,
                walkInFriendly: false,
            });
            addToast("Expanded filters to show selected spot", "#FF5E3A");
        }
        setActiveRestaurantId(id);
        setTimeout(() => {
            const targetEl = feedRef.current?.querySelector(
                `[data-id="${id}"]`,
            );
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 60);
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
        const pool =
            filteredRestaurants.length > 0 ? filteredRestaurants : restaurants;
        const topPick = [...pool].sort(
            (a, b) => b.votes - a.votes || b.rating - a.rating,
        )[0];
        setWinnerSpot(topPick);
    };

    const queuedRestaurants = useMemo(
        () => restaurants.filter((r) => r.inQueue),
        [restaurants],
    );

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
                        onClick={createRoom}
                        className="room-entry-primary"
                    >
                        New room
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
                            maxLength={32}
                        />
                        <button
                            type="submit"
                            className="room-entry-secondary"
                        >
                            Enter room
                        </button>
                    </form>
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
                                onClick={() => {
                                    if (saveProfile()) createRoom();
                                }}
                                className="room-entry-primary room-entry-room-button"
                            >
                                New room
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
                                    maxLength={32}
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

                    {!isRealtimeConfigured() && (
                        <p className="room-entry-warning">
                            Realtime is not configured. Add Vite Supabase
                            environment variables to enable shared rooms.
                        </p>
                    )}
                </div>
            </main>
        );
    }

    return (
        <div className="bg-[#121212] text-white min-h-screen lg:h-screen lg:overflow-hidden flex flex-col font-sans">
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
                    restaurants={filteredRestaurants}
                    activeId={activeRestaurantId}
                    onSelectActive={setActiveRestaurantId}
                    onToggleVote={handleToggleVote}
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
                        presenceCount={roomPresenceCount}
                        participants={roomParticipants}
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
                restaurants={filteredRestaurants}
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
