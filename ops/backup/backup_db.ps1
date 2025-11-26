# backup_db.ps1
# 목적: PostgreSQL DB 자동 백업(일 1회), 보관기간 지난 백업 정리, 로그 기록
# 특징: pg_dump 경로 자동 탐색(PATH, 일반 설치 경로 순으로 검색)

param(
  [string]$EnvFilePath = "$PSScriptRoot\..\..\.env",
  [string]$BackupRoot  = "$PSScriptRoot\archives",
  [int]   $RetentionDays = 14,
  [string]$PgBin = ""   # 비워두면 자동 탐색
)

$ErrorActionPreference = "Stop"

# 시간·경로 준비
$startTime = Get-Date
$ts = $startTime.ToString("yyyyMMdd_HHmmss")
$todayDir = Join-Path $BackupRoot ($startTime.ToString("yyyy-MM-dd"))
$null = New-Item -ItemType Directory -Force -Path $todayDir
$logFile = Join-Path $todayDir "backup_$ts.log"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

Write-Log "=== DB 백업 시작 ==="

# .env에서 DATABASE_URL 추출
function Get-DatabaseUrlFromEnv($path) {
  if (Test-Path $path) {
    $lines = Get-Content $path | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' }
    if ($lines) {
      $kv = $lines[-1].Trim()
      $val = $kv -replace '^\s*DATABASE_URL\s*=\s*', ''
      return $val.Trim('"').Trim("'")
    }
  }
  return $null
}

$databaseUrlRaw = Get-DatabaseUrlFromEnv $EnvFilePath
if (-not $databaseUrlRaw) {
  Write-Log "오류: .env에서 DATABASE_URL을 찾지 못했습니다. 경로 확인: $EnvFilePath"
  throw "DATABASE_URL 누락"
}

# SQLAlchemy 스타일을 libpq 스타일로 치환
$databaseUrl = $databaseUrlRaw -replace '^postgresql\+asyncpg://', 'postgresql://'
Write-Log "원본 URL: $databaseUrlRaw"
Write-Log "pg_dump URL: $databaseUrl"

# pg_dump 경로 자동 탐색
function Find-PgDump() {
  # 1단계: PATH에서 찾기
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path $cmd.Source)) { return $cmd.Source }

  # 2단계: 일반 설치 경로 검색
  $roots = @(
    'C:\Program Files\PostgreSQL',
    'C:\Program Files (x86)\PostgreSQL'
  )
  foreach ($root in $roots) {
    if (Test-Path $root) {
      # 버전 큰 순으로 정렬해서 bin\pg_dump.exe 존재 확인
      $dirs = Get-ChildItem -Path $root -Directory | Sort-Object Name -Descending
      foreach ($d in $dirs) {
        $candidate = Join-Path (Join-Path $d.FullName 'bin') 'pg_dump.exe'
        if (Test-Path $candidate) { return $candidate }
      }
    }
  }

  return $null
}

$pgDumpExe = $null
if ($PgBin -and (Test-Path (Join-Path $PgBin 'pg_dump.exe'))) {
  $pgDumpExe = Join-Path $PgBin 'pg_dump.exe'
} else {
  $pgDumpExe = Find-PgDump
}

if (-not $pgDumpExe) {
  Write-Log "오류: pg_dump를 찾지 못했습니다."
  Write-Log "해결 가이드:"
  Write-Log "1) PostgreSQL을 설치할 때 Command Line Tools 포함으로 설치하거나,"
  Write-Log "2) 이미 설치되어 있으면 환경변수 PATH에 C:\Program Files\PostgreSQL\버전\bin 추가,"
  Write-Log "3) 또는 Scoop 사용 시: scoop install postgresql"
  throw "pg_dump 미설치 또는 경로 미설정"
}

Write-Log "pg_dump 경로: $pgDumpExe"

# 출력 파일(.dump: 커스텀 포맷)
$dumpFile = Join-Path $todayDir "db_$ts.dump"

# pg_dump 실행
$pgArgs = @(
  "--format=c",
  "--blobs",
  "--no-owner",
  "--compress=9",
  "--file=`"$dumpFile`"",
  "--dbname=`"$databaseUrl`""
)

try {
  Write-Log "pg_dump 실행: `"$pgDumpExe`" $($pgArgs -join ' ')"
  $p = Start-Process -FilePath $pgDumpExe -ArgumentList $pgArgs -NoNewWindow -PassThru -Wait
  if ($p.ExitCode -ne 0) {
    Write-Log "오류: pg_dump 실패 ExitCode=$($p.ExitCode)"
    throw "pg_dump 실패"
  }
  Write-Log "pg_dump 성공: $dumpFile"
}
catch {
  Write-Log "오류: $($_.Exception.Message)"
  throw
}

# 보관기간 지난 백업 삭제
try {
  Write-Log "보관기간 $RetentionDays일 초과 백업 정리 시작"
  if (Test-Path $BackupRoot) {
    Get-ChildItem -Path $BackupRoot -Directory | ForEach-Object {
      $dirDate = $_.Name
      $parsed = $null
      if ([DateTime]::TryParse($dirDate, [ref]$parsed)) {
        if ($parsed -lt (Get-Date).AddDays(-$RetentionDays)) {
          Write-Log "삭제: $($_.FullName)"
          Remove-Item -Recurse -Force -Path $_.FullName
        }
      }
    }
  }
  Write-Log "보관 정리 완료"
}
catch {
  Write-Log "보관 정리 오류: $($_.Exception.Message)"
}

Write-Log "=== DB 백업 완료 ==="
