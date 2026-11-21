"""Infer a cuisine tag for restaurants whose ``cuisine`` is blank.

Every source returns an OSM-style tag (``"italian"``, ``"coffee_shop"``) so
``matching.cuisine_label`` and the frontend's ``formatCuisine`` display it the
same way as the OSM values already in the table. Sources, cheapest first:

1. ``keyword``     – the name says it ("Pizzeria", "Taqueria", "Dunkin'").
2. ``osm``         – a nearby OpenStreetMap POI with a matching name (cached JSON).
3. ``institution`` – dining services, schools, hospitals, venue concessions.
4. ``places``      – Google Places Text Search (needs GOOGLE_PLACES_API_KEY).
5. ``llm``         – OpenAI guess from name + address; only medium/high confidence.

See the ``enrich_cuisine`` management command.
"""
import json
import math
import os
import re
import urllib.error
import urllib.request
from difflib import SequenceMatcher

# Tags the LLM may choose from (all already used by OSM rows in the table).
VOCABULARY = [
    "american", "asian", "bagel", "bakery", "bar", "barbecue", "breakfast", "bubble_tea", "burger",
    "cafeteria", "caribbean", "chicken", "chinese", "coffee_shop", "colombian", "concessions",
    "dessert", "diner", "donut", "ethiopian", "french", "greek", "ice_cream", "indian", "irish",
    "italian", "japanese", "juice", "korean", "latin_american", "mediterranean", "mexican",
    "middle_eastern", "pizza", "ramen", "salad", "salvadoran", "sandwich", "seafood", "spanish",
    "steak_house", "sushi", "thai", "vegetarian", "vietnamese",
]

# Order matters: the first match wins, so specific patterns come before broad ones.
KEYWORD_RULES = [
    (r"dunkin", "donut;coffee_shop"),
    (r"starbucks|peet'?s|blue bottle|caffe nero|coffee|espresso|\broast(ers|ery)\b", "coffee_shop"),
    (r"kung fu tea|gong cha|\bboba\b|bubble tea|tiger sugar|\bcoco\b|chatime|yi fang|tapioca", "bubble_tea"),
    (r"j\.?\s?p\.? licks|gelato|ice cream|creamery|froyo|frozen yogurt", "ice_cream"),
    (r"donut|doughnut", "donut"),
    (r"bagel", "bagel"),
    (r"bakery|bake shop|bakeshop|patisserie|boulangerie|\btatte\b|pastry|cannoli", "bakery"),
    (r"juice|smoothie|acai|açaí|pressed", "juice"),
    (r"pizz|domino'?s|papa john|\bcalzone", "pizza"),
    (r"sushi|omakase", "sushi"),
    (r"ramen", "ramen"),
    (r"\bpho\b|banh mi|viet|bon me|saigon", "vietnamese"),
    (r"\bthai\b|siam|bangkok", "thai"),
    (r"taqueria|\btacos?\b|burrito|cantina|mexic|chipotle|boloco|taco bell|el pelon", "mexican"),
    (r"hot ?pot|dumpling|szechuan|sichuan|chinese|\bchina\b|\bwok\b|dim sum|hunan|mandarin|panda express", "chinese"),
    (r"korea|bibimbap|bulgogi|\bbbq chicken\b|bonchon", "korean"),
    (r"japan|izakaya|teriyaki|tokyo|\budon\b|yakitori", "japanese"),
    (r"india|tandoor|masala|curry|biryani|punjab", "indian"),
    (r"ristorante|trattoria|osteria|enoteca|\bpasta|italian|italia\b|cucina", "italian"),
    (r"\bgreek|gyro|souvlaki", "greek"),
    (r"shawarma|falafel|kebab|kabob|halal|lebanese|persian", "middle_eastern"),
    (r"mediterr|\bcava\b", "mediterranean"),
    (r"seafood|lobst|oyster|\bfish|clam|chowder|crab|\bpoke\b", "seafood"),
    (r"steak|chophouse", "steak_house"),
    (r"\bbbq\b|barbecue|bar-b-q|smokehouse", "barbecue"),
    (r"burger|five guys|shake shack|wendy'?s|mcdonald|wahlburgers", "burger"),
    (r"chicken|wings|\bpollo\b|popeyes|\bkfc\b|chick-fil|\bhen\b", "chicken"),
    (r"subway|sandwich|\bsubs?\b|\bdeli\b|panini|jersey mike|potbelly|panera|au bon pain|cosi\b", "sandwich"),
    (r"salad|sweetgreen|chopt", "salad"),
    (r"\bdiner\b", "diner"),
    (r"breakfast|brunch|pancake|waffle", "breakfast"),
    (r"caribbean|caribe[nñ]o|jamaican?\b(?!\s*plain)|haiti|\broti\b|jerk", "caribbean"),
    (r"pupus|salvador", "salvadoran"),
    (r"colombia", "colombian"),
    (r"empanada|arepa|latin|cuban|venezuel|peru|brazil", "latin_american"),
    (r"ethiopia|eritrea", "ethiopian"),
    (r"brasserie|\bfrench|creperie|crepe", "french"),
    (r"tapas|spanish|paella", "spanish"),
    (r"\birish\b", "irish"),
    (r"vegan|vegetarian", "vegetarian"),
    (r"\basian?\b|noodle", "asian"),
    (r"\bpub\b|tavern|taproom|brew(ery|ing|house)|saloon|beer hall|wine bar", "bar"),
]
KEYWORD_RULES = [(re.compile(pattern, re.IGNORECASE), tag) for pattern, tag in KEYWORD_RULES]

