# 📄 backend/main.py
# 프로젝트 메인 엔트리 — 모든 라우터 연결 허브
# 규칙: 전체수정 / 턴제 / 페이지우선 / 상단주석 / 핑은 system 전용
# NOAH PATCH v1.9 (outbound.process 서비스 직접 DI 방식으로 정리)

from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

# 전역 에러 시스템
from backend.system.error_codes import register_global_handlers

# ─────────────────────────────────────────────────────────────
# APP 초기화
# ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="stock-app",
    version="0.1.0",
)

# 전역 에러 핸들러 장착
register_global_handlers(app)

# ─────────────────────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────────────────────

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:8000",
    "http://192.168.45.139:5174",
    "https://pseudoallegoristic-sina-nonremedial.ngrok-free.dev",  # 🔹 추가
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,  # 쿠키/인증정보 포함 요청 허용
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# System: Health / Ready
# ─────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api", tags=["system"])


@api.get("/health")
def api_health():
    return {"status": "ok"}


@api.get("/ready")
def api_ready():
    return {"ready": True}


app.include_router(api)

# ─────────────────────────────────────────────────────────────
# Guard (지연 인증용 - 현재 미사용, 추후 확장 여지용)
# ─────────────────────────────────────────────────────────────

def guard(request: Request):
    try:
        return True
    except HTTPException:
        raise
    except Exception:
        return True

# ─────────────────────────────────────────────────────────────
# 도메인 라우터 연결 섹션
# ─────────────────────────────────────────────────────────────

# 로그인 - 로그인 페이지(login.main)
from backend.routers.login.login import login
app.include_router(login)

# 메인페이지 - 메인 화면(main.page)
from backend.routers.main.main_page import main_page
app.include_router(main_page)

# 입고관리 - 입고 처리(inbound.process)
from backend.routers.inbound.inbound_process import inbound_process
app.include_router(inbound_process)

# 입고관리 - 입고 등록 조회(inbound.register.query)
from backend.routers.inbound.inbound_register_query import inbound_register_query
app.include_router(inbound_register_query)

# 입고관리 - 입고등록 등록(inbound.register_form)
from backend.routers.inbound.inbound_register_form import inbound_register_form
app.include_router(inbound_register_form)

# 입고관리 - 입고 완료(inbound.complete)
from backend.routers.inbound.inbound_complete import inbound_complete
app.include_router(inbound_complete)

# ✅ 출고관리 - 출고 처리(outbound.process)
from backend.routers.outbound.outbound_process import outbound_process
app.include_router(outbound_process)

# 출고관리 - 출고 등록 조회(outbound.register)
from backend.routers.outbound.outbound_register import outbound_register
app.include_router(outbound_register)

# 출고관리 - 출고등록 등록(outbound.register.form)
from backend.routers.outbound.outbound_register_form import outbound_register_form
app.include_router(outbound_register_form)

# 출고관리 - 출고 완료(outbound.complete)
from backend.routers.outbound.outbound_complete import outbound_complete
app.include_router(outbound_complete)

# 출고관리 - 출고 취소(outbound.cancel)
from backend.routers.outbound.outbound_cancel import outbound_cancel
app.include_router(outbound_cancel)

# 재고관리 - 재고 현황(stock.statuspage)
from backend.routers.stock.statuspage import statuspage
app.include_router(statuspage)

# 재고관리 - 재고 이력(stock.history)
from backend.routers.stock.stock_history import stock_history
app.include_router(stock_history)

# 상품관리 - 상품 등록(product.register)
from backend.routers.products.product_register import product_register
app.include_router(product_register)

# 📦 Reports — 대시보드/통계
from backend.routers.reports.reports_weekly import reports_weekly
app.include_router(reports_weekly)

from backend.routers.reports.reports_monthly import reports_monthly
app.include_router(reports_monthly)

from backend.routers.reports.top10 import top10
app.include_router(top10)

# 설정 - 기본 설정(settings.basic)
from backend.routers.settings.settings_basic import settings_basic
app.include_router(settings_basic)

# 설정 - 고급설정(settings.advanced)
from backend.routers.settings.settings_advanced import settings_advanced
app.include_router(settings_advanced)
