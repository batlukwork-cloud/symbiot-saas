# G3 Real TaskRun Creation

## Layer

`SAAS-0928` closes the gap between product-fit demo and managed runtime execution.

## Scope

The runtime now creates a unique TaskRun, user-visible artifact and audit event for every accepted launch request.

## Acceptance

- `POST /api/task-runs` returns a new `run-*` id, not `run-demo-001`.
- The created TaskRun has a new `artifact-*` id, not `artifact-demo-001`.
- Result Center opens for the created run and returns `ready_for_acceptance`.
- Runtime evidence links at least one audit event to the created run.
- Missing TaskRun ids return `404` instead of silently falling back to the demo run.
- RBAC/ABAC remains active: unauthorized execution is blocked before TaskRun creation.

## Evidence

`runtime_logs\SAAS_0928_REAL_TASKRUN_CREATION_LIVE_CHECK_2026-07-03.json`