INSTITUTION_RULES = [
    (re.compile(r"pavilion|td garden|fenway park|stadium|arena|\bconcession|logan airport|\bbos\b(?!\.)|"
                r"terminal [a-e]\b|convention center|\bbcec\b|hynes", re.IGNORECASE), "concessions"),
    (re.compile(r"sodexo|eurest|aramark|bon app[eé]tit|compass group|flik|restaurant associates|"
                r"college|university|school|academy|hospital|medical center|\bdining (hall|services)\b|"
                r"cafeteria", re.IGNORECASE), "cafeteria"),
]

# OSM amenity -> tag when a matched POI has no cuisine tag.
OSM_AMENITY_TAGS = {"cafe": "coffee_shop", "ice_cream": "ice_cream", "pub": "bar", "bar": "bar"}

_STOPWORDS = {"the", "inc", "llc", "corp", "co", "ltd", "restaurant", "cafe", "bar", "grill",
              "kitchen", "boston", "and", "of", "at", "dba", "s"}


def restaurant_names(restaurant):
    return [n for n in (restaurant.dbaname, restaurant.businessname) if n and n.strip()]


def classify_keyword(names):
    for name in names:
        for pattern, tag in KEYWORD_RULES:
            match = pattern.search(name)
            if match:
                return tag, f"name contains {match.group(0)!r}"
    return None


def classify_institution(names):
    for name in names:
        for pattern, tag in INSTITUTION_RULES:
            match = pattern.search(name)
            if match:
                return tag, f"institutional name ({match.group(0)!r})"
    return None


def _tokens(text):
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", str(text).lower().replace("'", "")).split()
            if w not in _STOPWORDS]


