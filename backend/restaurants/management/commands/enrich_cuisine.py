"""Fill blank ``restaurants.cuisine`` values in the shared table.

Only rows whose cuisine is NULL/blank are touched; existing values are never
overwritten. Without --apply nothing is written: the command prints a summary and
saves a review CSV (id, name, address, cuisine, source, detail).

    manage.py enrich_cuisine                          # dry run -> enrich_cuisine_report.csv
    manage.py enrich_cuisine --llm                    # also ask OpenAI for leftovers
    manage.py enrich_cuisine --from-report r.csv --apply   # write a reviewed report as-is

Edit or blank the ``cuisine`` column of the report to fix/skip rows before applying it.
Google Places runs only when GOOGLE_PLACES_API_KEY is set.
"""
import csv
import os
import time
from collections import Counter
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from restaurants import cuisine_enrichment as ce
from restaurants.models import Restaurant

ALL_SOURCES = ["keyword", "osm", "institution", "places", "llm"]
DEFAULT_OSM_CACHE = settings.BASE_DIR.parent / "frontend/src/csv_data/boston_osm_food_pois_cache.json"
BLANK = Q(cuisine__isnull=True) | Q(cuisine__regex=r"^\s*$")
REPORT_FIELDS = ["id", "name", "address", "cuisine", "source", "detail"]


