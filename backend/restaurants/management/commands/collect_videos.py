"""Collect submitted video links and match each one to a restaurant.

Sources (pick one):
  --discord-channel <id>   read messages with a bot token (DISCORD_BOT_TOKEN env var)
  --input <file>           .csv (e.g. a Google Sheet export) or .txt (one submission per line)

Each submission is a link plus, ideally, the restaurant name:
  https://www.tiktok.com/@foodie/video/123  Neptune Oyster

Writes a review CSV. Check it (fix restaurant_id where needed, set approve=yes),
then load it with `manage.py import_videos <csv>`. Nothing is written to the
database by this command.
"""
import csv
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from restaurants.video_matching import RestaurantIndex, choose_with_llm
from restaurants.videos import extract_urls, fetch_video_metadata

DISCORD_API = "https://discord.com/api/v10"
OUTPUT_FIELDS = [
    "approve", "url", "platform", "restaurant_id", "restaurant_name", "restaurant_address",
    "confidence", "method", "reason", "name_hint", "caption", "author", "added_by",
    "alternatives", "embed_id", "embed_url", "thumbnail_url", "source_text",
]


def _clean_hint(text):
    text = re.sub(r"<[@#!&]?\d+>", " ", text)  # Discord mentions
    return re.sub(r"^[\s\-–—:|,>]+|[\s\-–—:|,]+$", "", re.sub(r"\s+", " ", text)).strip()


def name_hint_from(text, urls):
    """The restaurant name in a "<link> <name>" submission.

    Prefers the text after the last link, so prefixes from a pasted chat log
    ("[3:45 PM] frank: <link> Neptune Oyster") are ignored. Falls back to the
    text before the first link for "<name> <link>" submissions.
    """
    if not urls:
        return _clean_hint(text)
    positions = [(text.find(url), url) for url in urls if url in text]
    if not positions:
        return _clean_hint(text)
    first_start = min(p for p, _ in positions)
    last_start, last_url = max(positions)
    after = _clean_hint(text[last_start + len(last_url):])
    return after or _clean_hint(text[:first_start])


def read_discord(channel_id, limit):
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise CommandError("Set DISCORD_BOT_TOKEN to read a Discord channel.")
    submissions, before = [], None
    while len(submissions) < limit:
        url = f"{DISCORD_API}/channels/{channel_id}/messages?limit=100" + (f"&before={before}" if before else "")
        request = urllib.request.Request(url, headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (https://github.com, 1.0) restaurant-video-importer",
        })
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                page = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise CommandError(f"Discord API returned {error.code}: {error.read().decode()[:300]}") from error
        if not page:
            break
        for message in page:
            text = " ".join([message.get("content", "")] +
                            [embed.get("url", "") for embed in message.get("embeds", []) if embed.get("url")])
            submissions.append({"text": text, "added_by": message.get("author", {}).get("username", "")})
        before = page[-1]["id"]
    if submissions and not any(s["text"].strip() for s in submissions):
        raise CommandError("Messages came back empty. Enable the MESSAGE CONTENT intent for the bot "
                           "in the Discord developer portal (Bot → Privileged Gateway Intents).")
    return list(reversed(submissions[:limit]))  # oldest first


def read_file(path):
    path = Path(path)
    if not path.exists():
        raise CommandError(f"No such file: {path}")
    if path.suffix.lower() != ".csv":
        return [{"text": line, "added_by": ""} for line in path.read_text().splitlines() if line.strip()]
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        return []
    header = [h.strip().lower() for h in rows[0]]
    has_header = not any(extract_urls(cell) for cell in rows[0])
    if not has_header:
        return [{"text": " ".join(row), "added_by": ""} for row in rows]

    def column(*keywords):
        return next((i for i, h in enumerate(header) if any(k in h for k in keywords)), None)

    url_col, name_col = column("url", "link", "video"), column("restaurant", "name", "place", "spot")
    by_col = column("added", "by", "submitted", "who")
    submissions = []
    for row in rows[1:]:
        cell = lambda i: row[i].strip() if i is not None and i < len(row) else ""
        text = f"{cell(url_col)} {cell(name_col)}" if url_col is not None else " ".join(row)
        if text.strip():
            submissions.append({"text": text, "added_by": cell(by_col)})
    return submissions


