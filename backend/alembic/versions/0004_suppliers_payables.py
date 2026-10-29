"""Add supplier purchases and payable history.

Revision ID: 0004_suppliers_payables
Revises: 0003_member_subject
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_suppliers_payables"
down_revision = "0003_member_subject"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_suppliers_business_id"),
        sa.UniqueConstraint("business_id", "phone", name="uq_supplier_business_phone"),
    )
    op.create_index("ix_suppliers_business_name", "suppliers", ["business_id", "name"])

    op.create_table(
        "supplier_purchases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("invoice_reference", sa.String(120), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("total_amount >= 0", name="ck_supplier_purchase_total_nonnegative"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "supplier_id"],
            ["suppliers.business_id", "suppliers.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_supplier_purchases_business_id"),
        sa.UniqueConstraint(
            "business_id", "id", "supplier_id", name="uq_supplier_purchases_business_supplier"
        ),
    )
    op.create_index(
        "ix_supplier_purchases_business_supplier_date",
        "supplier_purchases",
        ["business_id", "supplier_id", "purchase_date"],
    )

    op.create_table(
        "supplier_purchase_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("purchase_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_supplier_purchase_line_quantity_positive"),
        sa.CheckConstraint(
            "unit_price >= 0 AND line_total >= 0",
            name="ck_supplier_purchase_line_amount_nonnegative",
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "purchase_id"],
            ["supplier_purchases.business_id", "supplier_purchases.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "product_id"], ["products.business_id", "products.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "location_id"], ["locations.business_id", "locations.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_supplier_purchase_lines_business_purchase",
        "supplier_purchase_lines",
        ["business_id", "purchase_id"],
    )

    op.create_table(
        "supplier_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("purchase_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_supplier_payment_amount_positive"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "supplier_id"],
            ["suppliers.business_id", "suppliers.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "purchase_id", "supplier_id"],
            ["supplier_purchases.business_id", "supplier_purchases.id", "supplier_purchases.supplier_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_supplier_payments_business_id"),
    )
    op.create_index(
        "ix_supplier_payments_business_supplier_created",
        "supplier_payments",
        ["business_id", "supplier_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_supplier_payments_business_supplier_created", table_name="supplier_payments")
    op.drop_table("supplier_payments")
    op.drop_index("ix_supplier_purchase_lines_business_purchase", table_name="supplier_purchase_lines")
    op.drop_table("supplier_purchase_lines")
    op.drop_index("ix_supplier_purchases_business_supplier_date", table_name="supplier_purchases")
    op.drop_table("supplier_purchases")
    op.drop_index("ix_suppliers_business_name", table_name="suppliers")
    op.drop_table("suppliers")
