from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO
import json
import sqlite3
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.ai_service import AIProviderError, extract_product_query
from app.command_service import CommandIntent, interpret_command, is_action_like_request
from app.formatting import format_quantity, format_quantity_label
from app.inventory_metrics import is_low_stock, is_out_of_stock
from app.main import app, optional_authenticated_subject
from app.models import (
    AssistantConversation,
    Business,
    Customer,
    CustomerLedgerEntry,
    InventoryBalance,
    Location,
    Product,
    ProductAlias,
    Sale,
    StockMovement,
    Supplier,
    SupplierPayment,
    SupplierPurchase,
)
from app.query_service import lookup_product
from app.query_understanding import Intent, understand_query

BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000001")
OTHER_BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000002")


@pytest.mark.parametrize(
    ("query", "intent", "customer", "amount"),
    [
        ("Ramesh ne 200 rupaye de diye", CommandIntent.RECORD_CUSTOMER_PAYMENT, "ramesh", Decimal("200")),
        ("रमेश ने २०० रुपये दे दिए", CommandIntent.RECORD_CUSTOMER_PAYMENT, "रमेश", Decimal("200")),
        ("Ramesh ka kitna udhar pending hai", CommandIntent.CUSTOMER_BALANCE_QUERY, "ramesh", None),
    ],
)
def test_voice_and_typed_customer_commands_are_parsed(query, intent, customer, amount):
    command = interpret_command(query)

    assert command is not None
    assert command.intent == intent
    assert command.customer_query == customer
    assert command.amount == amount


def test_sale_command_parses_number_words_and_ignores_hypothetical_sales():
    command = interpret_command("I sold one HP Laptop")

    assert command is not None
    assert command.intent == CommandIntent.RECORD_SALE
    assert command.product_query == "hp laptop"
    assert command.quantity == Decimal("1")
    assert interpret_command("Can I sell one HP Laptop?") is None
    assert interpret_command("What if I sold one HP Laptop?") is None
    assert not is_action_like_request("Can I sell one HP Laptop?")
    assert not is_action_like_request("What if I sold one HP Laptop?")


@pytest.mark.parametrize(
    ("query", "intent", "product", "quantity", "unit"),
    [
        ("Add three piece of keyboard in stock.", CommandIntent.RECEIVE_STOCK, "keyboard", Decimal("3"), "piece"),
        ("Add 3 keyboards to inventory.", CommandIntent.RECEIVE_STOCK, "keyboards", Decimal("3"), None),
        ("Keyboard ke 3 piece stock mein add karo.", CommandIntent.RECEIVE_STOCK, "keyboard", Decimal("3"), "piece"),
        ("Maine 3 keyboard kharide hain.", CommandIntent.RECEIVE_STOCK, "keyboard", Decimal("3"), None),
        ("I sold one HP laptop.", CommandIntent.RECORD_SALE, "hp laptop", Decimal("1"), None),
    ],
)
def test_common_english_and_hinglish_inventory_commands(query, intent, product, quantity, unit):
    command = interpret_command(query)

    assert command is not None
    assert command.intent == intent
    assert command.product_query == product
    assert command.quantity == quantity
    assert command.unit == unit
    assert is_action_like_request(query)


@pytest.mark.parametrize(
    ("question", "intent", "entity"),
    [
        ("Where did I keep Amul Butter?", Intent.LOCATION, "amul butter"),
        ("Where do we store Amul Butter?", Intent.LOCATION, "amul butter"),
        ("How much stock do I have for Amul Butter?", Intent.STOCK, "amul butter"),
        ("Show me products running low", Intent.LOW_STOCK, ""),
        ("Which items are out of stock?", Intent.OUT_OF_STOCK, ""),
        ("कितना अमूल बटर बचा है?", Intent.STOCK, "अमूल बटर"),
        ("अमूल बटर स्टॉक कितना है?", Intent.STOCK, "अमूल बटर"),
    ],
)
def test_conversational_inventory_question_scenarios(question, intent, entity):
    query = understand_query(question)

    assert query.intent == intent
    assert query.entity_query == entity


@pytest.mark.parametrize(
    ("question", "intent", "entity", "quantity"),
    [
        ("मैंने 3 कीबोर्ड खरीदे", CommandIntent.RECEIVE_STOCK, "कीबोर्ड", Decimal("3")),
        ("रमेश ने २०० रुपये दिए", CommandIntent.RECORD_CUSTOMER_PAYMENT, "रमेश", Decimal("200")),
        ("Ramesh gave me ₹500", CommandIntent.RECORD_CUSTOMER_PAYMENT, "ramesh", Decimal("500")),
        ("How much does Ramesh owe me?", CommandIntent.CUSTOMER_BALANCE_QUERY, "ramesh", None),
    ],
)
def test_conversational_customer_and_hindi_action_scenarios(question, intent, entity, quantity):
    command = interpret_command(question)

    assert command is not None
    assert command.intent == intent
    if intent in {CommandIntent.CUSTOMER_BALANCE_QUERY, CommandIntent.RECORD_CUSTOMER_PAYMENT}:
        assert command.customer_query == entity
        if intent == CommandIntent.RECORD_CUSTOMER_PAYMENT:
            assert command.amount == quantity
    else:
        assert command.product_query == entity
        assert command.quantity == quantity


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


@pytest.fixture
def client(session, monkeypatch):
    monkeypatch.setattr("app.main.settings.app_env", "development")
    monkeypatch.setattr("app.main.settings.dev_api_token", "local-test-token")
    monkeypatch.setattr("app.main.settings.dev_business_id", str(BUSINESS_ID))

    def override_db():
        with Session(session.get_bind()) as request_session:
            yield request_session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        ("Where is Amul Butter?", "product_location"),
        ("Where can I find Amul Butter?", "product_location"),
        ("Where is Amul Buter?", "product_location"),
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
    assert "20 packets" in result.message
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

    result = lookup_product(session, BUSINESS_ID, "Where is Amul Buter?")

    assert result.clarification_required
    assert set(result.candidates) == {"Amul Butter", "Amul Butters"}


def test_low_stock_lookup_uses_configured_business_threshold(session):
    milk = Product(
        id=UUID("00000000-0000-0000-0000-000000000060"),
        business_id=BUSINESS_ID,
        name="Milk",
        unit="packet",
        minimum_stock=Decimal("5"),
    )
    out_of_stock = Product(
        id=UUID("00000000-0000-0000-0000-000000000072"),
        business_id=BUSINESS_ID,
        name="Bread",
        unit="loaf",
        minimum_stock=Decimal("3"),
    )
    session.add_all([milk, out_of_stock])
    session.flush()
    session.add(
        InventoryBalance(
            business_id=BUSINESS_ID,
            product_id=milk.id,
            location_id=UUID("00000000-0000-0000-0000-000000000010"),
            quantity=Decimal("2"),
        )
    )
    session.commit()

    result = lookup_product(session, BUSINESS_ID, "Show low stock items.")

    assert result.candidates == ("Milk (2 packets)",)
    assert "Amul Butter" not in result.message


def test_out_of_stock_product_is_reported_separately_from_low_stock(session):
    rice = Product(
        id=UUID("00000000-0000-0000-0000-000000000061"),
        business_id=BUSINESS_ID,
        name="Rice",
        unit="bag",
        minimum_stock=Decimal("5"),
    )
    session.add(rice)
    session.commit()

    low_stock_result = lookup_product(session, BUSINESS_ID, "Show low stock items.")
    out_of_stock_result = lookup_product(session, BUSINESS_ID, "Which items are out of stock?")

    assert low_stock_result.candidates == ()
    assert "Rice" not in low_stock_result.message
    assert out_of_stock_result.candidates == ("Rice (0 bags)",)
    assert "Rice (0 bags)" in out_of_stock_result.message


