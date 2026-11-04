# G3 Create Next Task Workflow

Status: closed on 2026-07-03.

## Purpose

Turn the Result Center action `create-next-task` into an actual linked follow-up TaskRun.

This layer closes `SAAS-0932` inside the G3 Product Runtime maximum safe throw B.

## Implemented

- `ResultActionRecord` now supports `related_task_run_id`.
- `task_run_result_actions` persists `related_task_run_id`.
- `create-next-task` creates a follow-up TaskRun through the existing managed TaskRun creation path.
- Result Center action history shows the linked TaskRun id.
- Frontend displays `linked TaskRun` in action history.

## Evidence

- Live HTTP check: `runtime_logs/SAAS_0932_CREATE_NEXT_TASK_WORKFLOW_LIVE_CHECK_2026-07-03.json`.
- Backend compile: passed.
- G3 smoke check: passed, `44` files and `48` API markers.
- Frontend production build: passed.

## Current Limits

- The follow-up TaskRun is created from a default follow-up payload. A richer next-task form and user-editable brief are still open.
- Deployment remains parked until separate approval.

## Links

- [[Create Next Task workflow]]
- [[Result Action execution endpoint]]
- [[TaskRun State Persistence]]
- [[Runtime]]
- [[Quality Gates]]
