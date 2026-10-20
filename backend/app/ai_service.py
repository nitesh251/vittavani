import http.client
import json
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.config import settings
from app.query_understanding import Intent

_MAX_PROVIDER_RESPONSE_BYTES = 32_768
_MAX_PROVIDER_ERROR_BYTES = 4_096
_MAX_LOG_DETAIL_LENGTH = 512
_MAX_PROVIDER_TIMEOUT_SECONDS = 30
logger = logging.getLogger(__name__)

_BEARER_PATTERN = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")
_API_KEY_PATTERN = re.compile(r"(?i)\bgsk_[a-z0-9_-]+")
_NAMED_SECRET_PATTERN = re.compile(
    r"(?i)\b(api[_ -]?key|authorization|access[_ -]?token)\b\s*[:=]\s*[^\s,;]+"
)


class AIProviderError(Exception):
    pass


AI_INTENT_MAP = {
    "stock": Intent.STOCK,
    "location": Intent.LOCATION,
    "low_stock": Intent.LOW_STOCK,
    "unknown": Intent.UNKNOWN,
}


def _sanitize_provider_detail(detail: str) -> str:
    sanitized = detail
    if settings.groq_api_key:
        sanitized = sanitized.replace(settings.groq_api_key, "[REDACTED]")
    sanitized = _BEARER_PATTERN.sub("[REDACTED]", sanitized)
    sanitized = _API_KEY_PATTERN.sub("[REDACTED]", sanitized)
    sanitized = _NAMED_SECRET_PATTERN.sub(r"\1=[REDACTED]", sanitized)
    return " ".join(sanitized.split())[:_MAX_LOG_DETAIL_LENGTH]


def _provider_error_message(response_body: bytes) -> str:
    body = response_body[:_MAX_PROVIDER_ERROR_BYTES].decode("utf-8", errors="replace")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return _sanitize_provider_detail(body) or "Provider returned no diagnostic message"

    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        message = error.get("message") or error.get("code")
    elif isinstance(error, str):
        message = error
    elif isinstance(payload, dict):
        message = payload.get("message")
    else:
        message = None
    if not isinstance(message, str) or not message.strip():
        return "Provider returned no diagnostic message"
    return _sanitize_provider_detail(message)


def _log_provider_error(category: str, *, status: int | None = None, detail: str = "") -> None:
    safe_detail = _sanitize_provider_detail(detail) if detail else ""
    logger.warning(
        "Groq request failed category=%s status=%s provider_message=%s",
        category,
        status if status is not None else "n/a",
        safe_detail or "n/a",
    )


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
    configured_timeout = settings.ai_timeout_seconds
    timeout_seconds = max(1, min(configured_timeout, _MAX_PROVIDER_TIMEOUT_SECONDS))
    if configured_timeout != timeout_seconds:
        logger.warning(
            "AI_TIMEOUT_SECONDS=%s is outside the supported 1–%s second range; using %s seconds",
            configured_timeout,
            _MAX_PROVIDER_TIMEOUT_SECONDS,
            timeout_seconds,
        )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            response_body = response.read(_MAX_PROVIDER_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        try:
            error_body = exc.read(_MAX_PROVIDER_ERROR_BYTES)
        except (OSError, http.client.HTTPException):
            error_body = b""
        provider_message = _provider_error_message(error_body)
        status = exc.code
        if status in (401, 403):
            category = "authentication"
            user_message = "Groq rejected its API credentials. Check GROQ_API_KEY on the backend."
        elif status in (400, 404, 422):
            category = "model_or_request"
            user_message = (
                "Groq rejected the configured model or request. "
                "Check AI_MODEL and model compatibility."
            )
        elif status == 429:
            category = "rate_limit"
            user_message = (
                "Groq rate limit or quota reached. Try again later or check your "
                "Groq account limits."
            )
        elif status >= 500:
            category = "provider_server"
            user_message = "Groq is temporarily unavailable. Try again later."
        else:
            category = "provider_http"
            user_message = "Groq request failed. Check backend logs for the provider status."
        _log_provider_error(category, status=status, detail=provider_message)
        raise AIProviderError(user_message) from exc
    except TimeoutError as exc:
        _log_provider_error("timeout", detail=f"Timeout after {timeout_seconds} seconds")
        raise AIProviderError("Groq request timed out. Try again or use Normal Search.") from exc
    except URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            category = "timeout"
            user_message = "Groq request timed out. Try again or use Normal Search."
        else:
            category = "network"
            user_message = (
                "Could not connect to Groq. Check the backend network connection and try again."
            )
        _log_provider_error(category, detail=str(exc.reason))
        raise AIProviderError(user_message) from exc
    except (OSError, http.client.HTTPException) as exc:
        _log_provider_error("network", detail=f"{type(exc).__name__}: {exc}")
        raise AIProviderError(
            "Could not connect to Groq. Check the backend network connection and try again."
        ) from exc

    if len(response_body) > _MAX_PROVIDER_RESPONSE_BYTES:
        _log_provider_error("malformed_response", detail="Response exceeded configured size limit")
        raise AIProviderError("AI Assistant returned an oversized response. Try Normal Search.")
    try:
        payload = json.loads(response_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        _log_provider_error(
            "malformed_response",
            detail=f"Invalid JSON response body ({len(response_body)} bytes)",
        )
        raise AIProviderError(
            "AI Assistant returned an invalid response. Try Normal Search."
        ) from exc

    try:
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        _log_provider_error("malformed_response", detail=str(exc))
        raise AIProviderError(
            "AI Assistant returned an invalid response. Try Normal Search."
        ) from exc

    if not isinstance(parsed, dict):
        _log_provider_error(
            "malformed_response",
            detail="Structured response was not a JSON object",
        )
        raise AIProviderError("AI Assistant returned an invalid response. Try Normal Search.")
    intent = parsed.get("intent")
    product_query = parsed.get("product_query")
    if not isinstance(intent, str) or intent not in AI_INTENT_MAP:
        _log_provider_error(
            "malformed_response",
            detail="Structured response contained an unsupported intent",
        )
        raise AIProviderError("AI Assistant returned an unsupported intent. Try Normal Search.")
    if product_query is not None and (
        not isinstance(product_query, str)
        or not product_query.strip()
        or len(product_query) > 180
        or any(ord(char) < 32 for char in product_query)
    ):
        _log_provider_error(
            "malformed_response",
            detail="Structured response contained an invalid product query",
        )
        raise AIProviderError("AI Assistant returned an invalid product query. Try Normal Search.")
    return {
        "intent": intent,
        "product_query": product_query.strip() if product_query else None,
    }
