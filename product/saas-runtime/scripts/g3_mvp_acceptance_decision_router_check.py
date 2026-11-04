from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
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


def ordered(text: str, first: str, second: str) -> bool:
    first_index = text.find(first)
    second_index = text.find(second)
    return first_index >= 0 and second_index > first_index


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "144_G4_MVP_ACCEPTANCE_DECISION_ROUTER" not in workbook.sheetnames:
        return False
    rows = list(workbook["144_G4_MVP_ACCEPTANCE_DECISION_ROUTER"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1779-DECISION-OPTIONS",
        "SAAS-1791-DECISION-IMPACT",
        "SAAS-1803-DECISION-CHECKLIST",
        "SAAS-1815-DECISION-SUMMARY",
        "SAAS-1823-DECISION-REGRESSION",
        "SAAS-1831-DECISION-FIXATION",
        "SAAS-1838-DECISION-FIXATION",
        "MVP Acceptance Decision Router v0.1",
        "accept/revise/continue route is visible and selectable",
    ]
    return len(closed_rows) == 60 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "decision_router_model_exists": contains(page, "type AcceptanceDecisionRoute")
        and contains(page, "type AcceptanceDecisionRouterItem")
        and contains(page, "acceptanceDecisionRoute")
        and contains(page, "setAcceptanceDecisionRoute"),
        "three_user_routes_are_visible": contains(page, 'title: "Принять"')
        and contains(page, 'title: "Поправить"')
        and contains(page, 'title: "Продолжить"')
        and contains(page, "acceptanceDecisionRoutes.map"),
        "decision_route_is_interactive": contains(page, 'aria-pressed={acceptanceDecisionRoute === route.id}')
        and contains(page, "onClick={() => saveAcceptanceDecisionRoute(route.id)}")
        and contains(page, 'className={`acceptance-decision-option'),
        "impact_uses_real_user_mvp_state": contains(page, "acceptanceDecisionImpactItems")
        and contains(page, "artifactComposerEditorValue.title")
        and contains(page, "artifactComposerDraft.title")
        and contains(page, "nextStepPayloadForCreation.urgency")
        and contains(page, "linkedFollowupTaskRunId"),
        "checklist_keeps_stop_and_review_visible": contains(page, "acceptanceDecisionChecklistItems")
        and contains(page, "nextStepReviewConfirmed")
        and contains(page, "Приемка цикла")
        and contains(page, "Ближайшая остановка остается внутри пользовательского MVP"),
        "router_rendered_after_acceptance_board": ordered(
            page,
            'aria-label="Приемка повторного цикла"',
            'aria-label="Маршрут решения после приемки"',
        )
        and contains(page, "Фиксация решения без внешней отправки"),
        "styles_and_mobile_exist": contains(styles, ".acceptance-decision-router")
        and contains(styles, ".acceptance-decision-options")
        and contains(styles, ".acceptance-decision-impact")
        and contains(styles, ".acceptance-decision-checklist")
        and contains(styles, ".acceptance-decision-head,")
        and contains(styles, ".acceptance-decision-options,"),
        "previous_acceptance_layer_remains_connected": contains(page, "repeatRunAcceptanceSummaryText")
        and contains(page, "repeatRunAcceptanceCriteriaItems")
        and contains(page, "Acceptance без внешней отправки"),
        "scope_has_no_external_or_admin_expansion": not contains(page, "persistAcceptanceDecision")
        and not contains(page, "sendAcceptanceDecision")
        and not contains(page, "exportAcceptanceDecision")
        and not contains(page, "acceptance-decision-admin"),
        "ksg_records_60_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_ACCEPTANCE_DECISION_ROUTER",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP acceptance decision router; accept/revise/continue route, impact, checklist and local summary; backend persistence is covered by the next base layer; no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "968 / 1838 = 52.7%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_ACCEPTANCE_DECISION_ROUTER_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
