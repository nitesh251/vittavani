"""Add customer ledger, sales, and command idempotency.

Revision ID: 0002_customer_ledger
Revises: 0001_inventory
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_customer_ledger"
down_revision = "0001_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_customers_business_id"),
        sa.UniqueConstraint("business_id", "phone", name="uq_customer_business_phone"),
    )
    op.create_index("ix_customers_business_name", "customers", ["business_id", "name"])

    op.create_table(
        "sales",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=True),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("paid_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("total_amount >= 0", name="ck_sale_total_nonnegative"),
        sa.CheckConstraint("paid_amount >= 0 AND paid_amount <= total_amount", name="ck_sale_paid_valid"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "customer_id"], ["customers.business_id", "customers.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_sales_business_id"),
        sa.UniqueConstraint("business_id", "idempotency_key", name="uq_sales_business_idempotency"),
    )
    op.create_index("ix_sales_business_created", "sales", ["business_id", "created_at"])

    op.create_table(
        "sale_line_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("sale_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_sale_line_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0 AND line_total >= 0", name="ck_sale_line_amount_nonnegative"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "sale_id"], ["sales.business_id", "sales.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "product_id"], ["products.business_id", "products.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "location_id"], ["locations.business_id", "locations.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sale_lines_business_sale", "sale_line_items", ["business_id", "sale_id"])

    op.create_table(
        "customer_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("sale_id", sa.Uuid(), nullable=True),
        sa.Column("transaction_type", sa.String(32), nullable=False),
        sa.Column("amount_delta", sa.Numeric(12, 2), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount_delta <> 0", name="ck_customer_ledger_nonzero"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["business_id", "customer_id"], ["customers.business_id", "customers.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "sale_id"], ["sales.business_id", "sales.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "id", name="uq_customer_ledger_business_id"),
    )
    op.create_index(
        "ix_customer_ledger_business_customer_created",
        "customer_ledger_entries",
        ["business_id", "customer_id", "created_at"],
    )

    op.create_table(
        "command_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("response_body", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "idempotency_key", name="uq_command_business_key"),
    )
    op.create_index("ix_command_requests_business_created", "command_requests", ["business_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_command_requests_business_created", table_name="command_requests")
    op.drop_table("command_requests")
    op.drop_index("ix_customer_ledger_business_customer_created", table_name="customer_ledger_entries")
    op.drop_table("customer_ledger_entries")
    op.drop_index("ix_sale_lines_business_sale", table_name="sale_line_items")
    op.drop_table("sale_line_items")
    op.drop_index("ix_sales_business_created", table_name="sales")
    op.drop_table("sales")
    op.drop_index("ix_customers_business_name", table_name="customers")
    op.drop_table("customers")
