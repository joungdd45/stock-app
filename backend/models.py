# 📄 backend/models.py
# 목적: 재고이찌 DB 스펙 v1.6-r2 전체 SQLAlchemy 모델 정의
# 기준 스키마: users / product(+묶음설정) / inbound / outbound / inventory_ledger / stock_current / settings 계열
#
# ✅ 기본 원칙 (v1.6-r2)
# 1) 재고이찌의 모든 업무 테이블은 기본적으로 deleted_at 기반 논리삭제를 사용한다.
# 2) 마지막 수정자 추적용 updated_by 필드를 사용한다.
# 3) inventory_ledger는 이력 보존을 위해 deleted_at을 두지 않는 예외 테이블이다.
# 4) 상품 묶음설정은 product_bundle_item 을 통해 bundle_sku ↔ component_sku 관계로 관리한다.
# 5) product 테이블에는 weight(NUMERIC(12,3)), base_sku(VARCHAR(50)), pack_qty(INTEGER) 컬럼이 포함된다.
# 6) outbound_header 테이블에는 country(VARCHAR(10)) 컬럼이 포함된다.

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    Date,
    DateTime,
    Numeric,
    Text,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint,
    Index,
    text,
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


# ─────────────────────────────────────────────
# 공통 Mixin (필요 최소한만 사용)
# ─────────────────────────────────────────────
class CreatedUpdatedMixin:
    """
    created_at, updated_at 둘 다 있는 테이블용 Mixin.
    - created_at: 행이 처음 만들어진 시각
    - updated_at: 행이 생성되거나 수정될 때마다 자동 갱신
    """

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class UpdatedOnlyMixin:
    """
    updated_at만 있는 테이블용 Mixin.
    - updated_at: 행이 생성되거나 수정될 때마다 자동 갱신
    """

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


# ─────────────────────────────────────────────
# 0. 사용자관리: users
# ─────────────────────────────────────────────
class User(CreatedUpdatedMixin, Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), nullable=False, unique=True)     # 로그인 아이디
    password_hash = Column(String(255), nullable=False)            # 비밀번호 해시
    name = Column(String(100))                                     # 사용자 이름
    role = Column(String(20), nullable=False, server_default=text("'user'"))
    # 예: admin, manager, user 등

    is_active = Column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )  # 계정 활성 여부

    last_login_at = Column(DateTime)                               # 마지막 로그인 시각
    login_count = Column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )  # 누적 로그인 횟수

    # 감사 필드
    created_by = Column(String(50))                                # 최초 생성자
    updated_by = Column(String(50))                                # 마지막 수정자
    deleted_at = Column(DateTime)                                  # soft delete 시각 (탈퇴 등)


