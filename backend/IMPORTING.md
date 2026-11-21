# Shared restaurant catalog and reconciliation

## Current source of truth

Django reads the existing Supabase `public.restaurants` table. Do not import a
second copy of the licensing CSV, create `restaurants_restaurant`, or update the
teammates' `restaurants` / `BostonFoodLiscences` tables with the retired importer.
The public API uses the shared `_id` as `id`.

Read-only verification during reconciliation found 3,355 shared rows and 3,148
rows satisfying the current `active()` query (Active license and non-null
coordinates). Counts describe that snapshot, not a guarantee of current operation.
All mapped columns matched PostgreSQL types/nullability. Unmapped source columns
`license_add_dt_tm`, `dayphn_cleaned`, and `property_id` are preserved. The `_id`
column has no generated default in Supabase: application code must not assume it
can create rows using the model's BigAutoField declaration.

`managed=False` controls Django's schema management; it does not make ORM writes
impossible. The current application exposes restaurant reads and disables Admin
add/change/delete. Keep all new code from saving, updating, or deleting shared rows.

## Migration lineage

Already-published and already-applied dependencies are:

1. `restaurants.0002_use_shared_restaurants_table` depends on restaurants.0001.
   It makes Restaurant unmanaged, changes the table mapping, and maps id to `_id`.
   Its raw SQL creates a stand-in shared table only when missing, for disposable
   local/test databases. It does not rename or copy the existing shared table.
2. `rooms.0002_alter_room_current_restaurant_alter_vote_restaurant` depends on
   restaurants.0002 and rooms.0001. It removes database restaurant FK constraints
   (`db_constraint=False`); the Django relationships remain.
3. `restaurants.0003_drop_legacy_restaurant_table` depends on both preceding 0002
   migrations and drops the legacy table without CASCADE.

All 23 local migration identifiers matched Supabase's recorded identifiers, with
no pending/unknown migrations. The legacy table was confirmed absent, and room/vote
restaurant ID columns had no database FK constraints. Django does not store checksums
for migrations, so this establishes identifier/schema consistency, not byte-for-byte
proof of the originally executed migration files.

No live migrations or imports were executed during this reconciliation. Do not
reapply or roll back this lineage to recover the retired managed catalog.

## Previous importer work

The original stash `On tanish: Save restaurant importer before teammate merge`
remains intact. It contains the importer, CSV validation, idempotency tests,
optional-metadata tests/docs, and `0002_restaurant_optional_metadata`.

Do not apply/pop the entire stash. The optional-metadata migration targets a dropped
table and creates a second migration branch. The old importer constructs fields no
longer present on Restaurant, queries the computed `name` as a database column, and
attempts inserts; it is incompatible with the authoritative shared catalog.

Useful retained ideas are source-ID joins, UTF-8 BOM handling, duplicate detection,
coordinate validation, null/empty metadata semantics, dry-run reporting, and test
cases. Reuse those in a future read-only catalog audit or an enrichment importer
that writes only to a separately approved Django-owned table. The current source
still has fuzzy cuisine enrichment and simplified opening hours that require review.
No ratings, prices, media URLs, or availability should be fabricated.

## Recommended enrichment design (proposal only)

Use a separate Django-managed one-to-one enrichment table keyed to shared `_id`,
with nullable validated price (1–4) and rating (0–5), optional video/image URLs,
and provenance/review timestamps. Keep source records untouched. Decide the
cross-table FK and external deletion policy with the catalog owner before generating
a migration. Use left-join/optional serialization so unenriched venues still appear.

No enrichment model or migration has been created. Today the serializer explicitly
returns null prices/ratings and empty video/image URLs. Price/rating API filters
return 400 until supported; they do not silently claim to filter unknown values.

## Remaining data integrity considerations

The current active query only checks status and non-null coordinates. It does not
validate coordinate bounds/finiteness, source names/addresses, cuisine quality, or
physical venue deduplication. External changes can leave orphaned restaurant IDs in
rooms/votes because database constraints are disabled. Audit dangling references and
agree a source-row deletion policy before changing those constraints.

Historical migration state for the unmanaged Restaurant retains older fields not
present on the live model; the current migration auto-detector ignores unmanaged
field changes. Future migrations using historical Restaurant models must account
for this. Do not use the absence of generated migrations as proof of field-state
identity, or change already-applied migration files to fix it.

## Safe local verification

Run from `backend/`:

```sh
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py check
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py test
DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py makemigrations --check --dry-run
```

The test runner creates/migrates only an isolated in-memory SQLite database,
including the stand-in source table. It does not connect to Supabase. PostgreSQL
row-lock concurrency still needs separate disposable-database testing.
