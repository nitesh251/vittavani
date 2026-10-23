from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app import auth, main
from app.database import Base, get_db
from app.models import Business, BusinessMember, Product


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'auth-test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as session:
        yield session
    engine.dispose()


@pytest.fixture
def signing_keys():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def make_token(private_key, *, issuer="https://project.example/auth/v1", audience="authenticated", exp=None):
    return jwt.encode(
        {
            "sub": "auth-user-1",
            "iss": issuer,
            "aud": audience,
            "exp": exp or datetime.now(UTC) + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
    )


def test_supabase_token_requires_valid_signature_issuer_audience_and_expiry(monkeypatch, signing_keys):
    private_key, public_key = signing_keys
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class TestJwkClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr(auth, "PyJWKClient", TestJwkClient)
    token = make_token(private_key)
    assert auth.verify_supabase_access_token(token, "https://project.example/") == "auth-user-1"

    for invalid in (
        make_token(other_private_key),
        make_token(private_key, issuer="https://attacker.example/auth/v1"),
        make_token(private_key, audience="anonymous"),
        make_token(private_key, exp=datetime.now(UTC) - timedelta(minutes=1)),
    ):
        with pytest.raises(HTTPException) as error:
            auth.verify_supabase_access_token(invalid, "https://project.example")
        assert error.value.status_code == 401


def test_supabase_token_fails_closed_when_project_is_unconfigured():
    with pytest.raises(HTTPException) as error:
        auth.verify_supabase_access_token("untrusted-token", "")
    assert error.value.status_code == 503


def test_authenticated_business_scope_ignores_untrusted_business_query(database, monkeypatch):
    own_business = Business(name="My Shop")
    other_business = Business(name="Other Shop")
    database.add_all([own_business, other_business])
    database.flush()
    database.add_all(
        [
            BusinessMember(business_id=own_business.id, auth_subject="owner-a", role="owner"),
            Product(business_id=own_business.id, name="Own product", unit="packet"),
            Product(business_id=other_business.id, name="Other product", unit="packet"),
        ]
    )
    database.commit()
    monkeypatch.setattr(main, "_bearer_subject", lambda _authorization: "owner-a")

    def override_db():
        yield database

    overrides = main.app.dependency_overrides.copy()
    main.app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(main.app) as client:
            response = client.get(
                "/api/v1/products",
                headers={"Authorization": "******"},
                params={"business_id": str(other_business.id)},
            )
    finally:
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(overrides)

    assert response.status_code == 200
    assert [product["name"] for product in response.json()["items"]] == ["Own product"]


def test_repeated_onboarding_returns_the_same_workspace(database):
    first = main.create_business(main.BusinessCreate(name="My Shop"), "owner-onboarding", database)
    second = main.create_business(main.BusinessCreate(name="Different Name"), "owner-onboarding", database)

    assert first.id == second.id
    assert second.name == "My Shop"
    assert database.scalar(select(func.count()).select_from(Business)) == 1
    assert database.scalar(select(func.count()).select_from(BusinessMember)) == 1


def test_development_token_is_disabled_outside_development(database, monkeypatch):
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main.settings, "dev_api_token", "local-token")
    monkeypatch.setattr(main.settings, "dev_business_id", str(uuid4()))

    with pytest.raises(HTTPException) as error:
        main.development_business_id("local-token", None, database)
    assert error.value.status_code == 401
