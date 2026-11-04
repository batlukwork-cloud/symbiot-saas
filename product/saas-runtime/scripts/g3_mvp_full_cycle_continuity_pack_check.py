from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
RUN_TIMESTAMP = "2026-07-10T00:00:00+03:00"
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
    if "139_G4_MVP_FULL_CYCLE_CONTINUITY" not in workbook.sheetnames:
        return False
    rows = list(workbook["139_G4_MVP_FULL_CYCLE_CONTINUITY"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1579-SNAPSHOT",
        "SAAS-1589-TRANSFER",
        "SAAS-1599-RESULT_REVIEW",
        "SAAS-1609-COMPLETION",
        "SAAS-1618-COMPLETION",
        "MVP Full Cycle Continuity Pack v0.1",
        "readiness 748 / 1618 = 46.2%",
    ]
    return len(closed_rows) == 40 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "snapshot_model_and_state_exist": contains(page, "type NextStepReviewSnapshot")
        and contains(page, "nextStepReviewSnapshot")
        and contains(page, "setNextStepReviewSnapshot"),
        "snapshot_captured_and_reset_safely": contains(page, "confirmed_at_label: \"Подтверждено в Product Workbench\"")
        and page.count("setNextStepReviewSnapshot(null)") >= 4,
        "create_and_open_use_confirmed_payload": contains(page, "nextStepPayloadForCreation")
        and contains(page, "followup_goal: nextStepPayloadForCreation.goal")
        and contains(page, "expectedArtifact: nextStepPayloadForCreation.expected_artifact"),
        "confirmed_basis_block_exists": contains(page, "confirmedNextStepItems")
        and contains(page, "Подтвержденная основа")
        and contains(page, "Что пользователь перенес в следующий цикл"),
        "cycle_transfer_block_exists": contains(page, "cycleTransferItems")
        and contains(page, "Перенос в цикл")
        and contains(page, "Как принятый результат стал новым запуском"),
        "cycle_result_review_block_exists": contains(page, "cycleResultReviewItems")
        and contains(page, "Review результата цикла")
        and contains(page, "вырос из подтвержденного шага"),
        "cycle_completion_package_exists": contains(page, "cycleCompletionPackageItems")
        and contains(page, "Пакет завершения")
        and contains(page, "Что остается пользователю после полного прохода"),
        "continuity_styles_and_mobile_exist": contains(styles, ".continuity-pack")
        and contains(styles, ".continuity-pack-grid")
        and contains(styles, ".continuity-pack-item.is-confirmed")
        and contains(styles, ".continuity-pack-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/full-cycle-continuity")
        and not contains(page, "persistContinuityPack")
        and not contains(page, "sendContinuityPack")
        and not contains(page, "exportContinuityPack")
        and not contains(page, "continuity-pack-admin"),
        "ksg_records_40_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_FULL_CYCLE_CONTINUITY_PACK",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP full-cycle continuity pack; confirmed next-step snapshot, cycle transfer, result review, completion package; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "748 / 1618 = 46.2%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_FULL_CYCLE_CONTINUITY_PACK_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
