import re
from typing import Optional
import pandas as pd
import requests
from rapidfuzz import fuzz
from pathlib import Path
import json
import time
import math

BASE_DIR = Path(__file__).resolve().parent
LICENSE_CSV_PATH = BASE_DIR / "boston_active_food_licenses.csv"
OUTPUT_CSV_PATH = BASE_DIR / "matched_boston_food_establishments.csv"

# Update these column names to match your licensure CSV
LICENSE_ID_COL = "_id"      # Primary key / unique ID in your licensure DB
LICENSE_NAME_COL = "businessname"  # Establishment name column
# Street address column (or combine street + city/zip)
LICENSE_ADDR_COL = "address"

# Greater Boston bounding box: (south, west, north, east)
BOSTON_BBOX = (42.2279, -71.1912, 42.3969, -70.9850)
CACHE_PATH = BASE_DIR / "boston_osm_food_pois_cache.json"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "BostonFoodLicenseLinker/1.0"

# Minimum name similarity score (0-100) to accept a match at the same normalized address
MIN_NAME_SCORE = 75


def _query_overpass_with_retries(query: str, max_retries_per_endpoint: int = 2) -> dict:
    """Try Overpass mirrors with exponential backoff on transient HTTP/network errors."""
    last_error: Exception | None = None

    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, max_retries_per_endpoint + 1):
            try:
                resp = requests.post(
                    endpoint,
                    data={"data": query},
                    headers={"User-Agent": USER_AGENT},
                    timeout=90,
                )
                if resp.status_code in (429, 502, 503, 504):
                    raise requests.HTTPError(
                        f"{resp.status_code} from {endpoint}", response=resp
                    )
                resp.raise_for_status()
                return resp.json()
            except requests.RequestException as exc:
                last_error = exc
                sleep_s = 2 ** attempt
                print(
                    f"Overpass attempt {attempt}/{max_retries_per_endpoint} failed on "
                    f"{endpoint} ({exc}). Retrying in {sleep_s}s..."
                )
                time.sleep(sleep_s)

    raise RuntimeError(
        f"All Overpass endpoints failed. Last error: {last_error}")


def fetch_boston_osm_food_pois(
    bbox: tuple[float, float, float, float],
    use_cache: bool = False,
) -> list[dict]:
    """Query Overpass API (with local JSON cache & mirror fallback) for Boston food POIs."""
    pois: list[dict] = []

    if use_cache and CACHE_PATH.exists():
        try:
            data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    else:
        s, w, n, e = bbox
        query = f"""
        [out:json][timeout:45];
        (
          node["amenity"~"restaurant|cafe|fast_food|bar|pub|ice_cream|bakery"]({s},{w},{n},{e});
          way["amenity"~"restaurant|cafe|fast_food|bar|pub|ice_cream|bakery"]({s},{w},{n},{e});
        );
        out center tags;
        """
        try:
            data = _query_overpass_with_retries(query)
            if isinstance(data, dict):
                CACHE_PATH.write_text(json.dumps(data), encoding="utf-8")
        except Exception as exc:
            print(f"Warning: Overpass fetch failed ({exc}). Returning 0 POIs.")
            return pois

    if not isinstance(data, dict):
        return pois

    elements = data.get("elements") or []
    for el in elements:
        if not isinstance(el, dict):
            continue
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue

        housenumber = str(tags.get("addr:housenumber") or "").strip()
        street = str(tags.get("addr:street") or "").strip()
        city = str(tags.get("addr:city") or "Boston").strip()
        postcode = str(tags.get("addr:postcode") or "").strip()

        street_part = f"{housenumber} {street}".strip()
        full_address = ", ".join(p for p in [street_part, city, postcode] if p)

        pois.append({
            "osm_id": el.get("id"),
            "name": name,
            "address": full_address,
            "norm_addr": normalize_address(street_part),
            "norm_name": normalize_name(name),
            "cuisine": str(tags.get("cuisine") or "").strip(),
            "opening_hours": str(tags.get("opening_hours") or "").strip(),
        })

    return pois