def test_low_stock_rule_ignores_zero_threshold_and_out_of_stock():
    assert is_low_stock(Decimal("2"), Decimal("5"))
    assert not is_low_stock(Decimal("0"), Decimal("5"))
    assert not is_low_stock(Decimal("1"), Decimal("0"))
    assert is_out_of_stock(Decimal("0"))
    assert is_out_of_stock(Decimal("-1"))
    assert not is_out_of_stock(Decimal("0.001"))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("20"), "20"),
        (Decimal("20.000"), "20"),
        (Decimal("0"), "0"),
        (Decimal("0.125"), "0.125"),
        (Decimal("100000000000000000000000.125"), "1,00,00,00,00,00,00,00,00,00,00,000.125"),
        (Decimal("-0.500"), "-0.5"),
    ],
)
def test_quantity_formatter_is_exact_and_never_uses_exponents(value, expected):
    assert format_quantity(value) == expected


def test_quantity_label_pluralizes_common_units():
    assert format_quantity_label(Decimal("20.000"), "packet") == "20 packets"
    assert format_quantity_label(Decimal("1.000"), "packets") == "1 packet"
    assert format_quantity_label(Decimal("1.5"), "kg") == "1.5 kg"


def test_http_lookup_requires_configured_development_token(client):
    assert client.post("/api/v1/ask", json={"query": "Where is Amul Butter?"}).status_code == 401
    assert client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "invalid-token"},
        json={"query": "Where is Amul Butter?"},
    ).status_code == 401
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "Where is Amul Butter?"},
    )

    assert response.status_code == 200
    assert response.json()["product_name"] == "Amul Butter"
    assert response.json()["original_query"] == "Where is Amul Butter?"


def test_normal_search_uses_saved_hindi_alias_and_real_inventory(client):
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "अमूल बटर कितना बचा है?", "mode": "normal"},
    )

    assert response.status_code == 200
    assert response.json()["product_name"] == "Amul Butter"
    assert response.json()["quantity"] == "23.000"
    assert response.json()["unit"] == "packet"
    assert "23 packets" in response.json()["message"]


def test_ai_mode_uses_mocked_interpretation_and_database_facts(client, monkeypatch):
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    monkeypatch.setattr("app.main.settings.ai_provider", "groq")
    monkeypatch.setattr("app.main.settings.ai_model", "test-model")
    monkeypatch.setattr(
        "app.main.extract_product_query",
        lambda question: {"intent": "stock", "product_query": "Amul Butter"},
    )

    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "How much butter is left?", "mode": "ai"},
    )

    assert response.status_code == 200
    assert response.json()["quantity"] == "23.000"
    assert response.json()["message"].startswith("Amul Butter: 23 packets available.")
    assert response.json()["provider"] == "groq"
    assert response.json()["model"] == "test-model"


def test_ai_mode_uses_interpreted_intent_without_reparsing_product_text(client, session, monkeypatch):
    session.add(
        ProductAlias(
            business_id=BUSINESS_ID,
            product_id=UUID("00000000-0000-0000-0000-000000000020"),
            alias="Where is Amul Butter",
        )
    )
    session.commit()
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    monkeypatch.setattr("app.main.settings.ai_provider", "groq")
    monkeypatch.setattr("app.main.settings.ai_model", "test-model")
    monkeypatch.setattr(
        "app.main.extract_product_query",
        lambda question: {"intent": "stock", "product_query": "Where is Amul Butter"},
    )

    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "Do I have butter?", "mode": "ai"},
    )

    assert response.status_code == 200
    assert response.json()["intent"] == "stock_quantity"
    assert response.json()["message"].startswith("Amul Butter: 23 packets available.")


def test_ai_mode_handles_location_and_low_stock_intents(client, session, monkeypatch):
    milk = Product(
        id=UUID("00000000-0000-0000-0000-000000000074"),
        business_id=BUSINESS_ID,
        name="Milk",
        unit="packet",
        minimum_stock=Decimal("5"),
    )
    session.add(milk)
    session.flush()
    session.add(
        InventoryBalance(
            business_id=BUSINESS_ID,
            product_id=milk.id,
            location_id=UUID("00000000-0000-0000-0000-000000000010"),
            quantity=Decimal("2"),
        )
    )
    bread = Product(
        id=UUID("00000000-0000-0000-0000-000000000075"),
        business_id=BUSINESS_ID,
        name="Bread",
        unit="packet",
        minimum_stock=Decimal("3"),
    )
    session.add(bread)
    session.commit()
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    monkeypatch.setattr("app.main.settings.ai_provider", "groq")
    monkeypatch.setattr("app.main.settings.ai_model", "test-model")
    interpretations = iter(
        [
            {"intent": "location", "product_query": "Amul Butter"},
            {"intent": "low_stock", "product_query": None},
            {"intent": "out_of_stock", "product_query": None},
        ]
    )
    monkeypatch.setattr("app.main.extract_product_query", lambda question: next(interpretations))
    headers = {"X-Dev-Token": "local-test-token"}

    location_response = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Where is butter?", "mode": "ai"},
    )
    low_stock_response = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Which products are nearly out?", "mode": "ai"},
    )
    out_of_stock_response = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Which items are out of stock?", "mode": "ai"},
    )

    assert location_response.status_code == 200
    assert location_response.json()["intent"] == "product_location"
    assert "Storeroom > Rack B > Shelf 2" in location_response.json()["message"]
    assert low_stock_response.status_code == 200
    assert "Milk (2 packets)" in low_stock_response.json()["message"]
    assert out_of_stock_response.status_code == 200
    assert out_of_stock_response.json()["intent"] == "out_of_stock_report"
    assert out_of_stock_response.json()["candidates"] == ["Bread (0 packets)"]


def test_ai_provider_failure_returns_a_sanitized_upstream_error(client, monkeypatch):
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)

    def fail_provider(_question):
        raise AIProviderError("AI Assistant is temporarily unavailable. Try Normal Search.")

    monkeypatch.setattr("app.main.extract_product_query", fail_provider)

    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "How much butter?", "mode": "ai"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "AI Assistant is temporarily unavailable. Try Normal Search."


def test_ai_mode_reports_unconfigured_provider_without_affecting_normal_search(client, monkeypatch):
    monkeypatch.setattr("app.main.ai_is_configured", lambda: False)
    headers = {"X-Dev-Token": "local-test-token"}

    status_response = client.get("/api/v1/ai/status", headers=headers)
    ai_response = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Amul Butter?", "mode": "ai"},
    )
    normal_response = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Amul Butter?"},
    )

    assert status_response.status_code == 200
    assert status_response.json() == {"configured": False, "provider": None, "model": None}
    assert ai_response.status_code == 503
    assert "Normal Search" in ai_response.json()["detail"]
    assert normal_response.status_code == 200
    assert normal_response.json()["quantity"] == "23.000"


def test_voice_command_sale_commits_stock_and_is_idempotent(client, session):
    headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "sale-command-1"}
    payload = {"query": "5 Amul Butter bik gaya at Shelf 2", "mode": "normal"}

    response = client.post("/api/v1/ask", headers=headers, json=payload)
    repeated = client.post("/api/v1/ask", headers=headers, json=payload)

    assert response.status_code == 200
    assert response.json()["intent"] == "record_sale"
    assert response.json()["action_result"]["total_amount"] == "0.00"
    assert repeated.json()["action_result"]["sale_id"] == response.json()["action_result"]["sale_id"]
    assert session.scalar(select(func.sum(InventoryBalance.quantity)).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
    )) == Decimal("18.000")
    assert session.scalar(select(func.count(Sale.id)).where(Sale.business_id == BUSINESS_ID)) == 1
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "sale",
    )) == 1


