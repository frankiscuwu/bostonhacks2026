# ReelHungry: address-first MBTA directions

Read-only directions for each Jam participant, using the Jam's selected restaurant
as the destination. No models, database migrations, or shared record writes.
No participant coordinates or address searches are broadcast to the room.

## Local startup

Backend `.env` needs `DJANGO_SECRET_KEY`, the existing database configuration,
`MBTA_API_KEY`, and `GEOAPIFY_API_KEY`. Keys belong only on the backend.

From the repository root, in separate terminals:

```sh
sh backend/run_local.sh
cd frontend && npm run dev
```

Open http://localhost:5173. The local launcher removes stale exported **MBTA and
Geoapify** keys so `backend/.env` supplies both. It leaves database configuration
and other environment variables unchanged. Normal deployment/manage.py startup
preserves standard environment-over-dotenv precedence. Restart Django after key
changes. A rejected configured key never triggers a silent anonymous retry.

Django runs at http://127.0.0.1:8000. `/` intentionally returns 404; use
`/api/health/`. `/api/restaurants/` provides catalog IDs. Vite's `VITE_API_URL`
should be the Django origin, without `/api`. Development defaults to
`http://127.0.0.1:8000`; production must configure it and rebuild. Allow the frontend
origin in Django `CORS_ALLOWED_ORIGINS`. Never add either API key to `VITE_*`.

## Sources

