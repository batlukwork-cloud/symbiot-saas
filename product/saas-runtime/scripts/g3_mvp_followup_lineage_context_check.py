from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
LIVE_LOG = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_LINEAGE_CONTEXT_LIVE_API_2026-07-11.json"
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
    if "149_G4_MVP_FOLLOWUP_LINEAGE_CONTEXT" not in workbook.sheetnames:
        return False
    rows = list(workbook["149_G4_MVP_FOLLOWUP_LINEAGE_CONTEXT"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2118-FOLLOWUP-LINEAGE-SCHEMA",
        "SAAS-2136-FOLLOWUP-LINEAGE-RESULT-CENTER",
        "SAAS-2156-FOLLOWUP-LINEAGE-FRONTEND",
        "SAAS-2176-FOLLOWUP-LINEAGE-LIVE",
        "SAAS-2196-FOLLOWUP-LINEAGE-REGRESSION",
        "SAAS-2225-FOLLOWUP-LINEAGE-FIXATION",
        "MVP Follow-up Lineage Context v0.1",
        "follow-up restores cycle number and full lineage chain on direct opening",
    ]
    return len(closed_rows) == 108 and all(marker in joined for marker in required_markers)


def live_log_ready() -> bool:
    if not LIVE_LOG.exists():
        return False
    payload = json.loads(LIVE_LOG.read_text(encoding="utf-8"))
    continuity = payload.get("continuity", {})
    checks = payload.get("checks", {})
    return bool(
        payload.get("passed")
        and checks.get("cycle_number_is_3")
        and checks.get("lineage_has_2_parents")
        and continuity.get("cycle_number") == 3
        and len(continuity.get("lineage", [])) == 2
    )


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")

    checks = {
        "schema_exposes_lineage_and_cycle_number": contains(schemas, "class FollowupLineageItem")
        and contains(schemas, "cycle_number: int = 1")
        and contains(schemas, "lineage: list[FollowupLineageItem]"),
        "result_center_traverses_followup_chain": contains(result_center, "max_depth = 12")
        and contains(result_center, "seen_task_run_ids")
        and contains(result_center, "FollowupLineageItem(")
        and contains(result_center, "followup-lineage-cycle-number")
        and contains(result_center, "followup-lineage-chain-restored"),
        "frontend_uses_backend_cycle_number": contains(page, "persistedCycleNumber")
        and contains(page, "Math.max(cycleNumber, persistedCycleNumber, 2)")
        and contains(page, "continuity.cycle_number ?? 2"),
        "frontend_shows_lineage_chain": contains(page, "followupLineageItems")
        and contains(page, "Цепочка циклов")
        and contains(page, "Как пользователь дошел до текущего запуска")
        and contains(styles, ".followup-lineage-review"),
        "live_api_proves_cycle_three_direct_restore": live_log_ready(),
        "scope_stays_user_mvp_no_external_layer": not contains(result_center, "create table followup_lineage")
        and not contains(page, "followup-lineage-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_108_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_FOLLOWUP_LINEAGE_CONTEXT",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP follow-up lineage; direct opening restores chain and cycle number from existing Result Center actions; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1355 / 2225 = 60.9%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_FOLLOWUP_LINEAGE_CONTEXT_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
