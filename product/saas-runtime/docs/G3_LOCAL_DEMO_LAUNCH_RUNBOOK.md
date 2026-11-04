# G3 Local Demo Launch Runbook

Status: implemented for `SAAS-0941`.

## Purpose

Give a repeatable local-only way to open the product for manual product-fit review.

This runbook does not deploy Symbiot outside the machine. It starts the backend and frontend on `127.0.0.1`.

## Route

Mode: `SAFE_THROW`
Route: `A`
Throw: `3/5`

## Launch

```powershell
cd <локальный путь>
.\scripts\start_g3_local_demo.ps1
```

Default local URLs:

- backend: `http://127.0.0.1:8020`
- frontend: `http://127.0.0.1:3020`

## Stop

```powershell
cd <локальный путь>
.\scripts\stop_g3_local_demo.ps1
```

## Manual Check Path

1. Open the frontend local URL.
2. Check that Product Workbench is visible.
3. Create or preview a task.
4. Confirm the selected workgroup is visible.
5. Launch TaskRun.
6. Open Result Center.
7. Check artifact, evidence, gates, actions, version/hash.
8. Accept result or create next task.
9. Confirm that the next TaskRun can be reopened.

## Acceptance

The local demo launch is accepted if:

- both scripts exist;
- backend and frontend start only on `127.0.0.1`;
- PID file is written to `runtime_logs`;
- stop script terminates recorded processes;
- manual path can be executed without external deployment;
- no production storage, retention or tenant model changes are required.

## Stop Conditions

Stop before:

- external HTTPS deployment;
- public demo;
- client pilot;
- production storage or retention;
- tenant/security model change;
- external export.

## Evidence

- Readiness check: `runtime_logs/SAAS_0941_LOCAL_DEMO_LAUNCH_READINESS_2026-07-03.json`
- Start script: `scripts/start_g3_local_demo.ps1`
- Stop script: `scripts/stop_g3_local_demo.ps1`

## Links

- [[Product Evidence Route]]
- [[Product Evidence Pack]]
- [[TaskRun Detail Reload]]
- [[Quality Gates]]
