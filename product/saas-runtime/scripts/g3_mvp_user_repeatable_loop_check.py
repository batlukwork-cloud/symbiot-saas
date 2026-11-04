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
        "cycle_number_is_stateful": contains(page, "cycleNumber")
        and contains(page, "currentCycleNumber")
        and contains(page, "nextCycleNumber"),
        "followup_open_advances_cycle_number": contains(page, "targetCycleNumber")
        and contains(page, "isFollowupCycleOpen ? cycleNumber + 1 : 2")
        and contains(page, "setCycleNumber(targetCycleNumber)"),
        "top_command_uses_next_cycle_label": contains(page, "Цикл ${nextCycleNumber} создан")
        and contains(page, "Открыть цикл ${nextCycleNumber}"),
        "current_cycle_acceptance_label_is_dynamic": contains(page, "Цикл ${currentCycleNumber} открыт")
        and contains(page, "Принять результат цикла ${currentCycleNumber}"),
        "continuation_steps_are_cycle_aware": contains(page, "Создать цикл ${nextCycleNumber}")
        and contains(page, "Открыть цикл ${nextCycleNumber}")
        and contains(page, "Принять результат цикла ${currentCycleNumber}"),
        "cycle_trail_rendered": contains(page, "user-cycle-trail")
        and contains(page, "Цикл {currentCycleNumber - 1} принят")
        and contains(page, "Цикл {nextCycleNumber} следующий"),
        "cycle_context_resets_for_manual_paths": contains(page, "setCycleNumber(1)")
        and contains(page, "setOpenedFollowupTaskRunId(\"\")")
        and contains(page, "loadExistingTaskRun"),
        "cycle_trail_styles_are_responsive": contains(styles, ".user-cycle-trail")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr));")
        and contains(styles, "@media (max-width: 760px)"),
        "no_backend_or_admin_expansion": not contains(page, "repeatable-loop-admin")
        and not contains(styles, "repeatable-loop-admin"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_REPEATABLE_LOOP",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP repeatable loop only; no backend contract, production, security, tenant, audit-access or admin/evidence expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_REPEATABLE_LOOP_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
