"""add draft_header meta_json

Revision ID: add_draft_header_meta_json
Revises: b206bfc36aa5
Create Date: 2025-12-30

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "add_draft_header_meta_json"
down_revision = "b206bfc36aa5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "draft_header",
        sa.Column(
            "meta_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("draft_header", "meta_json")
