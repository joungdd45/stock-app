# scripts/backup_db.py
import os, json, gzip, csv, pathlib
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

# 백업 타겟 후보 (있으면 백업, 없으면 스킵)
TARGET_TABLES = ["products", "stocks", "ledger", "audit_log"]

def ensure_dir(p: pathlib.Path):
    p.mkdir(parents=True, exist_ok=True)

def now_stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")

async def table_exists(session: AsyncSession, table: str) -> bool:
    q = text("SELECT to_regclass(:fqname) IS NOT NULL AS exists")
    row = (await session.execute(q, {"fqname": f"public.{table}"})).first()
    return bool(row[0]) if row else False

async def get_columns(session: AsyncSession, table: str):
    """
    returns list of (column_name, udt_name) ordered by ordinal_position
    """
    q = text("""
        SELECT column_name, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :t
        ORDER BY ordinal_position
    """)
    rows = (await session.execute(q, {"t": table})).all()
    return [(r[0], r[1]) for r in rows]

def build_select_sql(table: str, cols):
    """
    json/jsonb 컬럼은 ::text 로 캐스팅해서 CSV에 안전 저장
    """
    select_items = []
    for name, udt in cols:
        if udt in ("json", "jsonb"):
            select_items.append(f'"{name}"::text AS "{name}"')
        else:
            select_items.append(f'"{name}"')
    order_col = "id" if any(c[0] == "id" for c in cols) else cols[0][0]
    select_list = ", ".join(select_items)
    return f'SELECT {select_list} FROM public."{table}" ORDER BY "{order_col}"'

async def dump_table(session: AsyncSession, table: str, folder: pathlib.Path):
    cols = await get_columns(session, table)
    if not cols:
        return {"name": table, "rows": 0, "file": f"{table}.csv.gz", "skipped": True, "reason": "no columns"}
    sql = build_select_sql(table, cols)
    result = await session.execute(text(sql))
    headers = list(result.keys())
    rows = result.mappings().all()

    out_path = folder / f"{table}.csv.gz"
    with gzip.open(out_path, "wt", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in headers})
    return {"name": table, "rows": len(rows), "file": out_path.name, "skipped": False}

async def main():
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is missing")

    engine = create_async_engine(db_url, echo=False, future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    backup_root = pathlib.Path("backups")
    ensure_dir(backup_root)
    folder = backup_root / now_stamp()
    ensure_dir(folder)

    summary = {
        "at_utc": datetime.now(timezone.utc).isoformat(),
        "tables": [],
    }

    async with SessionLocal() as session:
        for t in TARGET_TABLES:
            if not await table_exists(session, t):
                summary["tables"].append({"name": t, "rows": 0, "file": None, "skipped": True, "reason": "not found"})
                continue
            info = await dump_table(session, t, folder)
            summary["tables"].append(info)

    with open(folder / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"✅ Backup done: {folder}")
    for t in summary["tables"]:
        flag = "SKIP" if t.get("skipped") else "OK"
        rows = t.get("rows", 0)
        print(f" - {t['name']}: {flag} ({rows} rows)")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
