from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Business, InventoryBalance, Location, Product, ProductAlias
from app.query_service import lookup_product

BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000001")
OTHER_BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000002")


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        business = Business(id=BUSINESS_ID, name="Test Shop")
        other_business = Business(id=OTHER_BUSINESS_ID, name="Other Shop")
        storeroom = Location(id=UUID("00000000-0000-0000-0000-000000000010"), business_id=BUSINESS_ID, name="Storeroom")
        rack = Location(
            id=UUID("00000000-0000-0000-0000-000000000011"),
            business_id=BUSINESS_ID,
            parent_location_id=storeroom.id,
            name="Rack B",
        )
        shelf = Location(
            id=UUID("00000000-0000-0000-0000-000000000012"),
            business_id=BUSINESS_ID,
            parent_location_id=rack.id,
            name="Shelf 2",
        )
        butter = Product(id=UUID("00000000-0000-0000-0000-000000000020"), business_id=BUSINESS_ID, name="Amul Butter", unit="packet")
        other_butter = Product(id=UUID("00000000-0000-0000-0000-000000000021"), business_id=OTHER_BUSINESS_ID, name="Other Butter", unit="packet")
        db.add_all(
            [
                business,
                other_business,
                storeroom,
                rack,
                shelf,
                butter,
                other_butter,
                ProductAlias(business_id=BUSINESS_ID, product_id=butter.id, alias="अमूल बटर"),
                ProductAlias(business_id=BUSINESS_ID, product_id=butter.id, alias="Amul makhan"),
                InventoryBalance(
                    business_id=BUSINESS_ID,
                    product_id=butter.id,
                    location_id=shelf.id,
                    quantity=Decimal("20"),
                ),
                InventoryBalance(
                    business_id=BUSINESS_ID,
                    product_id=butter.id,
                    location_id=storeroom.id,
                    quantity=Decimal("3"),
                ),
                InventoryBalance(
                    business_id=OTHER_BUSINESS_ID,
                    product_id=other_butter.id,
                    location_id=UUID("00000000-0000-0000-0000-000000000030"),
                    quantity=Decimal("99"),
                ),
            ]
        )
        # The unrelated tenant's balance references its own location.
        db.add(Location(id=UUID("00000000-0000-0000-0000-000000000030"), business_id=OTHER_BUSINESS_ID, name="Other shop"))
        db.commit()
        yield db
    Base.metadata.drop_all(engine)


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        ("Where is Amul Butter?", "product_location"),
        ("Amul butter kahan rakha hai?", "product_location"),
        ("अमूल बटर कहाँ रखा है?", "product_location"),
        ("वेयर इज़ अमूल बटर?", "product_location"),
        ("अमूल बटर कितना बचा है?", "stock_quantity"),
        ("How much Amul butter is available?", "stock_quantity"),
        ("Amul makhan kidhar hai?", "product_location"),
    ],
)
def test_equivalent_language_queries_resolve_same_database_product(session, text, intent):
    result = lookup_product(session, BUSINESS_ID, text)

    assert result.intent == intent
    assert result.original_query == text
    assert result.product_name == "Amul Butter"
    assert result.quantity == Decimal("23.000")
    assert len(result.locations) == 2


def test_product_location_includes_nested_path(session):
    result = lookup_product(session, BUSINESS_ID, "Where is Amul Butter?")

    assert "Storeroom > Rack B > Shelf 2" in result.message
    assert "Other shop" not in result.message


def test_unrecognized_or_empty_query_requires_clarification(session):
    for query in ("", "Random unknown item", "transfer ten units"):
        result = lookup_product(session, BUSINESS_ID, query)
        assert result.product_name is None
        assert result.clarification_required


def test_no_recorded_location_does_not_invent_one(session):
    product = Product(id=UUID("00000000-0000-0000-0000-000000000040"), business_id=BUSINESS_ID, name="Rice")
    session.add(product)
    session.commit()

    result = lookup_product(session, BUSINESS_ID, "Where is Rice?")

    assert "No storage location is recorded" in result.message


def test_ambiguous_close_matches_return_candidates(session):
    session.add_all(
        [
            Product(id=UUID("00000000-0000-0000-0000-000000000050"), business_id=BUSINESS_ID, name="Amul Butter"),
            Product(id=UUID("00000000-0000-0000-0000-000000000051"), business_id=BUSINESS_ID, name="Amul Butters"),
        ]
    )
    session.commit()

    result = lookup_product(session, BUSINESS_ID, "Amul Buter")

    assert result.clarification_required
    assert set(result.candidates) == {"Amul Butter", "Amul Butters"}


def test_http_lookup_requires_configured_development_token(session, monkeypatch):
    monkeypatch.setattr("app.main.settings.app_env", "development")
    monkeypatch.setattr("app.main.settings.dev_api_token", "local-test-token")
    monkeypatch.setattr("app.main.settings.dev_business_id", str(BUSINESS_ID))

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        assert client.post("/api/v1/ask", json={"query": "Where is Amul Butter?"}).status_code == 401
        response = client.post(
            "/api/v1/ask",
            headers={"Authorization": "******"},
            json={"query": "Where is Amul Butter?"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["product_name"] == "Amul Butter"
    assert response.json()["original_query"] == "Where is Amul Butter?"