def normalize_name(name: str) -> str:
    """Normalize restaurant names for fuzzy matching."""
    s = str(name).lower()
    s = re.sub(
        r"\b(llc|inc|corp|co|ltd|the|restaurant|cafe|coffee|bar|grill|kitchen)\b", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_address(addr: str) -> str:
    """Normalize street addresses to improve exact/blocked address matching."""
    s = str(addr).lower()
    # Strip suite/unit/floor suffixes so "100 Main St Suite 200" -> "100 main st"
    s = re.sub(r"\b(ste|suite|unit|apt|fl|floor|#)\s*[a-z0-9\-]+\b", " ", s)
    replacements = {
        r"\bstreet\b": "st",
        r"\bavenue\b": "ave",
        r"\bboulevard\b": "blvd",
        r"\broad\b": "rd",
        r"\bparkway\b": "pkwy",
        r"\bplace\b": "pl",
        r"\bsquare\b": "sq",
        r"\bnorth\b": "n",
        r"\bsouth\b": "s",
        r"\beast\b": "e",
        r"\bwest\b": "w",
    }
    for pattern, repl in replacements.items():
        s = re.sub(pattern, repl, s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def extract_open_close_times(opening_hours: str) -> tuple[Optional[str], Optional[str]]:
    """
    Extract earliest open time and latest close time (HH:MM) from an OSM opening_hours string.
    Handles common formats like 'Mo-Su 07:00-22:00' or '08:00-14:00, 17:00-23:00'.
    """
    if not opening_hours:
        return None, None
    if opening_hours.strip() == "24/7":
        return "00:00", "23:59"

    # Match 24h times like 8:00, 08:00, or 22:30
    time_pairs = re.findall(
        r"\b(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\b", opening_hours)
    if not time_pairs:
        return None, None

    def to_minutes(t: str) -> int:
        h, m = map(int, t.split(":"))
        return h * 60 + m

    def pad_hhmm(t: str) -> str:
        h, m = map(int, t.split(":"))
        return f"{h:02d}:{m:02d}"

    opens = [pad_hhmm(pair[0]) for pair in time_pairs]
    closes = [pad_hhmm(pair[1]) for pair in time_pairs]

    earliest_open = min(opens, key=to_minutes)
    latest_close = max(closes, key=to_minutes)
    return earliest_open, latest_close


def _clean_str(val: object) -> str:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return ""
    s = str(val).strip()
    return "" if s.lower() in ("nan", "none", "<na>") else s


def _safe_float(val: object) -> Optional[float]:
    s = _clean_str(val)
    if not s:
        return None
    try:
        num = float(s)
        return None if math.isnan(num) or math.isinf(num) else num
    except ValueError:
        return None


def _dist_meters(
    lat1: Optional[float],
    lon1: Optional[float],
    lat2: Optional[float],
    lon2: Optional[float],
) -> Optional[float]:
    if None in (lat1, lon1, lat2, lon2):
        return None
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * \
        math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def match_licenses_to_pois(
    licenses_df: pd.DataFrame,
    pois: list[dict] | None,
    min_addr_score: float = 65.0,
    min_fallback_score: float = 82.0,
    max_meters: float = 120.0,
) -> pd.DataFrame:
    """Match licensure rows to OSM POIs by normalized address + name, with geo/name fallback."""
    pois = pois or []
    pois_by_addr: dict[str, list[dict]] = {}
    for poi in pois:
        n_addr = _clean_str(poi.get("norm_addr"))
        if n_addr:
            pois_by_addr.setdefault(n_addr, []).append(poi)

    rows: list[dict] = []
    matched_total = 0
    cuisine_total = 0

    for _, lic in licenses_df.iterrows():
        lic_id = _clean_str(lic.get(LICENSE_ID_COL))
        dba = _clean_str(lic.get("dbaname"))
        biz = _clean_str(lic.get("businessname"))
        lic_name = dba or biz
        lic_addr = _clean_str(lic.get(LICENSE_ADDR_COL))

        lic_lat = _safe_float(lic.get("latitude"))
        lic_lon = _safe_float(lic.get("longitude"))

        norm_addr = normalize_address(lic_addr)
        norm_name = normalize_name(lic_name)

        best_poi: Optional[dict] = None
        best_score = 0.0

        # Pass 1: Same normalized street address
        for poi in pois_by_addr.get(norm_addr, []):
            score = float(fuzz.token_set_ratio(
                norm_name, _clean_str(poi.get("norm_name"))))
            if score > best_score:
                best_score = score
                best_poi = poi

        accepted = best_poi is not None and best_score >= min_addr_score

        # Pass 2: Coordinate proximity + strong name match fallback
        if not accepted and norm_name:
            best_poi = None
            best_score = 0.0
            for poi in pois:
                score = float(fuzz.token_set_ratio(
                    norm_name, _clean_str(poi.get("norm_name"))))
                p_lat = _safe_float(poi.get("lat"))
                p_lon = _safe_float(poi.get("lon"))
                dist = _dist_meters(lic_lat, lic_lon, p_lat, p_lon)
                if score >= min_fallback_score and (dist is None or dist <= max_meters):
                    if score > best_score:
                        best_score = score
                        best_poi = poi
            accepted = best_poi is not None

        if accepted and best_poi is not None:
            matched_total += 1
            cuisine_val = _clean_str(best_poi.get("cuisine")) or None
            if cuisine_val:
                cuisine_total += 1
            open_time, close_time = extract_open_close_times(
                _clean_str(best_poi.get("opening_hours")))
            rows.append({
                "id": lic_id,
                "name": lic_name,
                "address": lic_addr,
                "cuisine": cuisine_val,
                "open_time": open_time,
                "close_time": close_time,
            })
        else:
            rows.append({
                "id": lic_id,
                "name": lic_name,
                "address": lic_addr,
                "cuisine": None,
                "open_time": None,
                "close_time": None,
            })

    print(
        f"Matched {matched_total}/{len(licenses_df)} licenses ({cuisine_total} with cuisine)")
    return pd.DataFrame(rows, columns=["id", "name", "address", "cuisine", "open_time", "close_time"])


def main() -> None:
    licenses_df = pd.read_csv(LICENSE_CSV_PATH, dtype={LICENSE_ID_COL: str})
    pois = fetch_boston_osm_food_pois(BOSTON_BBOX)
    result_df = match_licenses_to_pois(licenses_df, pois)

    print(result_df.head(15).to_string(index=False))
    result_df.to_csv(OUTPUT_CSV_PATH, index=False)
    print(f"\nSaved {len(result_df)} rows to {OUTPUT_CSV_PATH}")

    print("License columns:", list(licenses_df.columns))

    print("Total OSM POIs fetched:", len(pois))
    print("OSM POIs with cuisine:", sum(1 for p in pois if p.get("cuisine")))
    print("OSM POIs with opening_hours:", sum(
        1 for p in pois if p.get("opening_hours")))


if __name__ == "__main__":
    main()
