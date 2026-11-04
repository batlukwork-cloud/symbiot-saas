from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path


os.environ.setdefault("SYMBIOT_API_BASE", "http://127.0.0.1:8116")

import g3_mvp_business_asset_g_review_execution_workspace_check as base


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
LIVE_LOG = LOGS / "SAAS_MVP_BUSINESS_ASSET_G_DECISION_REVIEW_SUMMARY_WORKSPACE_LIVE_API_2026-07-12.json"


def contains(text: str, marker: str) -> bool:
    return marker in text


def live_api_check() -> dict:
    cycle1_id, cycle2_id, cycle3_id, cycle4_id, cycle4_result = base.create_cycle4()
    before = cycle4_result["business_asset_g_decision_review_summary_workspace"]
    base.request_json(
        f"/api/task-runs/{cycle4_id}/acceptance-decision",
        "POST",
        {"route": "continue", "comment": "continue G decision review summary"},
    )
    after_decision = base.request_json(f"/api/task-runs/{cycle4_id}/result-center")
    launch_payload = after_decision["outcome_next_cycle_launcher"]["launch_payload"]
    base.request_json(
        f"/api/task-runs/{cycle4_id}/workspace/next-step-review",
        "POST",
        {**launch_payload, "confirmed_at_label": "business asset G decision review summary workspace check"},
    )
    after_review = base.request_json(f"/api/task-runs/{cycle4_id}/result-center")
    after_create = base.request_json(
        f"/api/task-runs/{cycle4_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 5 from {after_review['outcome_next_cycle_launcher']['launch_payload']['source_label']}",
            "followup_goal": after_review["outcome_next_cycle_launcher"]["launch_payload"]["goal"],
            "followup_expected_artifact": after_review["outcome_next_cycle_launcher"]["launch_payload"]["expected_artifact"],
            "followup_source_context": after_review["outcome_next_cycle_launcher"]["launch_payload"]["source_context"],
            "followup_urgency": after_review["outcome_next_cycle_launcher"]["launch_payload"]["urgency"],
        },
    )
    after = base.request_json(f"/api/task-runs/{cycle4_id}/result-center")
    workspace = after["business_asset_g_decision_review_summary_workspace"]
    item_ids = {item["id"] for item in workspace["review_items"]}
    gate_ids = {gate["id"]: gate["status"] for gate in workspace["gates"]}
    checks = {
        "g_decision_review_summary_active_before_route": before["is_active"] is True,
        "g_decision_review_summary_active_after_route": workspace["is_active"] is True,
        "g_decision_review_summary_cycle_number_is_4": workspace["cycle_number"] == 4,
        "g_decision_review_summary_selected_continue_restored": workspace["selected_route"] == "continue",
        "g_decision_review_summary_primary_action_opens_next_cycle": workspace["primary_action"] == "open-next-cycle",
        "g_decision_review_summary_items_cover_manual_review": {
            "business-asset-g-decision-review-summary-route",
            "business-asset-g-decision-review-summary-checklist",
            "business-asset-g-decision-review-summary-evidence",
            "business-asset-g-decision-review-summary-not-green",
            "business-asset-g-decision-review-summary-owner",
            "business-asset-g-decision-review-summary-next",
            "business-asset-g-decision-review-summary-guard",
        }.issubset(item_ids),
        "g_decision_review_summary_next_cycle_linked": after_create["outcome_next_cycle_launcher"]["linked_task_run_id"] is not None,
        "g_decision_review_summary_existing_runtime_only_gate": gate_ids.get("business-asset-g-decision-review-summary-existing-runtime-only") == "passed",
        "g_decision_review_summary_manual_gate_is_warning": gate_ids.get("business-asset-g-decision-review-summary-manual-gate") == "warning",
    }
    evidence = {
        "task": "SAAS_MVP_BUSINESS_ASSET_G_DECISION_REVIEW_SUMMARY_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": base.API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "cycle1_task_run_id": cycle1_id,
        "cycle2_task_run_id": cycle2_id,
        "cycle3_task_run_id": cycle3_id,
        "cycle4_task_run_id": cycle4_id,
        "cycle5_task_run_id": after_create["outcome_next_cycle_launcher"]["linked_task_run_id"],
        "business_asset_g_decision_review_summary_workspace": workspace,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    LIVE_LOG.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    return evidence


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")
    live = live_api_check()
    checks = {
        "schema_exposes_business_asset_g_decision_review_summary_workspace": contains(schemas, "class BusinessAssetGDecisionReviewSummaryWorkspaceState")
        and contains(schemas, "business_asset_g_decision_review_summary_workspace: BusinessAssetGDecisionReviewSummaryWorkspaceState"),
        "result_center_builds_business_asset_g_decision_review_summary_workspace": contains(result_center, "_build_business_asset_g_decision_review_summary_workspace_state")
        and contains(result_center, "business-asset-g-decision-review-summary-existing-runtime-only"),
        "frontend_shows_business_asset_g_decision_review_summary_workspace": contains(page, "businessAssetGDecisionReviewSummaryWorkspace?.is_active")
        and contains(page, "Сводка ручной G-проверки")
        and contains(styles, ".business-asset-g-decision-review-summary-workspace"),
        "live_api_proves_business_asset_g_decision_review_summary_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table business_asset_g_review_summary")
        and not contains(page, "business-asset-g-decision-review-summary-admin")
        and not contains(result_center, "production_deploy"),
    }
    evidence = {
        "task": "SAAS_MVP_BUSINESS_ASSET_G_DECISION_REVIEW_SUMMARY_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(LIVE_LOG)],
        "scope": "user MVP business asset G decision review summary workspace; summarizes Dmitry manual review without closing UX/design/market/release gates",
        "readiness_before_proof": "12205 / 13075 = 93.3%",
    }
    out = LOGS / "SAAS_MVP_BUSINESS_ASSET_G_DECISION_REVIEW_SUMMARY_WORKSPACE_CHECK_2026-07-12.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