def test_number_word_sale_uses_saved_price_and_persists_transaction(client, session):
    product = session.get(Product, UUID("00000000-0000-0000-0000-000000000020"))
    product.selling_price = Decimal("15.00")
    session.commit()
    headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "number-word-sale"}
    payload = {"query": "I sold one Amul Butter at Shelf 2", "mode": "normal"}

    response = client.post("/api/v1/ask", headers=headers, json=payload)
    repeated = client.post("/api/v1/ask", headers=headers, json=payload)

    assert response.status_code == 200
    result = response.json()["action_result"]
    assert response.json()["intent"] == "record_sale"
    assert result["unit_price"] == "15.00"
    assert result["total_amount"] == "15.00"
    assert result["sale_id"] == repeated.json()["action_result"]["sale_id"]
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == product.id,
        InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
    )) == Decimal("19.000")
    sale = session.scalar(select(Sale).where(Sale.business_id == BUSINESS_ID))
    assert sale is not None
    assert sale.total_amount == Decimal("15.00")
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "sale",
    )) == 1


def test_voice_receipt_adds_stock_and_records_movement(client, session):
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "receipt-command-1"},
        json={"query": "Receive 5 packets of Amul Butter at Shelf 2"},
    )

    assert response.status_code == 200
    assert response.json()["intent"] == "receive_stock"
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
        InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
    )) == Decimal("25.000")
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "purchase_receipt",
    )) == 1


def test_location_clarification_persists_for_same_authenticated_conversation_only(
    client, session, monkeypatch
):
    front_store = Location(
        id=UUID("00000000-0000-0000-0000-000000000040"),
        business_id=BUSINESS_ID,
        name="Front Store",
    )
    duplicate_shelf = Location(
        id=UUID("00000000-0000-0000-0000-000000000041"),
        business_id=BUSINESS_ID,
        parent_location_id=front_store.id,
        name="Shelf 2",
    )
    session.add_all([front_store, duplicate_shelf])
    session.commit()
    subject = {"value": "owner-a"}
    monkeypatch.setitem(
        app.dependency_overrides,
        optional_authenticated_subject,
        lambda: subject["value"],
    )
    conversation_id = "00000000-0000-4000-8000-000000000099"
    headers = {"X-Dev-Token": "local-test-token"}

    clarification = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "location-follow-up-start"},
        json={
            "query": "Add three packets of Amul Butter to stock",
            "mode": "normal",
            "conversation_id": conversation_id,
        },
    )

    assert clarification.status_code == 200
    assert clarification.json()["clarification_required"] is True
    assert "location" in clarification.json()["message"].casefold()
    session.expire_all()
    pending = session.scalar(
        select(AssistantConversation).where(
            AssistantConversation.business_id == BUSINESS_ID,
            AssistantConversation.auth_subject == "owner-a",
        )
    )
    assert pending is not None
    assert pending.pending_action["intent"] == "receive_stock"

    subject["value"] = "owner-b"
    unauthorized_follow_up = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Storeroom Rack B Shelf 2", "conversation_id": conversation_id},
    )
    assert unauthorized_follow_up.status_code == 200
    assert unauthorized_follow_up.json()["action_result"] is None

    subject["value"] = "owner-a"
    unrelated_follow_up = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Shelf brackets", "conversation_id": conversation_id},
    )
    assert unrelated_follow_up.status_code == 200
    assert unrelated_follow_up.json()["clarification_required"] is True
    assert unrelated_follow_up.json()["action_result"] is None

    completed = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "location-follow-up-complete"},
        json={"query": "Storeroom Rack B Shelf 2", "conversation_id": conversation_id},
    )

    assert completed.status_code == 200
    assert completed.json()["intent"] == "receive_stock"
    assert completed.json()["action_result"]["balance"] == "23.000"
    session.expire_all()
    assert session.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.business_id == BUSINESS_ID,
            InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
            InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
        )
    ) == Decimal("23.000")
    assert session.scalar(
        select(AssistantConversation).where(
            AssistantConversation.business_id == BUSINESS_ID,
            AssistantConversation.auth_subject == "owner-a",
        )
    ) is None

    from app.command_service import BusinessCommand

    customer = Customer(
        id=UUID("00000000-0000-0000-0000-000000000042"),
        business_id=BUSINESS_ID,
        name="Ramesh",
    )
    session.get(Product, UUID("00000000-0000-0000-0000-000000000020")).selling_price = Decimal("10")
    session.add(customer)
    session.commit()
    monkeypatch.setattr(
        "app.main.interpret_command",
        lambda _query: BusinessCommand(
            intent=CommandIntent.RECORD_CREDIT_SALE,
            product_query="Amul Butter",
            quantity=Decimal("1"),
            customer_query="Ramesh",
        ),
    )
    credit_sale_conversation = "00000000-0000-4000-8000-000000000097"
    credit_sale_clarification = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "credit-sale-follow-up-start"},
        json={
            "query": "Record one Amul Butter on credit for Ramesh",
            "conversation_id": credit_sale_conversation,
        },
    )
    assert credit_sale_clarification.status_code == 200
    assert credit_sale_clarification.json()["clarification_required"] is True
    assert session.scalar(
        select(AssistantConversation).where(
            AssistantConversation.conversation_id == UUID(credit_sale_conversation),
            AssistantConversation.auth_subject == "owner-a",
        )
    ).pending_action["intent"] == "record_credit_sale"

    credit_sale = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "credit-sale-follow-up-complete"},
        json={
            "query": "Storeroom Rack B Shelf 2",
            "conversation_id": credit_sale_conversation,
        },
    )
    assert credit_sale.status_code == 200
    assert credit_sale.json()["intent"] == "record_credit_sale"
    assert credit_sale.json()["action_result"]["sale_id"]
    assert session.scalar(
        select(func.count(Sale.id)).where(
            Sale.business_id == BUSINESS_ID,
            Sale.id == UUID(credit_sale.json()["action_result"]["sale_id"]),
        )
    ) == 1
    sale = session.get(Sale, UUID(credit_sale.json()["action_result"]["sale_id"]))
    assert sale.customer_id == customer.id
    assert session.scalar(
        select(func.count(CustomerLedgerEntry.id)).where(
            CustomerLedgerEntry.business_id == BUSINESS_ID,
            CustomerLedgerEntry.customer_id == customer.id,
        )
    ) == 1


def test_assistant_requests_purge_expired_clarification_state(client, session):
    conversation_id = UUID("00000000-0000-4000-8000-000000000098")
    conversation = AssistantConversation(
        business_id=BUSINESS_ID,
        auth_subject="expired-owner",
        conversation_id=conversation_id,
        pending_action={"intent": "receive_stock"},
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    session.add(conversation)
    session.commit()

    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "Amul Butter?"},
    )

    assert response.status_code == 200
    session.expire_all()
    assert session.scalar(
        select(AssistantConversation).where(
            AssistantConversation.conversation_id == conversation_id,
        )
    ) is None


def test_ai_mode_answers_general_questions_without_business_mutations(client, session, monkeypatch):
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    observed = {}

    def answer(question, *, verified_context=None):
        observed["question"] = question
        observed["context"] = verified_context
        return "Try one small, measurable change and review the result next week."

    monkeypatch.setattr("app.main.generate_assistant_response", answer)
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "How can I improve customer retention?", "mode": "ai"},
    )

    assert response.status_code == 200
    assert response.json()["intent"] == "general_advice"
    assert response.json()["message"].startswith("Try one small")
    assert observed == {
        "question": "How can I improve customer retention?",
        "context": None,
    }
    assert session.scalar(select(func.count(Sale.id)).where(Sale.business_id == BUSINESS_ID)) == 0


