"""add draft tables

Revision ID: 5906125ac640
Revises: d21e0dee7d22
Create Date: 2025-12-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "5906125ac640"
down_revision = "d21e0dee7d22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) PostgreSQL ENUM 타입 생성 (이미 있으면 스킵)
    op.execute(
        """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_type') THEN
        CREATE TYPE draft_type AS ENUM ('INBOUND', 'OUTBOUND', 'STOCKTAKE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_status') THEN
        CREATE TYPE draft_status AS ENUM ('DRAFT', 'CONFIRMING', 'CONFIRMED', 'CANCELED');
    END IF;
END$$;
"""
    )

    draft_type_enum = postgresql.ENUM(
        "INBOUND", "OUTBOUND", "STOCKTAKE",
        name="draft_type",
        create_type=False,
    )
    draft_status_enum = postgresql.ENUM(
        "DRAFT", "CONFIRMING", "CONFIRMED", "CANCELED",
        name="draft_status",
        create_type=False,
    )

    # 2) draft_header
    op.create_table(
        "draft_header",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("draft_type", draft_type_enum, nullable=False),
        sa.Column("status", draft_status_enum, nullable=False, server_default=sa.text("'DRAFT'")),
        sa.Column("draft_key", sa.String(length=200), nullable=False),

        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),

        sa.UniqueConstraint("draft_type", "draft_key", name="uq_draft_header_type_key"),
    )
    op.create_index(
        "ix_draft_header_type_status",
        "draft_header",
        ["draft_type", "status"],
        unique=False,
    )

    # 3) draft_item
    op.create_table(
        "draft_item",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("draft_id", sa.BigInteger(), sa.ForeignKey("draft_header.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(length=120), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_barcode", sa.String(length=120), nullable=True),

        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),

        sa.UniqueConstraint("draft_id", "sku", name="uq_draft_item_draft_sku"),
    )
    op.create_index("ix_draft_item_draft_id", "draft_item", ["draft_id"], unique=False)

    # 4) draft_request (멱등성)
    op.create_table(
        "draft_request",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("draft_id", sa.BigInteger(), sa.ForeignKey("draft_header.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default=sa.text("'CONFIRM'")),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),

        sa.UniqueConstraint("request_id", name="uq_draft_request_request_id"),
    )
    op.create_index("ix_draft_request_draft_id", "draft_request", ["draft_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_draft_request_draft_id", table_name="draft_request")
    op.drop_table("draft_request")

    op.drop_index("ix_draft_item_draft_id", table_name="draft_item")
    op.drop_table("draft_item")

    op.drop_index("ix_draft_header_type_status", table_name="draft_header")
    op.drop_table("draft_header")

    # ENUM은 다른 오브젝트가 참조할 수 있어 안전하게 IF EXISTS로만 제거
    op.execute("DROP TYPE IF EXISTS draft_status")
    op.execute("DROP TYPE IF EXISTS draft_type")
