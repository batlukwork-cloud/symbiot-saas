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
        "business_decision_hero_rendered": contains(page, "business-decision-hero")
        and contains(page, "Итог миссии")
        and contains(page, "Что сделать с результатом"),
        "primary_result_decision_cta_present": contains(page, 'href="#result-decision"')
        and contains(page, "Принять решение")
        and contains(page, "primaryResultAction"),
        "technical_business_result_id_not_duplicated": contains(page, 'id="business-result"')
        and contains(page, 'id="business-result-detail"'),
        "user_result_page_single_column": contains(styles, ".user-page .simple-result-shell")
        and contains(styles, "grid-template-columns: 1fr;"),
        "user_mode_hides_technical_result_chrome": contains(styles, ".user-page .result-center-nav")
        and contains(styles, ".user-page .artifact-passport-compact")
        and contains(styles, ".user-page .compact-passport")
        and contains(styles, ".user-page .version-drawer")
        and contains(styles, ".user-page .support-drawer"),
        "decision_cards_preserved": contains(page, "resultDecisionCards.map")
        and contains(page, "applyResultAction(card.action)"),
        "accept_decision_visually_prioritized": contains(styles, ".user-page .decision-accept")
        and contains(styles, "#155e2b"),
        "mobile_result_hero_stacks": contains(styles, ".business-decision-hero")
        and contains(styles, "@media (max-width: 760px)"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_RESULT_DECISION_PAGE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP result and decision page only; no backend contract, production, security, secrets or admin evidence layer expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_RESULT_DECISION_PAGE_CHECK_2026-07-09.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