def test_ai_sales_advice_preserves_database_facts_and_adds_suggestions(client, session, monkeypatch):
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    observed = {}

    def answer(question, *, verified_context=None):
        observed["question"] = question
        observed["context"] = verified_context
        return "Try one promotion for a week and compare the results."

    monkeypatch.setattr("app.main.generate_assistant_response", answer)
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "How can I improve sales?", "mode": "ai"},
    )

    assert response.status_code == 200
    assert response.json()["intent"] == "business_insight"
    assert response.json()["message"].startswith("There is not enough recorded sales history")
    assert "Suggestions: Try one promotion" in response.json()["message"]
    assert observed["question"] == "How can I improve sales?"
    assert set(observed["context"]) <= {
        "current_period",
        "previous_period",
        "top_products",
        "restock_candidates",
        "daily_trend",
    }
    assert "recommendations_are_general" not in observed["context"]
    assert session.scalar(select(func.count(Sale.id)).where(Sale.business_id == BUSINESS_ID)) == 0


def test_add_to_inventory_phrase_receives_stock_once_with_saved_unit(client, session):
    headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "add-stock-phrase"}
    payload = {"query": "Add three packets of Amul Butter to stock at Shelf 2", "mode": "normal"}

    response = client.post("/api/v1/ask", headers=headers, json=payload)
    repeated = client.post("/api/v1/ask", headers=headers, json=payload)

    assert response.status_code == 200
    assert response.json()["intent"] == "receive_stock"
    assert response.json()["action_result"]["balance"] == "23.000"
    movement_id = UUID(response.json()["action_result"]["stock_movement_id"])
    assert repeated.json()["action_result"]["stock_movement_id"] == str(movement_id)
    assert session.get(StockMovement, movement_id).movement_type == "purchase_receipt"
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
        InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
    )) == Decimal("23.000")


def test_ai_mode_routes_action_like_unparsed_commands_to_structured_action(client, session, monkeypatch):
    from app.command_service import BusinessCommand

    monkeypatch.setattr("app.main.interpret_command", lambda _query: None)
    monkeypatch.setattr("app.main.ai_is_configured", lambda: True)
    monkeypatch.setattr(
        "app.main.extract_business_command",
        lambda _query: BusinessCommand(
            intent=CommandIntent.RECEIVE_STOCK,
            product_query="Amul Butter",
            quantity=Decimal("1"),
            unit="packet",
            location_query="Shelf 2",
        ),
    )
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "ai-receipt-route"},
        json={"query": "Add 1 Amul Butter to stock at Shelf 2", "mode": "ai"},
    )

    assert response.status_code == 200
    assert response.json()["intent"] == "receive_stock"
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
        InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
    )) == Decimal("21.000")


def test_unknown_stock_receipt_suggests_product_creation_without_mutation(client, session):
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "unknown-receipt"},
        json={"query": "Add 3 packets of Missing Widget to stock at Shelf 2"},
    )

    assert response.status_code == 200
    assert response.json()["clarification_required"] is True
    assert "Would you like to create it" in response.json()["message"]
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "purchase_receipt",
    )) == 0


def test_supplier_purchase_partial_payments_are_atomic_and_idempotent(client, session):
    headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "supplier-create-1"}
    supplier_payload = {"name": "North Wholesale", "phone": "9876543210", "email": "orders@example.test"}
    supplier_response = client.post("/api/v1/suppliers", headers=headers, json=supplier_payload)
    supplier_repeat = client.post("/api/v1/suppliers", headers=headers, json=supplier_payload)
    assert supplier_response.status_code == 201
    supplier_id = supplier_response.json()["id"]
    assert supplier_repeat.json()["id"] == supplier_id
    assert session.scalar(select(func.count(Supplier.id)).where(Supplier.business_id == BUSINESS_ID)) == 1

    product_id = str(UUID("00000000-0000-0000-0000-000000000020"))
    shelf_id = str(UUID("00000000-0000-0000-0000-000000000012"))
    purchase_payload = {
        "supplier_id": supplier_id,
        "invoice_reference": "INV-42",
        "purchase_date": "2026-10-25",
        "due_date": "2026-11-10",
        "paid_amount": "10.00",
        "lines": [
            {"product_id": product_id, "location_id": shelf_id, "quantity": "2", "unit": "packet", "unit_price": "10.00"},
            {"product_id": product_id, "location_id": shelf_id, "quantity": "1", "unit": "packet", "unit_price": "15.00"},
        ],
    }
    purchase_headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "supplier-purchase-1"}
    purchase_response = client.post("/api/v1/supplier-purchases", headers=purchase_headers, json=purchase_payload)
    purchase_repeat = client.post("/api/v1/supplier-purchases", headers=purchase_headers, json=purchase_payload)
    assert purchase_response.status_code == 201
    result = purchase_response.json()
    assert result["total_amount"] == "35.00"
    assert result["paid_amount"] == "10.00"
    assert result["outstanding_balance"] == "25.00"
    assert purchase_repeat.json()["purchase_id"] == result["purchase_id"]
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID(product_id),
        InventoryBalance.location_id == UUID(shelf_id),
    )) == Decimal("23.000")
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "purchase_receipt",
    )) == 2
    assert session.scalar(select(func.count(SupplierPurchase.id)).where(
        SupplierPurchase.business_id == BUSINESS_ID,
    )) == 1

    payment_payload = {"purchase_id": result["purchase_id"], "amount": "5.00", "note": "Bank transfer"}
    payment_headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "supplier-payment-1"}
    payment_url = f"/api/v1/suppliers/{supplier_id}/payments"
    payment_response = client.post(payment_url, headers=payment_headers, json=payment_payload)
    payment_repeat = client.post(payment_url, headers=payment_headers, json=payment_payload)
    assert payment_response.status_code == 200
    assert payment_response.json()["purchase_outstanding_balance"] == "20.00"
    assert payment_response.json()["supplier_outstanding_balance"] == "20.00"
    assert payment_repeat.json()["payment_id"] == payment_response.json()["payment_id"]
    assert session.scalar(select(func.count(SupplierPayment.id)).where(
        SupplierPayment.business_id == BUSINESS_ID,
    )) == 2
    assert session.scalar(select(InventoryBalance.quantity).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID(product_id),
        InventoryBalance.location_id == UUID(shelf_id),
    )) == Decimal("23.000")

    suppliers = client.get("/api/v1/suppliers", headers={"X-Dev-Token": "local-test-token"})
    history = client.get(
        f"/api/v1/suppliers/{supplier_id}/purchases",
        headers={"X-Dev-Token": "local-test-token"},
    )
    assert suppliers.json()["items"][0]["outstanding_balance"] == "20.00"
    purchase = history.json()["items"][0]
    assert purchase["outstanding_balance"] == "20.00"
    assert len(purchase["lines"]) == 2
    assert len(purchase["payments"]) == 2

    overpayment = client.post(
        payment_url,
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "supplier-overpay"},
        json={"purchase_id": result["purchase_id"], "amount": "21.00"},
    )
    assert overpayment.status_code == 409
    assert session.scalar(select(func.count(SupplierPayment.id)).where(
        SupplierPayment.business_id == BUSINESS_ID,
    )) == 2


def test_supplier_purchases_reject_cross_business_products_and_locations(client, session):
    supplier = Supplier(business_id=BUSINESS_ID, name="Local Supplier")
    session.add(supplier)
    session.commit()
    response = client.post(
        "/api/v1/supplier-purchases",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "cross-tenant-supplier-purchase"},
        json={
            "supplier_id": str(supplier.id),
            "purchase_date": "2026-10-25",
            "lines": [{
                "product_id": str(UUID("00000000-0000-0000-0000-000000000021")),
                "location_id": str(UUID("00000000-0000-0000-0000-000000000030")),
                "quantity": "1",
                "unit_price": "10.00",
            }],
        },
    )

    assert response.status_code == 404
    assert session.scalar(select(func.count(SupplierPurchase.id)).where(
        SupplierPurchase.business_id == BUSINESS_ID,
    )) == 0
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.movement_type == "purchase_receipt",
    )) == 0
    hidden = client.get(
        f"/api/v1/suppliers/{UUID('00000000-0000-0000-0000-000000000099')}/purchases",
        headers={"X-Dev-Token": "local-test-token"},
    )
    assert hidden.status_code == 404


