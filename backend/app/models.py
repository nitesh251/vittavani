from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160))
    preferred_language: Mapped[str] = mapped_column(String(16), default="hi")
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    products: Mapped[list["Product"]] = relationship(back_populates="business")


class BusinessMember(Base):
    __tablename__ = "business_members"
    __table_args__ = (
        UniqueConstraint("business_id", "auth_subject", name="uq_member_business_subject"),
        Index("ix_business_members_auth_subject", "auth_subject"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    auth_subject: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="owner")


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("business_id", "id", name="uq_locations_business_id"),
        UniqueConstraint("business_id", "parent_location_id", "name", name="uq_location_sibling_name"),
        ForeignKeyConstraint(
            ["business_id", "parent_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        Index("ix_locations_business_id", "business_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    parent_location_id: Mapped[UUID | None] = mapped_column(nullable=True)
    name: Mapped[str] = mapped_column(String(120))


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_id", "id", name="uq_products_business_id"),
        UniqueConstraint("business_id", "sku", name="uq_product_business_sku"),
        CheckConstraint("selling_price >= 0", name="ck_product_price_nonnegative"),
        CheckConstraint("minimum_stock >= 0", name="ck_product_minimum_nonnegative"),
        Index("ix_products_business_id_name", "business_id", "name"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(180))
    sku: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str] = mapped_column(String(32), default="piece")
    selling_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    minimum_stock: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    business: Mapped[Business] = relationship(back_populates="products")
    aliases: Mapped[list["ProductAlias"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ProductAlias(Base):
    __tablename__ = "product_aliases"
    __table_args__ = (
        UniqueConstraint("business_id", "id", name="uq_alias_business_id"),
        UniqueConstraint("business_id", "alias", name="uq_alias_business_alias"),
        ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="CASCADE",
        ),
        Index("ix_product_aliases_business_alias", "business_id", "alias"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    product_id: Mapped[UUID]
    alias: Mapped[str] = mapped_column(String(180))

    product: Mapped[Product] = relationship(back_populates="aliases")


class InventoryBalance(Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (
        UniqueConstraint("business_id", "id", name="uq_balances_business_id"),
        UniqueConstraint("business_id", "product_id", "location_id", name="uq_balance_product_location"),
        ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["business_id", "location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("quantity >= 0", name="ck_balance_quantity_nonnegative"),
        Index("ix_inventory_balances_business_product", "business_id", "product_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    product_id: Mapped[UUID]
    location_id: Mapped[UUID]
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0"))


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        UniqueConstraint("business_id", "id", name="uq_movements_business_id"),
        ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["business_id", "source_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["business_id", "destination_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("quantity_change <> 0", name="ck_movement_nonzero_quantity"),
        Index("ix_stock_movements_business_product_created", "business_id", "product_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    product_id: Mapped[UUID]
    source_location_id: Mapped[UUID | None] = mapped_column(nullable=True)
    destination_location_id: Mapped[UUID | None] = mapped_column(nullable=True)
    movement_type: Mapped[str] = mapped_column(String(32))
    quantity_change: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    initiated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
