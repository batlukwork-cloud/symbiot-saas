# G3 Dmitry UI Acceptance Checklist

Status: implemented for `SAAS-0942`.

## Purpose

Provide a human-readable product-fit checklist for Dmitry's manual acceptance of the local Symbiot SaaS MVP screen.

## Route

Mode: `SAFE_THROW`
Route: `A`
Throw: `4/5`

## Checklist

| ID | Area | Acceptance Question | Expected Evidence | Status |
|---|---|---|---|---|
| DUI-01 | Product Workbench | Is it clear what product screen I am looking at? | Main screen title, current gate and route are visible. | To check |
| DUI-02 | Task Intake | Can I formulate a real task without developer language? | Task form has goal, context, expected artifact and urgency. | To check |
| DUI-03 | Role Preview | Do I see who will work on the task before launch? | Workgroup preview displays roles and reasons. | To check |
| DUI-04 | TaskRun | Does the system create a managed TaskRun, not a loose answer? | TaskRun id, status, stages and gates are visible. | To check |
| DUI-05 | Result Center | Do I see result, evidence, gates and actions in one place? | Result Center contains artifact, evidence, checklist and actions. | To check |
| DUI-06 | Artifact Trust | Can I verify artifact version and hash? | Artifact version and SHA256 hash are visible. | To check |
| DUI-07 | Next Task | Can I create a next task from the result? | Editable Next Task Brief creates follow-up TaskRun. | To check |
| DUI-08 | Reopen | Can I reopen a TaskRun by id? | TaskRun Detail Reload works. | To check |
| DUI-09 | Safety | Is it obvious that this is local MVP, not production deployment? | Dashboard/runbook marks local-only route and stop conditions. | To check |
| DUI-10 | Value | Is the scenario close enough to the product promise? | Dmitry decision: accept, accept with conditions, or return to revision. | To check |

## Acceptance Decision Options

- `Accepted`: scenario is clear enough to continue product hardening.
- `Accepted with conditions`: scenario works, but specific follow-ups are required.
- `Returned to revision`: scenario is not yet a product, or blocks the main promise.

## Mandatory Notes For Review

- Short UTP is not frozen until Dmitry sees the product in action.
- Client pilot remains blocked until a separate deployment and security gate.
- External HTTPS deployment is outside this route.

## Links

- [[Product Evidence Route]]
- [[Product Evidence Pack]]
- [[Local Demo Launch Runbook]]
- [[Quality Gates]]
- [[G3 Product-Fit Gate]]
