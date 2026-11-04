# G3 TaskRun State Persistence

Date: 2026-07-03
Task: SAAS-0929 / ENG-SaaS-0038
maximum safe throw: B 2/10

## Purpose

Convert managed TaskRun creation from process-memory state into persistent runtime state.

## Implemented

- Added `backend/app/services/task_run_store.py`.
- Persisted TaskRun, Artifact and audit event bundles into SQLite.
- Updated TaskRun, Artifact, Result Center and Runtime Evidence reads to use persisted state.
- Preserved `404` for unknown TaskRun and `403` for unauthorized execution.

## Acceptance

- A new `run-*` is created through `POST /api/task-runs`.
- Backend process is stopped.
- Backend process is started again.
- The same `run-*` opens through `GET /api/task-runs/{id}`.
- Result Center opens after restart and returns `ready_for_acceptance`.
- Artifact opens after restart and remains linked to the TaskRun.

## Evidence

`<локальный путь>`

SHA256: `21FED479F728B703AC0B3111BC9399D80734275150462B869D1835C03926B42D`

## Verification

- `backend\.venv\Scripts\python.exe -m compileall backend\app` passed.
- `backend\.venv\Scripts\python.exe scripts\g3_smoke_check.py` passed.
- `npm --prefix frontend run build` passed.
- Live restart persistence check passed.

## Next

SAAS-0930: Result Action execution endpoint.
