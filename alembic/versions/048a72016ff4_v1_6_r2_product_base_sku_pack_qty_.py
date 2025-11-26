"""v1.6-r2 product base_sku/pack_qty 추가

- product:
  - base_sku (nullable, FK -> product.sku)
  - pack_qty (INTEGER NOT NULL DEFAULT 1, CHECK pack_qty > 0)
  - idx_product_base_sku 인덱스
  - 기존 행에 대해 base_sku = sku 로 초기화

⚠️ outbound_header.country 는 이전 리비전(3db0e0474930_add_country_to_outbound_header.py)에서 이미 추가됨.
"""

from alembic import op
import sqlalchemy as sa


# 리비전 ID (자동 생성된 값 그대로 사용)
revision = "048a72016ff4"
# 바로 이전 리비전: add_country_to_outbound_header
down_revision = "3db0e0474930"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ───────────────────────────────────────── product: base_sku, pack_qty 추가 ─────────────────────────────────────────
    # base_sku 컬럼 추가 (nullable, FK -> product.sku)
    op.add_column(
        "product",
        sa.Column("base_sku", sa.String(length=50), nullable=True),
    )

    # pack_qty 컬럼 추가 (NOT NULL, DEFAULT 1)
    op.add_column(
        "product",
        sa.Column(
            "pack_qty",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )

    # base_sku FK (product.sku)
    op.create_foreign_key(
        "fk_product_base_sku_product",
        source_table="product",
        referent_table="product",
        local_cols=["base_sku"],
        remote_cols=["sku"],
    )

    # pack_qty > 0 체크 제약조건
    op.create_check_constraint(
        "ck_product_pack_qty_positive",
        "product",
        "pack_qty > 0",
    )

    # base_sku 인덱스
    op.create_index(
        "idx_product_base_sku",
        "product",
        ["base_sku"],
    )

    # 기존 데이터에 대해 base_sku = sku 로 초기화
    op.execute("UPDATE product SET base_sku = sku WHERE base_sku IS NULL")

    # server_default 는 스키마 정의를 깔끔하게 유지하려면 제거
    op.alter_column("product", "pack_qty", server_default=None)


def downgrade() -> None:
    # ───────────────────────────────────────── product 롤백 ─────────────────────────────────────────
    # 인덱스/제약조건/외래키 먼저 제거
    op.drop_index("idx_product_base_sku", table_name="product")
    op.drop_constraint("ck_product_pack_qty_positive", "product", type_="check")
    op.drop_constraint("fk_product_base_sku_product", "product", type_="foreignkey")

    # 컬럼 제거
    op.drop_column("product", "pack_qty")
    op.drop_column("product", "base_sku")
