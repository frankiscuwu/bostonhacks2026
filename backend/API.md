# Restaurant and room API

All paths have trailing slashes. Send JSON bodies with `Content-Type: application/json`.
Public reads use the room code; there is no user authentication yet.

## Restaurants

Restaurants come from the shared Supabase `restaurants` table (Boston food licenses).
Django maps it read-only (`managed = False`, primary key `_id`) and never alters it.
A restaurant is *active* when `licstatus = 'Active'` and it has latitude and longitude.

`GET /api/restaurants/` returns an array of active restaurants in ascending ID order.
`name` is `dbaname`, falling back to `businessname`; `address` joins street, city, state
and ZIP. The source has no price or rating, so `price_level` and `rating` are
always `null`. `cuisine` is the
raw source value (often `null`, sometimes a list like `donut;coffee_shop`), and
`open_time`/`close_time` are `HH:MM` strings or `null`. `videos` lists attached TikTok /
Instagram / YouTube videos (`platform`, `url`, `embed_id`, `embed_url`, `thumbnail_url`,
`author`, `caption`); `creator_video_url` and `image_url` come from the first one, or are empty.
See `VIDEOS.md` for how videos are collected.
Optional query parameters:

- `cuisine`: case-insensitive substring match.
- `max_price` / `min_rating`: unsupported; return HTTP 400 because the shared
  catalog has no corresponding metadata. They are not silently ignored.
- `latitude`, `longitude`, `max_distance_km`: all three required together. Distance is
  straight-line Haversine distance in kilometers, not transit or driving distance.

Distance filtering happens in Python after database filters, suitable for the MVP
catalog. There is no pagination yet.

## Create and join

`POST /api/rooms/` and `POST /api/rooms/{code}/join/` take:

```json
{"display_name": "Alex"}
```

Both return HTTP 201 with `room`, `participant`, and `participant_token` keys.
The token is a private UUID credential, returned only in this creation/join response.
Store it privately on the client and never include it in URLs, shared room state, or
analytics. There is no credential recovery endpoint. Each repeated create/join
request creates a new participant; automatic retries are not idempotent.
Joining a closed room (`is_active: false`) returns HTTP 409.

## Room state

`GET /api/rooms/{code}/` returns:

```json
{
  "code": "ABC123",
  "selected_restaurant": null,
  "selected_at": null,
  "selected_by": null,
  "is_active": true,
  "created_at": "...",
  "participants": [{"id": 1, "display_name": "Alex", "is_active": true, "joined_at": "...",
                    "filters": {"cuisines": [], "max_distance_miles": null, "open_now": false}}],
  "matching_count": 3148
}
```

`matching_count` is how many active restaurants match every active participant's
saved filters. `selected_restaurant` uses the restaurant shape above. Tokens are never
part of public serializers.

## Filters

`PUT /api/rooms/{code}/filters/` requires an `X-Participant-Token` header and replaces
that participant's filters:

```json
{"cuisines": ["Pizza", "Mexican"], "max_distance_miles": 1.5, "open_now": false}
```

- `cuisines`: `cuisine_label` values; empty means any cuisine.
- `max_distance_miles`: 0.1–100 straight-line miles from Boston Common, or `null` for any.
- `open_now`: JSON boolean; when true, only restaurants with posted hours that are open
  now (Boston time). Restaurants without hours never match.

Returns the updated room state. Matching logic lives in `restaurants/matching.py`.

## Random pick

`POST /api/rooms/{code}/pick/` requires an `X-Participant-Token` header. Django randomly
chooses one restaurant matching *every* active participant's saved filters, stores it
as `selected_restaurant` with `selected_at` and `selected_by`, and returns the room
state. Any participant can pick again; each pick replaces the previous one. Returns
409 when nothing matches everyone (or the room is closed), and 403 for missing,
invalid, inactive, or other-room credentials.

Clients should save pending filter changes before picking. Realtime notifications are
client-sent "room-updated" pings with no payload; clients refetch from Django.

There is no departure endpoint: closing a browser does not remove a participant, so
an abandoned participant's filters still apply until they are marked inactive.

## Local verification

Run from `backend/` with an explicit SQLite override so the test runner never
connects to the shared Supabase database:

```sh
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py check
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py test
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py makemigrations --check --dry-run
```

The existing dotenv loader preserves the explicit environment override. SQLite tests
verify service behavior but cannot exercise PostgreSQL row locks; a separate disposable
PostgreSQL database is needed for a concurrent transaction integration test.

The discovery/group-selection API reads restaurants from the shared `restaurants`
table and writes room state only to `rooms_*`. The selected-restaurant FK has no database constraint because the
restaurants table is owned outside Django. Migration `restaurants.0002` only creates
`restaurants` when missing (fresh SQLite databases); on Supabase it is a no-op.
`rooms.0002` drops the old restaurant FK constraints. Migration
`restaurants.0003_drop_legacy_restaurant_table` then drops the legacy
`restaurants_restaurant` table without CASCADE, after depending on both apps' 0002
migrations. `rooms.0003` removes voting and adds participant filters and random selection;
`rooms.0004` adds participant location. `BostonFoodLiscences` is not used.

`managed=False` is a schema-management setting, not an ORM write prohibition.
Do not save/update/delete source rows. See [IMPORTING.md](IMPORTING.md) for the
retired importer, preserved stash, migration reconciliation, and proposed separate
enrichment table. The old `0002_restaurant_optional_metadata` must not be restored.

## Creator videos

`GET /api/restaurants/{id}/videos/` returns approved creator-video records in ID
order, or `[]` for a restaurant without approved videos. Unknown restaurants return
404. Public submissions and approval writes are not supported (405).

The separate Django-managed `RestaurantVideo` model references shared restaurant
IDs without modifying source rows. New entries default to pending and are manually
reviewed in Admin. See [VIDEOS.md](VIDEOS.md) for the exact TypeScript response,
URL allowlist, review workflow, and YouTube/TikTok/Instagram official embed guidance.
Existing restaurant response fields remain unchanged.

Migration `restaurants.0004_restaurant_video` creates the video table only. It was
applied to shared Supabase on November 21, 2026, with no video records inserted.
See [VIDEOS.md](VIDEOS.md) for the remaining staff permission setup.
Video administration writes to the new table;
the discovery endpoint continues reading the shared restaurant table without writes.
