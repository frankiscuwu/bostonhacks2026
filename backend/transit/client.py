"""Bounded, cached JSON:API access to the official MBTA V3 service."""
import gzip
import hashlib
import json
import logging
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

from django.core.cache import caches
from django.utils.connection import ConnectionProxy

cache = ConnectionProxy(caches, "transit")

BASE = "https://api-v3.mbta.com"
ROUTES = ("Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E")
ENDPOINTS = {"routes", "stops", "route_patterns", "shapes", "predictions", "schedules", "alerts"}
logger = logging.getLogger(__name__)


class _MBTARedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        if parsed.scheme != "https" or parsed.netloc != "api-v3.mbta.com":
            raise MBTAUnavailable("invalid_mbta_response")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def urlopen(request, timeout):
    return build_opener(_MBTARedirects()).open(request, timeout=timeout)


class MBTAUnavailable(Exception):
    """Safe public error code; never propagate provider bodies or API keys."""

    def __init__(self, code="mbta_unavailable"):
        self.code = code
        super().__init__(code)


class MBTAClient:
    def __init__(self):
        self.api_key = os.environ.get("MBTA_API_KEY", "")
        self.timeout = min(15, max(1, float(os.environ.get("MBTA_TIMEOUT_SECONDS", "8"))))
        self.scope = hashlib.sha256(self.api_key.encode()).hexdigest()[:12]
        self.deadline = time.monotonic() + 22

    def _read(self, url):
        # Pagination never follows arbitrary hosts or insecure redirects.
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "api-v3.mbta.com":
            raise MBTAUnavailable("invalid_mbta_response")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise MBTAUnavailable("mbta_timeout")
        if cache.get(f"mbta:cooldown:{self.scope}"):
            raise MBTAUnavailable("mbta_rate_limited")
        budget = f"mbta:budget:{self.scope}:{int(time.time() // 60)}"
        cache.add(budget, 0, 65)
        try:
            count = cache.incr(budget)
        except ValueError:
            raise MBTAUnavailable("mbta_rate_limited") from None
        if count > (120 if self.api_key else 16):
            raise MBTAUnavailable("mbta_rate_limited")
        headers = {"Accept": "application/vnd.api+json", "Accept-Encoding": "gzip", "User-Agent": "ReelHungry-transit/1.0"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        try:
            with urlopen(Request(url, headers=headers), timeout=min(self.timeout, remaining)) as response:
                if urlsplit(response.geturl()).netloc != "api-v3.mbta.com":
                    raise MBTAUnavailable("invalid_mbta_response")
                body = response.read(4_000_001)
                if len(body) > 4_000_000:
                    raise MBTAUnavailable("invalid_mbta_response")
                if response.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                if len(body) > 8_000_000:
                    raise MBTAUnavailable("invalid_mbta_response")
                document = json.loads(body)
        except HTTPError as error:
            # Log only endpoint/status, never credentials, headers or response bodies.
            logger.warning("MBTA request failed: endpoint=%s status=%s", parsed.path, error.code)
            if error.code == 429:
                cache.set(f"mbta:cooldown:{self.scope}", True, 60)
                raise MBTAUnavailable("mbta_rate_limited") from None
            if error.code in (401, 403):
                raise MBTAUnavailable("mbta_authorization_failed") from None
            raise MBTAUnavailable() from None
        except (URLError, TimeoutError, OSError, ValueError, EOFError):
            raise MBTAUnavailable() from None
        if not isinstance(document, dict) or not isinstance(document.get("data"), list):
            raise MBTAUnavailable("invalid_mbta_response")
        return document

    def get(self, endpoint, params=None, ttl=60):
        if endpoint not in ENDPOINTS:
            raise ValueError("Unsupported MBTA endpoint")
        params = {**(params or {}), "page[limit]": 100}
        url = BASE + "/" + endpoint + "?" + urlencode(sorted(params.items()))
        key = "mbta:response:" + self.scope + ":" + hashlib.sha256(url.encode()).hexdigest()
        cached = cache.get(key)
        if cached is not None:
            return cached
        data, included, seen = [], {}, set()
        for _ in range(8):
            if url in seen:
                raise MBTAUnavailable("invalid_mbta_response")
            seen.add(url)
            document = self._read(url)
            data.extend(document["data"])
            for item in document.get("included", []):
                included[(item["type"], item["id"])] = item
            next_page = document.get("links", {}).get("next")
            if not next_page:
                result = {"data": data, "included": list(included.values())}
                cache.set(key, result, ttl)
                return result
            url = urljoin(BASE, next_page)
        raise MBTAUnavailable("mbta_response_too_large")
