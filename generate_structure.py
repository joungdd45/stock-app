# 📄 generate_structure.py
# stock-app 프로젝트 폴더 구조 자동 스캐너
# 실행 시 현재 폴더 전체 구조를 project_structure.txt로 저장
# (가상환경, 빌드 디렉토리 등 불필요한 경로 자동 제외)

import os

OUTPUT_FILE = "project_structure.txt"
EXCLUDE_DIRS = {
    ".git", ".idea", "__pycache__", ".venv", "env", "venv",
    "node_modules", "dist", "build", ".pytest_cache"
}

def scan_directory(base_path="."):
    structure = []
    for root, dirs, files in os.walk(base_path):
        # 제외할 폴더 제거
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

        rel_path = os.path.relpath(root, base_path)
        level = 0 if rel_path == "." else rel_path.count(os.sep)
        indent = "    " * level
        folder = "📁 " + (os.path.basename(root) if rel_path != "." else os.path.basename(base_path))
        structure.append(f"{indent}{folder}/")

        subindent = "    " * (level + 1)
        for f in sorted(files):
            structure.append(f"{subindent}- {f}")

    return "\n".join(structure)

def main():
    root = os.path.abspath(".")
    print("📦 stock-app 폴더 구조 스캔 중...")
    tree_output = scan_directory(root)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("# 📂 stock-app Project Structure\n\n")
        f.write(tree_output)
        f.write("\n\n✅ 자동 업데이트 완료!")
    print(f"✅ 구조 스캔 완료: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
