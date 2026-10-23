from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    CustomerLedgerEntry,
    InventoryBalance,
    Location,
    Product,
    Sale,
    SaleLineItem,
    StockMovement,
)

MONEY_QUANTUM = Decimal("0.01")


def post_receipt(
    session: Session,
    business_id: UUID,
    product: Product,
    location_id: UUID,
    quantity: Decimal,
    *,
    note: str | None = None,
) -> Decimal:
    location = session.scalar(
        select(Location).where(Location.business_id == business_id, Location.id == location_id)
    )
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    balance = session.scalar(
        select(InventoryBalance)
        .where(
            InventoryBalance.business_id == business_id,
            InventoryBalance.product_id == product.id,
            InventoryBalance.location_id == location_id,
        )
        .with_for_update()
    )
    if balance is None:
        balance = InventoryBalance(
            business_id=business_id,
            product_id=product.id,
            location_id=location_id,
            quantity=quantity,
        )
        session.add(balance)
    else:
        balance.quantity += quantity
    session.add(
        StockMovement(
            business_id=business_id,
            product_id=product.id,
            destination_location_id=location_id,
            movement_type="purchase_receipt",
            quantity_change=quantity,
            initiated_by="voice-command",
            note=note,
        )
    )
    session.flush()
    return balance.quantity


def post_sale(
    session: Session,
    business_id: UUID,
    product: Product,
    location_id: UUID,
    quantity: Decimal,
    *,
    customer: Customer | None = None,
    paid_amount: Decimal | None = None,
    unit_price: Decimal | None = None,
    note: str | None = None,
) -> Sale:
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Sale quantity must be greater than zero")
    location = session.scalar(
        select(Location).where(Location.business_id == business_id, Location.id == location_id)
    )
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    balance = session.scalar(
        select(InventoryBalance)
        .where(
            InventoryBalance.business_id == business_id,
            InventoryBalance.product_id == product.id,
            InventoryBalance.location_id == location_id,
        )
        .with_for_update()
    )
    if balance is None or balance.quantity < quantity:
        raise HTTPException(status_code=409, detail="Insufficient stock at the selected location")

    price = (unit_price if unit_price is not None else product.selling_price).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
    total = (price * quantity).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    paid = total if paid_amount is None and customer is None else (paid_amount or Decimal("0"))
    paid = paid.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if paid < 0 or paid > total:
        raise HTTPException(status_code=422, detail="Payment must be between zero and the sale total")
    if customer is None and paid != total:
        raise HTTPException(status_code=422, detail="A customer is required for an unpaid or partial sale")

    if customer is not None:
        customer = session.scalar(
            select(Customer)
            .where(
                Customer.business_id == business_id,
                Customer.id == customer.id,
                Customer.active.is_(True),
            )
            .with_for_update()
        )
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found")
    balance.quantity -= quantity
    sale = Sale(
        business_id=business_id,
        customer_id=customer.id if customer else None,
        total_amount=total,
        paid_amount=paid,
    )
    session.add(sale)
    session.flush()
    session.add(
        SaleLineItem(
            business_id=business_id,
            sale_id=sale.id,
            product_id=product.id,
            location_id=location_id,
            quantity=quantity,
            unit_price=price,
            line_total=total,
        )
    )
    session.add(
        StockMovement(
            business_id=business_id,
            product_id=product.id,
            source_location_id=location_id,
            movement_type="sale",
            quantity_change=-quantity,
            reference=f"sale:{sale.id}",
            initiated_by="voice-command",
            note=note,
        )
    )
    debt = total - paid
    if customer is not None and debt > 0:
        session.add(
            CustomerLedgerEntry(
                business_id=business_id,
                customer_id=customer.id,
                sale_id=sale.id,
                transaction_type="credit_sale",
                amount_delta=debt,
                note=note,
            )
        )
    session.flush()
    return sale


def customer_balance(session: Session, business_id: UUID, customer_id: UUID) -> Decimal:
    entries = session.scalars(
        select(CustomerLedgerEntry.amount_delta).where(
            CustomerLedgerEntry.business_id == business_id,
            CustomerLedgerEntry.customer_id == customer_id,
        )
    )
    return sum(entries, Decimal("0"))


def post_customer_payment(
    session: Session,
    business_id: UUID,
    customer: Customer,
    amount: Decimal,
    *,
    note: str | None = None,
) -> Decimal:
    customer = session.scalar(
        select(Customer)
        .where(Customer.business_id == business_id, Customer.id == customer.id, Customer.active.is_(True))
        .with_for_update()
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    balance = customer_balance(session, business_id, customer.id)
    if amount > balance:
        raise HTTPException(status_code=409, detail="Payment cannot exceed the customer's outstanding balance")
    session.add(
        CustomerLedgerEntry(
            business_id=business_id,
            customer_id=customer.id,
            transaction_type="payment",
            amount_delta=-amount,
            note=note,
        )
    )
    session.flush()
    return balance - amount


def post_transfer(
    session: Session,
    business_id: UUID,
    product: Product,
    source_location_id: UUID,
    destination_location_id: UUID,
    quantity: Decimal,
    *,
    note: str | None = None,
) -> Decimal:
    if source_location_id == destination_location_id:
        raise HTTPException(status_code=422, detail="Source and destination must be different locations")
    locations = session.scalars(
        select(Location).where(
            Location.business_id == business_id,
            Location.id.in_([source_location_id, destination_location_id]),
        )
    ).all()
    if len(locations) != 2:
        raise HTTPException(status_code=404, detail="Source or destination location not found")
    balances = session.scalars(
        select(InventoryBalance)
        .where(
            InventoryBalance.business_id == business_id,
            InventoryBalance.product_id == product.id,
            InventoryBalance.location_id.in_([source_location_id, destination_location_id]),
        )
        .order_by(InventoryBalance.location_id)
        .with_for_update()
    ).all()
    by_location = {balance.location_id: balance for balance in balances}
    source = by_location.get(source_location_id)
    if source is None or source.quantity < quantity:
        raise HTTPException(status_code=409, detail="Insufficient stock at the source location")
    destination = by_location.get(destination_location_id)
    source.quantity -= quantity
    if destination is None:
        destination = InventoryBalance(
            business_id=business_id,
            product_id=product.id,
            location_id=destination_location_id,
            quantity=quantity,
        )
        session.add(destination)
    else:
        destination.quantity += quantity
    session.add_all(
        [
            StockMovement(
                business_id=business_id,
                product_id=product.id,
                source_location_id=source_location_id,
                destination_location_id=destination_location_id,
                movement_type=movement_type,
                quantity_change=change,
                initiated_by="voice-command",
                note=note,
            )
            for movement_type, change in (("transfer_out", -quantity), ("transfer_in", quantity))
        ]
    )
    session.flush()
    return source.quantity
