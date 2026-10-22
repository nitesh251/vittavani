import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from rapidfuzz import fuzz


class Intent(StrEnum):
    LOCATION = "product_location"
    STOCK = "stock_quantity"
    LOW_STOCK = "low_stock_report"
    PRODUCT_SEARCH = "product_search"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Query:
    original: str
    normalized: str
    entity_query: str
    intent: Intent


@dataclass(frozen=True)
class Candidate:
    product_id: UUID
    name: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Resolution:
    product: Candidate | None
    candidates: tuple[Candidate, ...] = ()
    ambiguous: bool = False
    confidence: float = 0.0


_LOW_STOCK_PHRASES = (
    "show low stock items",
    "low stock",
    "कम स्टॉक",
    "कम सामान",
    "कम बचा",
)
_LOCATION_PHRASES = (
    "where is",
    "where are",
    "where can i find",
    "kahan rakha hai",
    "kahan rakha",
    "kahan hai",
    "kahan milega",
    "kahan milegi",
    "kidhar hai",
    "kidhar milega",
    "kidhar milegi",
    "कहाँ रखा है",
    "कहाँ रखा",
    "कहाँ है",
    "कहाँ मिलेगा",
    "कहाँ मिलेगी",
    "किधर है",
    "वेयर इज़",
    "वेयर इस",
)
_STOCK_PHRASES = (
    "how much",
    "how many",
    "how much is left",
    "how much is available",
    "kitna stock",
    "kitna bacha hai",
    "kitna hai",
    "stock batao",
    "kitni bachi",
    "कितना स्टॉक",
    "कितना बचा है",
    "कितनी बची",
    "कितना है",
)
_SEARCH_PHRASES = ("search for", "find", "show me", "dikhao", "दिखाओ", "खोजो")
_ALL_PHRASES = tuple(
    sorted(set(_LOW_STOCK_PHRASES + _LOCATION_PHRASES + _STOCK_PHRASES + _SEARCH_PHRASES), key=len, reverse=True)
)


def normalize_text(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).casefold()
    value = "".join(
        char if char.isalnum() or char.isspace() or unicodedata.category(char).startswith("M") else " "
        for char in value
    )
    return re.sub(r"\s+", " ", value).strip()


def understand_query(text: str) -> Query:
    original = text
    normalized = normalize_text(text)
    if not normalized:
        return Query(original=original, normalized="", entity_query="", intent=Intent.UNKNOWN)
    if any(normalize_text(phrase) in normalized for phrase in _LOW_STOCK_PHRASES):
        return Query(original=original, normalized=normalized, entity_query="", intent=Intent.LOW_STOCK)

    intent = Intent.PRODUCT_SEARCH
    if any(normalize_text(phrase) in normalized for phrase in _LOCATION_PHRASES):
        intent = Intent.LOCATION
    elif any(normalize_text(phrase) in normalized for phrase in _STOCK_PHRASES):
        intent = Intent.STOCK
    elif any(normalize_text(phrase) in normalized for phrase in _SEARCH_PHRASES):
        intent = Intent.PRODUCT_SEARCH

    entity = normalized
    for phrase in _ALL_PHRASES:
        entity = re.sub(rf"(?<!\w){re.escape(normalize_text(phrase))}(?!\w)", " ", entity)
    entity = re.sub(r"\s+", " ", entity).strip()
    return Query(original=original, normalized=normalized, entity_query=entity, intent=intent)


def resolve_product(query: str, products: list[Candidate]) -> Resolution:
    normalized_query = normalize_text(query)
    if not normalized_query:
        return Resolution(product=None)

    entries = [
        (candidate, normalize_text(name))
        for candidate in products
        for name in (candidate.name, *candidate.aliases)
        if normalize_text(name)
    ]
    exact = {candidate.product_id: candidate for candidate, name in entries if name == normalized_query}
    if len(exact) == 1:
        return Resolution(product=next(iter(exact.values())), confidence=1.0)
    if len(exact) > 1:
        return Resolution(product=None, candidates=tuple(exact.values()), ambiguous=True, confidence=1.0)

    scores: dict[UUID, tuple[Candidate, float]] = {}
    for candidate, name in entries:
        score = max(
            fuzz.ratio(normalized_query, name),
            fuzz.token_set_ratio(normalized_query, name),
        ) / 100
        current = scores.get(candidate.product_id)
        if current is None or score > current[1]:
            scores[candidate.product_id] = (candidate, score)

    ranked = sorted(scores.values(), key=lambda item: item[1], reverse=True)
    if not ranked or ranked[0][1] < 0.72:
        return Resolution(product=None)
    if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < 0.08:
        return Resolution(
            product=None,
            candidates=tuple(candidate for candidate, _ in ranked if ranked[0][1] - _ < 0.08),
            ambiguous=True,
            confidence=ranked[0][1],
        )
    return Resolution(product=ranked[0][0], confidence=ranked[0][1])
