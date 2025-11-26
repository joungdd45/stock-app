# 📄 generate_structure.py
# stock-gui 프로젝트 폴더 구조 자동 스캐너
# 실행 시 현재 폴더 이하의 파일/폴더 구조를 project_structure.txt로 저장

import os

OUTPUT_FILE = "project_structure.txt"
EXCLUDE_DIRS = {"node_modules", ".git", ".next", "__pycache__", "dist", "build"}

def scan_directory(base_path="."):
    structure = []
    for root, dirs, files in os.walk(base_path):
        # 제외할 폴더 필터링
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        level = root.replace(base_path, "").count(os.sep)
        indent = "    " * level
        folder_name = os.path.basename(root)
        structure.append(f"{indent}📁 {folder_name}/")
        subindent = "    " * (level + 1)
        for f in sorted(files):
            structure.append(f"{subindent}- {f}")
    return "\n".join(structure)

def main():
    base = os.path.abspath(".")
    print("📦 폴더 구조를 스캔 중입니다...")
    tree_output = scan_directory(os.path.join(base, "src"))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("# 📂 stock-gui Project Structure\n\n")
        f.write(tree_output)
        f.write("\n\n✅ 자동 업데이트 완료!")
    print(f"✅ {OUTPUT_FILE} 파일이 업데이트되었습니다.")

if __name__ == "__main__":
    main()
