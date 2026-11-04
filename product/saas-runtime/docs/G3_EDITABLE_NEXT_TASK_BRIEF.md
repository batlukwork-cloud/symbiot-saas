# G3 Editable Next Task Brief

Status: implemented for `SAAS-0934`.

## Purpose

The Result Center must let a user turn an accepted result into the next managed TaskRun without hiding the task brief inside backend defaults.

## Product Behavior

The Product Workbench now exposes a `Next Task Brief` block in user actions.

The brief contains:

- goal;
- expected artifact;
- source context;
- urgency.

When the user triggers `Create Next Task`, these fields are sent to the Runtime API and used to create the linked follow-up TaskRun.

## API Contract

Endpoint:

`POST /api/task-runs/{task_run_id}/result-actions/{action_id}`

For `create-next-task`, payload may include:

- `followup_goal`;
- `followup_expected_artifact`;
- `followup_source_context`;
- `followup_urgency`.

## Evidence

Live check script:

`scripts/g3_editable_next_task_brief_check.py`

Evidence file:

`runtime_logs/SAAS_0934_EDITABLE_NEXT_TASK_BRIEF_LIVE_CHECK_2026-07-03.json`

The check proves:

- source TaskRun can be created;
- `create-next-task` produces a linked TaskRun;
- follow-up artifact is created;
- editable goal and context appear in the follow-up artifact.

## Links

- [[Result Action execution endpoint]]
- [[Create Next Task workflow]]
- [[Product Demo Runbook]]
- [[Quality Gates]]
- [[Audit Layer]]
