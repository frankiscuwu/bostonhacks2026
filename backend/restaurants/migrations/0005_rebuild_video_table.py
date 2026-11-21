"""Replace a video table created by the removed ``0004_restaurant_video`` schema.

Two video features were developed in parallel. The other one's migration was
applied to the shared database first, so ``0004_restaurant_videos`` was recorded
as applied while the table kept the old columns (canonical_url, verification_status,
...). This rebuilds the table with the current schema.

Safety: only acts when the table has the old columns AND no rows; refuses
otherwise. A database already on the current schema (fresh/test/local) is untouched.
"""
from django.db import migrations
from django.db.migrations.recorder import MigrationRecorder

TABLE = "restaurants_restaurantvideo"


def rebuild_video_table(apps, schema_editor):
    connection = schema_editor.connection
    video_model = apps.get_model("restaurants", "RestaurantVideo")
    if TABLE not in connection.introspection.table_names():
        schema_editor.create_model(video_model)
    else:
        with connection.cursor() as cursor:
            columns = {col.name for col in connection.introspection.get_table_description(cursor, TABLE)}
            if "embed_url" in columns:
                pass  # already the current schema
            elif "canonical_url" in columns:
                cursor.execute(f'SELECT COUNT(*) FROM "{TABLE}"')
                rows = cursor.fetchone()[0]
                if rows:
                    raise RuntimeError(
                        f"{TABLE} uses the old video schema and has {rows} rows; refusing to drop it. "
                        "Export or move those rows first.")
                schema_editor.execute(f'DROP TABLE "{TABLE}"')
                schema_editor.create_model(video_model)
            else:
                raise RuntimeError(f"{TABLE} has an unrecognized schema: {sorted(columns)}")

    # Forget the removed migration so the history matches the files on disk.
    MigrationRecorder(connection).migration_qs.filter(
        app="restaurants", name="0004_restaurant_video").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("restaurants", "0004_restaurant_videos"),
    ]

    operations = [
        migrations.RunPython(rebuild_video_table, migrations.RunPython.noop),
    ]
