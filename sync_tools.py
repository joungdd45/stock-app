# -*- coding: utf-8 -*-
# 📦 sync_tools.py — 외장하드 ↔ 로컬 완전 미러링 도우미 (디버그/자가진단 포함)
# ------------------------------------------------------
# ✅ 사용법 요약
# ------------------------------------------------------
# 📍 1. 로컬 → 외장하드 (백업용)
#
#   python sync_tools.py to-ext
#     → 로컬(C:\dev\stock-app) → 외장하드(D:\projects\stock-app 또는 E:\projects\stock-app)
#        로컬의 모든 파일을 외장하드로 완전 복사(미러링).
#        외장하드에만 있던 파일은 삭제됨.
#     🔸 옵션: --dry  (실제 복사 없이 시뮬레이션만 수행)
#
# ------------------------------------------------------
# 📍 2. 외장하드 → 로컬 (복원 + 실행 준비)
#
#   python sync_tools.py to-local
#     → 외장하드의 최신 파일을 로컬로 완전 복사(미러링).
#        로컬에만 있던 파일은 삭제됨.
#
#   python sync_tools.py front-deps
#     → 프론트엔드 의존성 설치 (node_modules 재설치)
#        내부적으로 pnpm이 있으면 pnpm install --frozen-lockfile 실행,
#        락파일 불일치로 실패하면 자동으로 --no-frozen-lockfile로 재시도.
#        pnpm이 없으면 자동으로 npm ci 실행.
#
# ------------------------------------------------------
# 1) 두 PC의 Node·pnpm 버전, pnpm 스토어 위치를 완전히 동일하게
# 
#   회사·집 모두에서 아래 3줄로 맞춰 놓자. 한 번만 해두면 끝.
# 
#   node -v
#   pnpm -v
#   pnpm config set store-dir C:\pnpm-store\v10 --global
#  확인코드 : pnpm config get store-dir
# ------------------------------------------------------
# 
#   python sync_tools.py back-deps
#     → 백엔드 의존성 설치 (.venv 가상환경 + pip install -r requirements.txt)
#
#   ✅ 권장 순서:
#       1) python sync_tools.py to-local
#       2) python sync_tools.py front-deps
#       3) python sync_tools.py back-deps
# 
#
#
# ------------------------------------------------------
# 📍 기타 명령어
#
#   python sync_tools.py selftest
#     → Python, robocopy, npm/pip 경로 및 폴더 점검
#
#   python sync_tools.py all-to-ext
#     → 로컬→외장 미러링 후 설치 가이드 안내 로그 출력
#
#   python sync_tools.py all-to-local
#     → 외장→로컬 미러링 후 설치 가이드 안내 로그 출력
# ------------------------------------------------------
# ⚠️ 주의
# - /MIR 사용 중 → 소스에 없는 파일은 대상에서 삭제됨.
# - 방향(to-ext / to-local)을 항상 확인하고 실행!
# ------------------------------------------------------
#
# 📦 [외장하드 사용 시 추가 가이드]
# ------------------------------------------------------
# 외장하드(D:\projects\stock-app 또는 E:\projects\stock-app)는
# 소스코드 + 가상환경(.venv) + 모든 의존성이 포함되어 있음.
#
# 단, ⚠️ `.venv` 안의 Python 실행 경로는 PC마다 다르므로
# 다른 PC(예: 회사)에서 외장하드를 사용할 땐 한 번만 재등록 필요.
#
# 💡 실행 오류(예: ModuleNotFoundError, Python path mismatch)가 나올 경우
# 아래 절차로 가상환경을 “재연결”하면 해결됨.
#
# ------------------------------------------------------
# 🔧 외장하드에서 FastAPI 서버 실행 절차
# ------------------------------------------------------
# 1️⃣ 외장하드 경로로 이동:
#     cd D:\projects\stock-app
#
# 2️⃣ 가상환경 재등록 (Python 실행 경로만 갱신):
#     python -m venv .venv
#     → 기존 패키지는 유지되며, 실행 경로만 현재 PC 기준으로 재설정됨.
#
# 3️⃣ 가상환경 활성화:
#     D:\projects\stock-app\.venv\Scripts\activate
#
# 4️⃣ 백엔드 서버 실행:
#     uvicorn app:app --reload
#
# ✅ 위 절차 후엔 외장하드 안의 FastAPI가 정상 구동됨.
# ✅ 외장하드에는 다음 주요 패키지가 이미 포함되어 있음:
#    - fastapi, uvicorn, sqlalchemy, asyncpg, redis, passlib, python-jose 등
#
# ------------------------------------------------------
# 🧠 참고
# - 외장하드를 다른 PC에 꽂을 때마다 위 2단계(`python -m venv .venv`)만
#   다시 실행하면 모든 경로 문제가 해결됨.
#
# - 의존성 업데이트 후엔 항상:
#     pip freeze > requirements.txt
#   으로 갱신하고, 새 PC에서 실행 시:
#     pip install -r requirements.txt
#   로 복원 가능.
#
# - 필요 시 PowerShell 자동화 버전도 작성 가능 (외장하드 감지 후 자동 venv 재설정).

