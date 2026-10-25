from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.business_actions import (
    customer_balance,
    post_customer_payment,
    post_receipt,
    post_sale,
    post_transfer,
)
from app.command_service import BusinessCommand, CommandIntent
from app.formatting import format_quantity_label
from app.location_paths import location_paths
from app.models import Customer, CustomerLedgerEntry, InventoryBalance, Location, Product, ProductAlias
from app.query_service import lookup_product
from app.query_understanding import Candidate, Intent, resolve_product

_UNIT_CANONICAL = {
    "packets": "packet",
    "pkt": "packet",
    "pkts": "packet",
    "pieces": "piece",
    "pcs": "piece",
    "units": "unit",
    "bottles": "bottle",
    "kgs": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "gram": "g",
    "grams": "g",
    "liters": "litre",
    "litres": "litre",
    "liter": "litre",
    "पैकेट": "packet",
    "पैकेट्स": "packet",
    "पीस": "piece",
    "लिटर": "litre",
    "किलो": "kg",
}


def _unit_key(unit: str) -> str:
    normalized = unit.strip().casefold()
    return _UNIT_CANONICAL.get(normalized, normalized)


def _clarification(message: str, *, candidates: list[str] | None = None) -> dict[str, object]:
    return {
        "intent": CommandIntent.CLARIFY.value,
        "message": message,
        "candidates": candidates or [],
        "locations": [],
        "clarification_required": True,
        "product_name": None,
        "quantity": None,
        "unit": None,
        "action_result": None,
    }


def _products(session: Session, business_id: UUID) -> list[Product]:
    return session.scalars(
        select(Product).where(Product.business_id == business_id, Product.active.is_(True))
    ).all()


def _resolve_product(
    session: Session, business_id: UUID, query: str | None
) -> tuple[Product | None, list[str]]:
    if not query:
        return None, []
    products = _products(session, business_id)
    aliases: dict[UUID, list[str]] = {product.id: [] for product in products}
    if products:
        for alias in session.scalars(
            select(ProductAlias).where(
                ProductAlias.business_id == business_id,
                ProductAlias.product_id.in_([product.id for product in products]),
            )
        ):
            aliases[alias.product_id].append(alias.alias)
    resolution = resolve_product(
        query,
        [
            Candidate(product_id=product.id, name=product.name, aliases=tuple(aliases[product.id]))
            for product in products
        ],
    )
    if resolution.ambiguous:
        return None, [candidate.name for candidate in resolution.candidates]
    if resolution.product is None:
        return None, []
    product = session.scalar(
        select(Product)
        .where(
            Product.business_id == business_id,
            Product.id == resolution.product.product_id,
            Product.active.is_(True),
        )
        .with_for_update()
    )
    return product, []


def _resolve_customer(
    session: Session, business_id: UUID, query: str | None
) -> tuple[Customer | None, list[str]]:
    if not query:
        return None, []
    term = query.strip().casefold()
    digits = "".join(character for character in query if character.isdigit())
    customers = session.scalars(
        select(Customer).where(Customer.business_id == business_id, Customer.active.is_(True))
    ).all()
    matches = [
        customer for customer in customers
        if customer.name.casefold() == term or (digits and customer.phone == digits)
    ]
    if len(matches) > 1:
        return None, [f"{customer.name} ({customer.phone or 'no phone'})" for customer in matches]
    return (matches[0], []) if matches else (None, [])


def _resolve_location(
    session: Session,
    business_id: UUID,
    query: str | None,
    *,
    product: Product | None = None,
    require_stock: bool = False,
) -> tuple[Location | None, list[str]]:
    locations = session.scalars(select(Location).where(Location.business_id == business_id)).all()
    paths = location_paths(session, business_id)
    candidates = locations
    if require_stock and product:
        stocked_ids = set(
            session.scalars(
                select(InventoryBalance.location_id).where(
                    InventoryBalance.business_id == business_id,
                    InventoryBalance.product_id == product.id,
                    InventoryBalance.quantity > 0,
                )
            )
        )
        candidates = [location for location in locations if location.id in stocked_ids]
    if query:
        term = query.strip().casefold()
        matches = [
            location for location in candidates
            if location.name.casefold() == term or paths.get(location.id, "").casefold() == term
        ]
        if len(matches) == 1:
            return matches[0], []
        return None, [paths.get(location.id, location.name) for location in matches]
    if len(candidates) == 1:
        return candidates[0], []
    return None, [paths.get(location.id, location.name) for location in candidates]


