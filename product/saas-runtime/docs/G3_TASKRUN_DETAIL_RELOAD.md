# G3 TaskRun Detail Reload

Status: implemented for `SAAS-0935`.

## Purpose

The Product Workbench must not lose a previous result after refresh or navigation. A user must be able to paste a stored `TaskRun ID` and restore the TaskRun monitor, Result Center and artifact.

## Product Behavior

The `TaskRun Monitor + Result Center` panel now includes an `Open TaskRun` control.

The control loads:

- `GET /api/task-runs/{task_run_id}`;
- `GET /api/task-runs/{task_run_id}/result-center`;
- `GET /api/artifacts/{artifact_id}` when an artifact exists.

## Evidence

Live check script:

`scripts/g3_taskrun_detail_reload_check.py`

Evidence file:

`runtime_logs/SAAS_0935_TASKRUN_DETAIL_RELOAD_LIVE_CHECK_2026-07-03.json`

The check proves:

- a TaskRun can be created;
- the same TaskRun can be reloaded by id;
- Result Center can be reloaded by id;
- artifact can be reloaded;
- missing TaskRun returns `404`.

## Links

- [[TaskRun State Persistence]]
- [[TaskRun Monitor + Result Center]]
- [[Product Demo Runbook]]
- [[Editable Next Task Brief]]
- [[Quality Gates]]