def test_failed_voice_sale_does_not_change_inventory_or_history(client, session):
    before_movements = session.scalar(select(func.count(StockMovement.id)))
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "insufficient-sale"},
        json={"query": "500 Amul Butter bik gaya at Shelf 2"},
    )

    assert response.status_code == 409
    assert session.scalar(select(func.sum(InventoryBalance.quantity)).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
    )) == Decimal("23.000")
    assert session.scalar(select(func.count(Sale.id))) == 0
    assert session.scalar(select(func.count(StockMovement.id))) == before_movements


def test_customer_credit_sale_payment_and_ledger_use_signed_balance(client, session):
    butter = session.get(Product, UUID("00000000-0000-0000-0000-000000000020"))
    butter.selling_price = Decimal("15.00")
    session.commit()
    headers = {"X-Dev-Token": "local-test-token"}
    customer_response = client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "Ramesh", "phone": "+91 98765 43210"},
    )
    assert customer_response.status_code == 201
    customer_id = customer_response.json()["id"]
    sale_payload = {
        "product_id": str(butter.id),
        "location_id": "00000000-0000-0000-0000-000000000012",
        "quantity": "2",
        "customer_id": customer_id,
        "paid_amount": "0",
        "unit": "packet",
    }
    missing_key_sale = client.post("/api/v1/sales", headers=headers, json=sale_payload)
    sale_headers = {**headers, "Idempotency-Key": "credit-sale-ramesh-1"}
    sale_response = client.post(
        "/api/v1/sales",
        headers=sale_headers,
        json=sale_payload,
    )
    repeated_sale = client.post("/api/v1/sales", headers=sale_headers, json=sale_payload)

    assert missing_key_sale.status_code == 400
    assert sale_response.status_code == 201
    assert repeated_sale.json()["sale_id"] == sale_response.json()["sale_id"]
    assert sale_response.json()["outstanding_balance"] == "30.00"
    payment = client.post(
        f"/api/v1/customers/{customer_id}/payments",
        headers={**headers, "Idempotency-Key": "ramesh-payment-in-ledger-test"},
        json={"amount": "10"},
    )
    ledger = client.get(f"/api/v1/customers/{customer_id}/ledger", headers=headers)
    customers = client.get("/api/v1/customers", headers=headers)
    sales = client.get("/api/v1/sales", headers=headers)

    assert payment.status_code == 200
    assert payment.json()["outstanding_balance"] == "20.00"
    assert ledger.status_code == 200
    assert [entry["amount_delta"] for entry in ledger.json()["items"]] == ["30.00", "-10.00"]
    assert ledger.json()["outstanding_balance"] == "20.00"
    assert customers.json()["items"][0]["outstanding_balance"] == "20.00"
    assert sales.status_code == 200
    assert sales.json()["items"][0]["product_name"] == "Amul Butter"
    assert sales.json()["items"][0]["quantity"] == "2.000"
    assert sales.json()["items"][0]["customer_name"] == "Ramesh"
    assert session.scalar(select(func.count(CustomerLedgerEntry.id))) == 2
    assert session.scalar(select(func.count(Sale.id))) == 1


def test_overpayment_and_idempotency_key_reuse_fail_without_extra_posts(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    customer = Customer(business_id=BUSINESS_ID, name="Ramesh")
    session.add(customer)
    session.flush()
    session.add(CustomerLedgerEntry(
        business_id=BUSINESS_ID,
        customer_id=customer.id,
        transaction_type="opening_balance",
        amount_delta=Decimal("25"),
    ))
    session.commit()
    overpayment = client.post(
        f"/api/v1/customers/{customer.id}/payments",
        headers={**headers, "Idempotency-Key": "ramesh-overpayment-attempt"},
        json={"amount": "30"},
    )
    missing_key_payment = client.post(
        f"/api/v1/customers/{customer.id}/payments",
        headers=headers,
        json={"amount": "1"},
    )
    payment_headers = {**headers, "Idempotency-Key": "ramesh-payment-10"}
    payment_body = {"amount": "10"}
    payment_once = client.post(
        f"/api/v1/customers/{customer.id}/payments",
        headers=payment_headers,
        json=payment_body,
    )
    payment_repeat = client.post(
        f"/api/v1/customers/{customer.id}/payments",
        headers=payment_headers,
        json=payment_body,
    )
    first = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "key-reuse"},
        json={"query": "Receive 1 packet of Amul Butter at Shelf 2"},
    )
    conflicting = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "key-reuse"},
        json={"query": "Receive 2 packets of Amul Butter at Shelf 2"},
    )

    assert overpayment.status_code == 409
    assert missing_key_payment.status_code == 400
    assert payment_once.json()["outstanding_balance"] == "15.00"
    assert payment_repeat.json()["outstanding_balance"] == "15.00"
    assert first.status_code == 200
    assert conflicting.status_code == 409
    assert session.scalar(select(func.count(CustomerLedgerEntry.id))) == 2
    assert session.scalar(select(func.sum(InventoryBalance.quantity)).where(
        InventoryBalance.business_id == BUSINESS_ID,
        InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
    )) == Decimal("24.000")


def test_voice_command_creates_product_only_with_unit_price_and_location(client, session):
    headers = {"X-Dev-Token": "local-test-token", "Idempotency-Key": "new-ghee-command"}
    clarification = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "New product Amul Ghee quantity 5 add kar do"},
    )
    assert clarification.status_code == 200
    assert clarification.json()["clarification_required"]
    assert "unit and selling price" in clarification.json()["message"]
    assert session.scalar(select(func.count(Product.id)).where(
        Product.business_id == BUSINESS_ID,
        Product.name == "amul ghee",
    )) == 0

    complete = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "new-ghee-command-complete"},
        json={
            "query": "New product Amul Ghee quantity 5 unit packet price 350 at Storeroom add kar do"
        },
    )

    assert complete.status_code == 200
    assert complete.json()["intent"] == "create_product"
    assert complete.json()["action_result"]["balance"] == "5"
    created = session.scalar(select(Product).where(
        Product.business_id == BUSINESS_ID,
        Product.name == "amul ghee",
    ))
    assert created is not None
    assert created.unit == "packet"
    assert created.selling_price == Decimal("350.00")
    assert session.scalar(select(func.count(StockMovement.id)).where(
        StockMovement.business_id == BUSINESS_ID,
        StockMovement.product_id == created.id,
    )) == 1


def test_voice_price_update_and_customer_payment_persist(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    butter_id = UUID("00000000-0000-0000-0000-000000000020")
    price_response = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "price-update-butter"},
        json={"query": "Amul Butter ka price 350 kar do"},
    )
    assert price_response.status_code == 200
    assert price_response.json()["action_result"]["selling_price"] == "350"
    assert client.get("/api/v1/products", headers=headers).json()["items"][0]["selling_price"] == "350.00"

    customer = client.post("/api/v1/customers", headers=headers, json={"name": "Ramesh"}).json()
    session.add(
        CustomerLedgerEntry(
            business_id=BUSINESS_ID,
            customer_id=UUID(customer["id"]),
            transaction_type="opening_balance",
            amount_delta=Decimal("500"),
        )
    )
    session.commit()
    paid = client.post(
        "/api/v1/ask",
        headers={**headers, "Idempotency-Key": "voice-payment-200"},
        json={"query": "Ramesh ne 200 rupaye de diye"},
    )
    balance = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"query": "Ramesh ka kitna udhar pending hai"},
    )

    assert paid.status_code == 200
    assert "Outstanding balance ₹300.00" in paid.json()["message"]
    assert balance.status_code == 200
    assert balance.json()["action_result"]["outstanding_balance"] == "300.00"
    assert session.scalar(select(func.count(CustomerLedgerEntry.id))) == 2