class Command(BaseCommand):
    help = "Match submitted TikTok/Instagram/YouTube links to restaurants and write a review CSV."

    def add_arguments(self, parser):
        source = parser.add_mutually_exclusive_group(required=True)
        source.add_argument("--discord-channel", help="Discord channel id to read (needs DISCORD_BOT_TOKEN).")
        source.add_argument("--input", help="CSV or TXT file of submissions.")
        parser.add_argument("--output", default="video_matches.csv", help="Review CSV to write.")
        parser.add_argument("--limit", type=int, default=1000, help="Max Discord messages to read.")
        parser.add_argument("--no-llm", action="store_true", help="Fuzzy matching only, no OpenAI calls.")

    def handle(self, *args, **options):
        submissions = (read_discord(options["discord_channel"], options["limit"]) if options["discord_channel"]
                       else read_file(options["input"]))
        self.stdout.write(f"Read {len(submissions)} submissions.")

        client = None
        if not options["no_llm"]:
            try:
                import openai
            except ImportError as error:
                raise CommandError("pip install openai, or pass --no-llm") from error
            if not os.environ.get("OPENAI_API_KEY"):
                raise CommandError("Set OPENAI_API_KEY, or pass --no-llm for fuzzy matching only.")
            client = openai.OpenAI()

        index = RestaurantIndex()
        self.stdout.write(f"Loaded {len(index.rows)} active restaurants.")
        rows, seen = [], set()
        for submission in submissions:
            urls = extract_urls(submission["text"])
            hint = name_hint_from(submission["text"], urls)
            for url in urls:
                row = self.match_one(url, hint, submission, index, client, seen)
                if row:
                    rows.append(row)
                    self.stdout.write(f"  [{row['confidence'] or '-':6}] {row['restaurant_name'] or '(no match)':40.40} ← {url}")

        output = Path(options["output"])
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        approved = sum(1 for r in rows if r["approve"] == "yes")
        self.stdout.write(self.style.SUCCESS(
            f"Wrote {len(rows)} rows to {output} ({approved} pre-approved as high confidence). "
            f"Review it, then run: python manage.py import_videos {output}"))

    def match_one(self, url, hint, submission, index, client, seen):
        video = fetch_video_metadata(url)
        row = dict.fromkeys(OUTPUT_FIELDS, "")
        row.update(url=url, name_hint=hint, added_by=submission["added_by"],
                   source_text=submission["text"][:300])
        if video is None:
            row.update(reason="Not a TikTok/Instagram/YouTube video link")
            return row
        key = (video.platform, video.embed_id)
        if key in seen:
            return None  # duplicate submission
        seen.add(key)
        row.update(url=video.url, platform=video.platform, caption=video.caption, author=video.author,
                   embed_id=video.embed_id, embed_url=video.embed_url, thumbnail_url=video.thumbnail_url)

        candidates = (index.shortlist(hint) if hint
                      else index.shortlist(video.caption, from_caption=True))
        if not candidates:
            row.update(confidence="", method="none",
                       reason="No restaurant name matched" + ("" if hint else " (no name given)"))
            return row

        chosen, confidence, reason, method = None, "", "", ""
        exact = index.exact_unique(hint, candidates) if hint else None
        if exact:
            chosen, confidence, reason, method = exact, "high", "Exact name match", "exact"
        elif client is not None:
            chosen, confidence, reason = self.ask_llm(client, hint, video, candidates)
            method = "llm"
        else:
            chosen = candidates[0]
            confidence = "medium" if chosen.score >= 0.8 else "low"
            reason, method = f"Best fuzzy match (score {chosen.score})", "fuzzy"

        alternatives = [c for c in candidates if c is not chosen][:3]
        row.update(confidence=confidence, method=method, reason=reason,
                   alternatives=" | ".join(f"{c.restaurant.id}: {c.restaurant.name} ({c.restaurant.full_address})"
                                           for c in alternatives))
        if chosen:
            row.update(restaurant_id=chosen.restaurant.id, restaurant_name=chosen.restaurant.name,
                       restaurant_address=chosen.restaurant.full_address,
                       approve="yes" if confidence == "high" else "")
        return row

    def ask_llm(self, client, hint, video, candidates):
        import openai
        for attempt in range(3):
            try:
                return choose_with_llm(client, name_hint=hint, caption=video.caption, author=video.author,
                                       platform=video.platform, candidates=candidates)
            except openai.RateLimitError as error:
                wait = int(float(error.response.headers.get("retry-after", "20")))
                self.stderr.write(f"Rate limited; waiting {wait}s")
                time.sleep(wait)
        return None, "low", "Rate limited by the OpenAI API"
