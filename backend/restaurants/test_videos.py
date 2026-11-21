import csv
import json
import tempfile
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from .management.commands.collect_videos import name_hint_from
from .models import Restaurant, RestaurantVideo
from .tests import restaurant_data
from .video_matching import RestaurantIndex, choose_with_llm, normalize
from .videos import extract_urls, parse_video_url

TIKTOK = "https://www.tiktok.com/@bostonfoodie/video/7301234567890123456?is_from_webapp=1"


class VideoUrlTests(TestCase):
    def test_parse_supported_platforms(self):
        tiktok = parse_video_url(TIKTOK)
        self.assertEqual((tiktok.platform, tiktok.embed_id), ("tiktok", "7301234567890123456"))
        self.assertEqual(tiktok.url, "https://www.tiktok.com/@bostonfoodie/video/7301234567890123456")
        self.assertEqual(tiktok.embed_url, "https://www.tiktok.com/player/v1/7301234567890123456")
        for url in ("https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=abc",
                    "https://instagram.com/reels/C1a2B3c4D5e/"):
            reel = parse_video_url(url)
            self.assertEqual((reel.platform, reel.embed_id), ("instagram", "C1a2B3c4D5e"))
            self.assertEqual(reel.embed_url, "https://www.instagram.com/reel/C1a2B3c4D5e/embed")
        for url in ("https://youtube.com/shorts/dQw4w9WgXcQ?si=x", "https://youtu.be/dQw4w9WgXcQ",
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"):
            short = parse_video_url(url)
            self.assertEqual((short.platform, short.embed_id), ("youtube", "dQw4w9WgXcQ"))
        for url in ("https://www.tiktok.com/@bostonfoodie", "https://example.com/video/1", "not a url"):
            self.assertIsNone(parse_video_url(url))

    def test_extract_urls_and_hint(self):
        text = f"{TIKTOK}, Neptune Oyster!  <@123456>"
        urls = extract_urls(text)
        self.assertEqual(urls, [TIKTOK])
        self.assertEqual(name_hint_from(text, urls), "Neptune Oyster!")
        self.assertEqual(name_hint_from(f"Neptune Oyster - {TIKTOK}", [TIKTOK]), "Neptune Oyster")
        self.assertEqual(name_hint_from(f"[3:45 PM]sam: {TIKTOK} Neptune Oyster", [TIKTOK]), "Neptune Oyster")


class MatchingTests(TestCase):
    def setUp(self):
        self.neptune = Restaurant.objects.create(**restaurant_data(dbaname="Neptune Oyster",
                                                                   businessname="Neptune Oyster LLC"))
        self.regina = Restaurant.objects.create(**restaurant_data(dbaname="Pizzeria Regina",
                                                                  businessname="Regina Pizzeria Inc"))
        self.regina2 = Restaurant.objects.create(**restaurant_data(dbaname="Pizzeria Regina",
                                                                   businessname="Regina Pizzeria Inc",
                                                                   address="1 Faneuil Hall"))
        self.index = RestaurantIndex()

    def test_normalize(self):
        self.assertEqual(normalize("Neptune Oyster, LLC."), "neptune oyster")
        self.assertEqual(normalize("Joe's Bar & Grill"), "joes and")

    def test_shortlist_and_exact(self):
        candidates = self.index.shortlist("neptune oysters")
        self.assertEqual(candidates[0].restaurant, self.neptune)
        self.assertEqual(self.index.exact_unique("Neptune Oyster", self.index.shortlist("Neptune Oyster")).restaurant,
                         self.neptune)
        # Two branches share the name, so an exact match is ambiguous.
        self.assertIsNone(self.index.exact_unique("Pizzeria Regina", self.index.shortlist("Pizzeria Regina")))
        self.assertEqual(self.index.shortlist("zzzz qqqq"), [])

    def test_caption_shortlist(self):
        candidates = self.index.shortlist("Best lobster roll in Boston at Neptune Oyster 🦞 #foodtok",
                                          from_caption=True)
        self.assertEqual(candidates[0].restaurant, self.neptune)

    def test_choose_with_llm(self):
        candidates = self.index.shortlist("regina pizza")

        def fake_client(payload, refusal=None):
            message = SimpleNamespace(content=json.dumps(payload) if payload is not None else None, refusal=refusal)
            response = SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")])
            calls = []
            create = lambda **kwargs: calls.append(kwargs) or response
            return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), calls

        client, calls = fake_client({"candidate_number": 2, "confidence": "low", "reason": "chain"})
        with patch.dict("os.environ", {"OPENAI_MODEL": "test-model"}):
            chosen, confidence, reason = choose_with_llm(client, name_hint="regina pizza", caption="",
                                                         author="", platform="tiktok", candidates=candidates)
        self.assertEqual(chosen, candidates[1])
        self.assertEqual((confidence, reason), ("low", "chain"))
        request = calls[0]
        self.assertEqual(request["model"], "test-model")
        self.assertEqual(request["response_format"]["type"], "json_schema")
        self.assertTrue(request["response_format"]["json_schema"]["strict"])
        self.assertIn("regina pizza", request["messages"][1]["content"])

        client, _ = fake_client({"candidate_number": 0, "confidence": "high", "reason": "none"})
        self.assertIsNone(choose_with_llm(client, name_hint="x", caption="", author="", platform="tiktok",
                                          candidates=candidates)[0])
        client, _ = fake_client(None, refusal="I can't help with that")
        self.assertEqual(choose_with_llm(client, name_hint="x", caption="", author="", platform="tiktok",
                                         candidates=candidates)[:2], (None, "low"))


