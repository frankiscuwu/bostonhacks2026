# Creator video API and review workflow

This feature stores links in Django-owned `restaurants_restaurantvideo`, associated
with the shared `restaurants._id`. It does not download, host, scrape, or fetch video
pages, and never inserts/updates source restaurants. Multiple videos can reference
one restaurant; the same video may reference multiple restaurants.

## Migration and ownership

`restaurants.0004_restaurant_video` depends on the existing restaurant 0003 migration
and creates only the video table, its index, and uniqueness constraint. It has not
been applied to shared Supabase. Do not run it there without approval.

The restaurant relation uses `db_constraint=False`, preserving the external table's
ownership. Model validation and Admin require an existing restaurant when saving;
external deletion may leave an orphan video. The endpoint checks restaurant existence
first and returns 404 for a deleted restaurant. Django ORM deletion is protected
while videos reference a restaurant. Avoid bulk_create/update or raw SQL for video
editing: those bypass the model's URL validation. Ordinary save() enforces validation.

## Manual curation in Admin

1. Sign in to `/admin/` with authorized staff/model permissions.
2. Add a Restaurant Video and choose the existing restaurant's `_id` using the raw-ID
   lookup. The source Restaurant Admin remains read-only.
3. Select `youtube`, `tiktok`, or `instagram` and paste a supported full HTTPS URL.
4. Enter creator name/handle if known; otherwise leave them blank. No creator data
   is inferred or fabricated.
5. Leave the default `pending` while reviewing. Confirm the video concerns the right
   venue, attribution is correct, and the public video permits embedding. Set
   `approved` to publish; `pending` or `rejected` removes it from the public feed.
6. Re-review whenever editing the URL or restaurant of an approved record. Approval
   is manual and does not automatically recheck video availability later.

`platform_video_id` is derived from the URL and read-only in Admin. Canonicalization
removes query/fragment tracking parameters and normalizes supported hosts. Duplicate
restaurant/platform/video-ID associations are rejected, including URL aliases.
`created_at` and `updated_at` record entry creation and modification, not source
video upload time. No public submission or moderation endpoint exists.

## Supported inputs

All inputs require HTTPS, an exact supported hostname, no credentials, and no
explicit port. Unknown domains, mismatched platforms, profiles, playlists, and
malformed paths/IDs are rejected. Query/fragment metadata is discarded.

| Platform | Accepted input formats | Stored canonical format |
| --- | --- | --- |
| YouTube | `youtube.com/shorts/ID`, `youtube.com/watch?v=ID`, `youtube.com/embed/ID`, `youtu.be/ID`; also `www.youtube.com` and `m.youtube.com` | `https://www.youtube.com/watch?v=ID` |
| TikTok | `tiktok.com/@HANDLE/video/ID`; also `www.tiktok.com` and `m.tiktok.com` | `https://www.tiktok.com/@HANDLE/video/ID` |
| Instagram | `instagram.com/reel/SHORTCODE/`; also `www.instagram.com` and `m.instagram.com` | `https://www.instagram.com/reel/SHORTCODE/` |

YouTube IDs are 11 URL-safe characters. TikTok IDs are 10–25 decimal digits and
handles use 1–24 letters, digits, dots, or underscores. Instagram shortcodes use
1–100 letters, digits, dashes, or underscores. TikTok `vm`/`vt` redirect links are
not followed; open them yourself and paste the final full video URL. Instagram
`/p/`, stories, and profile URLs are intentionally outside this Reel-only feature.
YouTube share/watch links are accepted because Shorts share the same video-ID
player; syntax validation cannot establish whether a video actually is a Short.

Validation is structural only: it does not establish existence, creator identity,
public status, restaurant association, or embeddability. Those are review checks.

## Public endpoint and exact frontend contract

`GET /api/restaurants/{id}/videos/` returns an unpaginated array, ordered by ascending
video-record ID. Only `approved` entries for that restaurant are returned. A source
restaurant need not satisfy the discovery `active()` filter to have approved videos.

