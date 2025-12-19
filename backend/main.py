from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from backend.system.error_codes import register_global_handlers

# ─────────────────────────────────────────────
# APP 초기화
# ─────────────────────────────────────────────
app = FastAPI(
    title="stock-app",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# 전역 에러 핸들러
register_global_handlers(app)

# ─────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:8000",
    "http://192.168.45.139:5174",
    "https://pseudoallegoristic-sina-nonremedial.ngrok-free.dev",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# System Health / Ready
# ─────────────────────────────────────────────
@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}

# PC 프론트에서 직접 두드릴 수 있는 Health 엔드포인트
@app.get("/system/health", tags=["system"])
def system_health():
    return {"ok": True, "service": "backend", "status": "healthy"}

api = APIRouter(prefix="/api", tags=["system"])

@api.get("/health")
def api_health():
    return {"status": "ok"}

@api.get("/ready")
def api_ready():
    return {"ready": True}

app.include_router(api)

# ─────────────────────────────────────────────
# /api/system/ping
# ─────────────────────────────────────────────
system_router = APIRouter(prefix="/api/system", tags=["system"])

@system_router.get("/ping")
def system_ping():
    return {"ok": True, "data": "pong"}

# /api/system/health 도 함께 제공(필요시 사용)
@system_router.get("/health")
def api_system_health():
    return {"ok": True, "service": "backend", "status": "healthy"}

app.include_router(system_router)

# ─────────────────────────────────────────────
# Guard
# ─────────────────────────────────────────────
def guard(request: Request):
    try:
        return True
    except HTTPException:
        raise
    except Exception:
        return True

# ─────────────────────────────────────────────
# 라우터 연결
# ─────────────────────────────────────────────
from backend.routers.login.login import login
app.include_router(login)

from backend.routers.main.main_page import main_page
app.include_router(main_page)

from backend.routers.inbound.inbound_process import inbound_process
app.include_router(inbound_process)

from backend.routers.inbound.inbound_register_query import inbound_register_query
app.include_router(inbound_register_query)

from backend.routers.inbound.inbound_register_form import inbound_register_form
app.include_router(inbound_register_form)

from backend.routers.inbound.inbound_complete import inbound_complete
app.include_router(inbound_complete)

from backend.routers.outbound.outbound_process import outbound_process
app.include_router(outbound_process)

from backend.routers.outbound.outbound_register import outbound_register
app.include_router(outbound_register)

from backend.routers.outbound.outbound_register_form import outbound_register_form
app.include_router(outbound_register_form)

from backend.routers.outbound.outbound_complete import outbound_complete
app.include_router(outbound_complete)

from backend.routers.outbound.outbound_cancel import outbound_cancel
app.include_router(outbound_cancel)

from backend.routers.stock.statuspage import statuspage
app.include_router(statuspage)

from backend.routers.stock.stock_history import stock_history
app.include_router(stock_history)

from backend.routers.products.product_register import product_register
app.include_router(product_register)

from backend.routers.reports.reports_weekly import reports_weekly
app.include_router(reports_weekly)

from backend.routers.reports.reports_monthly import reports_monthly
app.include_router(reports_monthly)

from backend.routers.reports.top10 import top10
app.include_router(top10)

from backend.routers.settings.settings_basic import settings_basic
app.include_router(settings_basic)

from backend.routers.settings.settings_advanced import settings_advanced
app.include_router(settings_advanced)

from backend.routers.app.app_version import app_version
app.include_router(app_version)


