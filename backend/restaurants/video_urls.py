"""Parse allowlisted public video URLs without fetching pages or following redirects."""
import re
from urllib.parse import parse_qs, urlsplit

from django.core.exceptions import ValidationError


def canonicalize_video_url(platform, url):
    error = ValidationError("Enter a supported HTTPS video URL matching the selected platform.")
    if not isinstance(url, str) or any(char.isspace() or ord(char) < 32 for char in url):
        raise error
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
                or parsed.port is not None or not parsed.hostname):
            raise error
        host = parsed.hostname.lower()
        path = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)
    except ValueError:
        raise error from None

    if platform == "youtube":
        video_id = None
        if host == "youtu.be":
            match = re.fullmatch(r"/([A-Za-z0-9_-]{11})/?", path)
            video_id = match[1] if match else None
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if path == "/watch" and len(query.get("v", [])) == 1:
                video_id = query["v"][0]
            else:
                match = re.fullmatch(r"/(?:shorts|embed)/([A-Za-z0-9_-]{11})/?", path)
                video_id = match[1] if match else None
        if video_id and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            return f"https://www.youtube.com/watch?v={video_id}", video_id
    elif platform == "tiktok" and host in {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}:
        match = re.fullmatch(r"/@([A-Za-z0-9_.]{1,24})/video/([0-9]{10,25})/?", path)
        if match:
            handle, video_id = match.groups()
            return f"https://www.tiktok.com/@{handle}/video/{video_id}", video_id
    elif platform == "instagram" and host in {"instagram.com", "www.instagram.com", "m.instagram.com"}:
        match = re.fullmatch(r"/reel/([A-Za-z0-9_-]{1,100})/?", path)
        if match:
            video_id = match[1]
            return f"https://www.instagram.com/reel/{video_id}/", video_id
    raise error
