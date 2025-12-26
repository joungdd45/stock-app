# 📄 backend/routers/app/app_version.py
# 역할:
#  - APK(모바일앱) 강제 업데이트용 버전체크 엔드포인트 제공
#  - 앱 시작 시 1회 호출하여 min_app_version 미만이면 앱이 차단/종료됨
# 응답 규격:
#  {
#    "ok": true,
#    "trace_id": null,
#    "data": {
#      "min_app_version": "1.0.3",
#      "message": "최신 버전으로 업데이트해 주세요."
#    }
#  }

from fastapi import APIRouter

app_version = APIRouter(prefix="/api/app", tags=["app"])

# ✅ 운영 시 여기만 올리면 됨 (서버 기준)
MIN_APP_VERSION = "1.0.5"
MESSAGE = "최신 버전으로 업데이트해 주세요."


@app_version.get("/version")
def get_app_version():
    return {
        "ok": True,
        "trace_id": None,
        "data": {
            "min_app_version": MIN_APP_VERSION,
            "message": MESSAGE,
        },
    }
