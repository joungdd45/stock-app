"""add_country_to_outbound_header

Revision ID: 3db0e0474930
Revises: 0c78d7662147
Create Date: 2025-11-22 00:24:39.745750
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3db0e0474930"
down_revision: Union[str, Sequence[str], None] = "0c78d7662147"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """v1.6-r2: outbound_header 테이블에 country 컬럼 추가."""
    op.add_column(
        "outbound_header",
        sa.Column("country", sa.String(length=10), nullable=True),
    )


def downgrade() -> None:
    """롤백 시 outbound_header.country 컬럼 제거."""
    op.drop_column("outbound_header", "country")
