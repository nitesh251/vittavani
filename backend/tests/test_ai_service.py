from io import BytesIO
import http.client
import json
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

from app.ai_service import AIProviderError, _MAX_LOG_DETAIL_LENGTH, extract_product_query
from app.config import Settings


TEST_API_KEY = "gsk_test_key_never_use_in_production"


@pytest.fixture
def configured_ai(monkeypatch):
    monkeypatch.setattr("app.ai_service.ai_is_configured", lambda: True)
    monkeypatch.setattr("app.ai_service.settings.ai_provider", "groq")
    monkeypatch.setattr("app.ai_service.settings.ai_model", "llama-3.1-8b-instant")
    monkeypatch.setattr("app.ai_service.settings.groq_api_key", TEST_API_KEY)
    monkeypatch.setattr("app.ai_service.settings.ai_timeout_seconds", 10)


def http_error(status: int, body: str) -> HTTPError:
    return HTTPError(
        "https://api.groq.com/openai/v1/chat/completions",
        status,
        "Provider error",
        None,
        BytesIO(body.encode()),
    )


@pytest.mark.parametrize(
    ("status", "category", "user_message", "provider_message"),
    [
        (401, "authentication", "API credentials", "Invalid API key"),
        (404, "model_or_request", "AI_MODEL", "model_not_found"),
        (429, "rate_limit", "rate limit or quota", "rate_limit_exceeded"),
    ],
)
def test_provider_http_errors_are_classified_and_sanitized(
    configured_ai, monkeypatch, caplog, status, category, user_message, provider_message
):
    provider_body = json.dumps(
        {
            "error": {
                "message": f"{provider_message} {TEST_API_KEY}"
            }
        }
    )
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(http_error(status, provider_body)),
    )

    with pytest.raises(AIProviderError, match=user_message):
        extract_product_query("How much stock is left?")

    assert f"category={category} status={status}" in caplog.text
    assert provider_message in caplog.text
    assert TEST_API_KEY not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_provider_error_diagnostic_is_truncated(configured_ai, monkeypatch, caplog):
    long_message = "provider detail " * 100
    provider_body = json.dumps({"error": {"message": long_message}})
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(http_error(400, provider_body)),
    )

    with pytest.raises(AIProviderError):
        extract_product_query("How much stock is left?")

    record = next(record for record in caplog.records if "category=model_or_request" in record.getMessage())
    diagnostic = record.getMessage().split("provider_message=", 1)[1]
    assert len(diagnostic) <= _MAX_LOG_DETAIL_LENGTH
    assert len(diagnostic) < len(long_message)


def test_provider_response_protocol_errors_are_classified_as_network(
    configured_ai, monkeypatch, caplog
):
    partial_response = "provider returned sensitive partial payload"

    class BrokenResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            raise http.client.IncompleteRead(partial_response.encode())

    monkeypatch.setattr("app.ai_service.urlopen", lambda *_args, **_kwargs: BrokenResponse())

    with pytest.raises(AIProviderError, match="connect to Groq"):
        extract_product_query("How much stock is left?")

    assert "category=network" in caplog.text
    assert "IncompleteRead" in caplog.text
    assert partial_response not in caplog.text


def test_provider_error_redacts_opaque_tokens(configured_ai, monkeypatch, caplog):
    opaque_token = "opaque_token_value_0123456789abcdef"
    provider_body = json.dumps({"error": {"message": f"Invalid credential {opaque_token}"}})
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(http_error(401, provider_body)),
    )

    with pytest.raises(AIProviderError):
        extract_product_query("How much stock is left?")

    assert opaque_token not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_provider_network_and_timeout_errors_have_distinct_diagnostics(
    configured_ai, monkeypatch, caplog
):
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError("request timed out")),
    )
    with pytest.raises(AIProviderError, match="timed out"):
        extract_product_query("How much stock is left?")
    assert "category=timeout" in caplog.text

    caplog.clear()
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("DNS unavailable")),
    )
    with pytest.raises(AIProviderError, match="connect to Groq"):
        extract_product_query("How much stock is left?")
    assert "category=network" in caplog.text
    assert "DNS unavailable" in caplog.text


def test_url_error_with_timeout_reason_is_logged_as_timeout(configured_ai, monkeypatch, caplog):
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError(TimeoutError("read timed out"))),
    )

    with pytest.raises(AIProviderError, match="timed out"):
        extract_product_query("How much stock is left?")

    assert "category=timeout" in caplog.text


def test_provider_rejects_malformed_json_with_backend_diagnostic(
    configured_ai, monkeypatch, caplog
):
    raw_body = b'{"error":"gsk_fake_diagnostic_secret"'
    monkeypatch.setattr("app.ai_service.urlopen", lambda *_args, **_kwargs: BytesIO(raw_body))

    with pytest.raises(AIProviderError, match="invalid response"):
        extract_product_query("How much stock is left?")

    assert "category=malformed_response" in caplog.text
    assert "{invalid json" not in caplog.text
    assert "gsk_fake_diagnostic_secret" not in caplog.text
    assert f"{len(raw_body)} bytes" in caplog.text


def test_provider_rejects_malformed_structured_content(configured_ai, monkeypatch, caplog):
    provider_response = json.dumps(
        {"choices": [{"message": {"content": "{invalid json"}}]}
    ).encode()
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: BytesIO(provider_response),
    )

    with pytest.raises(AIProviderError, match="invalid response"):
        extract_product_query("How much stock is left?")

    assert "category=malformed_response" in caplog.text


def test_provider_sends_structured_output_and_caps_configured_timeout(
    configured_ai, monkeypatch, caplog
):
    provider_response = json.dumps(
        {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {"intent": "stock", "product_query": "Amul Butter"}
                        )
                    }
                }
            ]
        }
    ).encode()
    observed = {}

    def mock_urlopen(request, timeout):
        observed["timeout"] = timeout
        observed["request"] = json.loads(request.data)
        return BytesIO(provider_response)

    monkeypatch.setattr("app.ai_service.settings.ai_timeout_seconds", 100)
    monkeypatch.setattr("app.ai_service.urlopen", mock_urlopen)

    assert extract_product_query("How much stock is left for Amul Butter?") == {
        "intent": "stock",
        "product_query": "Amul Butter",
    }
    assert observed["timeout"] == 30
    assert observed["request"]["model"] == "llama-3.1-8b-instant"
    assert observed["request"]["response_format"] == {"type": "json_object"}
    assert "AI_TIMEOUT_SECONDS=100" in caplog.text


def test_settings_load_ai_values_from_a_dotenv_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AI_PROVIDER=groq\n"
        "AI_MODEL=llama-3.1-8b-instant\n"
        "GROQ_API_KEY=local-test-key\n"
        "AI_TIMEOUT_SECONDS=100\n",
        encoding="utf-8",
    )

    loaded = Settings(_env_file=env_file)

    assert loaded.ai_provider == "groq"
    assert loaded.ai_model == "llama-3.1-8b-instant"
    assert loaded.groq_api_key == "local-test-key"
    assert loaded.ai_timeout_seconds == 100
    assert Path(Settings.model_config["env_file"]) == Path(__file__).resolve().parents[2] / ".env"
