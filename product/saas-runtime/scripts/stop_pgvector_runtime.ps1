$ErrorActionPreference = "Stop"

$RuntimeRoot = "D:\symbiot_pgvector_runtime"
$PgData = Join-Path $RuntimeRoot "pgdata16"
$PgBin = Join-Path $RuntimeRoot "postgresql-16.14\pgsql\bin"

& (Join-Path $PgBin "pg_ctl.exe") -D $PgData stop