import argparse, os, subprocess, sys, shutil, platform

# ⬇️ 반드시 환경에 맞춰 수정
LOCAL_DIR = r"C:\dev\stock-app"          # 로컬 작업 폴더

# ✅ D: 또는 E: 중 실제 연결된 외장하드 자동 탐색 (projects\stock-app 기준)
def _find_ext_dir(possible_drives=("D", "E")):
    for drive in possible_drives:
        path = f"{drive}:\\projects\\stock-app"
        if os.path.exists(path):
            print(f"✅ 외장하드 감지: {path}", flush=True)
            return path
    print("⚠️ D:나 E: 드라이브에서 projects\\stock-app 폴더를 찾을 수 없습니다.", flush=True)
    sys.exit(1)

EXT_DIR   = _find_ext_dir()              # 외장하드 폴더(자동 설정)
FRONT_DIR = os.path.join(LOCAL_DIR, "stock-gui")
REQ_FILE  = os.path.join(LOCAL_DIR, "requirements.txt")

# 대용량/자동생성 폴더 및 불필요 파일은 제외 (미러링 가속+안정성)
XD_DIRS = ["node_modules", ".venv", ".git", ".cache", "dist", "build", ".next"]
XF_FILES = ["*.log", "*.tmp"]

def log(msg):
    print(msg, flush=True)

def exists_or_die(path, label):
    if not os.path.exists(path):
        log(f"오류: {label} 경로가 없습니다 → {path}")
        sys.exit(2)

def run(cmd, cwd=None, shell=False):
    log(f"실행: {' '.join(cmd)}" + (f" (cwd={cwd})" if cwd else ""))
    proc = subprocess.run(cmd, cwd=cwd, shell=shell)
    if proc.returncode != 0:
        log(f"오류: 명령 실패(code={proc.returncode})")
        sys.exit(proc.returncode)
    log("성공")

def robocopy(src, dst, mirror=True, dry=False):
    exists_or_die(src, "원본")
    base = ["robocopy", src, dst]
    flags = ["/MIR" if mirror else "/E"]
    for d in XD_DIRS: flags += ["/XD", d]
    for f in XF_FILES: flags += ["/XF", f]
    cmd = base + flags
    log("ROBOCOPY 준비:")
    log("  " + " ".join(cmd))
    if dry:
        log("참고: --dry 모드이므로 실행하지 않습니다.")
        return
    # robocopy는 0~7은 성공, 8 이상은 실패
    proc = subprocess.run(" ".join(cmd), shell=True)
    code = proc.returncode
    if code >= 8:
        log(f"오류: robocopy 실패(code={code})")
        sys.exit(code)
    log(f"성공: robocopy 완료(code={code})")

def front_deps():
    exists_or_die(FRONT_DIR, "프론트 디렉토리")
    pnpm_path = shutil.which("pnpm")
    npm_path = shutil.which("npm")

    # pnpm 우선: frozen-lockfile → 실패 시 no-frozen-lockfile 재시도
    if os.path.exists(os.path.join(FRONT_DIR, "pnpm-lock.yaml")) and pnpm_path:
        log("pnpm: --frozen-lockfile 모드로 설치 시도")
        proc = subprocess.run([pnpm_path, "install", "--frozen-lockfile"], cwd=FRONT_DIR, shell=True)
        if proc.returncode != 0:
            log("참고: pnpm-lock.yaml과 package.json이 불일치 → --no-frozen-lockfile로 자동 재시도")
            proc2 = subprocess.run([pnpm_path, "install", "--no-frozen-lockfile"], cwd=FRONT_DIR, shell=True)
            if proc2.returncode != 0:
                log(f"오류: pnpm 설치 실패(code={proc2.returncode})")
                sys.exit(proc2.returncode)
            log("성공: pnpm install --no-frozen-lockfile 완료")
        else:
            log("성공: pnpm install --frozen-lockfile 완료")
        return

    # npm 경로가 있으면 npm ci
    if os.path.exists(os.path.join(FRONT_DIR, "package-lock.json")) and npm_path:
        run([npm_path, "ci"], cwd=FRONT_DIR, shell=True)
        return

    # 최후의 보루: npm이 있으면 락파일 없어도 npm ci 시도(프로젝트 정책에 맞게 조정 가능)
    if npm_path:
        run([npm_path, "ci"], cwd=FRONT_DIR, shell=True)
        return

    log("오류: pnpm/npm 둘 다 설치되어 있지 않습니다. npm 또는 pnpm을 설치하세요.")
    sys.exit(2)

