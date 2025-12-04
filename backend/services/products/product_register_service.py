# 📄 backend/services/products/product_register_service.py
# 페이지: 상품관리 > 상품등록
# 역할:
#   - 상품 목록 조회
#   - SKU 단건 조회
#   - 단건 등록
#   - 수정
#   - 선택 삭제
#   - 묶음 매핑 단건 업데이트
#   - 상품 대량 등록(bulk-excel, JSON rows 기준)
# 단계: v1-7 (DB v1.6-r2: base_sku / pack_qty / is_bundle 반영 + SKU 단건조회)
# 규칙:
#   - 전체수정
#   - sync(Session 전용)
#   - DomainError만 발생 (row 단위 에러는 errors 리스트로 반환)
# 필드 매핑:
#   - API/GUI 필드명: last_inbound_price
#   - DB 컬럼명: last_inbound_unit_price
#
# DB v1.6-r2 관련 규칙:
#   - 모든 신규 상품은 기본적으로
#       base_sku = sku
#       pack_qty = 1
#       is_bundle = False
#     로 저장한다.
#   - 묶음설정(product_bundle_item)은 추후 로직에서 활용되며,
#     현재 단계에서는 base_sku/pack_qty는 단품 기준 기본값만 세팅한다.

from __future__ import annotations

from typing import Dict, Any, List, Set
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError

from backend.system.error_codes import DomainError


PAGE_ID = "product.register"
PAGE_VERSION = "v1-7"


# ─────────────────────────────────────────────
# 내부 유틸: 모델/세션
# ─────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    try:
        from backend.models import Product, product_bundle_item, InventoryLedger
    except Exception as e:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="모델 로딩 오류",
            ctx={"page_id": PAGE_ID, "error": str(e)},
        )

    return {
        "Product": Product,
        "Bundle": product_bundle_item,
        "Ledger": InventoryLedger,
    }


def _get_session_adapter(session: Any) -> Session:
    if isinstance(session, Session):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


