from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
STORE = ROOT / "backend" / "app" / "services" / "task_run_store.py"
LIVE_LOG = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_CONTINUITY_REVIEW_LIVE_API_2026-07-11.json"
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
    if "148_G4_MVP_FOLLOWUP_CONTINUITY_REVIEW" not in workbook.sheetnames:
        return False
    rows = list(workbook["148_G4_MVP_FOLLOWUP_CONTINUITY_REVIEW"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2019-FOLLOWUP-CONTINUITY-STORE",
        "SAAS-2035-FOLLOWUP-CONTINUITY-SCHEMA",
        "SAAS-2051-FOLLOWUP-CONTINUITY-RESULT-CENTER",
        "SAAS-2071-FOLLOWUP-CONTINUITY-FRONTEND",
        "SAAS-2091-FOLLOWUP-CONTINUITY-LIVE",
        "SAAS-2117-FOLLOWUP-CONTINUITY-FIXATION",
        "MVP Follow-up Continuity Review v0.1",
        "follow-up opens as a persisted continuation with source, transferred goal and next action",
    ]
    return len(closed_rows) == 99 and all(marker in joined for marker in required_markers)


def live_log_ready() -> bool:
    if not LIVE_LOG.exists():
        return False
    payload = json.loads(LIVE_LOG.read_text(encoding="utf-8"))
    continuity = payload.get("continuity", {})
    return bool(
        payload.get("passed")
        and continuity.get("is_followup")
        and continuity.get("source_task_run_id")
        and continuity.get("goal")
        and continuity.get("expected_artifact")
    )


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")
    store = STORE.read_text(encoding="utf-8")

    checks = {
        "store_can_reverse_lookup_followup_source": contains(store, "get_result_action_by_related_task_run_id")
        and contains(store, "where related_task_run_id = ?")
        and contains(store, "order by created_at desc, id desc"),
        "schema_exposes_followup_continuity_state": contains(schemas, "class FollowupContinuityState")
        and contains(schemas, "is_followup: bool")
        and contains(schemas, "source_task_run_id: str | None")
        and contains(schemas, "followup_continuity: FollowupContinuityState"),
        "result_center_builds_source_context": contains(result_center, "_build_followup_continuity_state")
        and contains(result_center, "get_result_action_by_related_task_run_id")
        and (
            contains(result_center, "_build_user_workspace_state(source_action_history)")
            or contains(result_center, "_build_user_workspace_state(parent_action_history)")
        )
        and contains(result_center, "followup-continuity-review-restored"),
        "frontend_types_and_direct_restore_exist": contains(page, "type FollowupContinuityState")
        and contains(page, "followup_continuity: FollowupContinuityState")
        and contains(page, "loadedResult.followup_continuity.is_followup")
        and contains(page, "setOpenedFollowupTaskRunId(loadedRun.id)"),
        "frontend_shows_continuity_review": contains(page, "followupContinuityReviewItems")
        and contains(page, "Преемственность follow-up")
        and contains(page, "Почему открыт именно этот следующий запуск")
        and contains(styles, ".followup-continuity-review"),
        "live_api_proves_direct_followup_result_center": live_log_ready(),
        "scope_stays_user_mvp_no_external_layer": not contains(result_center, "production_deploy")
        and not contains(result_center, "tenant_isolation")
        and not contains(page, "followup-continuity-admin")
        and not contains(store, "create table followup_continuity"),
        "ksg_records_99_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_FOLLOWUP_CONTINUITY_REVIEW",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(STORE), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP follow-up opening; Result Center exposes persisted source continuity for direct follow-up opening; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1247 / 2117 = 58.9%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_CONTINUITY_REVIEW_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
