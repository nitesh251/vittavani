from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.formatting import format_quantity_label
from app.inventory_metrics import inventory_totals_subquery, is_low_stock
from app.location_paths import location_paths
from app.models import InventoryBalance, Location, Product, ProductAlias
from app.query_understanding import Candidate, Intent, Query, resolve_product, understand_query


@dataclass(frozen=True)
class LookupResult:
    intent: str
    original_query: str
    product_name: str | None = None
    quantity: Decimal | None = None
    unit: str | None = None
    locations: tuple[str, ...] = ()
    candidates: tuple[str, ...] = ()
    clarification_required: bool = False
    message: str = ""


def lookup_product(
    session: Session,
    business_id: UUID,
    text: str,
    *,
    interpreted_intent: Intent | None = None,
    interpreted_product: str | None = None,
) -> LookupResult:
    query = (
        understand_query(text)
        if interpreted_intent is None
        else Query(
            original=text,
            normalized="",
            entity_query=interpreted_product or "",
            intent=interpreted_intent,
        )
    )
    if query.intent == Intent.LOW_STOCK:
        totals = inventory_totals_subquery(business_id)
        products = session.execute(
            select(Product, func.coalesce(totals.c.quantity, 0).label("quantity"))
            .outerjoin(totals, totals.c.product_id == Product.id)
            .where(Product.business_id == business_id, Product.active.is_(True))
        ).all()
        low_stock = []
        for product, available in products:
            if is_low_stock(available, product.minimum_stock):
                low_stock.append(f"{product.name} ({format_quantity_label(available, product.unit)})")
        message = (
            f"Low stock: {', '.join(low_stock)}."
            if low_stock
            else "No in-stock products are at or below their configured minimum stock level."
        )
        return LookupResult(
            intent=query.intent,
            original_query=text,
            candidates=tuple(low_stock),
            message=message,
        )
    if query.intent == Intent.UNKNOWN:
        return LookupResult(
            intent=query.intent,
            original_query=text,
            clarification_required=True,
            message="I couldn’t identify that request. Ask where a product is or how much stock remains.",
        )

    product_rows = session.scalars(
        select(Product).where(Product.business_id == business_id, Product.active.is_(True))
    ).all()
    aliases_by_product: dict[UUID, list[str]] = {product.id: [] for product in product_rows}
    if product_rows:
        for alias in session.scalars(
            select(ProductAlias).where(
                ProductAlias.business_id == business_id,
                ProductAlias.product_id.in_([product.id for product in product_rows]),
            )
        ):
            aliases_by_product[alias.product_id].append(alias.alias)
    candidates = [
        Candidate(product_id=product.id, name=product.name, aliases=tuple(aliases_by_product[product.id]))
        for product in product_rows
    ]
    resolution = resolve_product(query.entity_query, candidates)
    if resolution.ambiguous:
        options = tuple(candidate.name for candidate in resolution.candidates)
        return LookupResult(
            intent=query.intent,
            original_query=text,
            candidates=options,
            clarification_required=True,
            message=f"Which product did you mean: {', '.join(options)}?",
        )
    if resolution.product is None:
        return LookupResult(
            intent=query.intent,
            original_query=text,
            clarification_required=True,
            message="I couldn’t find a matching product. Please check the name or add a product alias.",
        )

    product = next(product for product in product_rows if product.id == resolution.product.product_id)
    balances = session.execute(
        select(InventoryBalance, Location)
        .join(
            Location,
            (Location.business_id == InventoryBalance.business_id)
            & (Location.id == InventoryBalance.location_id),
        )
        .where(
            InventoryBalance.business_id == business_id,
            InventoryBalance.product_id == product.id,
        )
        .order_by(Location.name)
    ).all()
    paths = location_paths(session, business_id)
    locations = tuple(
        f"{paths.get(location.id, location.name)} ({format_quantity_label(balance.quantity, product.unit)})"
        for balance, location in balances
        if balance.quantity > 0
    )
    totals = inventory_totals_subquery(business_id)
    total = session.scalar(
        select(totals.c.quantity).where(totals.c.product_id == product.id)
    ) or Decimal("0")
    if query.intent == Intent.LOCATION:
        message = (
            f"{product.name} is at {', '.join(locations)}."
            if locations
            else f"No storage location is recorded for {product.name}."
        )
    elif query.intent == Intent.STOCK:
        message = f"{product.name}: {format_quantity_label(total, product.unit)} available."
        if locations:
            message += f" Locations: {', '.join(locations)}."
        else:
            message += " No storage location is recorded."
    else:
        message = f"Found {product.name}."

    return LookupResult(
        intent=query.intent,
        original_query=text,
        product_name=product.name,
        quantity=total,
        unit=product.unit,
        locations=locations,
        message=message,
    )
