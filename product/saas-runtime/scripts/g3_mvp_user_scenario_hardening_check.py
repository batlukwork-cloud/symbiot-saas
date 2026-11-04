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
        "single_next_action_model": contains(page, "type UserMissionCommand")
        and contains(page, "const userMissionCommand = useMemo<UserMissionCommand>"),
        "step_states_are_data_driven": contains(page, "const productStepStates = useMemo")
        and contains(page, "productStepStates.map"),
        "top_user_action_board_rendered": contains(page, "user-action-board")
        and contains(page, "Следующее действие миссии"),
        "user_page_shell_enabled": contains(page, 'className={viewMode === "user" ? "user-page" : "operator-page"}'),
        "service_chrome_hidden_in_user_mode": contains(styles, ".user-page .status-group")
        and contains(styles, ".user-page .view-mode-panel")
        and contains(styles, ".user-page .product-side")
        and contains(styles, ".user-page .campaign-map")
        and contains(styles, ".user-page .queue-monitor-strip"),
        "normal_user_role_details_not_first_screen": contains(page, "{showWorkspacePanel || showManagerLayer ? (")
        and contains(page, "Настроить команду"),
        "compact_team_summary_rendered": contains(page, "user-team-strip")
        and contains(page, "Команда миссии"),
        "result_acceptance_cta_preserved": contains(page, 'href="#result-decision"')
        and contains(page, "Перейти к приемке"),
        "admin_evidence_layer_not_expanded": contains(page, "evidenceAcceptanceCenter")
        and contains(page, 'viewMode !== "user" && queueEvidenceReview'),
        "responsive_styles_present": contains(styles, ".user-action-board")
        and contains(styles, ".user-team-strip")
        and contains(styles, "@media (max-width: 760px)"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_SCENARIO_HARDENING",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP scenario only; no backend contract, production, security, secrets or evidence-acceptance expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_SCENARIO_HARDENING_CHECK_2026-07-09.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
      raise SystemExit(1)


if __name__ == "__main__":
    main()
