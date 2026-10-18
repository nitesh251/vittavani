import secrets
from contextlib import contextmanager
from decimal import Decimal
from typing import Iterator, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai_service import AIProviderError, ai_is_configured, extract_product_query
from app.config import settings
from app.database import get_db
from app.formatting import format_quantity, format_quantity_label
from app.inventory_metrics import is_low_stock
from app.location_paths import location_paths
from app.models import InventoryBalance, Location, Product, ProductAlias, StockMovement
from app.query_service import lookup_product
from app.query_understanding import Intent

app = FastAPI(title="Vittavani API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Dev-Token"],
)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=500)
    mode: Literal["normal", "ai"] = "normal"


class AskResponse(BaseModel):
    intent: str
    original_query: str
    product_name: str | None = None
    quantity: str | None = None
    unit: str | None = None
    locations: list[str]
    candidates: list[str]
    clarification_required: bool
    message: str
    mode: Literal["normal", "ai"] = "normal"
    provider: str | None = None
    model: str | None = None


class LocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    parent_location_id: UUID | None = None


class ProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    sku: str | None = Field(default=None, max_length=80)
    unit: str = Field(min_length=1, max_length=32)
    selling_price: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    minimum_stock: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    aliases: list[str] = Field(default_factory=list, max_length=25)


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=180)
    sku: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    selling_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    minimum_stock: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    active: bool | None = None
    aliases: list[str] | None = Field(default=None, max_length=25)


class StockReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    location_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class StockAdjustment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    location_id: UUID
    quantity_change: Decimal = Field(max_digits=14, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class StockTransfer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    source_location_id: UUID
    destination_location_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class StockResult(BaseModel):
    product_id: UUID
    quantity: str
    unit: str
    message: str


class ProductBalance(BaseModel):
    location_id: UUID
    location_name: str
    quantity: str
    display_quantity: str


class ProductResponse(BaseModel):
    id: UUID
    name: str
    sku: str | None
    unit: str
    selling_price: str
    minimum_stock: str
    active: bool
    aliases: list[str]
    quantity: str
    display_quantity: str
    display_minimum_stock: str
    balances: list[ProductBalance]


class LocationResponse(BaseModel):
    id: UUID
    name: str
    full_name: str
    parent_location_id: UUID | None


class ProductList(BaseModel):
    items: list[ProductResponse]


class LocationList(BaseModel):
    items: list[LocationResponse]


class StockMovementResponse(BaseModel):
    id: UUID
    product_name: str
    movement_type: str
    quantity: str
    display_quantity: str
    unit: str
    source_location: str | None
    destination_location: str | None
    note: str | None
    created_at: str


class StockMovementList(BaseModel):
    items: list[StockMovementResponse]


@contextmanager
def _transaction(session: Session) -> Iterator[None]:
    try:
        yield
        session.commit()
    except Exception:
        session.rollback()
        raise


class DashboardProduct(BaseModel):
    id: UUID
    name: str
    quantity: str
    unit: str
    minimum_stock: str
    display_quantity: str
    display_minimum_stock: str


class DashboardUnitTotal(BaseModel):
    unit: str
    quantity: str
    display_quantity: str


class DashboardLocation(BaseModel):
    id: UUID
    name: str
    product_count: int
    stock_by_unit: list[DashboardUnitTotal]


class DashboardActivity(BaseModel):
    id: UUID
    movement_type: str
    product_name: str
    quantity: str
    unit: str
    display_quantity: str
    source_location: str | None
    destination_location: str | None
    created_at: str


class DashboardResponse(BaseModel):
    product_count: int
    total_stock_units: str | None
    stock_by_unit: list[DashboardUnitTotal]
    low_stock_count: int
    out_of_stock_count: int
    low_stock_products: list[DashboardProduct]
    stock_by_location: list[DashboardLocation]
    recent_stock_activity: list[DashboardActivity]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def development_business_id(dev_token: str | None = Header(default=None, alias="X-Dev-Token")) -> UUID:
    if settings.app_env != "development" or not settings.dev_api_token or not settings.dev_business_id:
        raise HTTPException(status_code=503, detail="Protected API is not configured")
    if dev_token is None or not secrets.compare_digest(dev_token, settings.dev_api_token):
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return UUID(settings.dev_business_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Protected API is not configured") from exc


@app.post("/api/v1/ask", response_model=AskResponse)
def ask(
    body: AskRequest,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> AskResponse:
    interpreted_intent: Intent | None = None
    interpreted_product: str | None = None
    if body.mode == "ai":
        if not ai_is_configured():
            raise HTTPException(
                status_code=503,
                detail=(
                    "AI Assistant is not configured. Set AI_PROVIDER, AI_MODEL, and "
                    "GROQ_API_KEY on the backend, or use Normal Search."
                ),
            )
        try:
            interpretation = extract_product_query(body.query)
        except AIProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        interpreted_intent = {
            "stock": Intent.STOCK,
            "location": Intent.LOCATION,
            "low_stock": Intent.LOW_STOCK,
            "unknown": Intent.UNKNOWN,
        }[interpretation["intent"]]
        interpreted_product = interpretation["product_query"]
    result = lookup_product(
        session,
        business_id,
        body.query,
        interpreted_intent=interpreted_intent,
        interpreted_product=interpreted_product,
    )
    return AskResponse(
        intent=result.intent,
        original_query=body.query,
        product_name=result.product_name,
        quantity=str(result.quantity) if result.quantity is not None else None,
        unit=result.unit,
        locations=list(result.locations),
        candidates=list(result.candidates),
        clarification_required=result.clarification_required,
        message=result.message,
        mode=body.mode,
        provider=settings.ai_provider if body.mode == "ai" else None,
        model=settings.ai_model if body.mode == "ai" else None,
    )


@app.get("/api/v1/ai/status")
def ai_status(
    _business_id: UUID = Depends(development_business_id),
) -> dict[str, str | bool | None]:
    configured = ai_is_configured()
    return {
        "configured": configured,
        "provider": settings.ai_provider if configured else None,
        "model": settings.ai_model if configured else None,
    }


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
def dashboard(
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> DashboardResponse:
    totals = (
        select(
            InventoryBalance.product_id.label("product_id"),
            func.sum(InventoryBalance.quantity).label("quantity"),
        )
        .where(InventoryBalance.business_id == business_id)
        .group_by(InventoryBalance.product_id)
        .subquery()
    )
    products = session.execute(
        select(
            Product,
            func.coalesce(totals.c.quantity, 0).label("quantity"),
        )
        .outerjoin(totals, totals.c.product_id == Product.id)
        .where(Product.business_id == business_id, Product.active.is_(True))
        .order_by(Product.name)
    ).all()
    low_stock = [
        DashboardProduct(
            id=product.id,
            name=product.name,
            quantity=str(quantity),
            unit=product.unit,
            minimum_stock=str(product.minimum_stock),
            display_quantity=format_quantity_label(quantity, product.unit),
            display_minimum_stock=format_quantity_label(product.minimum_stock, product.unit),
        )
        for product, quantity in products
        if is_low_stock(quantity, product.minimum_stock)
    ]
    out_of_stock_count = sum(1 for _, quantity in products if quantity <= 0)
    overall_by_unit: dict[str, Decimal] = {}
    for product, quantity in products:
        overall_by_unit[product.unit] = overall_by_unit.get(product.unit, Decimal("0")) + quantity
    on_hand_by_unit = {
        unit: quantity for unit, quantity in overall_by_unit.items() if quantity > 0
    }
    stock_by_unit = [
        DashboardUnitTotal(
            unit=unit,
            quantity=str(quantity),
            display_quantity=format_quantity_label(quantity, unit),
        )
        for unit, quantity in sorted(on_hand_by_unit.items())
    ]

    location_rows = session.execute(
        select(
            Location,
            Product.unit,
            func.sum(InventoryBalance.quantity).label("quantity"),
            func.count(func.distinct(InventoryBalance.product_id)).label("product_count"),
        )
        .join(
            InventoryBalance,
            (InventoryBalance.business_id == Location.business_id)
            & (InventoryBalance.location_id == Location.id),
        )
        .join(
            Product,
            (Product.business_id == InventoryBalance.business_id)
            & (Product.id == InventoryBalance.product_id),
        )
        .where(
            Location.business_id == business_id,
            Product.active.is_(True),
            InventoryBalance.quantity > 0,
        )
        .group_by(Location.id, Product.unit)
        .order_by(Location.name, Product.unit)
    ).all()
    location_totals: dict[UUID, dict] = {}
    paths = location_paths(session, business_id)
    for location, unit, quantity, product_count in location_rows:
        location_total = location_totals.setdefault(
            location.id,
            {
                "id": location.id,
                "name": paths.get(location.id, location.name),
                "product_count": 0,
                "stock_by_unit": [],
            },
        )
        location_total["product_count"] += product_count
        location_total["stock_by_unit"].append(
            DashboardUnitTotal(
                unit=unit,
                quantity=str(quantity),
                display_quantity=format_quantity_label(quantity, unit),
            )
        )
    locations = [DashboardLocation(**location) for location in location_totals.values()]

    source = Location.__table__.alias("source_location")
    destination = Location.__table__.alias("destination_location")
    movement_rows = session.execute(
        select(
            StockMovement,
            Product.name,
            Product.unit,
            source.c.name,
            destination.c.name,
        )
        .join(
            Product,
            (Product.business_id == StockMovement.business_id)
            & (Product.id == StockMovement.product_id),
        )
        .outerjoin(
            source,
            (source.c.business_id == StockMovement.business_id)
            & (source.c.id == StockMovement.source_location_id),
        )
        .outerjoin(
            destination,
            (destination.c.business_id == StockMovement.business_id)
            & (destination.c.id == StockMovement.destination_location_id),
        )
        .where(StockMovement.business_id == business_id)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(8)
    ).all()
    activity = [
        DashboardActivity(
            id=movement.id,
            movement_type=movement.movement_type,
            product_name=product_name,
            quantity=str(movement.quantity_change),
            unit=unit,
            display_quantity=format_quantity_label(movement.quantity_change, unit),
            source_location=source_name,
            destination_location=destination_name,
            created_at=movement.created_at.isoformat(),
        )
        for movement, product_name, unit, source_name, destination_name in movement_rows
    ]
    return DashboardResponse(
        product_count=len(products),
        total_stock_units=(
            str(next(iter(on_hand_by_unit.values()), Decimal("0")))
            if len(on_hand_by_unit) <= 1
            else None
        ),
        stock_by_unit=stock_by_unit,
        low_stock_count=len(low_stock),
        out_of_stock_count=out_of_stock_count,
        low_stock_products=low_stock,
        stock_by_location=locations,
        recent_stock_activity=activity,
    )


@app.get("/api/v1/products", response_model=ProductList)
def list_products(
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> ProductList:
    products = session.scalars(
        select(Product).where(Product.business_id == business_id).order_by(Product.name)
    ).all()
    product_ids = [product.id for product in products]
    product_units = {product.id: product.unit for product in products}
    balances = (
        session.execute(
            select(InventoryBalance, Location.name)
            .join(
                Location,
                (Location.business_id == InventoryBalance.business_id)
                & (Location.id == InventoryBalance.location_id),
            )
            .where(
                InventoryBalance.business_id == business_id,
                InventoryBalance.product_id.in_(product_ids),
            )
            .order_by(Location.name)
        ).all()
        if product_ids
        else []
    )
    by_product: dict[UUID, list[ProductBalance]] = {}
    quantities: dict[UUID, Decimal] = {}
    for balance, location_name in balances:
        by_product.setdefault(balance.product_id, []).append(
            ProductBalance(
                location_id=balance.location_id,
                location_name=location_name,
                quantity=str(balance.quantity),
                display_quantity=format_quantity_label(
                    balance.quantity, product_units[balance.product_id]
                ),
            )
        )
        quantities[balance.product_id] = quantities.get(balance.product_id, Decimal("0")) + balance.quantity
    aliases = (
        session.scalars(
            select(ProductAlias)
            .where(
                ProductAlias.business_id == business_id,
                ProductAlias.product_id.in_(product_ids),
            )
            .order_by(ProductAlias.alias)
        ).all()
        if product_ids
        else []
    )
    aliases_by_product: dict[UUID, list[str]] = {}
    for alias in aliases:
        aliases_by_product.setdefault(alias.product_id, []).append(alias.alias)
    return ProductList(
        items=[
            ProductResponse(
                id=product.id,
                name=product.name,
                sku=product.sku,
                unit=product.unit,
                selling_price=str(product.selling_price),
                minimum_stock=str(product.minimum_stock),
                active=product.active,
                aliases=aliases_by_product.get(product.id, []),
                quantity=str(quantities.get(product.id, Decimal("0"))),
                display_quantity=format_quantity_label(
                    quantities.get(product.id, Decimal("0")), product.unit
                ),
                display_minimum_stock=format_quantity_label(product.minimum_stock, product.unit),
                balances=by_product.get(product.id, []),
            )
            for product in products
        ]
    )


@app.get("/api/v1/locations", response_model=LocationList)
def list_locations(
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> LocationList:
    locations = session.scalars(
        select(Location).where(Location.business_id == business_id).order_by(Location.name)
    ).all()
    paths = location_paths(session, business_id)
    return LocationList(
        items=[
            LocationResponse(
                id=location.id,
                name=location.name,
                full_name=paths.get(location.id, location.name),
                parent_location_id=location.parent_location_id,
            )
            for location in locations
        ]
    )


@app.get("/api/v1/stock-movements", response_model=StockMovementList)
def list_stock_movements(
    limit: int = Query(default=100, ge=1, le=200),
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> StockMovementList:
    source = Location.__table__.alias("source_location")
    destination = Location.__table__.alias("destination_location")
    rows = session.execute(
        select(
            StockMovement,
            Product.name,
            Product.unit,
            source.c.id,
            destination.c.id,
        )
        .join(
            Product,
            (Product.business_id == StockMovement.business_id)
            & (Product.id == StockMovement.product_id),
        )
        .outerjoin(
            source,
            (source.c.business_id == StockMovement.business_id)
            & (source.c.id == StockMovement.source_location_id),
        )
        .outerjoin(
            destination,
            (destination.c.business_id == StockMovement.business_id)
            & (destination.c.id == StockMovement.destination_location_id),
        )
        .where(StockMovement.business_id == business_id)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(limit)
    ).all()
    paths = location_paths(session, business_id)
    return StockMovementList(
        items=[
            StockMovementResponse(
                id=movement.id,
                product_name=product_name,
                movement_type=movement.movement_type,
                quantity=str(movement.quantity_change),
                display_quantity=format_quantity_label(movement.quantity_change, unit),
                unit=unit,
                source_location=paths.get(source_id) if source_id else None,
                destination_location=paths.get(destination_id) if destination_id else None,
                note=movement.note,
                created_at=movement.created_at.isoformat(),
            )
            for movement, product_name, unit, source_id, destination_id in rows
        ]
    )


@app.post("/api/v1/locations", status_code=status.HTTP_201_CREATED)
def create_location(
    body: LocationCreate,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> dict[str, str | UUID | None]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Location name cannot be blank")
    try:
        with _transaction(session):
            if body.parent_location_id is not None:
                parent = session.scalar(
                    select(Location).where(
                        Location.business_id == business_id,
                        Location.id == body.parent_location_id,
                    )
                )
                if parent is None:
                    raise HTTPException(status_code=404, detail="Parent location not found")
            location = Location(
                business_id=business_id,
                name=name,
                parent_location_id=body.parent_location_id,
            )
            session.add(location)
            session.flush()
            result = {
                "id": location.id,
                "name": location.name,
                "parent_location_id": location.parent_location_id,
            }
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="A location with this name already exists here") from exc
    return result


@app.post("/api/v1/products", status_code=status.HTTP_201_CREATED)
def create_product(
    body: ProductCreate,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> dict[str, str | UUID]:
    name = body.name.strip()
    unit = body.unit.strip()
    aliases = [alias.strip() for alias in body.aliases]
    if not name or not unit or any(not alias for alias in aliases):
        raise HTTPException(status_code=422, detail="Product name, unit, and aliases cannot be blank")
    if len({alias.casefold() for alias in aliases}) != len(aliases):
        raise HTTPException(status_code=422, detail="Product aliases must be unique")
    if body.sku is not None and not body.sku.strip():
        raise HTTPException(status_code=422, detail="SKU cannot be blank")

    try:
        with _transaction(session):
            product = Product(
                business_id=business_id,
                name=name,
                sku=body.sku.strip() if body.sku else None,
                unit=unit,
                selling_price=body.selling_price,
                minimum_stock=body.minimum_stock,
            )
            session.add(product)
            session.flush()
            session.add_all(
                ProductAlias(business_id=business_id, product_id=product.id, alias=alias)
                for alias in aliases
            )
            result = {"id": product.id, "name": product.name, "unit": product.unit}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="A product with this SKU or alias already exists") from exc
    return result


@app.put("/api/v1/products/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: UUID,
    body: ProductUpdate,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> ProductResponse:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="At least one product field must be provided")
    if any(value is None for field, value in changes.items() if field != "sku"):
        raise HTTPException(status_code=422, detail="Product fields cannot be null; use an empty alias list to clear aliases")
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise HTTPException(status_code=422, detail="Product name cannot be blank")
    if "unit" in changes:
        changes["unit"] = changes["unit"].strip()
        if not changes["unit"]:
            raise HTTPException(status_code=422, detail="Product unit cannot be blank")
    if "sku" in changes and changes["sku"] is not None:
        changes["sku"] = changes["sku"].strip()
        if not changes["sku"]:
            raise HTTPException(status_code=422, detail="SKU cannot be blank")
    if "aliases" in changes and changes["aliases"] is not None:
        changes["aliases"] = [alias.strip() for alias in changes["aliases"]]
        if any(not alias for alias in changes["aliases"]):
            raise HTTPException(status_code=422, detail="Product aliases cannot be blank")
        if len({alias.casefold() for alias in changes["aliases"]}) != len(changes["aliases"]):
            raise HTTPException(status_code=422, detail="Product aliases must be unique")

    try:
        with _transaction(session):
            product = session.scalar(
                select(Product)
                .where(Product.business_id == business_id, Product.id == product_id)
                .with_for_update()
            )
            if product is None:
                raise HTTPException(status_code=404, detail="Product not found")
            if "unit" in changes and changes["unit"] != product.unit:
                has_inventory = session.scalar(
                    select(InventoryBalance.id).where(
                        InventoryBalance.business_id == business_id,
                        InventoryBalance.product_id == product_id,
                    ).limit(1)
                )
                has_history = session.scalar(
                    select(StockMovement.id).where(
                        StockMovement.business_id == business_id,
                        StockMovement.product_id == product_id,
                    ).limit(1)
                )
                if has_inventory is not None or has_history is not None:
                    raise HTTPException(
                        status_code=409,
                        detail="Unit cannot change after inventory or movement history exists",
                    )
            aliases = changes.pop("aliases", None)
            for field, value in changes.items():
                setattr(product, field, value)
            if aliases is not None:
                session.execute(
                    delete(ProductAlias).where(
                        ProductAlias.business_id == business_id,
                        ProductAlias.product_id == product_id,
                    )
                )
                session.flush()
                session.add_all(
                    ProductAlias(business_id=business_id, product_id=product_id, alias=alias)
                    for alias in aliases
                )
            session.flush()
            response = _product_response(session, business_id, product)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="A product with this SKU or alias already exists") from exc
    return response


def _product_response(session: Session, business_id: UUID, product: Product) -> ProductResponse:
    balance_rows = session.execute(
        select(InventoryBalance, Location.name)
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
    aliases = session.scalars(
        select(ProductAlias.alias)
        .where(ProductAlias.business_id == business_id, ProductAlias.product_id == product.id)
        .order_by(ProductAlias.alias)
    ).all()
    total = sum((balance.quantity for balance, _ in balance_rows), Decimal("0"))
    return ProductResponse(
        id=product.id,
        name=product.name,
        sku=product.sku,
        unit=product.unit,
        selling_price=str(product.selling_price),
        minimum_stock=str(product.minimum_stock),
        active=product.active,
        aliases=list(aliases),
        quantity=str(total),
        display_quantity=format_quantity_label(total, product.unit),
        display_minimum_stock=format_quantity_label(product.minimum_stock, product.unit),
        balances=[
            ProductBalance(
                location_id=balance.location_id,
                location_name=location_name,
                quantity=str(balance.quantity),
                display_quantity=format_quantity_label(balance.quantity, product.unit),
            )
            for balance, location_name in balance_rows
        ],
    )


def _require_active_product(session: Session, business_id: UUID, product_id: UUID) -> Product:
    # Product locks serialize per-product writes before any inventory-balance locks are acquired.
    product = session.scalar(
        select(Product)
        .where(
            Product.business_id == business_id,
            Product.id == product_id,
            Product.active.is_(True),
        )
        .with_for_update()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _require_location(session: Session, business_id: UUID, location_id: UUID) -> None:
    if session.scalar(
        select(Location.id).where(Location.business_id == business_id, Location.id == location_id)
    ) is None:
        raise HTTPException(status_code=404, detail="Location not found")


def _validate_unit(product: Product, requested_unit: str | None) -> None:
    if requested_unit is not None and requested_unit.strip().casefold() != product.unit.casefold():
        raise HTTPException(status_code=422, detail=f"Quantity unit must be {product.unit}")


@app.post("/api/v1/inventory/receipts", response_model=StockResult, status_code=status.HTTP_201_CREATED)
def receive_stock(
    body: StockReceipt,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> StockResult:
    try:
        with _transaction(session):
            product = _require_active_product(session, business_id, body.product_id)
            _validate_unit(product, body.unit)
            _require_location(session, business_id, body.location_id)
            balance = session.scalar(
                select(InventoryBalance)
                .where(
                    InventoryBalance.business_id == business_id,
                    InventoryBalance.product_id == body.product_id,
                    InventoryBalance.location_id == body.location_id,
                )
                .with_for_update()
            )
            if balance is None:
                balance = InventoryBalance(
                    business_id=business_id,
                    product_id=body.product_id,
                    location_id=body.location_id,
                    quantity=body.quantity,
                )
                session.add(balance)
            else:
                balance.quantity += body.quantity
            session.add(
                StockMovement(
                    business_id=business_id,
                    product_id=body.product_id,
                    destination_location_id=body.location_id,
                    movement_type="purchase_receipt",
                    quantity_change=body.quantity,
                    initiated_by="development-token",
                    note=body.note,
                )
            )
            session.flush()
            total = balance.quantity
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail="Inventory changed concurrently; retry the receipt",
        ) from exc
    return StockResult(
        product_id=product.id,
        quantity=str(total),
        unit=product.unit,
        message=(
            f"Received {format_quantity_label(body.quantity, product.unit)} of {product.name}. "
            f"Balance at location: {format_quantity_label(total, product.unit)}."
        ),
    )


@app.post("/api/v1/inventory/adjustments", response_model=StockResult)
def adjust_stock(
    body: StockAdjustment,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> StockResult:
    if body.quantity_change == 0:
        raise HTTPException(status_code=422, detail="Adjustment quantity cannot be zero")
    try:
        with _transaction(session):
            product = _require_active_product(session, business_id, body.product_id)
            _validate_unit(product, body.unit)
            _require_location(session, business_id, body.location_id)
            balance = session.scalar(
                select(InventoryBalance)
                .where(
                    InventoryBalance.business_id == business_id,
                    InventoryBalance.product_id == body.product_id,
                    InventoryBalance.location_id == body.location_id,
                )
                .with_for_update()
            )
            if balance is None and body.quantity_change < 0:
                raise HTTPException(status_code=409, detail="Cannot reduce stock below zero")
            if balance is None:
                balance = InventoryBalance(
                    business_id=business_id,
                    product_id=body.product_id,
                    location_id=body.location_id,
                    quantity=body.quantity_change,
                )
                session.add(balance)
            else:
                adjusted = balance.quantity + body.quantity_change
                if adjusted < 0:
                    raise HTTPException(status_code=409, detail="Cannot reduce stock below zero")
                balance.quantity = adjusted
            session.add(
                StockMovement(
                    business_id=business_id,
                    product_id=body.product_id,
                    source_location_id=body.location_id if body.quantity_change < 0 else None,
                    destination_location_id=body.location_id if body.quantity_change > 0 else None,
                    movement_type="adjustment",
                    quantity_change=body.quantity_change,
                    initiated_by="development-token",
                    note=body.note,
                )
            )
            session.flush()
            total = balance.quantity
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail="Inventory changed concurrently; retry the adjustment",
        ) from exc
    return StockResult(
        product_id=product.id,
        quantity=str(total),
        unit=product.unit,
        message=(
            f"Adjusted {product.name} by "
            f"{format_quantity_label(abs(body.quantity_change), product.unit)} "
            f"({format_quantity(body.quantity_change)}). "
            f"Balance at location: {format_quantity_label(total, product.unit)}."
        ),
    )


@app.post("/api/v1/inventory/transfers", response_model=StockResult)
def transfer_stock(
    body: StockTransfer,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> StockResult:
    if body.source_location_id == body.destination_location_id:
        raise HTTPException(
            status_code=422,
            detail="Source and destination must be different locations",
        )

    try:
        with _transaction(session):
            product = _require_active_product(session, business_id, body.product_id)
            _validate_unit(product, body.unit)
            _require_location(session, business_id, body.source_location_id)
            _require_location(session, business_id, body.destination_location_id)
            source = session.scalar(
                select(InventoryBalance)
                .where(
                    InventoryBalance.business_id == business_id,
                    InventoryBalance.product_id == body.product_id,
                    InventoryBalance.location_id == body.source_location_id,
                )
                .with_for_update()
            )
            if source is None or source.quantity < body.quantity:
                raise HTTPException(
                    status_code=409,
                    detail="Insufficient stock at the source location",
                )
            destination = session.scalar(
                select(InventoryBalance)
                .where(
                    InventoryBalance.business_id == business_id,
                    InventoryBalance.product_id == body.product_id,
                    InventoryBalance.location_id == body.destination_location_id,
                )
                .with_for_update()
            )
            source.quantity -= body.quantity
            if destination is None:
                destination = InventoryBalance(
                    business_id=business_id,
                    product_id=body.product_id,
                    location_id=body.destination_location_id,
                    quantity=body.quantity,
                )
                session.add(destination)
            else:
                destination.quantity += body.quantity
            for movement_type, quantity_change in (
                ("transfer_out", -body.quantity),
                ("transfer_in", body.quantity),
            ):
                session.add(
                    StockMovement(
                        business_id=business_id,
                        product_id=body.product_id,
                        source_location_id=body.source_location_id,
                        destination_location_id=body.destination_location_id,
                        movement_type=movement_type,
                        quantity_change=quantity_change,
                        initiated_by="development-token",
                        note=body.note,
                    )
                )
            session.flush()
            remaining = source.quantity
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail="Inventory changed concurrently; retry the transfer",
        ) from exc
    return StockResult(
        product_id=product.id,
        quantity=str(remaining),
        unit=product.unit,
        message=(
            f"Moved {format_quantity_label(body.quantity, product.unit)} of {product.name}. "
            f"Balance at source: {format_quantity_label(remaining, product.unit)}."
        ),
    )