def _command_result(
    intent: str,
    message: str,
    *,
    product: Product | None = None,
    quantity: Decimal | None = None,
    candidates: list[str] | None = None,
    action_result: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "intent": intent,
        "message": message,
        "product_name": product.name if product else None,
        "quantity": str(quantity) if quantity is not None else None,
        "unit": product.unit if product else None,
        "locations": [],
        "candidates": candidates or [],
        "clarification_required": bool(candidates),
        "action_result": action_result,
    }


def execute_command(
    session: Session, business_id: UUID, command: BusinessCommand
) -> dict[str, object] | None:
    if command.intent == CommandIntent.CLARIFY:
        return _clarification("I need more details before I can safely make that change.")
    if command.intent == CommandIntent.UNSUPPORTED:
        return _clarification(
            "I can help with stock, product locations, sales, receipts, and transfers. "
            "I can't complete that request."
        )
    if command.intent == CommandIntent.DELETE_OR_REVERSE_RECORD:
        return _clarification(
            "Deleting customers/products and reversing posted transactions are not enabled yet; no records were changed."
        )
    if command.intent == CommandIntent.CORRECT_TRANSACTION:
        return _clarification(
            "Transaction corrections are not enabled yet; no records were changed."
        )
    if command.intent in {
        CommandIntent.STOCK_QUERY,
        CommandIntent.LOCATION_QUERY,
        CommandIntent.LOW_STOCK_QUERY,
    }:
        intent_map = {
            CommandIntent.STOCK_QUERY: Intent.STOCK,
            CommandIntent.LOCATION_QUERY: Intent.LOCATION,
            CommandIntent.LOW_STOCK_QUERY: Intent.LOW_STOCK,
        }
        result = lookup_product(
            session,
            business_id,
            command.product_query or "",
            interpreted_intent=intent_map[command.intent],
            interpreted_product=command.product_query,
        )
        return {
            "intent": result.intent,
            "message": result.message,
            "product_name": result.product_name,
            "quantity": str(result.quantity) if result.quantity is not None else None,
            "unit": result.unit,
            "locations": list(result.locations),
            "candidates": list(result.candidates),
            "clarification_required": result.clarification_required,
            "action_result": None,
        }

    if command.intent == CommandIntent.CREATE_CUSTOMER:
        name = (command.customer_query or "").strip()
        if not name:
            return _clarification("Tell me the customer's name to create the account.")
        if session.scalar(
            select(Customer.id).where(
                Customer.business_id == business_id,
                func.lower(Customer.name) == name.casefold(),
                Customer.active.is_(True),
            )
        ):
            return _clarification("A customer with this name already exists. Use the customer screen to select or distinguish them.")
        customer = Customer(business_id=business_id, name=name)
        session.add(customer)
        session.flush()
        return _command_result(
            command.intent.value,
            f"Customer {customer.name} was saved.",
            action_result={"customer_id": str(customer.id), "name": customer.name, "outstanding_balance": "0"},
        )

    if command.intent in {CommandIntent.CUSTOMER_BALANCE_QUERY, CommandIntent.CUSTOMER_LEDGER_QUERY}:
        customer, candidates = _resolve_customer(session, business_id, command.customer_query)
        if candidates:
            return _clarification("Which customer did you mean?", candidates=candidates)
        if customer is None:
            return _clarification("I couldn't find that customer. Add the customer first.")
        balance = customer_balance(session, business_id, customer.id)
        if command.intent == CommandIntent.CUSTOMER_BALANCE_QUERY:
            return _command_result(
                command.intent.value,
                f"{customer.name} has ₹{balance} outstanding.",
                action_result={"customer_id": str(customer.id), "outstanding_balance": str(balance)},
            )
        entries = session.scalars(
            select(CustomerLedgerEntry)
            .where(
                CustomerLedgerEntry.business_id == business_id,
                CustomerLedgerEntry.customer_id == customer.id,
            )
            .order_by(CustomerLedgerEntry.created_at, CustomerLedgerEntry.id)
            .limit(100)
        ).all()
        return _command_result(
            command.intent.value,
            f"{customer.name}'s ledger has {len(entries)} recorded entries; outstanding ₹{balance}.",
            action_result={
                "customer_id": str(customer.id),
                "outstanding_balance": str(balance),
                "entries": [
                    {
                        "type": entry.transaction_type,
                        "amount_delta": str(entry.amount_delta),
                        "note": entry.note,
                        "created_at": entry.created_at.isoformat(),
                    }
                    for entry in entries
                ],
            },
        )

    if command.intent == CommandIntent.RECORD_CUSTOMER_PAYMENT:
        customer, candidates = _resolve_customer(session, business_id, command.customer_query)
        if candidates:
            return _clarification("Which customer made the payment?", candidates=candidates)
        if customer is None:
            return _clarification("Tell me which customer paid.")
        if command.amount is None or command.amount <= 0:
            return _clarification("Tell me the payment amount.")
        balance = post_customer_payment(session, business_id, customer, command.amount)
        return _command_result(
            command.intent.value,
            f"Payment of ₹{command.amount} recorded for {customer.name}. Outstanding balance ₹{balance}.",
            action_result={"customer_id": str(customer.id), "outstanding_balance": str(balance)},
        )

    if command.intent == CommandIntent.UPDATE_PRODUCT:
        product, candidates = _resolve_product(session, business_id, command.product_query)
        if candidates:
            return _clarification("Which product did you mean?", candidates=candidates)
        if product is None:
            return _clarification("I couldn't find that product.")
        if command.sale_price is None:
            return _clarification(f"What selling price should I set for {product.name}?")
        product.selling_price = command.sale_price
        session.flush()
        return _command_result(
            command.intent.value,
            f"{product.name} selling price updated to ₹{product.selling_price}.",
            product=product,
            action_result={"product_id": str(product.id), "selling_price": str(product.selling_price)},
        )

    if command.intent == CommandIntent.CREATE_PRODUCT:
        name = (command.product_query or "").strip()
        if not name:
            return _clarification("Tell me the product name.")
        if command.unit is None or command.sale_price is None:
            return _clarification("Tell me the product's unit and selling price before creating it.")
        if command.quantity is None:
            return _clarification("Tell me the opening stock quantity.")
        existing = session.scalar(
            select(Product.id).where(
                Product.business_id == business_id,
                func.lower(Product.name) == name.casefold(),
            )
        )
        if existing:
            return _clarification("A product with this name already exists. Use its existing record instead.")
        location, candidates = _resolve_location(session, business_id, command.location_query)
        if location is None:
            return _clarification("Choose the opening-stock location.", candidates=candidates)
        product = Product(
            business_id=business_id,
            name=name,
            unit=_unit_key(command.unit),
            selling_price=command.sale_price,
        )
        session.add(product)
        session.flush()
        balance, movement_id = post_receipt(
            session, business_id, product, location.id, command.quantity, note="Opening stock"
        )
        return _command_result(
            command.intent.value,
            f"Created {product.name} and recorded {format_quantity_label(command.quantity, product.unit)} at {location.name}.",
            product=product,
            quantity=balance,
            action_result={
                "product_id": str(product.id),
                "balance": str(balance),
                "location_id": str(location.id),
                "stock_movement_id": str(movement_id),
            },
        )

    if command.intent in {
        CommandIntent.RECORD_SALE,
        CommandIntent.RECORD_CREDIT_SALE,
        CommandIntent.RECEIVE_STOCK,
        CommandIntent.TRANSFER_STOCK,
    }:
        product, candidates = _resolve_product(session, business_id, command.product_query)
        if candidates:
            return _clarification("Which product did you mean?", candidates=candidates)
        if product is None:
            if command.intent == CommandIntent.RECEIVE_STOCK:
                return _clarification(
                    f"I couldn't find {command.product_query or 'that product'} in this business's catalogue. "
                    "Would you like to create it? I’ll need its unit and selling price."
                )
            if command.intent == CommandIntent.RECORD_SALE:
                return _clarification(
                    f"I couldn't find {command.product_query or 'that product'} in this business's catalogue."
                )
            return _clarification("Tell me the product name.")
        if command.quantity is None:
            return _clarification(f"Tell me how many {product.unit} of {product.name}.")
        if command.unit and _unit_key(command.unit) != _unit_key(product.unit):
            return _clarification(f"{product.name} is measured in {product.unit}; tell me the quantity in that unit.")

        if command.intent == CommandIntent.TRANSFER_STOCK:
            source, source_candidates = _resolve_location(
                session, business_id, command.source_location_query, product=product, require_stock=True
            )
            destination, destination_candidates = _resolve_location(
                session, business_id, command.destination_location_query
            )
            if source is None or destination is None:
                return _clarification(
                    "Specify both a source with enough stock and a different destination.",
                    candidates=source_candidates + destination_candidates,
                )
            remaining = post_transfer(
                session, business_id, product, source.id, destination.id, command.quantity
            )
            return _command_result(
                command.intent.value,
                f"Moved {format_quantity_label(command.quantity, product.unit)} of {product.name} from {source.name} to {destination.name}.",
                product=product,
                quantity=remaining,
                action_result={"source_balance": str(remaining), "source": source.name, "destination": destination.name},
            )

        if command.intent == CommandIntent.RECEIVE_STOCK:
            location, candidates = _resolve_location(session, business_id, command.location_query)
            if location is None:
                return _clarification("Choose the location where the stock was received.", candidates=candidates)
            balance, movement_id = post_receipt(session, business_id, product, location.id, command.quantity)
            return _command_result(
                command.intent.value,
                f"Received {format_quantity_label(command.quantity, product.unit)} of {product.name} at {location.name}. "
                f"Balance there is {format_quantity_label(balance, product.unit)}.",
                product=product,
                quantity=balance,
                action_result={
                    "location_id": str(location.id),
                    "location": location.name,
                    "quantity_received": str(command.quantity),
                    "balance": str(balance),
                    "stock_movement_id": str(movement_id),
                },
            )

        customer = None
        if command.intent == CommandIntent.RECORD_CREDIT_SALE:
            customer, candidates = _resolve_customer(session, business_id, command.customer_query)
            if candidates:
                return _clarification("Which customer should this credit sale be recorded for?", candidates=candidates)
            if customer is None:
                return _clarification("Tell me which customer is buying on credit.")
        location, candidates = _resolve_location(
            session, business_id, command.location_query, product=product, require_stock=True
        )
        if location is None:
            return _clarification("Choose the location from which stock should be sold.", candidates=candidates)
        sale = post_sale(
            session,
            business_id,
            product,
            location.id,
            command.quantity,
            customer=customer,
            paid_amount=Decimal("0") if customer else None,
            unit_price=product.selling_price,
        )
        stock_remaining = session.scalar(
            select(InventoryBalance.quantity).where(
                InventoryBalance.business_id == business_id,
                InventoryBalance.product_id == product.id,
                InventoryBalance.location_id == location.id,
            )
        )
        balance = customer_balance(session, business_id, customer.id) if customer else Decimal("0")
        return _command_result(
            command.intent.value,
            f"Sale recorded successfully. {format_quantity_label(command.quantity, product.unit)} of {product.name} "
            f"at ₹{product.selling_price} each; total ₹{sale.total_amount}. "
            f"Stock remaining: {format_quantity_label(stock_remaining or Decimal('0'), product.unit)} at {location.name}."
            + (f" {customer.name}'s outstanding balance is ₹{balance}." if customer else ""),
            product=product,
            quantity=command.quantity,
            action_result={
                "sale_id": str(sale.id),
                "quantity": str(command.quantity),
                "unit": product.unit,
                "unit_price": str(product.selling_price),
                "total_amount": str(sale.total_amount),
                "stock_remaining": str(stock_remaining or Decimal("0")),
                "location": location.name,
                "outstanding_balance": str(balance),
            },
        )

    return None
