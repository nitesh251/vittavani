"""Ensure each authenticated owner has at most one business workspace.

Revision ID: 0003_member_subject
Revises: 0002_customer_ledger
"""
from alembic import op

revision = "0003_member_subject"
down_revision = "0002_customer_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_business_members_auth_subject",
        "business_members",
        ["auth_subject"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_business_members_auth_subject", table_name="business_members")