def test_destructive_voice_command_never_changes_data_without_implemented_confirmation(client, session):
    before_products = session.scalar(select(func.count(Product.id)))
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token", "Idempotency-Key": "delete-request"},
        json={"query": "delete Amul Butter", "confirmation": True},
    )

    assert response.status_code == 200
    assert response.json()["clarification_required"]
    assert "not enabled" in response.json()["message"]
    assert session.scalar(select(func.count(Product.id))) == before_products




def test_ai_provider_rejects_non_object_json_responses(monkeypatch):
    provider_response = json.dumps(
        {"choices": [{"message": {"content": "[]"}}]}
    ).encode()
    monkeypatch.setattr("app.ai_service.ai_is_configured", lambda: True)
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: BytesIO(provider_response),
    )

    with pytest.raises(AIProviderError, match="invalid response"):
        extract_product_query("How much butter is left?")


def test_ai_provider_rejects_oversized_responses(monkeypatch):
    monkeypatch.setattr("app.ai_service.ai_is_configured", lambda: True)
    monkeypatch.setattr(
        "app.ai_service.urlopen",
        lambda *_args, **_kwargs: BytesIO(b"x" * 32_769),
    )

    with pytest.raises(AIProviderError, match="oversized response"):
        extract_product_query("How much butter is left?")


def test_dashboard_reports_real_tenant_inventory_aggregates(client):
    assert client.get("/api/v1/dashboard").status_code == 401
    response = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    data = response.json()
    assert data["product_count"] == 1
    assert data["total_stock_units"] == "23.000"
    assert data["stock_by_unit"] == [
        {"unit": "packet", "quantity": "23.000", "display_quantity": "23 packets"}
    ]
    assert data["low_stock_count"] == 0
    assert data["out_of_stock_count"] == 0
    assert {location["name"]: location["stock_by_unit"] for location in data["stock_by_location"]} == {
        "Storeroom": [{"unit": "packet", "quantity": "3.000", "display_quantity": "3 packets"}],
        "Storeroom > Rack B > Shelf 2": [
            {"unit": "packet", "quantity": "20.000", "display_quantity": "20 packets"}
        ],
    }
    assert data["recent_stock_activity"] == []
    assert "today_sales" not in data
    assert "customer_credit" not in data


def test_dashboard_reports_low_stock_and_recent_activity(client, session):
    milk = Product(
        id=UUID("00000000-0000-0000-0000-000000000070"),
        business_id=BUSINESS_ID,
        name="Milk",
        unit="packet",
        minimum_stock=Decimal("5"),
    )
    out_of_stock = Product(
        id=UUID("00000000-0000-0000-0000-000000000073"),
        business_id=BUSINESS_ID,
        name="Bread",
        unit="loaf",
        minimum_stock=Decimal("3"),
    )
    session.add_all([milk, out_of_stock])
    session.flush()
    session.add_all(
        [
            InventoryBalance(
                business_id=BUSINESS_ID,
                product_id=milk.id,
                location_id=UUID("00000000-0000-0000-0000-000000000010"),
                quantity=Decimal("2"),
            ),
            StockMovement(
                business_id=BUSINESS_ID,
                product_id=milk.id,
                destination_location_id=UUID("00000000-0000-0000-0000-000000000010"),
                movement_type="purchase_receipt",
                quantity_change=Decimal("2"),
                initiated_by="test",
            ),
        ]
    )
    session.commit()

    response = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    data = response.json()
    assert data["low_stock_count"] == 1
    assert data["out_of_stock_count"] == 1
    assert data["low_stock_products"][0]["name"] == "Milk"
    assert data["low_stock_products"][0]["quantity"] == "2.000"
    assert data["low_stock_products"][0]["display_quantity"] == "2 packets"
    assert data["recent_stock_activity"][0]["display_quantity"] == "2 packets"
    assert data["recent_stock_activity"][0]["product_name"] == "Milk"


def test_stock_movement_history_returns_tenant_scoped_location_paths(client, session):
    session.add(
        StockMovement(
            business_id=BUSINESS_ID,
            product_id=UUID("00000000-0000-0000-0000-000000000020"),
            source_location_id=UUID("00000000-0000-0000-0000-000000000012"),
            destination_location_id=UUID("00000000-0000-0000-0000-000000000010"),
            movement_type="transfer",
            quantity_change=Decimal("2"),
            note="Reorganized",
            initiated_by="test",
        )
    )
    session.commit()

    response = client.get("/api/v1/stock-movements?limit=10", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    movement = response.json()["items"][0]
    assert movement["product_name"] == "Amul Butter"
    assert movement["display_quantity"] == "2 packets"
    assert movement["source_location"] == "Storeroom > Rack B > Shelf 2"
    assert movement["destination_location"] == "Storeroom"
    assert movement["note"] == "Reorganized"


def test_product_api_reports_backend_calculated_stock_status(client, session):
    low_stock = Product(
        id=UUID("00000000-0000-0000-0000-000000000075"),
        business_id=BUSINESS_ID,
        name="Milk",
        unit="packet",
        minimum_stock=Decimal("5"),
    )
    out_of_stock = Product(
        id=UUID("00000000-0000-0000-0000-000000000076"),
        business_id=BUSINESS_ID,
        name="Bread",
        unit="loaf",
        minimum_stock=Decimal("3"),
    )
    inactive = Product(
        id=UUID("00000000-0000-0000-0000-000000000077"),
        business_id=BUSINESS_ID,
        name="Old item",
        unit="box",
        minimum_stock=Decimal("2"),
        active=False,
    )
    session.add_all([low_stock, out_of_stock, inactive])
    session.flush()
    session.add_all(
        [
            InventoryBalance(
                business_id=BUSINESS_ID,
                product_id=low_stock.id,
                location_id=UUID("00000000-0000-0000-0000-000000000010"),
                quantity=Decimal("2"),
            ),
            InventoryBalance(
                business_id=BUSINESS_ID,
                product_id=inactive.id,
                location_id=UUID("00000000-0000-0000-0000-000000000010"),
                quantity=Decimal("2"),
            ),
        ]
    )
    session.commit()

    response = client.get("/api/v1/products", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    statuses = {item["name"]: item["stock_status"] for item in response.json()["items"]}
    assert statuses == {
        "Amul Butter": "in_stock",
        "Bread": "out_of_stock",
        "Milk": "low_stock",
        "Old item": "inactive",
    }


def test_dashboard_returns_zero_counts_for_empty_business(client, session, monkeypatch):
    empty_business_id = UUID("00000000-0000-0000-0000-000000000099")
    session.add(Business(id=empty_business_id, name="Empty Shop"))
    session.commit()
    monkeypatch.setattr("app.main.settings.dev_business_id", str(empty_business_id))

    response = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    assert response.json()["product_count"] == 0
    assert response.json()["total_stock_units"] == "0"
    assert response.json()["low_stock_products"] == []
    assert response.json()["stock_by_unit"] == []
    assert response.json()["stock_by_location"] == []
    assert response.json()["recent_stock_activity"] == []


def test_dashboard_keeps_different_units_separate(client, session):
    rice = Product(
        id=UUID("00000000-0000-0000-0000-000000000071"),
        business_id=BUSINESS_ID,
        name="Rice",
        unit="bag",
    )
    session.add(rice)
    session.flush()
    session.add(
        InventoryBalance(
            business_id=BUSINESS_ID,
            product_id=rice.id,
            location_id=UUID("00000000-0000-0000-0000-000000000010"),
            quantity=Decimal("4"),
        )
    )
    session.commit()

    response = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"})
    data = response.json()

    assert data["stock_by_unit"] == [
        {"unit": "bag", "quantity": "4.000", "display_quantity": "4 bags"},
        {"unit": "packet", "quantity": "23.000", "display_quantity": "23 packets"},
    ]
    assert data["total_stock_units"] is None
    storeroom = next(item for item in data["stock_by_location"] if item["name"] == "Storeroom")
    assert storeroom["stock_by_unit"] == [
        {"unit": "bag", "quantity": "4.000", "display_quantity": "4 bags"},
        {"unit": "packet", "quantity": "3.000", "display_quantity": "3 packets"},
    ]


def test_dashboard_total_ignores_zero_stock_products_in_other_units(client, session):
    session.add(
        Product(
            id=UUID("00000000-0000-0000-0000-000000000075"),
            business_id=BUSINESS_ID,
            name="Empty flour",
            unit="bag",
        )
    )
    session.commit()

    data = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"}).json()

    assert data["stock_by_unit"] == [
        {"unit": "packet", "quantity": "23.000", "display_quantity": "23 packets"}
    ]
    assert data["total_stock_units"] == "23.000"


def test_dashboard_location_aggregates_exclude_inactive_products(client, session):
    product_id = UUID("00000000-0000-0000-0000-000000000074")
    session.add(
        Product(
            id=product_id,
            business_id=BUSINESS_ID,
            name="Archived Rice",
            unit="bag",
            active=False,
        )
    )
    session.flush()
    session.add(
        InventoryBalance(
            business_id=BUSINESS_ID,
            product_id=product_id,
            location_id=UUID("00000000-0000-0000-0000-000000000010"),
            quantity=Decimal("7"),
        )
    )
    session.commit()

    data = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"}).json()
    storeroom = next(item for item in data["stock_by_location"] if item["name"] == "Storeroom")

    assert data["product_count"] == 1
    assert data["stock_by_unit"] == [
        {"unit": "packet", "quantity": "23.000", "display_quantity": "23 packets"}
    ]
    assert storeroom["product_count"] == 1
    assert storeroom["stock_by_unit"] == [
        {"unit": "packet", "quantity": "3.000", "display_quantity": "3 packets"}
    ]
    inventory = client.get("/api/v1/products", headers={"X-Dev-Token": "local-test-token"}).json()
    archived = next(item for item in inventory["items"] if item["id"] == str(product_id))
    assert archived["active"] is False


def test_request_cannot_select_another_business(client):
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "Other Butter", "business_id": str(OTHER_BUSINESS_ID)},
    )

    assert response.status_code == 422