def back_deps():
    exists_or_die(LOCAL_DIR, "로컬 루트")
    if not os.path.exists(REQ_FILE):
        log("참고: requirements.txt 없음 → 백엔드 의존성 설치 스킵")
        return
    venv = os.path.join(LOCAL_DIR, ".venv")
    py = shutil.which("python") or shutil.which("py")
    if not py:
        log("오류: python 이 PATH에 없습니다.")
        sys.exit(2)
    if not os.path.exists(venv):
        run([py, "-m", "venv", venv], cwd=LOCAL_DIR, shell=True)
    pip = os.path.join(venv, "Scripts", "pip.exe")
    if not os.path.exists(pip):
        log("오류: 가상환경(.venv) 생성 실패로 보입니다.")
        sys.exit(2)
    run([pip, "install", "--upgrade", "pip"], cwd=LOCAL_DIR, shell=True)
    run([pip, "install", "-r", REQ_FILE], cwd=LOCAL_DIR, shell=True)

def selftest():
    log("=== SELFTEST ===")
    log(f"Python: {platform.python_version()} ({sys.executable})")
    log(f"cwd: {os.getcwd()}")
    log(f"LOCAL_DIR: {LOCAL_DIR}  exists={os.path.exists(LOCAL_DIR)}")
    log(f"EXT_DIR  : {EXT_DIR}  exists={os.path.exists(EXT_DIR)}")
    log(f"FRONT_DIR: {FRONT_DIR}  exists={os.path.exists(FRONT_DIR)}")
    log(f"REQ_FILE : {REQ_FILE}  exists={os.path.exists(REQ_FILE)}")
    # robocopy / npm / pnpm / pip 경로 점검
    for name in ["robocopy", "npm", "pnpm", "pip"]:
        log(f"{name}: {shutil.which(name)}")
    log("=== SELFTEST END ===")

def main():
    parser = argparse.ArgumentParser(description="외장하드 이동형 동기화 + 의존성 설치 유틸")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("to-ext", help="로컬 → 외장 미러링")
    p1.add_argument("--dry", action="store_true")

    p2 = sub.add_parser("to-local", help="외장 → 로컬 미러링")
    p2.add_argument("--dry", action="store_true")

    sub.add_parser("front-deps", help="프론트 의존성 설치")
    sub.add_parser("back-deps", help="백엔드 의존성 설치")
    sub.add_parser("all-to-ext", help="로컬→외장 + 의존성 가이드")
    sub.add_parser("all-to-local", help="외장→로컬 + 의존성 가이드")
    sub.add_parser("selftest", help="경로/도구 점검")

    args = parser.parse_args()
    log(f"[INFO] 명령: {args.cmd}")

    if args.cmd == "selftest":
        selftest()
    elif args.cmd == "to-ext":
        robocopy(LOCAL_DIR, EXT_DIR, mirror=True, dry=getattr(args, "dry", False))
    elif args.cmd == "to-local":
        robocopy(EXT_DIR, LOCAL_DIR, mirror=True, dry=getattr(args, "dry", False))
    elif args.cmd == "front-deps":
        front_deps()
    elif args.cmd == "back-deps":
        back_deps()
    elif args.cmd == "all-to-ext":
        robocopy(LOCAL_DIR, EXT_DIR, mirror=True)
        log("참고: 프론트= pnpm install --frozen-lockfile 또는 npm ci / 백엔드= venv+pip install -r")
    elif args.cmd == "all-to-local":
        robocopy(EXT_DIR, LOCAL_DIR, mirror=True)
        log("참고: 프론트= pnpm install --frozen-lockfile 또는 npm ci / 백엔드= venv+pip install -r")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 어떤 예외라도 콘솔에 확실히 보이도록
        import traceback
        log("치명적 오류 발생:")
        traceback.print_exc()
        sys.exit(1)