class Command(BaseCommand):
    help = "Infer cuisines for restaurants with a blank cuisine (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write cuisines to the restaurants table.")
        parser.add_argument("--llm", action="store_true", help="Use OpenAI for rows no other source labelled.")
        parser.add_argument("--sources", default="keyword,osm,institution,places",
                            help=f"Comma-separated, in order. Any of: {','.join(ALL_SOURCES)}.")
        parser.add_argument("--report", default="enrich_cuisine_report.csv", help="Where to write the review CSV.")
        parser.add_argument("--from-report", help="Skip inference and use this (reviewed) report instead.")
        parser.add_argument("--osm-cache", default=str(DEFAULT_OSM_CACHE))
        parser.add_argument("--active-only", action="store_true", help="Only rows matching Restaurant.active().")
        parser.add_argument("--limit", type=int, help="Process at most N rows (for testing).")
        parser.add_argument("--llm-batch", type=int, default=40)

    def handle(self, *args, **options):
        if options["from_report"]:
            results = self.read_report(Path(options["from_report"]))
        else:
            results = self.infer(options)
            self.write_report(Path(options["report"]), results)

        labelled = [r for r in results if r["cuisine"]]
        by_source = Counter(r["source"] for r in labelled)
        self.stdout.write(f"{len(labelled)}/{len(results)} blank rows labelled: "
                          + ", ".join(f"{s}={n}" for s, n in by_source.most_common()))
        self.stdout.write("Top cuisines: " + ", ".join(
            f"{c}={n}" for c, n in Counter(r["cuisine"] for r in labelled).most_common(12)))

        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"Dry run: nothing written. Review {options['from_report'] or options['report']}, "
                "then re-run with --from-report <file> --apply."))
            return

        written = 0
        with transaction.atomic():
            for row in labelled:
                # Re-check blankness at write time so a value set meanwhile is never clobbered.
                written += Restaurant.objects.filter(BLANK, pk=row["id"]).update(cuisine=row["cuisine"])
        self.stdout.write(self.style.SUCCESS(f"Wrote cuisine to {written} restaurants."))

    # -- inference ---------------------------------------------------------------------------

    def infer(self, options):
        sources = [s.strip() for s in options["sources"].split(",") if s.strip()]
        if options["llm"] and "llm" not in sources:
            sources.append("llm")
        unknown = set(sources) - set(ALL_SOURCES)
        if unknown:
            raise CommandError(f"Unknown sources: {', '.join(sorted(unknown))}")

        row_sources = []  # (name, callable(restaurant, names) -> (tag, detail) | None)
        for source in sources:
            if source == "keyword":
                row_sources.append((source, lambda r, n: ce.classify_keyword(n)))
            elif source == "institution":
                row_sources.append((source, lambda r, n: ce.classify_institution(n)))
            elif source == "osm":
                cache = Path(options["osm_cache"])
                if not cache.exists():
                    raise CommandError(f"OSM cache not found: {cache}")
                row_sources.append((source, ce.OsmIndex(cache).classify))
            elif source == "places":
                key = os.environ.get("GOOGLE_PLACES_API_KEY")
                if key:
                    row_sources.append((source, ce.PlacesClient(key).classify))
                else:
                    self.stdout.write("GOOGLE_PLACES_API_KEY not set: skipping Google Places.")

        queryset = (Restaurant.objects.active() if options["active_only"] else Restaurant.objects.all())
        restaurants = list(queryset.filter(BLANK).order_by("id"))
        if options["limit"]:
            restaurants = restaurants[: options["limit"]]
        self.stdout.write(f"{len(restaurants)} restaurants with a blank cuisine; sources: {', '.join(sources)}")

        results = {}
        leftovers = []
        for index, restaurant in enumerate(restaurants, start=1):
            names = ce.restaurant_names(restaurant)
            found = None
            if names:
                for source, classify in row_sources:
                    hit = classify(restaurant, names)
                    if hit:
                        found = (hit[0], source, hit[1])
                        break
            results[restaurant.id] = self.result_row(restaurant, *(found or ("", "", "")))
            if not found and names:
                leftovers.append(restaurant)
            if index % 250 == 0:
                self.stdout.write(f"  …{index}/{len(restaurants)}")

        if "llm" in sources and leftovers:
            self.run_llm(leftovers, results, options["llm_batch"])
        return list(results.values())

    def run_llm(self, leftovers, results, batch_size):
        try:
            import openai
        except ImportError:
            raise CommandError("The openai package is not installed (pip install -r requirements.txt).")
        if not os.environ.get("OPENAI_API_KEY"):
            raise CommandError("OPENAI_API_KEY is not set.")
        client = openai.OpenAI()
        model = ce.llm_model()
        self.stdout.write(f"Asking {model} about {len(leftovers)} leftover rows…")
        for start in range(0, len(leftovers), batch_size):
            batch = leftovers[start:start + batch_size]
            for attempt in range(5):
                try:
                    found = ce.classify_with_llm(client, batch, model)
                    break
                except openai.RateLimitError:
                    time.sleep(2 ** attempt * 5)
                except (openai.APIStatusError, openai.APIConnectionError) as error:
                    self.stderr.write(f"  OpenAI error on batch {start // batch_size + 1}: {error}")
                    found = {}
                    break
            else:
                found = {}
            for restaurant in batch:
                if restaurant.id in found:
                    tag, detail = found[restaurant.id]
                    results[restaurant.id] = self.result_row(restaurant, tag, "llm", detail)
            self.stdout.write(f"  …{min(start + batch_size, len(leftovers))}/{len(leftovers)}")

    @staticmethod
    def result_row(restaurant, cuisine, source, detail):
        return {"id": restaurant.id, "name": restaurant.name, "address": restaurant.full_address,
                "cuisine": cuisine, "source": source, "detail": detail}

    # -- report I/O --------------------------------------------------------------------------

    def write_report(self, path, results):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=REPORT_FIELDS)
            writer.writeheader()
            writer.writerows(results)
        self.stdout.write(f"Report written to {path.resolve()}")

    def read_report(self, path):
        if not path.exists():
            raise CommandError(f"No such file: {path}")
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        results = []
        for number, row in enumerate(rows, start=2):
            try:
                row["id"] = int(row["id"])
            except (KeyError, TypeError, ValueError):
                raise CommandError(f"{path} line {number}: bad id {row.get('id')!r}")
            row["cuisine"] = (row.get("cuisine") or "").strip()
            row["source"] = row.get("source") or "report"
            results.append(row)
        return results