def test_receipt_and_transfer_update_balances_and_append_movements(client, session):
    destination = client.post(
        "/api/v1/locations",
        headers={"X-Dev-Token": "local-test-token"},
        json={"name": "Dispatch shelf"},
    )
    assert destination.status_code == 201
    product = client.post(
        "/api/v1/products",
        headers={"X-Dev-Token": "local-test-token"},
        json={"name": "Rice", "unit": "bag", "aliases": ["चावल"]},
    )
    assert product.status_code == 201
    receipt = client.post(
        "/api/v1/inventory/receipts",
        headers={"X-Dev-Token": "local-test-token"},
        json={
            "product_id": product.json()["id"],
            "location_id": "00000000-0000-0000-0000-000000000010",
            "quantity": "10",
        },
    )
    assert receipt.status_code == 201
    transfer = client.post(
        "/api/v1/inventory/transfers",
        headers={"X-Dev-Token": "local-test-token"},
        json={
            "product_id": product.json()["id"],
            "source_location_id": "00000000-0000-0000-0000-000000000010",
            "destination_location_id": destination.json()["id"],
            "quantity": "3",
        },
    )

    assert transfer.status_code == 200
    assert transfer.json()["quantity"] == "7.000"
    assert session.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.business_id == BUSINESS_ID,
            InventoryBalance.product_id == UUID(product.json()["id"]),
            InventoryBalance.location_id == UUID(destination.json()["id"]),
        )
    ) == Decimal("3.000")
    assert session.scalar(
        select(func.count(StockMovement.id)).where(
            StockMovement.business_id == BUSINESS_ID,
            StockMovement.product_id == UUID(product.json()["id"]),
        )
    ) == 3


def test_product_create_update_and_inventory_reads_are_persisted_and_tenant_scoped(client):
    headers = {"X-Dev-Token": "local-test-token"}
    created = client.post(
        "/api/v1/products",
        headers=headers,
        json={"name": "Fresh Rice", "sku": "R-10", "unit": "bag", "minimum_stock": "2", "aliases": ["chawal"]},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    updated = client.put(
        f"/api/v1/products/{product_id}",
        headers=headers,
        json={"name": "Basmati Rice", "selling_price": "56.00", "minimum_stock": "3", "aliases": ["चावल"]},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Basmati Rice"
    assert updated.json()["selling_price"] == "56.00"
    assert format_quantity(Decimal(updated.json()["minimum_stock"])) == "3"
    assert updated.json()["display_quantity"] == "0 bags"
    assert updated.json()["display_minimum_stock"] == "3 bags"
    assert updated.json()["aliases"] == ["चावल"]
    same_alias_update = client.put(
        f"/api/v1/products/{product_id}",
        headers=headers,
        json={"aliases": ["चावल"]},
    )
    assert same_alias_update.status_code == 200
    cleared_sku = client.put(
        f"/api/v1/products/{product_id}",
        headers=headers,
        json={"sku": None},
    )
    assert cleared_sku.status_code == 200
    assert cleared_sku.json()["sku"] is None

    products = client.get("/api/v1/products", headers=headers)
    locations = client.get("/api/v1/locations", headers=headers)
    assert products.status_code == locations.status_code == 200
    assert [item["name"] for item in products.json()["items"]] == ["Amul Butter", "Basmati Rice"]
    assert all(item["name"] != "Other Butter" for item in products.json()["items"])
    assert {item["full_name"] for item in locations.json()["items"]} == {
        "Storeroom",
        "Storeroom > Rack B",
        "Storeroom > Rack B > Shelf 2",
    }


def test_stock_receipt_adjustments_and_transfer_preserve_total_and_record_movements(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    product_id = "00000000-0000-0000-0000-000000000020"
    shelf_id = "00000000-0000-0000-0000-000000000012"
    storeroom_id = "00000000-0000-0000-0000-000000000010"
    receipt = client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": product_id, "location_id": shelf_id, "quantity": "5", "unit": "packet"},
    )
    assert receipt.status_code == 201
    assert "25 packets" in receipt.json()["message"]
    balances = client.get("/api/v1/products", headers=headers).json()["items"][0]["balances"]
    shelf_balance = next(balance for balance in balances if balance["location_id"] == shelf_id)
    assert shelf_balance["display_quantity"] == "25 packets"

    adjustment_up = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={"product_id": product_id, "location_id": shelf_id, "quantity_change": "2", "unit": "packet"},
    )
    adjustment_down = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={"product_id": product_id, "location_id": shelf_id, "quantity_change": "-4", "unit": "packet"},
    )
    assert adjustment_up.status_code == adjustment_down.status_code == 200
    assert adjustment_down.json()["quantity"] == "23.000"
    assert "23 packets" in adjustment_down.json()["message"]

    transfer = client.post(
        "/api/v1/inventory/transfers",
        headers=headers,
        json={
            "product_id": product_id,
            "source_location_id": shelf_id,
            "destination_location_id": storeroom_id,
            "quantity": "2",
            "unit": "packet",
        },
    )
    assert transfer.status_code == 200
    assert transfer.json()["quantity"] == "21.000"
    inventory = client.get("/api/v1/products", headers=headers).json()["items"][0]
    assert inventory["quantity"] == "26.000"
    assert {item["location_id"]: item["quantity"] for item in inventory["balances"]} == {
        shelf_id: "21.000",
        storeroom_id: "5.000",
    }
    assert session.scalar(select(func.count(StockMovement.id))) == 5
    assert session.scalar(
        select(func.count(StockMovement.id)).where(StockMovement.movement_type == "purchase_receipt")
    ) == 1
    assert session.scalar(
        select(func.count(StockMovement.id)).where(StockMovement.movement_type == "adjustment")
    ) == 2
    assert session.scalar(
        select(func.count(StockMovement.id)).where(StockMovement.movement_type.in_(("transfer_out", "transfer_in")))
    ) == 2


