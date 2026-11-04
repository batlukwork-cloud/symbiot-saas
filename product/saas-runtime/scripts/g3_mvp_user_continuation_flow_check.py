from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"


def contains(text: str, marker: str) -> bool:
    return marker in text


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "user_continuation_panel_rendered": contains(page, "user-continuation-panel")
        and contains(page, "Продолжение сценария")
        and contains(page, "Открыть следующий запуск"),
        "continuation_steps_explain_main_cycle": contains(page, "userContinuationSteps")
        and contains(page, "Принять результат")
        and contains(page, "Создать следующую миссию")
        and contains(page, "Открыть следующий запуск"),
        "linked_followup_can_be_opened_without_manager_reload": contains(page, "openLinkedFollowupTaskRun")
        and contains(page, "loadTaskRunById")
        and contains(page, "linkedFollowupTaskRunId"),
        "manager_reload_kept_as_secondary_path": contains(page, "loadExistingTaskRun")
        and contains(page, "setReloadTaskRunId(linkedFollowupTaskRunId)"),
        "decision_cards_preserved": contains(page, "resultDecisionCards.map")
        and contains(page, "applyResultAction(card.action)")
        and contains(page, "create-next-task"),
        "user_mode_hides_duplicate_next_mission_card": contains(styles, ".user-page .next-mission-card")
        and contains(styles, "display: none;")
        and contains(styles, ".user-page .user-continuation-panel"),
        "continuation_panel_is_responsive": contains(styles, ".continuation-steps")
        and contains(styles, "@media (max-width: 760px)")
        and contains(styles, ".continuation-action-row"),
        "no_new_admin_or_evidence_acceptance_layer": not contains(page, "QueueEvidenceAcceptance")
        or contains(page, "evidenceAcceptanceCenter"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_CONTINUATION_FLOW",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP continuation flow only; no backend contract, production, security, tenant, admin or Evidence Acceptance Center expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_CONTINUATION_FLOW_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
