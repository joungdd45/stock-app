# 📄 C:\dev\stock-app\app\db\base.py
from __future__ import annotations

import os
import sys
from importlib import import_module
from pathlib import Path
from typing import List
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """프로젝트 전역 Declarative Base"""
    pass


def _ensure_on_syspath(p: Path) -> None:
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)


def import_all_models(verbose: bool = False) -> List[str]:
    """
    모델 자동 로딩(메타데이터 채우기).

    우선순위
    1) 단일 모듈 우선: 'models' → 'app.models' → 'app.db.models'
       - 루트의 models.py를 가장 먼저 시도(가장 흔한 케이스)
    2) 디렉터리 재귀 스캔:
       - app/db/models
       - app/models
       - app/domain/models
    3) 환경변수 MODELS_PATHS="app/foo,app/bar" 로 추가 경로 지정 가능

    반환: import에 성공한 모듈 경로 목록
    """
    imported: List[str] = []

    base_file = Path(__file__).resolve()            # .../app/db/base.py
    project_root = base_file.parents[2]             # C:/dev/stock-app
    _ensure_on_syspath(project_root)

    # 1) 단일 모듈 우선 로드 (루트 models.py 최우선)
    single_modules = [
        "models",           # ✅ C:\dev\stock-app\models.py
        "app.models",
        "app.db.models",
    ]
    for dotted in single_modules:
        try:
            if dotted in sys.modules:
                m = sys.modules[dotted]
            else:
                m = import_module(dotted)
            imported.append(dotted)
            if verbose:
                print(f"[import ok] {dotted}")
        except Exception as e:
            if verbose:
                print(f"[import fail] {dotted} -> {e!r}")

    # 2) 디렉터리 스캔 (필요한 모델 폴더만, 불필요 경로는 제외)
    dir_candidates: List[Path] = [
        project_root / "app" / "db" / "models",
        project_root / "app" / "models",
        project_root / "app" / "domain" / "models",
    ]

    # 환경변수로 추가 경로 지원 (쉼표로 구분)
    extra = os.getenv("MODELS_PATHS")
    if extra:
        for raw in extra.split(","):
            path = (project_root / raw.strip()).resolve()
            if path.exists() and path.is_dir():
                dir_candidates.append(path)

    scanned_any = False
    for d in dir_candidates:
        if not d.exists() or not d.is_dir():
            continue
        scanned_any = True
        for py in d.rglob("*.py"):
            if py.name == "__init__.py":
                continue
            try:
                rel = py.relative_to(project_root).with_suffix("")   # app/db/models/product
                dotted = ".".join(rel.parts)                         # app.db.models.product
                # 이미 임포트된 모듈은 스킵
                if dotted in sys.modules:
                    continue
                import_module(dotted)
                imported.append(dotted)
                if verbose:
                    print(f"[import ok] {dotted}")
            except Exception as e:
                if verbose:
                    print(f"[import fail] {py} -> {e!r}")

    if verbose:
        if not scanned_any:
            print("[warn] 스캔할 모델 디렉터리를 찾지 못했습니다.")
            print("      실제 경로가 다르면 MODELS_PATHS 환경변수로 추가하세요. (예: MODELS_PATHS=app/my_models)")
        try:
            print("tables:", sorted(Base.metadata.tables.keys()))
        except Exception:
            pass

    return imported


__all__ = ["Base", "import_all_models"]
