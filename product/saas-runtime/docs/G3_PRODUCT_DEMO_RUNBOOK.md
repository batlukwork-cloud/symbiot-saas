# G3 Product Demo Runbook

Status: implemented on 2026-07-03.

## Purpose

Provide a repeatable product-level verification scenario for the G3 Runtime.

The runbook proves the chain:

`Task Intake -> Workgroup Preview -> TaskRun -> Result Center -> Accept Result -> Create Next Task`

## How To Run

Start backend first:

```powershell
cd <локальный путь>
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Run the check:

```powershell
cd <локальный путь>
python scripts\g3_product_demo_runbook_check.py
```

Optional:

```powershell
$env:SYMBIOT_API_BASE='http://127.0.0.1:8000'
```

## Acceptance

The runbook passes only if:

- intake preview returns `ready`;
- workgroup preview exists;
- managed TaskRun is created;
- Result Center is `ready_for_acceptance`;
- `accept-result` changes product status to `accepted`;
- `create-next-task` creates a related follow-up TaskRun;
- evidence JSON is written to `runtime_logs`.

## Evidence

Default evidence file:

`runtime_logs/SAAS_0933_PRODUCT_DEMO_RUNBOOK_LIVE_CHECK_2026-07-03.json`

## Links

- [[Product Demo Runbook]]
- [[Create Next Task workflow]]
- [[Result Action execution endpoint]]
- [[TaskRun Monitor + Result Center]]
- [[Runtime]]
- [[Quality Gates]]
