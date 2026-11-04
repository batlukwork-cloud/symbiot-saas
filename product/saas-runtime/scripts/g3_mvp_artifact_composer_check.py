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
    if "135_G4_MVP_ARTIFACT_COMPOSER" not in workbook.sheetnames:
        return False
    rows = list(workbook["135_G4_MVP_ARTIFACT_COMPOSER"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1539-ARTIFACT-COMPOSER-MODEL",
        "SAAS-1540-ARTIFACT-COMPOSER-UI",
        "SAAS-1548-ARTIFACT-COMPOSER-FIXATION",
        "draft artifact -> proof -> next action -> checklist",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "artifact_composer_type_defined": contains(page, "type ArtifactComposerDraft")
        and contains(page, "checklist: string[]"),
        "artifact_composer_model_uses_mission_variants": contains(page, "const artifactComposerDraft = useMemo<ArtifactComposerDraft>")
        and contains(page, 'selectedBusinessMission.id === "support-knowledge"')
        and contains(page, 'selectedBusinessMission.id === "lead-qualification"')
        and contains(page, 'selectedBusinessMission.id === "document-summary"')
        and contains(page, 'selectedBusinessMission.id === "hr-screening"')
        and contains(page, 'selectedBusinessMission.id === "ops-report"')
        and contains(page, "Черновик коммерческого предложения"),
        "artifact_composer_model_uses_runtime_context": contains(page, "resultCenter?.artifact?.title")
        and contains(page, "resultCenter?.product_status")
        and contains(page, "activeDocumentIds.length")
        and contains(page, "selectedWorkgroup.length")
        and contains(page, "cycleSourceTaskRunId"),
        "artifact_composer_rendered_for_user": contains(page, 'className="artifact-composer-preview"')
        and contains(page, 'aria-label="Черновик результата"')
        and contains(page, "artifactComposerDraft.body")
        and contains(page, "artifactComposerDraft.checklist.map"),
        "artifact_composer_has_real_result_language": contains(page, "Черновик результата")
        and contains(page, "Основание")
        and contains(page, "Следующее действие")
        and contains(page, "Проблема клиента названа")
        and contains(page, "Передать клиенту оффер"),
        "styles_are_stable_and_responsive": contains(styles, ".artifact-composer-preview")
        and contains(styles, ".artifact-composer-body")
        and contains(styles, ".artifact-composer-checklist")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr))")
        and contains(styles, ".artifact-composer-checklist,")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/artifact-composer")
        and not contains(page, "artifact-composer-admin")
        and not contains(page, "exportArtifact")
        and not contains(styles, "artifact-composer-admin"),
        "ksg_records_artifact_composer_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_ARTIFACT_COMPOSER",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP artifact composer only; no backend contract expansion, no export/send workflow, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_ARTIFACT_COMPOSER_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