def test_receipt_then_transfer_matches_requested_balance_sequence(client, session, monkeypatch):
    business_id = UUID("00000000-0000-0000-0000-000000000098")
    source_id = UUID("00000000-0000-0000-0000-000000000091")
    destination_id = UUID("00000000-0000-0000-0000-000000000092")
    product_id = UUID("00000000-0000-0000-0000-000000000093")
    session.add(Business(id=business_id, name="Sequence Test Shop"))
    session.flush()
    session.add_all(
        [
            Location(id=source_id, business_id=business_id, name="Shelf 2"),
            Location(id=destination_id, business_id=business_id, name="Back Shelf"),
            Product(id=product_id, business_id=business_id, name="Amul Butter", unit="packet"),
        ]
    )
    session.flush()
    session.add(
        InventoryBalance(
            business_id=business_id,
            product_id=product_id,
            location_id=source_id,
            quantity=Decimal("20"),
        )
    )
    session.commit()
    monkeypatch.setattr("app.main.settings.dev_business_id", str(business_id))
    headers = {"X-Dev-Token": "local-test-token"}

    receipt = client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": str(product_id), "location_id": str(source_id), "quantity": "5"},
    )
    transfer = client.post(
        "/api/v1/inventory/transfers",
        headers=headers,
        json={
            "product_id": str(product_id),
            "source_location_id": str(source_id),
            "destination_location_id": str(destination_id),
            "quantity": "2",
        },
    )
    product = client.get("/api/v1/products", headers=headers).json()["items"][0]

    assert receipt.status_code == 201
    assert receipt.json()["quantity"] == "25.000"
    assert transfer.status_code == 200
    assert product["quantity"] == "25.000"
    assert product["display_quantity"] == "25 packets"
    assert {balance["location_id"]: balance["quantity"] for balance in product["balances"]} == {
        str(source_id): "23.000",
        str(destination_id): "2.000",
    }
    assert session.scalar(
        select(func.count(StockMovement.id)).where(StockMovement.business_id == business_id)
    ) == 3


def test_invalid_adjustment_location_unit_and_negative_balance_are_rejected(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    payload = {
        "product_id": "00000000-0000-0000-0000-000000000020",
        "location_id": "00000000-0000-0000-0000-000000000012",
        "quantity_change": "-21",
    }
    too_much = client.post("/api/v1/inventory/adjustments", headers=headers, json=payload)
    zero = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={**payload, "quantity_change": "0"},
    )
    wrong_unit = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={**payload, "quantity_change": "1", "unit": "kg"},
    )
    unknown_location = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={**payload, "location_id": "00000000-0000-0000-0000-000000000099", "quantity_change": "1"},
    )
    other_business = client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={**payload, "product_id": "00000000-0000-0000-0000-000000000021", "quantity_change": "1"},
    )
    assert too_much.status_code == 409
    assert zero.status_code == 422
    assert wrong_unit.status_code == 422
    assert unknown_location.status_code == 404
    assert other_business.status_code == 404
    assert session.scalar(select(func.count(StockMovement.id))) == 0


def test_receipt_rolls_back_balance_when_movement_persistence_fails(client, session):
    engine = session.get_bind()

    def fail_movement_insert(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("INSERT INTO STOCK_MOVEMENTS"):
            raise sqlite3.IntegrityError("forced stock movement write failure")

    event.listen(engine, "before_cursor_execute", fail_movement_insert)
    try:
        response = client.post(
            "/api/v1/inventory/receipts",
            headers={"X-Dev-Token": "local-test-token"},
            json={
                "product_id": "00000000-0000-0000-0000-000000000020",
                "location_id": "00000000-0000-0000-0000-000000000012",
                "quantity": "5",
            },
        )
    finally:
        event.remove(engine, "before_cursor_execute", fail_movement_insert)

    assert response.status_code == 409
    assert session.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.business_id == BUSINESS_ID,
            InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
            InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
        )
    ) == Decimal("20.000")
    assert session.scalar(select(func.count(StockMovement.id))) == 0


def test_stock_write_commits_when_dependency_has_already_started_transaction(client, session):
    original_dependency = app.dependency_overrides[get_db]

    def dependency_with_read():
        with Session(session.get_bind()) as request_session:
            request_session.scalar(select(Product.id).where(Product.business_id == BUSINESS_ID))
            yield request_session

    app.dependency_overrides[get_db] = dependency_with_read
    try:
        response = client.post(
            "/api/v1/inventory/receipts",
            headers={"X-Dev-Token": "local-test-token"},
            json={
                "product_id": "00000000-0000-0000-0000-000000000020",
                "location_id": "00000000-0000-0000-0000-000000000012",
                "quantity": "1",
            },
        )
    finally:
        app.dependency_overrides[get_db] = original_dependency

    assert response.status_code == 201
    assert session.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.business_id == BUSINESS_ID,
            InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
            InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000012"),
        )
    ) == Decimal("21.000")


def test_product_unit_cannot_change_after_stock_exists(client):
    response = client.put(
        "/api/v1/products/00000000-0000-0000-0000-000000000020",
        headers={"X-Dev-Token": "local-test-token"},
        json={"unit": "kg"},
    )
    assert response.status_code == 409


def test_product_update_rejects_null_and_cross_business_ids(client):
    headers = {"X-Dev-Token": "local-test-token"}
    null_name = client.put(
        "/api/v1/products/00000000-0000-0000-0000-000000000020",
        headers=headers,
        json={"name": None},
    )
    cross_tenant = client.put(
        "/api/v1/products/00000000-0000-0000-0000-000000000021",
        headers=headers,
        json={"name": "Changed other tenant product"},
    )
    assert null_name.status_code == 422
    assert cross_tenant.status_code == 404


def test_insufficient_transfer_rolls_back_without_movement(client, session):
    response = client.post(
        "/api/v1/inventory/transfers",
        headers={"X-Dev-Token": "local-test-token"},
        json={
            "product_id": "00000000-0000-0000-0000-000000000020",
            "source_location_id": "00000000-0000-0000-0000-000000000010",
            "destination_location_id": "00000000-0000-0000-0000-000000000011",
            "quantity": "100",
        },
    )

    assert response.status_code == 409
    assert session.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.business_id == BUSINESS_ID,
            InventoryBalance.product_id == UUID("00000000-0000-0000-0000-000000000020"),
            InventoryBalance.location_id == UUID("00000000-0000-0000-0000-000000000010"),
        )
    ) == Decimal("3.000")
    assert session.scalar(select(func.count(StockMovement.id))) == 0


def test_receipt_rejects_negative_and_cross_business_products(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    negative = client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "product_id": "00000000-0000-0000-0000-000000000020",
            "location_id": "00000000-0000-0000-0000-000000000010",
            "quantity": "-1",
        },
    )
    other_tenant = client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "product_id": "00000000-0000-0000-0000-000000000021",
            "location_id": "00000000-0000-0000-0000-000000000010",
            "quantity": "1",
        },
    )

    assert negative.status_code == 422
    assert other_tenant.status_code == 404
    assert session.scalar(select(func.count(StockMovement.id))) == 0
