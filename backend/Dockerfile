FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# requirements.txt 는 backend 폴더 안에 있는 것을 사용
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# ⚠ 핵심: backend 소스를 /app/backend 밑으로 복사
COPY . /app/backend

# /app 을 파이썬 모듈 검색 경로에 추가 → backend 패키지 인식
ENV PYTHONPATH=/app

# backend.main 안의 app 을 엔트리포인트로 사용
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
