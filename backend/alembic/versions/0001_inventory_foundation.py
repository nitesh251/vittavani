"""Create tenant-scoped inventory foundation.

Revision ID: 0001_inventory
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_inventory"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "businesses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("preferred_language", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "business_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "auth_subject", name="uq_member_business_subject"),
    )
    op.create_index("ix_business_members_auth_subject", "business_members", ["auth_subject"])
    op.create_table(
        "locations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("parent_location_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "parent_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_locations_business_id"),
        sa.UniqueConstraint(
            "business_id", "parent_location_id", "name", name="uq_location_sibling_name"
        ),
    )
    op.create_index("ix_locations_business_id", "locations", ["business_id"])
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=True),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("selling_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("minimum_stock", sa.Numeric(14, 3), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_products_business_id"),
        sa.UniqueConstraint("business_id", "sku", name="uq_product_business_sku"),
        sa.CheckConstraint("selling_price >= 0", name="ck_product_price_nonnegative"),
        sa.CheckConstraint("minimum_stock >= 0", name="ck_product_minimum_nonnegative"),
    )
    op.create_index("ix_products_business_id_name", "products", ["business_id", "name"])
    op.create_table(
        "product_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("alias", sa.String(length=180), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_alias_business_id"),
        sa.UniqueConstraint("business_id", "alias", name="uq_alias_business_alias"),
    )
    op.create_index("ix_product_aliases_business_alias", "product_aliases", ["business_id", "alias"])
    op.create_table(
        "inventory_balances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_balances_business_id"),
        sa.UniqueConstraint(
            "business_id", "product_id", "location_id", name="uq_balance_product_location"
        ),
        sa.CheckConstraint("quantity >= 0", name="ck_balance_quantity_nonnegative"),
    )
    op.create_index(
        "ix_inventory_balances_business_product",
        "inventory_balances",
        ["business_id", "product_id"],
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("source_location_id", sa.Uuid(), nullable=True),
        sa.Column("destination_location_id", sa.Uuid(), nullable=True),
        sa.Column("movement_type", sa.String(length=32), nullable=False),
        sa.Column("quantity_change", sa.Numeric(14, 3), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=True),
        sa.Column("initiated_by", sa.String(length=255), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id", "product_id"],
            ["products.business_id", "products.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "source_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "destination_location_id"],
            ["locations.business_id", "locations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_movements_business_id"),
        sa.CheckConstraint("quantity_change <> 0", name="ck_movement_nonzero_quantity"),
    )
    op.create_index(
        "ix_stock_movements_business_product_created",
        "stock_movements",
        ["business_id", "product_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_stock_movements_business_product_created", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_index("ix_inventory_balances_business_product", table_name="inventory_balances")
    op.drop_table("inventory_balances")
    op.drop_index("ix_product_aliases_business_alias", table_name="product_aliases")
    op.drop_table("product_aliases")
    op.drop_index("ix_products_business_id_name", table_name="products")
    op.drop_table("products")
    op.drop_index("ix_locations_business_id", table_name="locations")
    op.drop_table("locations")
    op.drop_index("ix_business_members_auth_subject", table_name="business_members")
    op.drop_table("business_members")
    op.drop_table("businesses")