# ─────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────
class ProductRegisterService:
    page_id = PAGE_ID
    page_version = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session: Session = _get_session_adapter(session)
        self.user = user or {}
        self.models = _get_models()
        self.Product = self.models["Product"]
        self.Bundle = self.models["Bundle"]
        self.Ledger = self.models["Ledger"]

    # ======================================================
    # 1) 목록 조회
    # ======================================================
    def list_items(self) -> Dict[str, Any]:
        """
        상품 목록 조회
        - deleted_at IS NULL 인 상품만 조회
        - v1-7에서 base_sku / pack_qty / is_bundle 컬럼은
          응답에 노출하지 않고 내부적으로만 사용 (필요 시 확장 가능)
        """
        stmt = (
            select(self.Product)
            .where(self.Product.deleted_at.is_(None))
            .order_by(self.Product.created_at.desc())
        )

        rows = self.session.execute(stmt).scalars().all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            last_inbound_unit_price = getattr(r, "last_inbound_unit_price", None)
            weight = getattr(r, "weight", None)

            # 묶음 관련 여부 (bundle_sku 또는 component_sku로 포함되는지)
            bundle_exists = self.session.execute(
                select(self.Bundle).where(
                    (
                        (self.Bundle.bundle_sku == r.sku)
                        | (self.Bundle.component_sku == r.sku)
                    ),
                    self.Bundle.deleted_at.is_(None),
                )
            ).first()

            items.append(
                {
                    "sku": r.sku,
                    "name": r.name,
                    # 화면 스펙 키: last_inbound_price
                    "last_inbound_price": last_inbound_unit_price,
                    "weight": weight,
                    "barcode": r.barcode,
                    "is_bundle_related": True if bundle_exists else False,
                }
            )

        return {
            "ok": True,
            "count": len(items),
            "items": items,
        }

    # ======================================================
    # 1-1) SKU 단건 조회
    #      - 입고/출고/모바일에서 SKU 기준으로 상품정보 조회
    # ======================================================
    def get_by_sku(self, *, sku: str) -> Dict[str, Any]:
        """
        SKU 기준 상품 단건 조회
        - deleted_at IS NULL 인 상품만 대상
        - 목록 조회와 동일한 필드 구조 중 단건만 반환
        """
        sku = (sku or "").strip()
        if not sku:
            raise DomainError(
                "PRODUCT-VALID-005",
                detail="sku는 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        product = self.session.execute(
            select(self.Product).where(
                self.Product.sku == sku,
                self.Product.deleted_at.is_(None),
            )
        ).scalar_one_or_none()

        if not product:
            raise DomainError(
                "PRODUCT-NOTFOUND-001",
                detail="해당 SKU를 찾을 수 없습니다.",
                ctx={"sku": sku},
            )

        last_inbound_unit_price = getattr(product, "last_inbound_unit_price", None)
        weight = getattr(product, "weight", None)

        bundle_exists = self.session.execute(
            select(self.Bundle).where(
                (
                    (self.Bundle.bundle_sku == product.sku)
                    | (self.Bundle.component_sku == product.sku)
                ),
                self.Bundle.deleted_at.is_(None),
            )
        ).first()

        item = {
            "sku": product.sku,
            "name": product.name,
            "last_inbound_price": last_inbound_unit_price,
            "weight": weight,
            "barcode": product.barcode,
            "is_bundle_related": True if bundle_exists else False,
        }

        return {
            "ok": True,
            "item": item,
        }

    # ======================================================
    # 2) 단건 등록
    # ======================================================
    def create(self, *, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        상품 단건 등록
        - 필수: sku, name
        - 옵션: last_inbound_price, weight, barcode
        - DB v1.6-r2:
          - base_sku = sku
          - pack_qty = 1
          - is_bundle = False
        """
        sku = (payload.get("sku") or "").strip()
        name = (payload.get("name") or "").strip()

        if not sku or not name:
            raise DomainError(
                "PRODUCT-VALID-001",
                detail="sku와 name은 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        # 요청에서는 last_inbound_price로 들어옴
        last_inbound_unit_price = payload.get("last_inbound_price", 0)
        weight = payload.get("weight")
        barcode = payload.get("barcode")

        # SKU 중복 체크 (삭제여부 상관없이)
        exists = self.session.execute(
            select(self.Product).where(self.Product.sku == sku)
        ).first()

        if exists:
            raise DomainError(
                "PRODUCT-VALID-002",
                detail="이미 존재하는 SKU입니다.",
                ctx={"sku": sku},
            )

        # 가격 검증
        try:
            if (
                last_inbound_unit_price is not None
                and float(last_inbound_unit_price) < 0
            ):
                raise ValueError
        except Exception:
            raise DomainError(
                "PRODUCT-VALID-003",
                detail="last_inbound_price는 0 이상의 숫자여야 합니다.",
                ctx={"value": last_inbound_unit_price},
            )

        username = self.user.get("username")

        # DB v1.6-r2 기본 규칙 반영
        obj = self.Product(
            sku=sku,
            name=name,
            barcode=barcode,
            weight=weight,
            last_inbound_unit_price=last_inbound_unit_price,
            # 신규 상품은 단품 기준:
            base_sku=sku,      # 자기 자신을 기준 SKU로
            pack_qty=1,        # 단품 1개
            is_bundle=False,   # 기본적으로 묶음상품 아님
            created_by=username,
            updated_by=username,
        )

        self.session.add(obj)

        try:
            self.session.commit()
        except IntegrityError as e:
            self.session.rollback()
            raise DomainError(
                "PRODUCT-VALID-002",
                detail="이미 존재하는 SKU입니다.",
                ctx={"sku": sku, "db_error": str(e)},
            )

        return {
            "ok": True,
            "sku": sku,
        }

    # ======================================================
    # 3) 상품 수정 (SKU 고정)
    # ======================================================
    def update(self, *, sku: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        상품 단건 수정
        - sku 고정
        - name / weight / barcode / last_inbound_price 수정
        - base_sku / pack_qty / is_bundle 는 현재 단계에서
          별도 화면 없이 내부 정책으로만 유지 (여기서 변경하지 않음)
        """
        sku = (sku or "").strip()
        if not sku:
            raise DomainError(
                "PRODUCT-VALID-005",
                detail="sku는 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        product = self.session.execute(
            select(self.Product).where(self.Product.sku == sku)
        ).scalar_one_or_none()

        if not product:
            raise DomainError(
                "PRODUCT-NOTFOUND-001",
                detail="해당 SKU를 찾을 수 없습니다.",
                ctx={"sku": sku},
            )

        # 기본 필드 수정
        if "name" in payload and payload["name"] is not None:
            product.name = payload["name"]
        if "weight" in payload:
            product.weight = payload["weight"]
        if "barcode" in payload:
            product.barcode = payload["barcode"]

        # 가격 필드 수정
        # - 우선순위: last_inbound_price → last_inbound_unit_price → 기존값
        if "last_inbound_price" in payload or "last_inbound_unit_price" in payload:
            value = payload.get(
                "last_inbound_price",
                payload.get("last_inbound_unit_price", product.last_inbound_unit_price),
            )
            try:
                if value is not None and float(value) < 0:
                    raise ValueError
            except Exception:
                raise DomainError(
                    "PRODUCT-VALID-003",
                    detail="last_inbound_price는 0 이상의 숫자여야 합니다.",
                    ctx={"value": value},
                )
            product.last_inbound_unit_price = value

        # base_sku / pack_qty / is_bundle 는 여기서 수정하지 않는다.
        product.updated_by = self.user.get("username")

        self.session.commit()

        return {
            "ok": True,
            "sku": sku,
        }

    # ======================================================
    # 4) 선택 삭제 (이력 없으면 물리삭제)
    # ======================================================
    def delete(self, *, skus: List[str]) -> Dict[str, Any]:
        """
        선택 삭제
        - 재고 이력이 있으면 삭제 불가
        - 없으면 Product 물리삭제
        """
        if not skus:
            raise DomainError(
                "PRODUCT-VALID-004",
                detail="skus가 비어있습니다.",
                ctx={"page_id": PAGE_ID},
            )

        deleted: List[str] = []

        for sku in skus:
            sku = (sku or "").strip()
            if not sku:
                continue

            # 재고 이력 존재 여부 확인
            used = self.session.execute(
                select(self.Ledger).where(self.Ledger.sku == sku)
            ).first()

            if used:
                raise DomainError(
                    "PRODUCT-USED-001",
                    detail="재고 이력이 있는 SKU는 삭제할 수 없습니다.",
                    ctx={"sku": sku},
                )

            self.session.execute(
                delete(self.Product).where(self.Product.sku == sku)
            )

            deleted.append(sku)

        self.session.commit()

        return {
            "ok": True,
            "deleted": deleted,
        }

    # ======================================================
    # 5) 묶음 매핑 단건 업데이트
    #    - bundle_sku 기준 기존 매핑 논리삭제 → 신규 매핑 전체 재삽입
    # ======================================================
    def update_bundle_mapping(self, *, payload: Dict[str, Any]) -> Dict[str, Any]:
        bundle_sku = (payload.get("bundle_sku") or "").strip()
        items = payload.get("items") or []

        if not bundle_sku:
            raise DomainError(
                "PRODUCT-VALID-006",
                detail="bundle_sku는 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        if not isinstance(items, list) or len(items) == 0:
            raise DomainError(
                "PRODUCT-VALID-007",
                detail="items는 1개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
            )

        # component_sku 목록 추출
        component_skus: List[str] = []
        for raw in items:
            sku = (raw.get("component_sku") or "").strip()
            if not sku:
                raise DomainError(
                    "PRODUCT-VALID-008",
                    detail="component_sku는 비어 있을 수 없습니다.",
                    ctx={"page_id": PAGE_ID},
                )
            component_skus.append(sku)

        # self reference 체크
        if bundle_sku in component_skus:
            raise DomainError(
                "PRODUCT-BUNDLE-SELF",
                detail="bundle_sku와 component_sku는 같을 수 없습니다.",
                ctx={"bundle_sku": bundle_sku},
            )

        # qty 검증 및 정제
        cleaned_items: List[Dict[str, Any]] = []
        for raw in items:
            comp_sku = (raw.get("component_sku") or "").strip()
            qty = raw.get("component_qty")

            try:
                qty_val = int(qty)
                if qty_val <= 0:
                    raise ValueError
            except Exception:
                raise DomainError(
                    "PRODUCT-BUNDLE-QTY",
                    detail="component_qty는 1 이상의 정수여야 합니다.",
                    ctx={"component_sku": comp_sku, "value": qty},
                )

            cleaned_items.append(
                {
                    "component_sku": comp_sku,
                    "component_qty": qty_val,
                }
            )

        # SKU 존재 여부 체크 (bundle_sku + component_skus)
        all_skus: Set[str] = {bundle_sku, *component_skus}
        existing_products = self.session.execute(
            select(self.Product).where(
                self.Product.sku.in_(all_skus),
                self.Product.deleted_at.is_(None),
            )
        ).scalars().all()

        existing_set: Set[str] = {p.sku for p in existing_products}
        missing = sorted(all_skus - existing_set)

        if missing:
            raise DomainError(
                "PRODUCT-NOTFOUND",
                detail="존재하지 않는 SKU가 포함되어 있습니다.",
                ctx={"missing_skus": missing},
            )

        now = datetime.utcnow()
        username = self.user.get("username")

        # 기존 매핑 논리삭제
        self.session.execute(
            update(self.Bundle)
            .where(
                self.Bundle.bundle_sku == bundle_sku,
                self.Bundle.deleted_at.is_(None),
            )
            .values(
                deleted_at=now,
                updated_at=now,
                updated_by=username,
            )
        )

        # 신규 매핑 삽입
        for item in cleaned_items:
            obj = self.Bundle(
                bundle_sku=bundle_sku,
                component_sku=item["component_sku"],
                component_qty=item["component_qty"],
                updated_by=username,
                deleted_at=None,
                created_at=now,
                updated_at=now,
            )
            self.session.add(obj)

        self.session.commit()

        return {
            "ok": True,
            "bundle_sku": bundle_sku,
            "mapping_count": len(cleaned_items),
        }

    # ======================================================
    # 6) 상품 대량 등록 (bulk-excel rows)
    #    - 프론트에서 엑셀 파싱 → rows 배열(JSON) 전달
    #    - 각 row 개별 검증 / 기존 SKU는 스킵
    # ======================================================
    def bulk_create(self, *, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not isinstance(rows, list) or len(rows) == 0:
            raise DomainError(
                "PRODUCT-VALID-009",
                detail="rows는 1개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
            )

        total_rows = len(rows)
        errors: List[Dict[str, Any]] = []

        # 모든 SKU 수집
        skus: List[str] = []
        for row in rows:
            sku = (row.get("sku") or "").strip()
            skus.append(sku)

        # DB에 이미 존재하는 SKU 미리 조회
        existing_products = self.session.execute(
            select(self.Product).where(self.Product.sku.in_(skus))
        ).scalars().all()
        existing_sku_set: Set[str] = {p.sku for p in existing_products}

        username = self.user.get("username")
        now = datetime.utcnow()

        to_insert: List[Any] = []
        success_count = 0

        for idx, row in enumerate(rows):
            sku = (row.get("sku") or "").strip()
            name = (row.get("name") or "").strip()
            barcode = row.get("barcode")
            weight = row.get("weight")
            # last_inbound_unit_price 또는 last_inbound_price 둘 중 하나 사용
            last_inbound_price = row.get("last_inbound_unit_price")
            if last_inbound_price is None:
                last_inbound_price = row.get("last_inbound_price")

            # 필수값 검증
            if not sku or not name:
                errors.append(
                    {
                        "row_index": idx,
                        "sku": sku,
                        "code": "PRODUCT-REQUIRED-001",
                        "message": "sku와 name은 필수입니다.",
                    }
                )
                continue

            # 기존 SKU 스킵 (A안)
            if sku in existing_sku_set:
                errors.append(
                    {
                        "row_index": idx,
                        "sku": sku,
                        "code": "PRODUCT-DUPLICATE-001",
                        "message": "이미 존재하는 SKU입니다.",
                    }
                )
                continue

            # weight 숫자 타입 검증 (선택)
            if weight is not None and weight != "":
                try:
                    weight = float(weight)
                except Exception:
                    errors.append(
                        {
                            "row_index": idx,
                            "sku": sku,
                            "code": "PRODUCT-VALID-004",
                            "message": "weight는 숫자여야 합니다.",
                        }
                    )
                    continue
            else:
                weight = None

            # last_inbound_price 숫자 및 범위 검증 (선택)
            if last_inbound_price is not None and last_inbound_price != "":
                try:
                    value = float(last_inbound_price)
                    if value < 0:
                        raise ValueError
                    last_inbound_unit_price = value
                except Exception:
                    errors.append(
                        {
                            "row_index": idx,
                            "sku": sku,
                            "code": "PRODUCT-VALID-003",
                            "message": "last_inbound_price는 0 이상의 숫자여야 합니다.",
                        }
                    )
                    continue
            else:
                last_inbound_unit_price = None

            # DB v1.6-r2 기본 규칙 반영
            obj = self.Product(
                sku=sku,
                name=name,
                barcode=barcode,
                weight=weight,
                last_inbound_unit_price=last_inbound_unit_price,
                base_sku=sku,       # 단품 기준: 자기 자신을 기준 SKU로
                pack_qty=1,         # 단품 1개
                is_bundle=False,    # 기본적으로 묶음상품 아님
                created_by=username,
                updated_by=username,
                created_at=now,
                updated_at=now,
            )
            to_insert.append(obj)
            success_count += 1

        # 실제 DB 반영
        if to_insert:
            self.session.add_all(to_insert)
            try:
                self.session.commit()
            except IntegrityError as e:
                self.session.rollback()
                # 이 경우는 설계상 예상 밖이므로 전체 실패로 보고 DomainError
                raise DomainError(
                    "PRODUCT-DB-001",
                    detail="대량 등록 중 DB 오류가 발생했습니다.",
                    ctx={"page_id": PAGE_ID, "error": str(e)},
                )

        return {
            "ok": True,
            "total_rows": total_rows,
            "success_count": success_count,
            "errors": errors,
        }
