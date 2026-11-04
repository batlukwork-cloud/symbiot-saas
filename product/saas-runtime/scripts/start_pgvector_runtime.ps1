$ErrorActionPreference = "Stop"

$RuntimeRoot = "D:\symbiot_pgvector_runtime"
$PgData = Join-Path $RuntimeRoot "pgdata16"
$PgBin = Join-Path $RuntimeRoot "postgresql-16.14\pgsql\bin"
$PgLog = Join-Path $RuntimeRoot "postgresql-16.14.log"

& (Join-Path $PgBin "pg_ctl.exe") -D $PgData -o '"-p" "55432" "-h" "127.0.0.1"' -l $PgLog start
Start-Sleep -Seconds 3
& (Join-Path $PgBin "pg_isready.exe") -h 127.0.0.1 -p 55432 -U symbiot

