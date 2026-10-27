"""Persist short-lived assistant clarification state.

Revision ID: 0005_assistant_conversations
Revises: 0004_suppliers_payables
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_assistant_conversations"
down_revision = "0004_suppliers_payables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("pending_action", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "business_id",
            "auth_subject",
            "conversation_id",
            name="uq_assistant_conversation_owner",
        ),
    )
    op.create_index(
        "ix_assistant_conversations_expires_at",
        "assistant_conversations",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_conversations_expires_at", table_name="assistant_conversations")
    op.drop_table("assistant_conversations")
