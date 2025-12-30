"""missing revision stub

이 리비전은 down_revision 체인 복구용 스텁입니다.
원본 0b45f1300eba 파일이 누락되어 Alembic이 새 리비전을 생성하지 못하는 문제를 해결합니다.
upgrade/downgrade는 의도적으로 비워둡니다.

Revision ID: 0b45f1300eba
Revises: 
Create Date: 1970-01-01 00:00:00
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0b45f1300eba"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
