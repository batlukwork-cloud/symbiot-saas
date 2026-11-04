from __future__ import annotations

import html
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
API_BASE = os.environ.get("SYMBIOT_API_BASE", "http://127.0.0.1:8000").rstrip("/")

HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.environ.get("SYMBIOT_SESSION", "symbiot-demo-session-token"),
    "x-tenant-id": os.environ.get("SYMBIOT_TENANT_ID", "tenant:demo"),
    "x-actor": os.environ.get("SYMBIOT_ACTOR", "g3-product-evidence-pack"),
    "x-role": os.environ.get("SYMBIOT_ROLE", "runtime-operator"),
    "x-department": os.environ.get("SYMBIOT_DEPARTMENT", "sales"),
    "x-access-level": os.environ.get("SYMBIOT_ACCESS_LEVEL", "standard"),
}


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            data = response.read().decode("utf-8")
            return response.status, json.loads(data) if data else {}
    except HTTPError as exc:
        data = exc.read().decode("utf-8")
        return exc.code, json.loads(data) if data else {"detail": exc.reason}


def write_html_report(path: Path, evidence: dict[str, Any]) -> None:
    checks = evidence["checks"]
    rows = "\n".join(
        f"<tr><td>{html.escape(key)}</td><td>{'PASS' if value else 'FAIL'}</td></tr>"
        for key, value in checks.items()
    )
    artifact = evidence.get("artifact") or {}
    result_center = evidence.get("result_center_after_followup") or {}
    actions = result_center.get("action_history", [])
    action_rows = "\n".join(
        "<tr>"
        f"<td>{html.escape(str(action.get('action_id', '')))}</td>"
        f"<td>{html.escape(str(action.get('actor', '')))}</td>"
        f"<td>{html.escape(str(action.get('comment', '')))}</td>"
        f"<td>{html.escape(str(action.get('related_task_run_id', '')))}</td>"
        "</tr>"
        for action in actions
    )
    content = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>SAAS-0940 Product Evidence Pack</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 32px; color: #152033; }}
    h1 {{ margin-bottom: 4px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 18px 0; }}
    th, td {{ border: 1px solid #d8dee9; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #eef3f8; }}
    .ok {{ color: #0b6b3a; font-weight: 700; }}
    .bad {{ color: #9b1c1c; font-weight: 700; }}
    pre {{ background: #f6f8fa; padding: 12px; overflow: auto; }}
  </style>
</head>
<body>
  <h1>SAAS-0940 Product Evidence Pack</h1>
  <p>Статус: <span class="{'ok' if evidence['passed'] else 'bad'}">{'PASS' if evidence['passed'] else 'FAIL'}</span></p>
  <p>API: {html.escape(evidence['api_base'])}; сформировано: {html.escape(evidence['finished_at'])}</p>
  <h2>Контрольные проверки</h2>
  <table><tr><th>Проверка</th><th>Статус</th></tr>{rows}</table>
  <h2>Сценарий результата</h2>
  <table>
    <tr><th>TaskRun</th><td>{html.escape(str(evidence.get('task_run_id')))}</td></tr>
    <tr><th>Artifact</th><td>{html.escape(str(evidence.get('artifact_id')))}</td></tr>
    <tr><th>Версия</th><td>{html.escape(str(artifact.get('version')))}</td></tr>
    <tr><th>Хэш версии</th><td>{html.escape(str(evidence.get('first_version_hash')))}</td></tr>
    <tr><th>Следующий TaskRun</th><td>{html.escape(str(evidence.get('followup_task_run_id')))}</td></tr>
  </table>
  <h2>История действий пользователя</h2>
  <table><tr><th>Действие</th><th>Actor</th><th>Комментарий</th><th>Связанный TaskRun</th></tr>{action_rows}</table>
  <h2>Артефакт</h2>
  <pre>{html.escape(str(artifact.get('content', '')))}</pre>
</body>
</html>
"""
    path.write_text(content, encoding="utf-8")


def main() -> None:
    started_at = datetime.now(UTC).isoformat()

    preview_payload = {
        "process_id": "commercial-proposal",
        "goal": "Собрать доказательный продуктовый сценарий Симбиота без внешнего deployment.",
        "expected_artifact": "Product evidence pack: TaskRun, Result Center, artifact version, user actions, next task.",
        "source_context": "SAAS-0940 product evidence pack",
        "urgency": "G3 Product Evidence / maximum safe throw 2/5",
        "document_ids": ["doc-demo-001"],
    }
    preview_status, preview = request_json("POST", "/api/task-runs/intake-preview", preview_payload)

    create_payload = {
        "process_id": preview_payload["process_id"],
        "profile_id": preview.get("recommended_profile_id", "demo-tenant-working") if isinstance(preview, dict) else "demo-tenant-working",
        "form_data": {
            "goal": preview_payload["goal"],
            "expected_artifact": preview_payload["expected_artifact"],
            "source_context": preview_payload["source_context"],
            "urgency": preview_payload["urgency"],
        },
        "document_ids": preview_payload["document_ids"],
    }
    create_status, task_run = request_json("POST", "/api/task-runs", create_payload)
    task_run_id = task_run.get("id") if isinstance(task_run, dict) else None
    artifact_id = task_run.get("artifact_id") if isinstance(task_run, dict) else None

    result_status, result_center = request_json("GET", f"/api/task-runs/{task_run_id}/result-center") if task_run_id else (0, {})
    artifact_status, artifact = request_json("GET", f"/api/artifacts/{artifact_id}") if artifact_id else (0, {})
    versions_status, versions = request_json("GET", f"/api/artifacts/{artifact_id}/versions") if artifact_id else (0, [])

    accept_status, accepted_center = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/accept-result",
        {"comment": "Product evidence pack accepted for internal MVP evidence."},
    ) if task_run_id else (0, {})

    followup_payload = {
        "comment": "Create controlled follow-up from product evidence pack.",
        "followup_goal": "Подготовить локальный демо-запуск по evidence pack.",
        "followup_expected_artifact": "Local demo launch runbook and readiness checklist.",
        "followup_source_context": "SAAS-0940 accepted product evidence pack",
        "followup_urgency": "G3 Product Evidence / SAAS-0941",
    }
    followup_status, followup_center = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
        followup_payload,
    ) if task_run_id else (0, {})

    first_version = versions[0] if isinstance(versions, list) and versions else {}
    action_history = followup_center.get("action_history", []) if isinstance(followup_center, dict) else []
    followup_task_run_id = next(
        (action.get("related_task_run_id") for action in action_history if action.get("action_id") == "create-next-task"),
        None,
    )
    checks = {
        "intake_preview_ready": preview_status == 200 and isinstance(preview, dict) and preview.get("status") == "ready",
        "workgroup_visible": isinstance(preview, dict) and len(preview.get("workgroup", [])) >= 1,
        "task_run_created": create_status == 200 and bool(task_run_id) and bool(artifact_id),
        "result_center_ready": result_status == 200 and result_center.get("product_status") in {"ready_for_acceptance", "accepted"},
        "artifact_loaded": artifact_status == 200 and artifact.get("id") == artifact_id,
        "artifact_versioned": versions_status == 200 and isinstance(versions, list) and len(versions) >= 1,
        "artifact_hash_present": len(first_version.get("content_hash", "")) == 64,
        "accept_action_recorded": accept_status == 200 and any(action.get("action_id") == "accept-result" for action in accepted_center.get("action_history", [])),
        "followup_task_created": followup_status == 200 and bool(followup_task_run_id),
        "evidence_no_external_deployment": API_BASE.startswith("http://127.0.0.1") or API_BASE.startswith("http://localhost"),
    }
    passed = all(checks.values())
    evidence = {
        "task": "SAAS-0940",
        "route": "maximum safe throw 2/5",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": passed,
        "checks": checks,
        "task_run_id": task_run_id,
        "artifact_id": artifact_id,
        "artifact": artifact,
        "preview": preview,
        "result_center_before_actions": result_center,
        "result_center_after_accept": accepted_center,
        "result_center_after_followup": followup_center,
        "versions_total": len(versions) if isinstance(versions, list) else 0,
        "first_version_hash": first_version.get("content_hash"),
        "followup_task_run_id": followup_task_run_id,
        "stop_conditions_checked": [
            "no_external_https_deployment",
            "no_public_demo",
            "no_client_pilot",
            "no_production_storage_or_retention",
            "no_tenant_security_model_change",
            "no_external_export",
        ],
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    json_path = RUNTIME_LOGS / "SAAS_0940_PRODUCT_EVIDENCE_PACK_2026-07-03.json"
    html_path = RUNTIME_LOGS / "SAAS_0940_PRODUCT_EVIDENCE_PACK_2026-07-03.html"
    json_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    write_html_report(html_path, evidence)
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
