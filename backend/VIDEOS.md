# Restaurant videos

TikTok / YouTube Shorts links are stored in `restaurants_restaurantvideo`
(Django-managed; the shared `restaurants` table is not changed) and returned in
`GET /api/restaurants/` as `videos`, plus `creator_video_url` / `image_url` from the first one.

## 1. Collect links (the 30-minute session)

Post one submission per message (Discord channel) or per row (Google Sheet):

```
https://www.tiktok.com/@someone/video/7301234567890123456  Neptune Oyster
```

- Always add the **restaurant name** after the link. Matching from the caption alone is unreliable.
- Use the link to the **video itself**, not a profile page.
- Only restaurants in **Boston proper** are in the database (not Cambridge, Somerville, Brookline).
- A "top 10 spots" video: post the same link once per restaurant, with each name.
- Short links (`vm.tiktok.com/...`, `youtu.be/...`) are fine.

For a Google Sheet, use columns like `Video link`, `Restaurant`, `Added by`, then File → Download → CSV.

## 2. Match links to restaurants

Run from `backend/` with `DATABASE_URL` pointing at the database to read restaurants from.
This step only reads the database.

```sh
# From a Google Sheet export (or a .txt file with one submission per line)
python manage.py collect_videos --input videos.csv --output video_matches.csv

# From a Discord channel
DISCORD_BOT_TOKEN=... python manage.py collect_videos --discord-channel 123456789012345678
```

Names that match exactly are accepted directly. Everything else goes to an OpenAI model
(`gpt-4o-mini` by default; set `OPENAI_MODEL` to change it), which picks from the closest license
names using the name, caption, and addresses. That needs `OPENAI_API_KEY`. It's one short request
per unclear link. Add `--no-llm` to use fuzzy matching only.

**Discord bot setup (one time):** in the [developer portal](https://discord.com/developers/applications),
create an application → Bot → Reset Token (this is `DISCORD_BOT_TOKEN`) → turn on **Message Content
Intent**. Then OAuth2 → URL Generator → scope `bot`, permissions *View Channels* + *Read Message
History* → open the URL to add the bot to your server. Get the channel id with Discord Developer Mode
→ right-click the channel → Copy Channel ID. The bot only reads history; it doesn't need to stay online.

## 3. Review the CSV

Open `video_matches.csv` in a spreadsheet:

- `approve` is pre-filled `yes` for high-confidence matches. Set `yes` on others you've checked.
- Wrong match: replace `restaurant_id` with one from `alternatives` (or look it up in Django admin).
- Leave `approve` empty to skip a row.

## 4. Import

```sh
python manage.py migrate                       # once, creates restaurants_restaurantvideo
python manage.py import_videos video_matches.csv --dry-run
python manage.py import_videos video_matches.csv
```

Re-running is safe; existing videos are updated, not duplicated. Videos can also be edited or
removed in Django admin under *Restaurant videos*.

TikTok thumbnail links from oEmbed are signed CDN URLs that can expire after a while. The frontend
falls back to a placeholder image, and re-running `collect_videos` + `import_videos` refreshes them.
