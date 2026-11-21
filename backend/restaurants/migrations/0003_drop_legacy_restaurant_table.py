"""Drop the unused legacy ``restaurants_restaurant`` table.

Restaurants now come from the shared ``restaurants`` table (see 0002). This runs
after rooms.0002, which removes the room/vote FK constraints that referenced the
legacy table. No CASCADE: if anything still depends on it, the drop fails instead
of silently removing dependents.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("restaurants", "0002_use_shared_restaurants_table"),
        ("rooms", "0002_alter_room_current_restaurant_alter_vote_restaurant"),
    ]

    operations = [
        migrations.RunSQL(
            'DROP TABLE IF EXISTS "restaurants_restaurant"',
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