- Existing restaurant without approved videos: HTTP 200 and `[]`.
- Nonexistent restaurant: HTTP 404 with `{ "detail": "Not found." }`.
- Public POST/PUT/PATCH/DELETE: HTTP 405; no records are created or approved.
- Approval query parameters cannot override the approved-only filter.

```ts
export type VideoPlatform = "youtube" | "tiktok" | "instagram";

export interface RestaurantVideo {
  id: number;                    // Django video-record ID
  restaurant_id: number;         // shared restaurants._id
  platform: VideoPlatform;
  canonical_url: string;         // validated HTTPS source link, never HTML
  platform_video_id: string;     // YouTube ID, TikTok ID, or Instagram shortcode
  creator_name: string;          // "" if unknown
  creator_handle: string;        // "" if unknown
  verification_status: "approved";
  created_at: string;            // ISO 8601 date-time
  updated_at: string;            // ISO 8601 date-time
}

export type RestaurantVideosResponse = RestaurantVideo[];

// Use the existing frontend API_BASE_URL; no participant token is needed.
const response = await fetch(`${API_BASE_URL}/api/restaurants/${restaurantId}/videos/`);
if (!response.ok) throw new Error(`Video API returned HTTP ${response.status}`);
const videos = (await response.json()) as RestaurantVideosResponse;
```

Existing restaurant list/detail-in-room serializers are unchanged: their legacy
`creator_video_url` still returns an empty string. Fetch the videos endpoint to
obtain the new links. Do not expect videos to be embedded in list responses.

## Rendering with provider players

Use source-player embeds, not MP4 downloads, regular page iframes, or arbitrary HTML
from API fields. Keep the canonical source link and creator attribution visible,
and fall back to the link if the player is blocked, removed, or restricted. Mount
only visible players and avoid forced autoplay. No playback synchronization is added.

### YouTube (including Shorts)

Construct `https://www.youtube.com/embed/${video.platform_video_id}` as an iframe
source. Use a descriptive title, lazy loading, fullscreen permission, and a player
viewport of at least 200×200. If enabling the IFrame Player API, follow its origin
configuration requirements. Official guidance:
https://developers.google.com/youtube/player_parameters

```tsx
<iframe
  src={`https://www.youtube.com/embed/${video.platform_video_id}`}
  title={video.creator_name || "Restaurant creator video"}
  loading="lazy"
  allow="encrypted-media; fullscreen; picture-in-picture"
  allowFullScreen
/>
```

### TikTok

Use the official iframe player at
`https://www.tiktok.com/player/v1/${video.platform_video_id}` with a title and
fullscreen permission. Keep default autoplay disabled. If handling postMessage
player events, validate the provider origin and message source. Official guidance:
https://developers.tiktok.com/docs/en/embed-player

### Instagram Reels

Use Instagram's official Embed markup/script, not an iframe of the regular Reel
page. Render a `blockquote` with class `instagram-media` and
`data-instgrm-permalink={video.canonical_url}` plus a source-link fallback. Load
`https://www.instagram.com/embed.js` once and call
`window.instgrm?.Embeds.process()` after React mounts/changes the blockquotes.
Type that optional global in the frontend rather than disabling TypeScript checks.
Do not insert creator names or URLs through unescaped raw HTML.

For provider-generated embed HTML, use Instagram's Embed menu or a separately
implemented server-side oEmbed integration; this backend does not fetch/store
provider HTML or require provider API credentials. Follow current Meta oEmbed
requirements if that integration is added; do not put credentials into Vite variables.
Private/restricted posts and accounts that disable embeds may not render.
Official guidance: https://developers.facebook.com/documentation/instagram-platform/oembed

## Isolated verification

From `backend/`:

```sh
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py check
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py test
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py makemigrations --check --dry-run
```

These create/migrate only a disposable SQLite test database. Test URL fixtures are
not real curated restaurant associations and are never inserted into Supabase.
