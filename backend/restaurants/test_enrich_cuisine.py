import csv
import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from . import cuisine_enrichment as ce
from .models import Restaurant
from .tests import restaurant_data


class ClassifierTests(SimpleTestCase):
    def test_keywords(self):
        cases = {"Regina Pizzeria": "pizza", "Dunkin' #4421": "donut;coffee_shop", "Anna's Taqueria": "mexican",
                 "Growl Growl Hot Pot": "chinese", "Nebo Ristorante/Enoteca": "italian",
                 "Wicked Lobsta": "seafood", "Golden Crust Bakery": "bakery", "Libertine": None}
        for name, tag in cases.items():
            hit = ce.classify_keyword([name])
            self.assertEqual(hit and hit[0], tag, name)

    def test_institutions(self):
        self.assertEqual(ce.classify_institution(["Sodexo at British Airways BOS"])[0], "concessions")
        self.assertEqual(ce.classify_institution(["FISHER COLLEGE"])[0], "cafeteria")
        self.assertIsNone(ce.classify_institution(["Libertine"]))

    def test_name_similarity(self):
        self.assertGreaterEqual(ce.name_similarity("BON ME RESTAURANT", "Bon Me"), 0.8)
        self.assertLess(ce.name_similarity("Broken Rice", "Nan Xiang Express"), 0.5)

    def test_places_types(self):
        self.assertEqual(ce.places_type_to_tag(["restaurant", "italian_restaurant"]), "italian")
        self.assertEqual(ce.places_type_to_tag(["hamburger_restaurant"]), "burger")
        self.assertIsNone(ce.places_type_to_tag(["restaurant", "food"]))


class CommandTests(TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cache = self.tmp / "osm.json"
        self.cache.write_text(json.dumps({"elements": [
            {"type": "node", "lat": 42.3601, "lon": -71.0590, "tags": {"name": "Mela", "cuisine": "indian"}},
        ]}))
        self.pizza = Restaurant.objects.create(**restaurant_data(dbaname="Joe's Pizza", cuisine=None))
        self.mela = Restaurant.objects.create(**restaurant_data(businessname="Mela Inc", dbaname="MELA RESTAURANT", cuisine=""))
        self.unknown = Restaurant.objects.create(**restaurant_data(businessname="Libertine LLC", dbaname="Libertine", cuisine=None))
        self.existing = Restaurant.objects.create(**restaurant_data(dbaname="Pizza Place", cuisine="greek"))

    def run_command(self, *args):
        call_command("enrich_cuisine", "--osm-cache", str(self.cache), "--report",
                     str(self.tmp / "report.csv"), *args, stdout=StringIO())

    def test_dry_run_writes_nothing_but_reports(self):
        self.run_command()
        self.assertIsNone(Restaurant.objects.get(pk=self.pizza.pk).cuisine)
        with (self.tmp / "report.csv").open() as handle:
            rows = {int(r["id"]): r for r in csv.DictReader(handle)}
        self.assertEqual(rows[self.pizza.pk]["cuisine"], "pizza")
        self.assertEqual(rows[self.mela.pk]["source"], "osm")
        self.assertEqual(rows[self.unknown.pk]["cuisine"], "")
        self.assertNotIn(self.existing.pk, rows)

    def test_apply_fills_blanks_only(self):
        self.run_command("--apply")
        self.assertEqual(Restaurant.objects.get(pk=self.pizza.pk).cuisine, "pizza")
        self.assertEqual(Restaurant.objects.get(pk=self.mela.pk).cuisine, "indian")
        self.assertIsNone(Restaurant.objects.get(pk=self.unknown.pk).cuisine)
        self.assertEqual(Restaurant.objects.get(pk=self.existing.pk).cuisine, "greek")

    def test_apply_reviewed_report(self):
        self.run_command()
        report = self.tmp / "report.csv"
        rows = list(csv.DictReader(report.open()))
        for row in rows:  # reviewer fixes one row, blanks another, and tries to overwrite an existing one
            if int(row["id"]) == self.pizza.pk:
                row["cuisine"] = ""
            if int(row["id"]) == self.unknown.pk:
                row["cuisine"] = "french"
        rows.append({"id": self.existing.pk, "cuisine": "pizza"})
        with report.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        call_command("enrich_cuisine", "--from-report", str(report), "--apply", stdout=StringIO())
        self.assertIsNone(Restaurant.objects.get(pk=self.pizza.pk).cuisine)
        self.assertEqual(Restaurant.objects.get(pk=self.unknown.pk).cuisine, "french")
        self.assertEqual(Restaurant.objects.get(pk=self.existing.pk).cuisine, "greek")


class RegressionTests(SimpleTestCase):
    def test_spot_check_false_positives(self):
        self.assertIsNone(ce.classify_institution(["Love Health"]))
        self.assertIsNone(ce.classify_institution(["HARRISON CAFE @ BOS. W & S"]))
        self.assertLess(ce.name_similarity("GAME ON FENWAY PARK", "Fenway Cafe"), 0.8)
        self.assertGreaterEqual(ce.name_similarity("Pavement", "Pavement Coffeehouse"), 0.8)
        self.assertEqual(ce.classify_keyword(["Pollo Centro"])[0], "chicken")
        self.assertEqual(ce.classify_keyword(["THE HUB PUB"])[0], "bar")
