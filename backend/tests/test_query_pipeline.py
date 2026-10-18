from decimal import Decimal
import sqlite3
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.formatting import format_quantity, format_quantity_label
from app.main import app
from app.models import Business, InventoryBalance, Location, Product, ProductAlias, StockMovement
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
    session.commit()

    result = lookup_product(session, BUSINESS_ID, "Show low stock items.")

    assert result.candidates == ("Milk (2 packets)",)
    assert "Amul Butter" not in result.message


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("20"), "20"),
        (Decimal("20.000"), "20"),
        (Decimal("0"), "0"),
        (Decimal("0.125"), "0.125"),
        (Decimal("100000000000000000000000.125"), "100000000000000000000000.125"),
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
    response = client.post(
        "/api/v1/ask",
        headers={"X-Dev-Token": "local-test-token"},
        json={"query": "Where is Amul Butter?"},
    )

    assert response.status_code == 200
    assert response.json()["product_name"] == "Amul Butter"
    assert response.json()["original_query"] == "Where is Amul Butter?"


def test_dashboard_reports_real_tenant_inventory_aggregates(client):
    assert client.get("/api/v1/dashboard").status_code == 401
    response = client.get("/api/v1/dashboard", headers={"X-Dev-Token": "local-test-token"})

    assert response.status_code == 200
    data = response.json()
    assert data["product_count"] == 1
    assert data["total_stock_units"] == "23.000"
    assert data["stock_by_unit"] == [{"unit": "packet", "quantity": "23.000"}]
    assert data["low_stock_count"] == 0
    assert data["out_of_stock_count"] == 0
    assert {location["name"]: location["stock_by_unit"] for location in data["stock_by_location"]} == {
        "Storeroom": [{"unit": "packet", "quantity": "3.000"}],
        "Storeroom > Rack B > Shelf 2": [{"unit": "packet", "quantity": "20.000"}],
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
    session.add(milk)
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
    assert data["low_stock_products"][0]["name"] == "Milk"
    assert data["low_stock_products"][0]["quantity"] == "2.000"
    assert data["recent_stock_activity"][0]["product_name"] == "Milk"


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
        {"unit": "bag", "quantity": "4.000"},
        {"unit": "packet", "quantity": "23.000"},
    ]
    assert data["total_stock_units"] is None
    storeroom = next(item for item in data["stock_by_location"] if item["name"] == "Storeroom")
    assert storeroom["stock_by_unit"] == [
        {"unit": "bag", "quantity": "4.000"},
        {"unit": "packet", "quantity": "3.000"},
    ]


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
    assert updated.json()["minimum_stock"] == "3.000"
    assert updated.json()["aliases"] == ["चावल"]

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


def test_invalid_adjustment_location_unit_and_negative_balance_are_rejected(client, session):
    headers = {"X-Dev-Token": "local-test-token"}
    payload = {
        "product_id": "00000000-0000-0000-0000-000000000020",
        "location_id": "00000000-0000-0000-0000-000000000012",
        "quantity_change": "-21",
    }
    too_much = client.post("/api/v1/inventory/adjustments", headers=headers, json=payload)
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


def test_product_unit_cannot_change_after_stock_exists(client):
    response = client.put(
        "/api/v1/products/00000000-0000-0000-0000-000000000020",
        headers={"X-Dev-Token": "local-test-token"},
        json={"unit": "kg"},
    )
    assert response.status_code == 409


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