- [MBTA V3 specification](https://api-v3.mbta.com/docs/swagger): `/routes`,
  `/stops`, `/route_patterns` with included representative trip stop sequences
  and shapes, `/predictions`, `/schedules`, and `/alerts`.
- [Geoapify autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/):
  `/v1/geocode/autocomplete`.
- [Geoapify geocoding](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/):
  `/v1/geocode/search`.
- [Geoapify pedestrian routing](https://apidocs.geoapify.com/docs/routing/):
  `/v1/routing?mode=walk`. Reported `time` is seconds; `distance` is metres.

MBTA's GTFS-derived representative-trip ordered stops give directed rail edges;
no full GTFS ZIP is downloaded per request. Only Red, Orange, Blue, and Green
B/C/D/E normal canonical patterns are supported. Exact patterns preserve branches,
headsigns and direction. Same-name stations/proximity/intersecting shapes do not
create transfers. At most one change at a shared MBTA parent station is supported.

## Routing and ETA

The existing Dijkstra supplies a structural baseline. Bounded enumeration adds
other directed direct/one-transfer paths using up to six station candidates per
end within 1.5 km straight-line distance. Three diverse pattern alternatives are
evaluated against pedestrian access/egress and real train events. The earliest
verified arrival among evaluated candidates wins. This is not a global optimum.

Geoapify routes origin → boarding station and exit station → restaurant through
its pedestrian street graph. Geometry, distance, estimated walking seconds, and
optional turn instructions are retained. Invalid, disconnected or excessively
snapped geometry is rejected. Provider failures leave labeled straight-line
connectors with **no walking duration**; this makes full ETA unavailable.

For each train leg, query predictions and schedules for the actual boarding and
alighting platform IDs. Match **one trip ID, exact route pattern and increasing
stop sequence**. Live events override scheduled events for that same trip/stop;
cancelled/skipped trips cannot reappear via schedules. Boarding is allowed only
when departure is at least walking arrival + a **60-second planning allowance**.
The allowance is included in waiting, not counted twice. Use the earliest
feasible alighting time, never an invented speed or average seconds per stop.
Scheduled and mixed live/scheduled results are labeled explicitly.

Subsequent legs start after the previous arrival. A same-platform change may have
zero transfer walking and still requires the boarding allowance. A change between
different platforms has **unverified internal walking time**: preserve the
structural route but withhold full ETA and do not recommend a timed connection.
Geoapify street routing does not establish underground platform-transfer times.
No inter-station walking transfers are invented.

When complete, end-to-end seconds = access walking + train waits (including
boarding allowances) + matched train durations + final walking. Return arrival
clock time and walking/waiting/transit components. Unknown walking, missing
same-trip events, missed connections or unverified transfer paths produce
`eta.status=unavailable`. Active suspension/shuttle advisories on a selected line
exclude affected timed alternatives; if none remain, withhold ETA because the graph cannot reroute through disruptions. Other
advisories remain prominent; predictions/estimates are not guarantees.

## HTTP contract

All endpoints are GET-only. Responses are private/no-store, without keys.
No origin is saved by these endpoints.

### Address search

`GET /api/transit/addresses/?q=Northeastern%20University&mode=autocomplete`

`mode=geocode` performs explicit submitted-address search. Query length is 3–200
characters with no control characters. Suggestions are biased toward Boston/
Cambridge and filtered to a 70 km circle around Boston, including Greater Boston.
Exact place names rank ahead of annexes/bookstores. Always let the user confirm
one result; multiple results are not silently converted into a destination.

```json
{
  "status": "ok",
  "suggestions": [{"id": "provider-place-id", "label": "Full address", "latitude": 42.34, "longitude": -71.09}],
  "attribution": "Powered by Geoapify · © OpenStreetMap contributors"
}
```

Status can be `ok`, `ambiguous`, `no_results`, `invalid_query` (400), or
`unavailable` (503, safe provider code). Throttled requests return 429.

### Personalized directions

`GET /api/transit/directions/?restaurant_id=396&origin_lat=42.338953&origin_lon=-71.0880556`

Or `?restaurant_id=396&room_code=ABC123` with the requesting participant's
`X-Participant-Token`. Saved mode validates active membership and unchanged Jam
destination. Coordinates stay private. Explicit origin overrides saved mode for
that request and does not update the participant. Missing location returns
`origin_required`, invalid coordinates 400, missing restaurant 404, invalid
membership 403, changed destination 409. `/` is not a directions endpoint.

Existing `status`, `origin`, `destination`, `boarding_station`, `exit_station`,
`legs`, `warnings`, `alerts`, `summary` and network timestamps are preserved.
New optional fields:

- `eta`: `status`, safe `reason`; when complete: `duration_seconds`, `arrival_time`,
  `walking_seconds`, `waiting_seconds`, `transit_seconds`, `transfer_seconds`,
  `boarding_buffer_seconds`, and `source` (`realtime`, `schedule`, `mixed`).
- `summary.duration_minutes`: rounded-up total, or null; `walking_distance_m`.
- Walk legs: `geometry` (LineString or null), `distance_basis`
  (`pedestrian_route` or `straight_line`), `distance_m`, `duration_seconds`, `steps`.
  Existing `approximate_distance_m` stays available for fallback.
- Transit legs: `timing` (same-trip departure/arrival/duration/wait/source),
  `departure_is_feasible`. Informational departures on incomplete routes must
  not be presented as catchable connections.
- `alternatives_evaluated`: bounded candidate count.

## Frontend

Create/join a Jam, adjust preferences and **Pick for us**. Winner popup and
persistent destination card open directions without repicking. The panel defaults
to the requesting participant's saved origin. **Choose starting point** opens
address search, with a 350 ms debounce, three-character minimum, cancellation,
timeouts, arrow-key/Enter selection, and explicit geocoding on Search. Selected
address becomes FROM; the Jam restaurant remains TO. Current location handles
permission failures. Coordinates are hidden under Advanced as a fallback.

The headline shows total minutes and Boston arrival clock time only for complete
ETA. Compact line badges and walking/waiting/transfer summaries precede concise
steps. Walking turns and station sequences are collapsed. Service alerts and
limitations remain inspectable. Routes preserve data source labels.

The existing Leaflet map overlays MBTA geometry in official line colors,
Geoapify pedestrian paths in dashed blue, and unavailable-walk straight connectors
in dotted gray. Fit bounds include all walking and transit geometry. Existing
origin marker, transfer/station markers and restaurant destination remain. Close
route restores restaurant browsing; closing the panel can retain its map overlay.
No second map, restaurant submission form, voting or room write was added.

## Limits and deployment

Geoapify timeout ≤7 seconds/request, 24-second client deadline, 60 outbound
requests/minute per worker/key and 60-second provider-429 cooldown. Private
search/walking responses use hashed keys in the process-local default cache
(5/10 minutes), never the public MBTA file cache. Address endpoint: 40/min/IP;
directions endpoint: 30/min/IP. Multi-worker deployments should use shared rate
limiting and a private server-side cache with appropriate retention. No errors,
request URLs, provider bodies or keys are exposed in frontend responses.

MBTA topology caches for one hour in the separate public file cache
(`MBTA_CACHE_LOCATION`, default `/tmp/reelhungry-mbta-cache`); predictions cache
briefly and schedules for one minute. Warm topology before opening traffic:

```sh
cd backend
DATABASE_URL=sqlite:///:memory: env -u MBTA_API_KEY -u GEOAPIFY_API_KEY .venv/bin/python manage.py warm_transit_cache
```

The service bounds total MBTA/alternative work to roughly 40 seconds, frontend
request timeout is 60 seconds. Serverless hosts may have shorter request limits;
verify the chosen backend host timeout and warm cache before the demo. Filesystem
cache is host-local, not durable/shared across serverless instances.

No buses, commuter rail, ferries, street walking-only alternatives, accessibility
routing, fares, closure rerouting or guaranteed connections. Schedule lookup uses
a bounded 90-minute horizon and GTFS extended hours before 03:00 Boston; it does
not plan multi-day journeys. Walking uses station coordinates and estimated
pedestrian speeds from the provider; entrances and internal station access are
not accessibility-verified. Line-wide disruption suppression can be conservative.
Address/place coverage depends on the provider; users confirm the full label.

## Verification

```sh
cd backend
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py check
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py makemigrations --check --dry-run
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py test
cd ../frontend
npm run build
npm run lint
```

Use the project's existing Python dependencies/environment. If your environment
needs the previously isolated audit dependencies, prefix Django commands with
`PYTHONPATH=/tmp/bostonhacks-audit-python-deps`. Never let the test runner inherit
a shared PostgreSQL URL. Unit tests mock external APIs; real-data probes use
explicitly disposable SQLite fixtures. No migration is required.

A real Django API check resolved **Northeastern University, 360 Huntington Avenue**
and routed to **Brassica Kitchen & Cafe**: Geoapify walk to Ruggles → Orange to
Forest Hills → Geoapify walk to restaurant. At that check it returned 18 minutes,
matched live train events, both pedestrian geometries and MBTA line geometry.
Travel time changes with current departures. Choose that starting address in the
frontend and a restaurant near Forest Hills to repeat manually. A Jam using a
fixture restaurant may be tested only in disposable SQLite; don't create test
rooms or modify shared Supabase records merely to run verification.

Verification completed: 113 isolated SQLite backend tests, Django checks,
migration consistency, frontend TypeScript/Vite build and ESLint. Real-data
headless browser checks used disposable SQLite with Supabase disabled: create
Jam → random pick → debounced address suggestions → keyboard selection → live
MBTA ETA and pedestrian geometry. Checks also covered map fit after expansion,
no results, denied device location, simulated address-provider HTTP 503/loading,
hidden advanced coordinates and mobile bounds, without runtime exceptions.
External basemap/image requests were blocked during browser checks; this verifies
route overlays, not basemap availability. No production migrations were run.
