from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.main import AskRequest, ask, dashboard
from app.models import (
    Business,
    Customer,
    CustomerLedgerEntry,
    InventoryBalance,
    Location,
    Product,
    Sale,
    SaleLineItem,
)
from app.sales_analytics import (
    answer_business_question,
    classify_business_question,
    previous_calendar_week_sales,
    sales_overview,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    Base.metadata.drop_all(engine)
    engine.dispose()


def record_sale(
    session: Session,
    business_id,
    product_id,
    location_id,
    created_at: datetime,
    *,
    total: str,
    quantity: str,
) -> None:
    sale_id = uuid4()
    session.add(
        Sale(
            id=sale_id,
            business_id=business_id,
            total_amount=Decimal(total),
            paid_amount=Decimal(total),
            created_at=created_at,
        )
    )
    session.add(
        SaleLineItem(
            id=uuid4(),
            business_id=business_id,
            sale_id=sale_id,
            product_id=product_id,
            location_id=location_id,
            quantity=Decimal(quantity),
            unit_price=Decimal(total) / Decimal(quantity),
            line_total=Decimal(total),
        )
    )


def test_sales_overview_uses_business_midnight_and_isolates_businesses(session: Session):
    business = Business(id=uuid4(), name="Example", timezone="Asia/Kolkata")
    other_business = Business(id=uuid4(), name="Other", timezone="Asia/Kolkata")
    session.add_all([business, other_business])
    session.flush()
    location = Location(id=uuid4(), business_id=business.id, name="Shop")
    other_location = Location(id=uuid4(), business_id=other_business.id, name="Other shop")
    product = Product(id=uuid4(), business_id=business.id, name="Tea", unit="packet")
    other_product = Product(id=uuid4(), business_id=other_business.id, name="Coffee", unit="packet")
    session.add_all([location, other_location, product, other_product])
    session.flush()

    now = datetime(2026, 10, 24, 0, 30, tzinfo=UTC)
    record_sale(
        session, business.id, product.id, location.id,
        datetime(2026, 10, 23, 18, 29, tzinfo=UTC),
        total="10.00", quantity="2",
    )
    record_sale(
        session, business.id, product.id, location.id,
        datetime(2026, 10, 23, 18, 30, tzinfo=UTC),
        total="15.00", quantity="3",
    )
    record_sale(
        session, other_business.id, other_product.id, other_location.id,
        datetime(2026, 10, 23, 19, 0, tzinfo=UTC),
        total="999.00", quantity="99",
    )
    session.add(
        CustomerLedgerEntry(
            id=uuid4(),
            business_id=business.id,
            customer_id=uuid4(),
            transaction_type="manual_credit",
            amount_delta=Decimal("12.50"),
        )
    )
    session.flush()

    overview = sales_overview(session, business.id, business.timezone, now=now)

    assert overview["today"]["total_amount"] == "15.00"
    assert overview["today"]["sale_count"] == 1
    assert overview["today"]["quantity_by_unit"] == [{"unit": "packet", "quantity": "3"}]
    assert overview["current_period"]["total_amount"] == "25.00"
    assert overview["top_products"] == [
        {"product_id": str(product.id), "name": "Tea", "quantity": "5", "unit": "packet"}
    ]
    assert overview["pending_customer_balances"] == "12.50"
    assert len(overview["trend"]) == 7
    assert overview["sales_status_note"].startswith("Sales records represent recorded sales")


def test_sales_overview_and_question_answer_handle_no_recorded_sales(session: Session):
    business = Business(id=uuid4(), name="Empty", timezone="Asia/Kolkata")
    session.add(business)
    session.flush()

    overview = sales_overview(
        session,
        business.id,
        business.timezone,
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )
    answer = answer_business_question(
        session,
        business.id,
        business.timezone,
        "Which products sold the most this week?",
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )

    assert overview["today"]["total_amount"] == "0.00"
    assert overview["top_products"] == []
    assert answer is not None
    assert "not enough data" in answer[0]


@pytest.mark.parametrize(
    ("question", "intent"),
    [
        ("How much were sales today?", "today"),
        ("How many units were sold today?", "today"),
        ("How much sales did I make this month?", "month"),
        ("Monthly sales", "month"),
        ("Is mahine ki bikri kitni hui?", "month"),
        ("Sales trend this week", "trend"),
        ("How much were sales last week?", "last_week"),
        ("Which products sold the most last week?", "last_week_top_products"),
        ("What products did we sell last week?", "last_week_top_products"),
        ("How is my business doing?", "trend"),
        ("Which products sold the most this week?", "top_products"),
        ("Aaj ki bikri kitni hai?", "today"),
        ("Sabse zyada bikne wale products kaun se hain?", "top_products"),
        ("What should I restock?", "restock"),
        ("How can I improve sales?", "improve"),
    ],
)
def test_business_question_classification(question: str, intent: str):
    assert classify_business_question(question) == intent


def test_business_question_classifier_does_not_capture_mutations():
    assert classify_business_question("Receive 5 packets of Amul Butter") is None
    assert classify_business_question("5 Amul Butter bik gaya") is None
    assert classify_business_question("5 packets Amul Butter sold today") is None


def test_dashboard_and_ask_endpoints_return_verified_sales_data(session: Session):
    business = Business(id=uuid4(), name="Shop", timezone="Asia/Kolkata")
    session.add(business)
    session.flush()

    dashboard_result = dashboard(business_id=business.id, session=session)
    answer = ask(
        AskRequest(query="Which products sold the most this week?", mode="ai"),
        idempotency_key=None,
        business_id=business.id,
        session=session,
    )

    assert dashboard_result.sales_overview.today.total_amount == "0.00"
    assert len(dashboard_result.sales_overview.trend) == 7
    assert answer.intent == "business_insight"
    assert "not enough data" in answer.message
    assert answer.provider is None


def test_restock_answer_uses_current_stock_and_recent_sales_velocity(session: Session):
    business = Business(id=uuid4(), name="Shop", timezone="Asia/Kolkata")
    session.add(business)
    session.flush()
    location = Location(id=uuid4(), business_id=business.id, name="Shop")
    product = Product(
        id=uuid4(),
        business_id=business.id,
        name="Tea",
        unit="packet",
        minimum_stock=Decimal("5"),
    )
    session.add_all([location, product])
    session.flush()
    session.add(
        InventoryBalance(
            id=uuid4(),
            business_id=business.id,
            product_id=product.id,
            location_id=location.id,
            quantity=Decimal("10"),
        )
    )
    now = datetime(2026, 10, 24, 0, 30, tzinfo=UTC)
    record_sale(
        session,
        business.id,
        product.id,
        location.id,
        datetime(2026, 10, 23, 12, 0, tzinfo=UTC),
        total="600.00",
        quantity="60",
    )
    session.flush()

    answer = answer_business_question(
        session,
        business.id,
        business.timezone,
        "What should I restock?",
        now=now,
    )

    assert answer is not None
    assert answer[1]["restock_candidates"][0]["name"] == "Tea"
    assert answer[1]["restock_candidates"][0]["coverage_days"] == "5.0"
    assert "not a forecast" in answer[0]


def test_last_week_questions_use_previous_local_calendar_week(session: Session):
    business = Business(id=uuid4(), name="Shop", timezone="Asia/Kolkata")
    session.add(business)
    session.flush()
    location = Location(id=uuid4(), business_id=business.id, name="Shop")
    product = Product(id=uuid4(), business_id=business.id, name="Tea", unit="packet")
    session.add_all([location, product])
    session.flush()
    record_sale(
        session,
        business.id,
        product.id,
        location.id,
        datetime(2026, 10, 18, 18, 29, tzinfo=UTC),
        total="10.00",
        quantity="2",
    )
    record_sale(
        session,
        business.id,
        product.id,
        location.id,
        datetime(2026, 10, 19, 18, 30, tzinfo=UTC),
        total="20.00",
        quantity="4",
    )
    session.flush()

    report = previous_calendar_week_sales(
        session,
        business.id,
        business.timezone,
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )
    answer = answer_business_question(
        session,
        business.id,
        business.timezone,
        "How much were sales last week?",
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )
    product_answer = answer_business_question(
        session,
        business.id,
        business.timezone,
        "What products did we sell last week?",
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )

    assert report["period_start"] == "2026-10-12"
    assert report["period_end"] == "2026-10-18"
    assert report["total_amount"] == "10.00"
    assert report["sale_count"] == 1
    assert answer is not None
    assert "2026-10-12 to 2026-10-18" in answer[0]
    assert product_answer is not None
    assert "Top products by recorded quantity last week" in product_answer[0]
    assert "Tea: 2 packet" in product_answer[0]


def test_month_to_date_sales_use_local_month_boundary_and_business_scope(session: Session):
    business = Business(id=uuid4(), name="Shop", timezone="Asia/Kolkata")
    other_business = Business(id=uuid4(), name="Other", timezone="Asia/Kolkata")
    session.add_all([business, other_business])
    session.flush()
    location = Location(id=uuid4(), business_id=business.id, name="Shop")
    other_location = Location(id=uuid4(), business_id=other_business.id, name="Other")
    product = Product(id=uuid4(), business_id=business.id, name="Tea", unit="packet")
    other_product = Product(id=uuid4(), business_id=other_business.id, name="Coffee", unit="packet")
    session.add_all([location, other_location, product, other_product])
    session.flush()

    record_sale(
        session, business.id, product.id, location.id,
        datetime(2026, 9, 30, 18, 29, tzinfo=UTC),
        total="999.00", quantity="99",
    )
    record_sale(
        session, business.id, product.id, location.id,
        datetime(2026, 9, 30, 18, 30, tzinfo=UTC),
        total="10.00", quantity="2",
    )
    record_sale(
        session, business.id, product.id, location.id,
        datetime(2026, 10, 23, 18, 30, tzinfo=UTC),
        total="15.00", quantity="3",
    )
    record_sale(
        session, other_business.id, other_product.id, other_location.id,
        datetime(2026, 10, 23, 19, 0, tzinfo=UTC),
        total="999.00", quantity="99",
    )
    session.flush()

    answer = answer_business_question(
        session,
        business.id,
        business.timezone,
        "How much sales did I make this month?",
        now=datetime(2026, 10, 24, 0, 30, tzinfo=UTC),
    )

    assert answer is not None
    assert answer[1] == {
        "intent": "month",
        "month": "2026-10",
        "period_start": "2026-10-01",
        "period_end": "2026-10-24",
        "currency": "INR",
        "total_amount": "25.00",
        "sale_count": 2,
    }
    assert "month to date" in answer[0]
    assert "INR 25.00 across 2 sale(s)" in answer[0]
