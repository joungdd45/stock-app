# -*- coding: utf-8 -*-
# 📄 tools/generate_schemas_json.py
# 목적: models.py 기반으로 schemas.json 자동 생성
# 실행: python tools/generate_schemas_json.py

import os, sys, json
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from backend.models import Base
import backend.models as models


def model_to_dict(model_cls):
    result = {}
    for col in model_cls.__table__.columns:
        result[col.name] = {
            "type": str(col.type),
            "nullable": col.nullable,
            "primary_key": col.primary_key,
            "default": (
                str(col.default.arg)
                if col.default is not None and col.default.arg is not None
                else None
            ),
        }
    return result


def generate_schemas():
    data = {}
    for name, cls in models.__dict__.items():
        if isinstance(cls, type) and hasattr(cls, "__table__"):
            data[cls.__tablename__] = model_to_dict(cls)

    with open("schemas.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("✅ schemas.json 생성 완료! → 루트폴더")


if __name__ == "__main__":
    generate_schemas()
