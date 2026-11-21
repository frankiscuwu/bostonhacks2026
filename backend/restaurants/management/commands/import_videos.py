"""Load an approved review CSV (from collect_videos) into restaurant_videos.

Rows are imported when `approve` is yes/y/true/1/x and `restaurant_id` is set.
Edit restaurant_id in the CSV to fix a wrong match (the `alternatives` column
lists the next-best candidates). Re-running is safe: existing videos are updated.
"""
import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from restaurants.models import Restaurant, RestaurantVideo
from restaurants.videos import parse_video_url

APPROVED = {"yes", "y", "true", "1", "x", "✅"}


class Command(BaseCommand):
    help = "Import approved rows from a collect_videos review CSV."

    def add_arguments(self, parser):
        parser.add_argument("csv_path")
        parser.add_argument("--dry-run", action="store_true", help="Validate and report without saving.")

    def handle(self, *args, **options):
        path = Path(options["csv_path"])
        if not path.exists():
            raise CommandError(f"No such file: {path}")
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))

        created = updated = skipped = 0
        with transaction.atomic():
            for number, row in enumerate(rows, start=2):  # header is line 1
                if (row.get("approve") or "").strip().lower() not in APPROVED:
                    skipped += 1
                    continue
                problem = self.import_row(row)
                if isinstance(problem, str):
                    self.stderr.write(f"Line {number}: {problem}")
                    skipped += 1
                elif problem:
                    created += 1
                else:
                    updated += 1
            if options["dry_run"]:
                transaction.set_rollback(True)

        verb = "Would import" if options["dry_run"] else "Imported"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {created} new and {updated} updated videos; skipped {skipped} rows."))

    def import_row(self, row):
        """True if created, False if updated, or an error message."""
        video = parse_video_url(row.get("url", ""))
        if video is None:
            return f"unsupported video link {row.get('url')!r}"
        try:
            restaurant = Restaurant.objects.get(id=int(row.get("restaurant_id", "")))
        except (ValueError, Restaurant.DoesNotExist):
            return f"unknown restaurant_id {row.get('restaurant_id')!r}"
        _, created = RestaurantVideo.objects.update_or_create(
            restaurant=restaurant, platform=video.platform, embed_id=video.embed_id,
            defaults={
                "url": video.url,
                "embed_url": video.embed_url,
                "thumbnail_url": (row.get("thumbnail_url") or video.thumbnail_url)[:2048],
                "author": (row.get("author") or "")[:200],
                "caption": row.get("caption") or "",
                "added_by": (row.get("added_by") or "")[:100],
            },
        )
        return created
