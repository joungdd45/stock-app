# 📄 backend.Dockerfile (전체수정)
FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지(빌드 최소한)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 파이썬 의존성
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 소스 전체 복사(routers, models, core, obs_logging 등 포함)
COPY . /app

# 파이썬 모듈 탐색 경로 보강
ENV PYTHONPATH=/app

# 실행
# ENV=local 이면 reload 켜고, 아니면 일반 실행
CMD sh -lc "if [ \"${ENV}\" = \"local\" ]; then uvicorn app:app --host 0.0.0.0 --port 8000 --reload; else uvicorn app:app --host 0.0.0.0 --port 8000; fi"