# ─────────────────────────────────────────────
# 1. 상품관리: product + 묶음설정
# ─────────────────────────────────────────────
class Product(CreatedUpdatedMixin, Base):
    __tablename__ = "product"

    id = Column(Integer, primary_key=True)
    sku = Column(String(50), nullable=False, unique=True)         # 내부 관리용 SKU
    barcode = Column(String(50))                                  # 바코드 (선택)
    name = Column(String(200), nullable=False)                    # 상품명
    brand = Column(String(100))                                   # 브랜드
    category = Column(String(100))                                # 카테고리 등 분류

    # ✅ 묶음 기준 추가
    # - base_sku: 이 SKU가 실제로 재고를 차감해야 할 기준 SKU
    #   단품인 경우: 자기 자신을 가리킴 (base_sku = sku)
    #   묶음상품인 경우: 구성 단품 SKU를 가리킴 (예: BUNDLE-3PACK -> SINGLE)
    base_sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=True,
    )

    # 이 SKU 1개가 실제 몇 개를 의미하는지
    # 단품 = 1 / 묶음상품 = 2, 3, 4 등
    pack_qty = Column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )

    # 묶음상품 여부
    # true: 이 SKU는 묶음상품으로 사용됨
    # false: 일반 단일상품
    is_bundle = Column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    # 최근 입고단가 = 가장 마지막 입고의 개당단가
    last_inbound_unit_price = Column(Numeric(12, 2))              # 최근입고단가 (원가 기준)
    last_inbound_date = Column(Date)                              # 최근 입고일자

    # 상품 자체 중량 (선택 입력)
    weight = Column(Numeric(12, 3))                               # 상품 1개 중량

    is_active = Column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )

    # 감사 필드
    created_by = Column(String(50))                               # 최초 생성자
    updated_by = Column(String(50))                               # 마지막 수정자
    deleted_at = Column(DateTime)                                 # soft delete 시각

    # 관계 (편의를 위한 선택 사항)
    inbound_items = relationship(
        "InboundItem",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    outbound_items = relationship(
        "OutboundItem",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    inventory_ledgers = relationship(
        "InventoryLedger",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    stock_current = relationship(
        "StockCurrent",
        back_populates="product",
        uselist=False,
        passive_deletes=True,
    )

    # 묶음설정 관계
    # 이 상품이 "묶음상품"일 때, 구성상품 목록
    bundle_components = relationship(
        "ProductBundleItem",
        foreign_keys="ProductBundleItem.bundle_sku",
        back_populates="bundle_product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # 이 상품이 "다른 묶음상품의 구성품"일 때, 소속 묶음 목록
    bundle_memberships = relationship(
        "ProductBundleItem",
        foreign_keys="ProductBundleItem.component_sku",
        back_populates="component_product",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_product_barcode", "barcode"),
        Index("idx_product_base_sku", "base_sku"),
        CheckConstraint("pack_qty > 0", name="ck_product_pack_qty_positive"),
    )


class ProductBundleItem(CreatedUpdatedMixin, Base):
    """
    상품 묶음설정 테이블
    - bundle_sku: 묶음상품 SKU (product.sku)
    - component_sku: 구성상품 SKU (product.sku)
    - component_qty: 해당 구성상품이 몇 개 포함되는지
    """
    __tablename__ = "product_bundle_item"

    id = Column(Integer, primary_key=True)

    bundle_sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
    )
    component_sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
    )
    component_qty = Column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )

    # 감사 필드
    updated_by = Column(String(50))                                # 마지막 수정자
    deleted_at = Column(DateTime)                                  # 논리삭제 (구성 해제 등)

    # 관계
    bundle_product = relationship(
        "Product",
        foreign_keys=[bundle_sku],
        back_populates="bundle_components",
    )
    component_product = relationship(
        "Product",
        foreign_keys=[component_sku],
        back_populates="bundle_memberships",
    )

    __table_args__ = (
        # 묶음상품이 자기 자신을 구성으로 갖는 것은 금지
        CheckConstraint("bundle_sku <> component_sku", name="ck_bundle_not_self"),
        # component_qty > 0 강제
        CheckConstraint("component_qty > 0", name="ck_bundle_component_qty_positive"),
        # 하나의 묶음 SKU 안에 동일 구성 SKU가 중복 들어가지 않도록 제한 (논리삭제 제외)
        Index(
            "ux_product_bundle_item_bundle_component",
            "bundle_sku",
            "component_sku",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_product_bundle_item_bundle_sku",
            "bundle_sku",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_product_bundle_item_component_sku",
            "component_sku",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


# ─────────────────────────────────────────────
# 2. 입고관리: inbound_header, inbound_item
# ─────────────────────────────────────────────
class InboundHeader(CreatedUpdatedMixin, Base):
    __tablename__ = "inbound_header"

    id = Column(Integer, primary_key=True)                        # 입고번호(전표번호)
    inbound_date = Column(Date)                                   # 입고일자
    order_date = Column(Date)                                     # 주문일자
    supplier_name = Column(String(100), nullable=False)           # 입고처(공급사)

    status = Column(
        String(20),
        nullable=False,
        server_default=text("'draft'"),
    )
    # 예: 'draft', 'committed'

    created_by = Column(String(50), nullable=False)               # 작성자
    memo = Column(Text)                                           # 메모

    # 감사 필드
    updated_by = Column(String(50))                               # 마지막 수정자
    deleted_at = Column(DateTime)                                 # soft delete 시각

    # 관계
    items = relationship(
        "InboundItem",
        back_populates="header",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_inbound_header_status", "status"),
        Index("idx_inbound_header_dates", "inbound_date", "order_date"),
    )


class InboundItem(CreatedUpdatedMixin, Base):
    __tablename__ = "inbound_item"

    id = Column(Integer, primary_key=True)
    header_id = Column(
        Integer,
        ForeignKey("inbound_header.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
    )

    qty = Column(Integer, nullable=False)                         # 입고수량
    unit_price = Column(Numeric(12, 2))                           # 개당단가 (원가 기준)
    total_price = Column(Numeric(12, 2))                          # 총단가 = qty * unit_price

    # 감사 필드
    updated_by = Column(String(50))                               # 마지막 수정자
    deleted_at = Column(DateTime)                                 # soft delete 시각

    # 관계
    header = relationship("InboundHeader", back_populates="items")
    product = relationship("Product", back_populates="inbound_items")

    __table_args__ = (
        Index("idx_inbound_item_header_id", "header_id"),
        Index("idx_inbound_item_sku", "sku"),
    )


# ─────────────────────────────────────────────
# 3. 출고관리: outbound_header, outbound_item
# ─────────────────────────────────────────────
class OutboundHeader(CreatedUpdatedMixin, Base):
    __tablename__ = "outbound_header"

    id = Column(Integer, primary_key=True)                        # 출고번호(전표번호, 송장 단위 전표)
    outbound_date = Column(Date)                                  # 출고일자
    order_number = Column(String(100))                            # 쇼핑몰 주문번호 등
    channel = Column(String(50))                                  # 판매채널(쇼피, 라자다 등)

    # 출고 국가 (쇼피 국가코드 또는 배송 국가코드)
    # 예: 'SG', 'MY', 'TW', 'PH', 'TH', 'VN'
    country = Column(String(10))                                  # 출고국가

    # 스플릿 출고 지원
    tracking_number = Column(String(100))                         # 택배 송장번호

    status = Column(
        String(20),
        nullable=False,
        server_default=text("'draft'"),
    )
    # 예: 'draft', 'picking', 'packed', 'shipped', 'completed'

    receiver_name = Column(String(100))                           # 수취인 이름 (필요 시)
    created_by = Column(String(50), nullable=False)               # 작성자
    memo = Column(Text)

    # 포장 완료 후 실제 박스 무게(g 단위)
    weight_g = Column(Integer)                                    # 박스 실중량 (그램)

    # 감사 필드
    updated_by = Column(String(50))                               # 마지막 수정자
    deleted_at = Column(DateTime)                                 # soft delete 시각

    # 관계
    items = relationship(
        "OutboundItem",
        back_populates="header",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_outbound_header_status", "status"),
        Index("idx_outbound_header_date", "outbound_date"),
        # 주문번호 조회용 인덱스 (논리삭제 제외)
        Index(
            "idx_outbound_header_order_number",
            "order_number",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # 송장번호 partial unique 인덱스
        Index(
            "ux_outbound_header_tracking_number",
            "tracking_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class OutboundItem(CreatedUpdatedMixin, Base):
    __tablename__ = "outbound_item"

    id = Column(Integer, primary_key=True)
    header_id = Column(
        Integer,
        ForeignKey("outbound_header.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
    )

    qty = Column(Integer, nullable=False)                         # 출고해야 할 수량
    scanned_qty = Column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )  # 실제 스캔된 수량

    sales_price = Column(Numeric(12, 2))                          # 개당 판매금액(해당 국가 통화)
    sales_total = Column(Numeric(12, 2))                          # 판매총액 = qty * sales_price

    currency = Column(String(10))                                 # 통화코드 (예: SGD, TWD 등)

    # 감사 필드
    updated_by = Column(String(50))                               # 마지막 수정자
    deleted_at = Column(DateTime)                                 # soft delete 시각

    # 관계
    header = relationship("OutboundHeader", back_populates="items")
    product = relationship("Product", back_populates="outbound_items")

    __table_args__ = (
        Index("idx_outbound_item_header_id", "header_id"),
        Index("idx_outbound_item_sku", "sku"),
    )


# ─────────────────────────────────────────────
# 4. 재고관리: 재고 이력(장부)와 재고 현황
# ─────────────────────────────────────────────
class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"

    id = Column(Integer, primary_key=True)
    sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
    )

    event_type = Column(String(20), nullable=False)
    # 예: 'INBOUND', 'OUTBOUND', 'ADJUST'

    ref_type = Column(String(20))                                  # 참조 전표 타입 (INBOUND, OUTBOUND 등)
    ref_id = Column(Integer)                                       # 참조 전표 id

    qty_in = Column(Integer, nullable=False, server_default=text("0"))
    qty_out = Column(Integer, nullable=False, server_default=text("0"))

    unit_price = Column(Numeric(12, 2))                            # 이 시점의 기준 단가 (원가 기준)

    memo = Column(Text)

    # 감사 필드
    created_by = Column(String(50))                                # 이 이력을 만든 사용자
    updated_by = Column(String(50))                                # 필요 시 정정 처리자

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )
    # deleted_at 없음: 이력 보존용 (예외 테이블)

    # 관계
    product = relationship("Product", back_populates="inventory_ledgers")

    __table_args__ = (
        Index("idx_inventory_ledger_sku", "sku"),
        Index("idx_inventory_ledger_created_at", "created_at"),
    )


class StockCurrent(UpdatedOnlyMixin, Base):
    __tablename__ = "stock_current"

    id = Column(Integer, primary_key=True)
    sku = Column(
        String(50),
        ForeignKey("product.sku"),
        nullable=False,
        unique=True,
    )

    qty_on_hand = Column(Integer, nullable=False, server_default=text("0"))
    qty_reserved = Column(Integer, nullable=False, server_default=text("0"))
    qty_pending_out = Column(Integer, nullable=False, server_default=text("0"))

    last_unit_price = Column(Numeric(12, 2))
    total_value = Column(Numeric(14, 2))

    # 감사 필드
    updated_by = Column(String(50))                                # 마지막 재고계산/동기화 수행자
    deleted_at = Column(DateTime)                                  # SKU별 재고행 비활성화

    # 관계
    product = relationship("Product", back_populates="stock_current")


# ─────────────────────────────────────────────
# 5. 설정: 글로벌 설정, 사용자별 페이지 설정, 고급설정
# ─────────────────────────────────────────────
class AppSettings(UpdatedOnlyMixin, Base):
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(String(500), nullable=False)
    description = Column(String(200))

    # 감사 필드
    updated_by = Column(String(50))                                # 마지막 수정자
    deleted_at = Column(DateTime)                                  # 설정 soft delete


class SettingsBasicUser(UpdatedOnlyMixin, Base):
    __tablename__ = "settings_basic_user"

    user_id = Column(Integer, primary_key=True)                    # 사용자당 1행 (users.id와 매핑 예정)
    page_size = Column(Integer, nullable=False)
    theme = Column(String(10), nullable=False)

    # 감사 필드
    updated_by = Column(String(50))                                # 마지막 수정자
    deleted_at = Column(DateTime)                                  # 설정 soft delete

    __table_args__ = (
        CheckConstraint("page_size BETWEEN 10 AND 200", name="ck_settings_basic_user_page_size"),
        CheckConstraint(
            "theme IN ('라이트', '다크', '시스템')",
            name="ck_settings_basic_user_theme",
        ),
    )


class SettingsAdvanced(UpdatedOnlyMixin, Base):
    __tablename__ = "settings_advanced"

    id = Column(Integer, primary_key=True)
    category = Column(String(50), nullable=False)                  # 예: 'security', 'performance', 'api'
    key = Column(String(100), nullable=False)                      # 예: 'password_min_length', 'cache_ttl', ...
    value = Column(String(500), nullable=False)                    # 실제 설정 값
    value_type = Column(String(20), nullable=False)                # 'int', 'bool', 'string', 'json' 등

    description = Column(String(200))

    # 감사 필드
    updated_by = Column(String(50))
    deleted_at = Column(DateTime)

    __table_args__ = (
        UniqueConstraint("category", "key", name="uq_settings_advanced_category_key"),
    )


# ─────────────────────────────────────────────
# 레거시 호환용 alias
# (예전 코드에서 `from backend.models import product_bundle_item`를 호출해도 깨지지 않도록)
# ─────────────────────────────────────────────
product_bundle_item = ProductBundleItem
