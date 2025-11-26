# tools/reset_admin_password.py
# 목적: admin 비밀번호를 72바이트 이하 새 값으로 강제 재설정
# 사용: docker compose exec backend python tools/reset_admin_password.py "새비번123!"

import os
import sys
import asyncio

# 프로젝트의 해시 정책 사용( bcrypt_sha256 기본 )
try:
    from core.security import hash_password
except Exception:
    from passlib.hash import bcrypt
    def hash_password(pw: str) -> str:
        return bcrypt.using(rounds=12).hash(pw)

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def run(new_password: str):
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("에러: 컨테이너 환경변수 DATABASE_URL이 없습니다.")
        sys.exit(1)

    pw_hash = hash_password(new_password)

    engine = create_async_engine(db_url, future=True)
    async with engine.begin() as conn:
        # updated_at 컬럼 없이 password_hash만 갱신
        result = await conn.execute(
            text("UPDATE users SET password_hash = :h WHERE username = :u"),
            {"h": pw_hash, "u": "admin"},
        )
        if result.rowcount == 0:
            print("경고: admin 사용자가 없습니다. admin 계정을 먼저 생성하세요.")
        else:
            print("성공: admin 비밀번호가 재설정되었습니다.")
    await engine.dispose()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python tools/reset_admin_password.py \"새비번123!\"")
        sys.exit(1)
    new_pw = sys.argv[1]
    if len(new_pw.encode("utf-8")) > 72:
        print("에러: bcrypt는 72바이트 초과 비밀번호 불가. 더 짧은 비번을 사용하세요.")
        sys.exit(1)
    asyncio.run(run(new_pw))
