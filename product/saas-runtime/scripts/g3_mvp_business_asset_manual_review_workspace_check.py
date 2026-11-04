from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
LIVE_LOG = LOGS / "SAAS_MVP_BUSINESS_ASSET_MANUAL_REVIEW_WORKSPACE_LIVE_API_2026-07-12.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8108").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "business-asset-manual-review-workspace-check",
    "x-role": "runtime-operator",
    "x-department": "sales",
    "x-access-level": "standard",
}


def contains(text: str, marker: str) -> bool:
    return marker in text


def request_json(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path}: {error.code} {detail}") from error


def create_cycle4() -> tuple[str, str, str, str, dict]:
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": True,
        "form_data": {
            "business_mission_id": "lead-qualification",
            "scenario_pack_id": "managed-result",
            "role_pack_id": "commercial",
            "selected_workgroup": ["sales-manager", "analyst", "methodologist"],
            "goal": "Собрать основу manual review workspace по бизнес-активу.",
            "expected_artifact": "SMB asset manual review source",
            "source_context": "business asset manual review workspace live check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    cycle1_id = queue_response["task_run"]["id"]
    request_json(f"/api/task-runs/{cycle1_id}/acceptance-decision", "POST", {"route": "accept", "comment": "accept cycle 1"})
    request_json(f"/api/task-runs/{cycle1_id}/result-actions/accept-result", "POST", {"comment": "accept cycle 1 result"})
    request_json(
        f"/api/task-runs/{cycle1_id}/workspace/next-step-review",
        "POST",
        {
            "goal": "Сформировать второй слой manual review.",
            "expected_artifact": "SMB asset manual review cycle 2",
            "source_context": f"Source TaskRun {cycle1_id}",
            "urgency": "open cycle 2",
            "source_label": "business-asset-manual-review-source",
            "confirmed_at_label": "live-check",
        },
    )
    after_cycle2_create = request_json(
        f"/api/task-runs/{cycle1_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create cycle 2",
            "followup_goal": "Сформировать второй слой manual review.",
            "followup_expected_artifact": "SMB asset manual review cycle 2",
            "followup_source_context": f"Source TaskRun {cycle1_id}",
            "followup_urgency": "open cycle 2",
        },
    )
    cycle2_id = next(record["related_task_run_id"] for record in after_cycle2_create["action_history"] if record.get("related_task_run_id"))
    request_json(f"/api/task-runs/{cycle2_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue cycle 2"})
    cycle2_result = request_json(f"/api/task-runs/{cycle2_id}/result-center")
    request_json(
        f"/api/task-runs/{cycle2_id}/workspace/next-step-review",
        "POST",
        {**cycle2_result["outcome_next_cycle_launcher"]["launch_payload"], "confirmed_at_label": "manual review check"},
    )
    cycle2_after_review = request_json(f"/api/task-runs/{cycle2_id}/result-center")
    cycle3_payload = cycle2_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle3_create = request_json(
        f"/api/task-runs/{cycle2_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 3 from {cycle3_payload['source_label']}",
            "followup_goal": cycle3_payload["goal"],
            "followup_expected_artifact": cycle3_payload["expected_artifact"],
            "followup_source_context": cycle3_payload["source_context"],
            "followup_urgency": cycle3_payload["urgency"],
        },
    )
    cycle3_id = after_cycle3_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    request_json(f"/api/task-runs/{cycle3_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue cycle 3"})
    cycle3_result = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    request_json(
        f"/api/task-runs/{cycle3_id}/workspace/next-step-review",
        "POST",
        {**cycle3_result["outcome_next_cycle_launcher"]["launch_payload"], "confirmed_at_label": "manual review check"},
    )
    cycle3_after_review = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    cycle4_payload = cycle3_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle4_create = request_json(
        f"/api/task-runs/{cycle3_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 4 from {cycle4_payload['source_label']}",
            "followup_goal": cycle4_payload["goal"],
            "followup_expected_artifact": cycle4_payload["expected_artifact"],
            "followup_source_context": cycle4_payload["source_context"],
            "followup_urgency": cycle4_payload["urgency"],
        },
    )
    cycle4_id = after_cycle4_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    cycle4_result = request_json(f"/api/task-runs/{cycle4_id}/result-center")
    return cycle1_id, cycle2_id, cycle3_id, cycle4_id, cycle4_result


