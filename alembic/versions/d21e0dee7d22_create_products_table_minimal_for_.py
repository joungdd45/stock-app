# 📄 C:\dev\stock-app\alembic\versions\d21e0dee7d22_create_products_table_minimal_for_.py
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d21e0dee7d22"
down_revision = "0b45f1300eba"  # inventory_ledger compat view 리비전
branch_labels = None
depends_on = None


def upgrade():
    # 최소 스키마: id, sku, name, quantity, status
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("sku", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_products_id", "products", ["id"])
    op.create_index("ix_products_sku", "products", ["sku"], unique=True)


def downgrade():
    op.drop_index("ix_products_sku", table_name="products")
    op.drop_index("ix_products_id", table_name="products")
    op.drop_table("products")
