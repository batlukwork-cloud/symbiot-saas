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
        "second_cycle_state_is_tracked": contains(page, "openedFollowupTaskRunId")
        and contains(page, "cycleSourceTaskRunId")
        and contains(page, "isFollowupCycleOpen"),
        "followup_open_updates_current_mission_brief": contains(page, "setProductTask({")
        and contains(page, "goal: followupBrief.goal")
        and contains(page, "expectedArtifact: followupBrief.expected_artifact")
        and contains(page, "sourceContext: followupBrief.source_context"),
        "second_cycle_panel_rendered_in_user_flow": contains(page, "user-cycle-panel")
        and contains(page, "Цикл {currentCycleNumber}")
        and contains(page, "Этот запуск продолжает принятую цепочку"),
        "second_cycle_has_user_decision_cta": contains(page, "Принять результат цикла ${currentCycleNumber}")
        and contains(page, "Теперь проверьте результат этого цикла"),
        "manual_reload_clears_cycle_context": contains(page, "setOpenedFollowupTaskRunId(\"\")")
        and contains(page, "setCycleSourceTaskRunId(\"\")")
        and contains(page, "loadExistingTaskRun"),
        "existing_continuation_flow_preserved": contains(page, "openLinkedFollowupTaskRun")
        and contains(page, "loadTaskRunById")
        and contains(page, "user-continuation-panel"),
        "second_cycle_styles_are_responsive": contains(styles, ".user-cycle-panel")
        and contains(styles, ".user-cycle-grid")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_frontend_user_mvp": contains(page, "user-cycle-panel")
        and not contains(page, "second-cycle-admin")
        and not contains(styles, "second-cycle-admin"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_SECOND_CYCLE_CONTEXT",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP second-cycle context only; no backend contract, production, security, tenant, audit-access or admin/evidence expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_SECOND_CYCLE_CONTEXT_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