class VideoApiTests(TestCase):
    def test_restaurant_api_includes_videos(self):
        restaurant = Restaurant.objects.create(**restaurant_data())
        Restaurant.objects.create(**restaurant_data(dbaname="No Video"))
        video = parse_video_url(TIKTOK)
        RestaurantVideo.objects.create(restaurant=restaurant, platform=video.platform, url=video.url,
                                       embed_id=video.embed_id, embed_url=video.embed_url,
                                       thumbnail_url="https://p16.tiktokcdn.com/thumb.jpg", author="bostonfoodie")
        with self.assertNumQueries(2):  # restaurants + prefetched videos
            rows = APIClient().get('/api/restaurants/').json()
        self.assertEqual(rows[0]['creator_video_url'], video.url)
        self.assertEqual(rows[0]['image_url'], "https://p16.tiktokcdn.com/thumb.jpg")
        self.assertEqual(rows[0]['videos'][0]['embed_url'], video.embed_url)
        self.assertEqual((rows[1]['creator_video_url'], rows[1]['videos']), ("", []))


class CommandTests(TestCase):
    def setUp(self):
        self.neptune = Restaurant.objects.create(**restaurant_data(dbaname="Neptune Oyster"))
        self.tmp = Path(tempfile.mkdtemp())

    def fake_metadata(self, url):
        video = parse_video_url(url)
        if video:
            video.caption, video.author = "so good", "creator"
        return video

    def test_collect_then_import(self):
        submissions = self.tmp / "links.txt"
        submissions.write_text(f"{TIKTOK} Neptune Oyster\n{TIKTOK} duplicate\nhttps://example.com/x Somewhere\n"
                               "https://youtu.be/dQw4w9WgXcQ totally unknown place qqq\n")
        output = self.tmp / "matches.csv"
        with patch("restaurants.management.commands.collect_videos.fetch_video_metadata", self.fake_metadata):
            call_command("collect_videos", input=str(submissions), output=str(output), no_llm=True,
                         stdout=StringIO())
        rows = list(csv.DictReader(output.open()))
        self.assertEqual(len(rows), 3)  # duplicate TikTok dropped
        tiktok, unsupported, youtube = rows
        self.assertEqual((tiktok["restaurant_id"], tiktok["confidence"], tiktok["approve"]),
                         (str(self.neptune.id), "high", "yes"))
        self.assertEqual(unsupported["platform"], "")
        self.assertEqual((youtube["restaurant_id"], youtube["approve"]), ("", ""))

        call_command("import_videos", str(output), dry_run=True, stdout=StringIO())
        self.assertFalse(RestaurantVideo.objects.exists())
        out = StringIO()
        call_command("import_videos", str(output), stdout=out, stderr=StringIO())
        self.assertIn("Imported 1 new", out.getvalue())
        saved = RestaurantVideo.objects.get()
        self.assertEqual((saved.restaurant_id, saved.platform, saved.author), (self.neptune.id, "tiktok", "creator"))
        call_command("import_videos", str(output), stdout=out, stderr=StringIO())  # idempotent
        self.assertEqual(RestaurantVideo.objects.count(), 1)

    def test_import_rejects_bad_rows(self):
        path = self.tmp / "bad.csv"
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["approve", "url", "restaurant_id"])
            writer.writeheader()
            writer.writerows([{"approve": "yes", "url": TIKTOK, "restaurant_id": "999999"},
                              {"approve": "yes", "url": "https://example.com", "restaurant_id": self.neptune.id}])
        err = StringIO()
        call_command("import_videos", str(path), stdout=StringIO(), stderr=err)
        self.assertIn("unknown restaurant_id", err.getvalue())
        self.assertIn("unsupported video link", err.getvalue())
        self.assertFalse(RestaurantVideo.objects.exists())

    def test_pasted_discord_chat(self):
        # Copied from the Discord desktop app: cozy mode (header lines), compact
        # mode (timestamp + name on the same line), and an embed that repeats the link.
        chat = self.tmp / "chat.txt"
        chat.write_text(
            "frank — Today at 3:41 PM\n"
            f"{TIKTOK} Neptune Oyster\n"
            "TikTok\n"
            f"{TIKTOK}\n"
            "[3:45 PM]sam: https://youtube.com/shorts/dQw4w9WgXcQ Neptune Oyster\n"
        )
        output = self.tmp / "chat.csv"
        with patch("restaurants.management.commands.collect_videos.fetch_video_metadata", self.fake_metadata):
            call_command("collect_videos", input=str(chat), output=str(output), no_llm=True, stdout=StringIO())
        rows = list(csv.DictReader(output.open()))
        self.assertEqual([(r["platform"], r["name_hint"], r["restaurant_id"]) for r in rows],
                         [("tiktok", "Neptune Oyster", str(self.neptune.id)),
                          ("youtube", "Neptune Oyster", str(self.neptune.id))])

    def test_sheet_csv_input(self):
        sheet = self.tmp / "sheet.csv"
        sheet.write_text(f"Video link,Restaurant,Added by\n{TIKTOK},Neptune Oyster,frank\n")
        output = self.tmp / "out.csv"
        with patch("restaurants.management.commands.collect_videos.fetch_video_metadata", self.fake_metadata):
            call_command("collect_videos", input=str(sheet), output=str(output), no_llm=True, stdout=StringIO())
        row = next(csv.DictReader(output.open()))
        self.assertEqual((row["restaurant_id"], row["added_by"], row["name_hint"]),
                         (str(self.neptune.id), "frank", "Neptune Oyster"))
