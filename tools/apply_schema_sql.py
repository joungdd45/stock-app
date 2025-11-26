# 📄 tools/apply_schema_sql.py (수정본)
import os
import sys
from dotenv import load_dotenv
import psycopg

BASE = os.path.abspath(os.path.dirname(__file__) + "/..")
SCHEMA_FILE = os.path.join(BASE, "schema.sql")

def main():
    load_dotenv()
    url = os.getenv("DATABASE_URL")
    if not url:
        print("에러: .env에 DATABASE_URL이 없습니다.")
        sys.exit(1)

    # ✅ SQLAlchemy async URL → psycopg sync URL 변환
    # postgresql+asyncpg:// → postgresql://
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)

    print(f"[INFO] DATABASE_URL={url}")
    print(f"[INFO] 적용 파일={SCHEMA_FILE}")

    if not os.path.exists(SCHEMA_FILE):
        print(f"에러: {SCHEMA_FILE} 없음")
        sys.exit(1)

    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        sql = f.read()

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    print("✅ schema.sql 적용 완료!")

if __name__ == "__main__":
    main()
