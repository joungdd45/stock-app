@echo off
REM run_backup.bat
REM 작업 스케줄러가 이 파일을 호출 → 파워셸 스크립트 실행

set SCRIPT_DIR=%~dp0
set PS1=%SCRIPT_DIR%backup_db.ps1

REM ExecutionPolicy 우회, 출력 보기 위해 -NoProfile -ExecutionPolicy Bypass 사용
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set ERR=%ERRORLEVEL%

if %ERR% NEQ 0 (
  echo 백업 실패. 오류코드 %ERR%
  exit /b %ERR%
)
echo 백업 성공
exit /b 0
