import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.config import settings


class AIProviderError(Exception):
    pass


def ai_is_configured() -> bool:
    return (
        settings.ai_provider.casefold() == "groq"
        and bool(settings.ai_model.strip())
        and bool(settings.groq_api_key.strip())
    )


def extract_product_query(question: str) -> dict[str, str | None]:
    if not ai_is_configured():
        raise AIProviderError("AI Assistant is not configured.")

    request_body = {
        "model": settings.ai_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Interpret a small-business inventory question. Return only a JSON object with "
                    "intent (one of stock, location, low_stock, unknown) and product_query "
                    "(the product name or null). Never answer with quantities, locations, SQL, or "
                    "other facts. Use low_stock when the user asks for low stock."
                ),
            },
            {"role": "user", "content": question},
        ],
    }
    request = Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + settings.groq_api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=max(1, min(settings.ai_timeout_seconds, 30))) as response:
            payload = json.loads(response.read(32_768))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise AIProviderError("AI Assistant is temporarily unavailable. Try Normal Search.") from exc
    try:
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise AIProviderError("AI Assistant returned an invalid response. Try Normal Search.") from exc

    intent = parsed.get("intent")
    product_query = parsed.get("product_query")
    if intent not in {"stock", "location", "low_stock", "unknown"}:
        raise AIProviderError("AI Assistant returned an unsupported intent. Try Normal Search.")
    if product_query is not None and (
        not isinstance(product_query, str)
        or not product_query.strip()
        or len(product_query) > 180
        or any(ord(char) < 32 for char in product_query)
    ):
        raise AIProviderError("AI Assistant returned an invalid product query. Try Normal Search.")
    return {
        "intent": intent,
        "product_query": product_query.strip() if product_query else None,
    }