def live_api_check() -> dict:
    cycle1_id, cycle2_id, cycle3_id, cycle4_id, cycle4_result = create_cycle4()
    before = cycle4_result["business_asset_manual_review_workspace"]
    request_json(f"/api/task-runs/{cycle4_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue manual review"})
    after_decision = request_json(f"/api/task-runs/{cycle4_id}/result-center")
    launch_payload = after_decision["outcome_next_cycle_launcher"]["launch_payload"]
    request_json(
        f"/api/task-runs/{cycle4_id}/workspace/next-step-review",
        "POST",
        {**launch_payload, "confirmed_at_label": "business asset manual review workspace check"},
    )
    after_review = request_json(f"/api/task-runs/{cycle4_id}/result-center")
    after_create = request_json(
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
    after = request_json(f"/api/task-runs/{cycle4_id}/result-center")
    workspace = after["business_asset_manual_review_workspace"]
    item_ids = {item["id"] for item in workspace["items"]}
    gate_ids = {gate["id"]: gate["status"] for gate in workspace["gates"]}
    checks = {
        "manual_review_workspace_active_before_route": before["is_active"] is True,
        "manual_review_workspace_active_after_route": workspace["is_active"] is True,
        "manual_review_cycle_number_is_4": workspace["cycle_number"] == 4,
        "manual_review_selected_continue_restored": workspace["selected_route"] == "continue",
        "manual_review_primary_action_opens_next_cycle": workspace["primary_action"] == "open-next-cycle",
        "manual_review_items_cover_g_check": {
            "business-asset-manual-review-scenario",
            "business-asset-manual-review-clarity",
            "business-asset-manual-review-business",
            "business-asset-manual-review-next",
            "business-asset-manual-review-proof",
            "business-asset-manual-review-guard",
            "business-asset-manual-review-dmitry",
        }.issubset(item_ids),
        "manual_review_next_cycle_linked": after_create["outcome_next_cycle_launcher"]["linked_task_run_id"] is not None,
        "manual_review_existing_runtime_only_gate": gate_ids.get("business-asset-manual-review-existing-runtime-only") == "passed",
        "manual_review_release_limit_is_warning": gate_ids.get("business-asset-manual-review-release-limited") == "warning",
    }
    evidence = {
        "task": "SAAS_MVP_BUSINESS_ASSET_MANUAL_REVIEW_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "cycle1_task_run_id": cycle1_id,
        "cycle2_task_run_id": cycle2_id,
        "cycle3_task_run_id": cycle3_id,
        "cycle4_task_run_id": cycle4_id,
        "cycle5_task_run_id": after_create["outcome_next_cycle_launcher"]["linked_task_run_id"],
        "business_asset_manual_review_workspace": workspace,
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
        "schema_exposes_business_asset_manual_review_workspace": contains(schemas, "class BusinessAssetManualReviewWorkspaceState")
        and contains(schemas, "business_asset_manual_review_workspace: BusinessAssetManualReviewWorkspaceState"),
        "result_center_builds_business_asset_manual_review_workspace": contains(result_center, "_build_business_asset_manual_review_workspace_state")
        and contains(result_center, "business-asset-manual-review-existing-runtime-only"),
        "frontend_shows_business_asset_manual_review_workspace": contains(page, "businessAssetManualReviewWorkspace?.is_active")
        and contains(page, "Ручная проверка бизнес-актива")
        and contains(styles, ".business-asset-manual-review-workspace"),
        "live_api_proves_business_asset_manual_review_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table business_asset_manual")
        and not contains(page, "business-asset-manual-admin")
        and not contains(result_center, "production_deploy"),
    }
    evidence = {
        "task": "SAAS_MVP_BUSINESS_ASSET_MANUAL_REVIEW_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(LIVE_LOG)],
        "scope": "user MVP business asset manual review workspace; cycle 4 shows scenario, clarity, business meaning, next action, proof, release guard and Dmitry G-check from existing Result Center runtime",
        "readiness_before_proof": "4405 / 5275 = 83.5%",
    }
    out = LOGS / "SAAS_MVP_BUSINESS_ASSET_MANUAL_REVIEW_WORKSPACE_CHECK_2026-07-12.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
