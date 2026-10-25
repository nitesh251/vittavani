from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    Business,
    Customer,
    CustomerLedgerEntry,
    Location,
    Product,
    Sale,
    SaleLineItem,
)
from app.sales_analytics import (
    answer_business_question,
    classify_business_question,
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
        ("Sales trend this week", "trend"),
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