def name_similarity(a, b):
    """0..1; strict enough that unrelated places sharing one word score low."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    ja, jb = " ".join(ta), " ".join(tb)
    if ja == jb:
        return 1.0
    overlap = len(set(ta) & set(tb)) / max(len(set(ta)), len(set(tb)))
    ratio = SequenceMatcher(None, ja, jb).ratio()
    # "Pavement" ~ "Pavement Coffeehouse", but not "Game On Fenway Park" ~ "Fenway".
    prefix = 0.9 if (len(ja) >= 4 and len(jb) >= 4 and (ja.startswith(jb) or jb.startswith(ja))) else 0.0
    return max(prefix, (overlap + ratio) / 2)


def distance_m(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 6371000 * 2 * math.asin(math.sqrt(min(1, a)))


class OsmIndex:
    def __init__(self, cache_path, max_distance_m=120, min_score=0.8):
        self.max_distance_m = max_distance_m
        self.min_score = min_score
        self.pois = []
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        for el in data.get("elements") or []:
            tags = el.get("tags") or {}
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            if tags.get("name") and lat is not None and lon is not None:
                self.pois.append((tags["name"], float(lat), float(lon),
                                  (tags.get("cuisine") or "").strip(), tags.get("amenity", "")))

    def classify(self, restaurant, names):
        if restaurant.latitude is None or restaurant.longitude is None:
            return None
        lat, lon = float(restaurant.latitude), float(restaurant.longitude)
        best = None
        for poi_name, plat, plon, cuisine, amenity in self.pois:
            if abs(plat - lat) > 0.002 or abs(plon - lon) > 0.003:  # cheap ~200m prefilter
                continue
            meters = distance_m(lat, lon, plat, plon)
            if meters > self.max_distance_m:
                continue
            score = max(name_similarity(n, poi_name) for n in names)
            if score >= self.min_score and (best is None or score > best[0]):
                best = (score, poi_name, cuisine, amenity, meters)
        if not best:
            return None
        score, poi_name, cuisine, amenity, meters = best
        tag = cuisine.lower().replace(" ", "_") or OSM_AMENITY_TAGS.get(amenity)
        if not tag:
            return None
        return tag, f"OSM {poi_name!r} {meters:.0f}m away, name score {score:.2f}"


# Google Places primaryType/types -> tag.
_PLACES_GENERIC = {"restaurant", "food", "point_of_interest", "establishment", "meal_takeaway",
                   "meal_delivery", "fast_food_restaurant", "store", "food_store", "grocery_store",
                   "convenience_store", "supermarket", "market", "catering_service", "food_court"}
_PLACES_SPECIAL = {"cafe": "coffee_shop", "coffee_shop": "coffee_shop", "hamburger_restaurant": "burger",
                   "ice_cream_shop": "ice_cream", "donut_shop": "donut", "bagel_shop": "bagel",
                   "juice_shop": "juice", "tea_house": "bubble_tea", "sandwich_shop": "sandwich",
                   "steak_house": "steak_house", "pub": "bar", "wine_bar": "bar", "bar": "bar",
                   "cafeteria": "cafeteria", "dessert_shop": "dessert", "confectionery": "dessert",
                   "chocolate_shop": "dessert", "acai_shop": "juice", "deli": "sandwich",
                   "bar_and_grill": "american", "diner": "diner", "bakery": "bakery"}


def places_type_to_tag(types):
    for t in types:
        if t in _PLACES_GENERIC:
            continue
        if t in _PLACES_SPECIAL:
            return _PLACES_SPECIAL[t]
        if t.endswith("_restaurant"):
            return t[: -len("_restaurant")]
    return None


class PlacesClient:
    URL = "https://places.googleapis.com/v1/places:searchText"

    def __init__(self, api_key, max_distance_m=200, min_score=0.7):
        self.api_key = api_key
        self.max_distance_m = max_distance_m
        self.min_score = min_score

    def classify(self, restaurant, names):
        if restaurant.latitude is None or restaurant.longitude is None:
            return None
        lat, lon = float(restaurant.latitude), float(restaurant.longitude)
        body = {
            "textQuery": f"{names[0]}, {restaurant.full_address}",
            "maxResultCount": 3,
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 300.0}},
        }
        request = urllib.request.Request(
            self.URL, data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": self.api_key,
                     "X-Goog-FieldMask": "places.displayName,places.primaryType,places.types,places.location"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                places = json.load(response).get("places") or []
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise  # bad key / API not enabled: stop the run instead of failing every row
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return None
        for place in places:
            loc = place.get("location") or {}
            if "latitude" not in loc:
                continue
            meters = distance_m(lat, lon, loc["latitude"], loc["longitude"])
            place_name = (place.get("displayName") or {}).get("text", "")
            score = max(name_similarity(n, place_name) for n in names)
            if meters > self.max_distance_m or score < self.min_score:
                continue
            tag = places_type_to_tag([place.get("primaryType") or ""] + (place.get("types") or []))
            if tag:
                return tag, f"Google Places {place_name!r} ({place.get('primaryType')}) {meters:.0f}m away"
        return None


_LLM_SYSTEM = (
    "You label Boston restaurants with a cuisine from a fixed list, using only the business name "
    "and address. Use your knowledge of well-known chains and local places. If the name does not "
    "make the cuisine reasonably clear, answer 'unknown' rather than guessing. Confidence 'high' "
    "means you know this place or the name states the cuisine; 'medium' means a strong hint."
)


def _llm_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["results"],
        "properties": {"results": {"type": "array", "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "cuisine", "confidence"],
            "properties": {
                "id": {"type": "integer"},
                "cuisine": {"type": "string", "enum": VOCABULARY + ["unknown"]},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            },
        }}},
    }


def classify_with_llm(client, restaurants, model):
    """Return {restaurant_id: (tag, detail)} for medium/high-confidence answers."""
    lines = [f"{r.id}: {' / '.join(restaurant_names(r)) or '(no name)'} — {r.full_address or 'no address'}"
             for r in restaurants]
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": _LLM_SYSTEM},
                  {"role": "user", "content": "Label each restaurant (id: name — address):\n" + "\n".join(lines)}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "cuisines", "strict": True, "schema": _llm_schema()}},
    )
    message = response.choices[0].message
    if getattr(message, "refusal", None) or not message.content:
        return {}
    try:
        results = json.loads(message.content)["results"]
    except (json.JSONDecodeError, KeyError):
        return {}
    wanted = {r.id for r in restaurants}
    found = {}
    for item in results:
        if (item.get("id") in wanted and item.get("cuisine") in VOCABULARY
                and item.get("confidence") in ("high", "medium")):
            found[item["id"]] = (item["cuisine"], f"{model} guess ({item['confidence']} confidence)")
    return found


def llm_model():
    return os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
