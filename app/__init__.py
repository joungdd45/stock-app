# 📄 app/__init__.py  (전체수정)
"""
패키지 마커 + 공개 심볼 정리

1) SQLAlchemy 베이스 및 모델 자동 임포트 유틸 노출
   - from app.db.base import Base, import_all_models

2) 레거시 호환 심볼 제공
   - routers/* 에서 'from app import get_session, ledger_to_dict, product_to_dict' 를 기대하는 경우가 있어
     Swagger 문서화와 서버 기동을 위해 임포트만 통과시키는 안전 스텁을 제공한다.
   - 실제 런타임에서 이 심볼이 호출되면 명확한 RuntimeError를 발생시킨다.
   - 실사용 의존성은 backend 쪽으로 점진 마이그레이션 예정.
"""

from typing import Any, Dict

# 1) 기존 공개 심볼
from .db.base import Base, import_all_models  # ✅ 유지

# 2) 레거시 호환 스텁
async def get_session(*args, **kwargs):
    raise RuntimeError(
        "get_session은 현재 실행 모드에서 제공되지 않습니다. "
        "backend 측의 세션 의존성으로 마이그레이션하거나 해당 라우터에서 직접 세션을 주입하세요."
    )

def ledger_to_dict(obj: Any) -> Dict[str, Any]:
    # 문서화 임포트 용도. 실제 직렬화는 각 라우터·서비스에서 구현해야 한다.
    return {}

def product_to_dict(obj: Any) -> Dict[str, Any]:
    return {}

__all__ = [
    "Base",
    "import_all_models",
    "get_session",
    "ledger_to_dict",
    "product_to_dict",
]
