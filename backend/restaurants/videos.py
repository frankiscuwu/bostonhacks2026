"""Parse TikTok / Instagram / YouTube links into embeddable videos.

``parse_video_url`` is pure (no network). ``fetch_video_metadata`` resolves
short links and pulls title/author/thumbnail from public oEmbed endpoints
(TikTok and YouTube need no key; Instagram oEmbed needs a Meta token, so
Instagram videos come back without metadata).
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

USER_AGENT = "Mozilla/5.0 (compatible; restaurant-video-importer/1.0)"
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

_TIKTOK_VIDEO = re.compile(r"tiktok\.com/@[^/]+/(?:video|photo)/(\d+)", re.IGNORECASE)
_TIKTOK_SHORT = re.compile(r"(?:vm|vt)\.tiktok\.com/|tiktok\.com/t/", re.IGNORECASE)
_INSTAGRAM = re.compile(r"instagram\.com/(?:[^/]+/)?(reels?|p|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE)
_YOUTUBE = re.compile(
    r"(?:youtube\.com/(?:shorts/|watch\?(?:.*&)?v=|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})",
    re.IGNORECASE,
)


@dataclass
class ParsedVideo:
    platform: str
    embed_id: str
    url: str
    embed_url: str
    thumbnail_url: str = ""
    author: str = ""
    caption: str = ""
    extra: dict = field(default_factory=dict)


def extract_urls(text):
    """URLs in free text, trailing punctuation trimmed, order kept, no duplicates."""
    seen, urls = set(), []
    for match in URL_PATTERN.findall(text or ""):
        url = match.rstrip(").,!?>]")
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def is_short_link(url):
    return bool(_TIKTOK_SHORT.search(url))


def parse_video_url(url):
    """Return a ParsedVideo for a supported post URL, or None."""
    if match := _TIKTOK_VIDEO.search(url):
        video_id = match.group(1)
        user = re.search(r"tiktok\.com/(@[^/]+)/", url, re.IGNORECASE).group(1)
        return ParsedVideo("tiktok", video_id, f"https://www.tiktok.com/{user}/video/{video_id}",
                           f"https://www.tiktok.com/player/v1/{video_id}")
    if match := _INSTAGRAM.search(url):
        kind = "reel" if match.group(1).lower().startswith("reel") else match.group(1).lower()
        code = match.group(2)
        canonical = f"https://www.instagram.com/{kind}/{code}/"
        return ParsedVideo("instagram", code, canonical, f"{canonical}embed")
    if match := _YOUTUBE.search(url):
        video_id = match.group(1)
        return ParsedVideo("youtube", video_id, f"https://www.youtube.com/shorts/{video_id}",
                           f"https://www.youtube.com/embed/{video_id}",
                           thumbnail_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
    return None


def _get(url, timeout=10):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.geturl(), response.read()


def resolve_short_link(url):
    """Follow redirects for vm.tiktok.com / tiktok.com/t/ links."""
    try:
        final_url, _ = _get(url)
        return final_url
    except (urllib.error.URLError, TimeoutError, ValueError):
        return url


def _oembed(endpoint, url):
    try:
        _, body = _get(f"{endpoint}?{urllib.parse.urlencode({'url': url, 'format': 'json'})}")
        return json.loads(body)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return {}


def fetch_video_metadata(url):
    """Parse a link (resolving short links) and fill in oEmbed metadata. None if unsupported."""
    if is_short_link(url):
        url = resolve_short_link(url)
    video = parse_video_url(url)
    if video is None:
        return None
    if video.platform == "tiktok":
        data = _oembed("https://www.tiktok.com/oembed", video.url)
        video.caption = data.get("title", "")
        video.author = data.get("author_name", "")
        video.thumbnail_url = data.get("thumbnail_url", "")
    elif video.platform == "youtube":
        data = _oembed("https://www.youtube.com/oembed", video.url)
        video.caption = data.get("title", "")
        video.author = data.get("author_name", "")
        video.thumbnail_url = data.get("thumbnail_url") or video.thumbnail_url
    return video
