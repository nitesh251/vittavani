from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./vittavani.db"
    dev_api_token: str = ""
    dev_business_id: str = ""
    frontend_origin: str = "http://localhost:3000"
    ai_provider: str = ""
    ai_model: str = ""
    groq_api_key: str = ""
    ai_timeout_seconds: int = 10

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
