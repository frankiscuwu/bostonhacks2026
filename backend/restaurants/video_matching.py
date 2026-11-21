"""Match a submitted video ("<url> <restaurant name>") to a row in ``restaurants``.

1. ``shortlist``: fuzzy-match the name hint (or the video caption) against
   every active restaurant's dbaname/businessname - standard library only.
2. ``choose_with_llm``: an OpenAI model picks one candidate (or none) using the
   hint, caption and addresses, returning structured JSON with a confidence level.

An exact, unambiguous name match skips the model call entirely.
"""
import difflib
import json
import os
import re
from dataclasses import dataclass

from .models import Restaurant

# Override with the OPENAI_MODEL environment variable.
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

_SUFFIXES = re.compile(
    r"\b(llc|l\.l\.c|inc|corp|corporation|co|company|ltd|the|restaurant|restaurants|"
    r"cafe|café|bar|grill|kitchen|dba)\b"
)
_STOPWORDS = {
    "boston", "best", "food", "eat", "eats", "foodie", "foodtok", "try", "trying", "must", "spot",
    "spots", "in", "at", "the", "a", "an", "and", "of", "to", "for", "this", "is", "my", "with",
    "ma", "new", "england", "fyp", "viral", "review", "restaurant", "restaurants",
}


def normalize(name):
    name = (name or "").lower().replace("&", " and ").replace("'", "").replace("’", "")
    name = re.sub(r"[^a-z0-9 ]+", " ", name)
    name = _SUFFIXES.sub(" ", name)
    return re.sub(r"\s+", " ", name).strip()


def _tokens(text):
    return {t for t in normalize(text).split() if len(t) > 1 and t not in _STOPWORDS}


@dataclass
class Candidate:
    restaurant: Restaurant
    score: float

    def describe(self):
        r = self.restaurant
        names = r.dbaname or r.businessname or ""
        if r.dbaname and r.businessname and r.dbaname != r.businessname:
            names = f"{r.dbaname} (legal name: {r.businessname})"
        return f"{names} — {r.full_address or 'no address'} — cuisine: {r.cuisine or 'unknown'}"


class RestaurantIndex:
    """Active restaurants with pre-normalized names, loaded once per run."""

    def __init__(self, restaurants=None):
        self.rows = []
        for r in restaurants if restaurants is not None else Restaurant.objects.active().order_by("id"):
            names = {normalize(n) for n in (r.dbaname, r.businessname) if n}
            names.discard("")
            if names:
                self.rows.append((r, names, set().union(*(set(n.split()) for n in names))))

    def shortlist(self, query, limit=10, from_caption=False):
        """Best fuzzy matches for a restaurant name (or, if from_caption, free text)."""
        query_norm = normalize(query)
        query_tokens = _tokens(query)
        if not query_norm or not query_tokens:
            return []
        scored = []
        for restaurant, names, name_tokens in self.rows:
            overlap = len(query_tokens & name_tokens)
            if from_caption:
                # Captions are long: rank by how much of the *name* appears in the text.
                meaningful = {t for t in name_tokens if t not in _STOPWORDS and len(t) > 1}
                if not meaningful or not overlap:
                    continue
                score = len(query_tokens & meaningful) / len(meaningful)
            else:
                ratio = max(difflib.SequenceMatcher(None, query_norm, n).ratio() for n in names)
                # Needs a shared word or a strong overall resemblance (typos like "neptun oyster").
                if not overlap and ratio < 0.6:
                    continue
                contains = any(query_norm in n or n in query_norm for n in names)
                jaccard = overlap / len(query_tokens | name_tokens) if name_tokens else 0
                score = max(ratio, jaccard) + (0.15 if contains else 0) + (0.5 if query_norm in names else 0)
            if score >= 0.35:
                scored.append(Candidate(restaurant, round(score, 3)))
        scored.sort(key=lambda c: (-c.score, c.restaurant.id))
        return scored[:limit]

    @staticmethod
    def exact_unique(query, candidates):
        """The single candidate whose name equals the query, if exactly one does."""
        query_norm = normalize(query)
        exact = [c for c in candidates
                 if query_norm in {normalize(c.restaurant.dbaname), normalize(c.restaurant.businessname)}]
        return exact[0] if len(exact) == 1 else None


_SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_number": {
            "type": "integer",
            "description": "1-based number of the matching candidate, or 0 if none of them match.",
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason": {"type": "string", "description": "One short sentence explaining the choice."},
    },
    "required": ["candidate_number", "confidence", "reason"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You match short food videos (TikTok, Instagram Reels, YouTube Shorts) to restaurants in a "
    "database of Boston food-service licenses. License names can differ from the public name: "
    "legal entity names, 'LLC' suffixes, or several branches of the same chain. Pick the candidate "
    "the video is about. Use the submitter's name hint first, then the caption and creator. "
    "If the hint and a candidate clearly refer to the same business, that is a match even when the "
    "wording differs. If it is a chain with several branches and nothing indicates which one, pick "
    "the most likely branch and use confidence 'low'. If no candidate fits, answer 0."
)


def choose_with_llm(client, *, name_hint, caption, author, platform, candidates):
    """Ask the model which candidate the video is about. Returns (candidate|None, confidence, reason).

    ``client`` is an ``openai.OpenAI`` instance. Rate-limit errors propagate so the
    caller can wait and retry; other API errors become a low-confidence non-match.
    """
    import openai

    listing = "\n".join(f"{i}. {c.describe()}" for i, c in enumerate(candidates, start=1))
    prompt = (
        f"Submitter's name hint: {name_hint or '(none given)'}\n"
        f"Platform: {platform}\n"
        f"Creator: {author or 'unknown'}\n"
        f"Video caption: {caption or '(unavailable)'}\n\n"
        f"Candidates:\n{listing}"
    )
    try:
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "restaurant_match", "strict": True, "schema": _SCHEMA},
            },
        )
    except openai.RateLimitError:
        raise
    except openai.APIStatusError as error:
        return None, "low", f"OpenAI API error {error.status_code}: {error.message}"
    except openai.APIConnectionError:
        return None, "low", "Could not reach the OpenAI API"

    message = response.choices[0].message
    if getattr(message, "refusal", None):
        return None, "low", "The model declined to answer"
    try:
        data = json.loads(message.content or "")
    except json.JSONDecodeError:
        return None, "low", f"Unparseable model output (finish_reason={response.choices[0].finish_reason})"
    number = data.get("candidate_number", 0)
    chosen = candidates[number - 1] if isinstance(number, int) and 1 <= number <= len(candidates) else None
    return chosen, data.get("confidence", "low"), data.get("reason", "")
