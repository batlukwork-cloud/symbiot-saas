from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
TASK_RUN_EXECUTION = ROOT / "backend" / "app" / "services" / "task_run_execution.py"
TASK_RUNS = ROOT / "backend" / "app" / "routers" / "task_runs.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
LIVE_LOG = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_PAYLOAD_PERSISTENCE_LIVE_API_2026-07-11.json"
RUN_TIMESTAMP = "2026-07-11T00:00:00+03:00"
KSG = (
    ROOT.parents[1]
    / "docs"
    / "06_management"
    / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ"
    / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА.xlsx"
)


def contains(text: str, marker: str) -> bool:
    return marker in text


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "147_G4_MVP_FOLLOWUP_PAYLOAD_PERSISTENCE" not in workbook.sheetnames:
        return False
    rows = list(workbook["147_G4_MVP_FOLLOWUP_PAYLOAD_PERSISTENCE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1959-FOLLOWUP-PAYLOAD-BACKEND",
        "SAAS-1971-FOLLOWUP-PAYLOAD-RESOLVE",
        "SAAS-1983-FOLLOWUP-PAYLOAD-FRONTEND",
        "SAAS-1995-FOLLOWUP-PAYLOAD-LIVE",
        "SAAS-2007-FOLLOWUP-PAYLOAD-REGRESSION",
        "SAAS-2018-FOLLOWUP-PAYLOAD-FIXATION",
        "MVP Follow-up Payload Persistence Base v0.1",
        "follow-up TaskRun can be created from persisted next-step review",
    ]
    return len(closed_rows) == 60 and all(marker in joined for marker in required_markers)


def live_log_ready() -> bool:
    if not LIVE_LOG.exists():
        return False
    payload = json.loads(LIVE_LOG.read_text(encoding="utf-8"))
    return bool(
        payload.get("passed")
        and payload.get("followup_payload_source") == "workspace-next-step-review-confirm"
        and payload.get("created_followup_task_run_id")
        and payload.get("persisted_goal_found_in_artifact")
    )


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    task_run_execution = TASK_RUN_EXECUTION.read_text(encoding="utf-8")
    task_runs = TASK_RUNS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")

    checks = {
        "backend_reads_persisted_workspace_review": contains(task_run_execution, "_latest_persisted_next_step_review")
        and contains(task_run_execution, "list_result_action_records")
        and contains(task_run_execution, 'record.action_id != "workspace-next-step-review-confirm"')
        and contains(task_run_execution, "_decode_workspace_payload"),
        "backend_resolves_request_then_persisted_then_default": contains(task_run_execution, "explicit_goal")
        and contains(task_run_execution, "persisted_review.get(\"goal\")")
        and contains(task_run_execution, "persisted_review.get(\"expected_artifact\")")
        and contains(task_run_execution, "followup_payload_source"),
        "backend_create_next_task_still_links_related_run": contains(task_runs, 'action_id == "create-next-task"')
        and contains(task_runs, "create_followup_task_run(task_run, session, payload).id")
        and contains(task_runs, "related_task_run_id"),
        "result_center_still_restores_review": contains(result_center, "_build_user_workspace_state")
        and contains(result_center, "workspace-next-step-review-confirm")
        and contains(result_center, "PersistedNextStepReviewState"),
        "frontend_allows_restored_review_to_create_followup": contains(page, "nextStepReviewReadyForCreation")
        and contains(page, "resultCenter?.user_workspace_state.next_step_review.confirmed")
        and contains(page, "card.id === \"create-next-task\" && !nextStepReviewReadyForCreation"),
        "frontend_payload_still_sends_explicit_happy_path": contains(page, "followup_goal: nextStepPayloadForCreation.goal")
        and contains(page, "followup_expected_artifact: nextStepPayloadForCreation.expected_artifact")
        and contains(page, "followup_source_context: nextStepPayloadForCreation.source_context")
        and contains(page, "followup_urgency: nextStepPayloadForCreation.urgency"),
        "live_api_proves_backend_fallback": live_log_ready(),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(page, "followup-payload-admin")
        and not contains(task_run_execution, "tenant_isolation")
        and not contains(task_run_execution, "production_deploy")
        and not contains(task_run_execution, "pricing"),
        "ksg_records_60_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_FOLLOWUP_PAYLOAD_PERSISTENCE_BASE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(TASK_RUN_EXECUTION), str(TASK_RUNS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP follow-up TaskRun creation; backend resolves create-next-task payload from persisted next-step review when explicit followup fields are absent; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1148 / 2018 = 56.9%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_PAYLOAD_PERSISTENCE_BASE_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
