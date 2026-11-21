# Restaurant and room API

All paths have trailing slashes. Send JSON bodies with `Content-Type: application/json`.
Public reads use the room code; there is no user authentication yet.

## Restaurants

Restaurants come from the shared Supabase `restaurants` table (Boston food licenses).
Django maps it read-only (`managed = False`, primary key `_id`) and never alters it.
A restaurant is *active* when `licstatus = 'Active'` and it has latitude and longitude.

`GET /api/restaurants/` returns an array of active restaurants in ascending ID order.
`name` is `dbaname`, falling back to `businessname`; `address` joins street, city, state
and ZIP. The source has no price, rating or media, so `price_level` and `rating` are
always `null` and `creator_video_url`/`image_url` are empty strings. `cuisine` is the
raw source value (often `null`, sometimes a list like `donut;coffee_shop`), and
`open_time`/`close_time` are `HH:MM` strings or `null`.
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

Creating a room selects the first active restaurant by ascending database ID.
With no active restaurants it creates a finished room, still returning the host's
credential. Joining a finished room returns HTTP 409. The host has no special
permissions in this MVP.

## Room state

`GET /api/rooms/{code}/` returns:

```json
{
  "code": "ABC123",
  "current_restaurant": {"id": 1, "name": "Example"},
  "current_round": 1,
  "is_active": true,
  "created_at": "...",
  "participants": [{"id": 1, "display_name": "Alex", "joined_at": "...", "is_active": true}],
  "voting_progress": {"required_count": 1, "voted_count": 0, "voted_participant_ids": []}
}
```

Restaurant objects include all explicit public fields in `RestaurantSerializer`;
the abbreviated example omits address, cuisine, price, rating, coordinates, video,
image, and description. Tokens are never part of public serializers.

## Voting and membership policy

`POST /api/rooms/{code}/vote/` requires an `X-Participant-Token` header and body:

```json
{"round_number": 1, "restaurant_id": 1, "vote": true}
```

`vote` must be a JSON boolean. Both round and restaurant must match current room
state. Successful requests return HTTP 200 with the updated room state. Missing,
invalid, inactive, or other-room credentials return 403; missing rooms return 404;
duplicate votes, stale state, and finished rooms return 409. Invalid inputs return
400. Refresh room state after a 409; do not silently cast a vote for a new round.

All joins and votes acquire the same room row lock inside a database transaction.
Every currently active participant is required to vote. Joins during a round are
immediately required, including when other participants have already voted. A join
that commits after advancement belongs to the new round. Thus a concurrent join
cannot be omitted from the required set if it commits before the deciding vote.

There is no departure, timeout, or presence endpoint. Closing a browser does not
remove a voter; an abandoned participant can hold the room open. Do not change
participant membership, active status, room state, or votes directly in Admin while
voting is in progress. A future departure service must acquire the same room lock
and explicitly define completion behavior.

When all active participants have voted, the service selects the next active
restaurant with an ID greater than the current ID and increments the round. It
skips inactive restaurants and never cycles backwards. Filters on the discovery
endpoint do not filter a room's sequence. Catalog changes affect subsequent choices;
this MVP does not snapshot the catalog. An already-current restaurant remains
votable if deactivated during its round. At exhaustion, `is_active` becomes false,
`current_restaurant` becomes null, and the round increments once for the completed
round. Finished rooms reject joins and votes.

The room lock serializes concurrent votes on PostgreSQL; the database unique
constraint is an additional duplicate-vote guard. State is serialized while the lock
is held and returned after the transaction commits. This is a committed snapshot;
clients may observe later state on their next fetch. The backend does not broadcast Realtime updates or run a WebSocket server. The
frontend sends credential-free `room-updated` notifications after successful API
responses and also polls Django. Future server-side broadcasts should use
`transaction.on_commit()` and exclude credentials.

## Results

`GET /api/rooms/{code}/results/` returns an array of:

```json
{"restaurant": {"id": 1, "name": "Example"}, "yes_count": 2, "no_count": 1, "total_votes": 3, "approval_rate": 0.6666666666666666}
```

Ranking is approval fraction descending, then yes count descending, then restaurant
ID ascending. Includes submitted votes from incomplete rounds and historical votes
from participants who later become inactive. Restaurants without votes are omitted.
This endpoint never exposes individual vote choices or participant credentials.

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

The discovery/group-voting API reads restaurants from the shared `restaurants`
table and writes room state only to `rooms_*`. Room and vote restaurant FKs have no database constraint because the
restaurants table is owned outside Django. Migration `restaurants.0002` only creates
`restaurants` when missing (fresh SQLite databases); on Supabase it is a no-op.
`rooms.0002` drops the old restaurant FK constraints. Migration
`restaurants.0003_drop_legacy_restaurant_table` then drops the legacy
`restaurants_restaurant` table without CASCADE, after depending on both apps' 0002
migrations. `BostonFoodLiscences` is not used.

`managed=False` is a schema-management setting, not an ORM write prohibition.
Do not save/update/delete source rows. See [IMPORTING.md](IMPORTING.md) for the
retired importer, preserved stash, migration reconciliation, and proposed separate
enrichment table. The old `0002_restaurant_optional_metadata` must not be restored.
