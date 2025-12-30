"""merge heads

Revision ID: b206bfc36aa5
Revises: 048a72016ff4, 5906125ac640
Create Date: 2025-12-30 13:20:45.878248

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b206bfc36aa5'
down_revision: Union[str, Sequence[str], None] = ('048a72016ff4', '5906125ac640')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
