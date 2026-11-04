from __future__ import annotations

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
    "x-actor": os.environ.get("SYMBIOT_ACTOR", "g3-artifact-versioning"),
    "x-role": os.environ.get("SYMBIOT_ROLE", "runtime-operator"),
    "x-department": os.environ.get("SYMBIOT_DEPARTMENT", "sales"),
    "x-access-level": os.environ.get("SYMBIOT_ACCESS_LEVEL", "standard"),
}


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any] | list[Any]]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            data = response.read().decode("utf-8")
            return response.status, json.loads(data) if data else {}
    except HTTPError as exc:
        data = exc.read().decode("utf-8")
        return exc.code, json.loads(data) if data else {"detail": exc.reason}


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "form_data": {
            "goal": "Проверить базовую версионность артефакта.",
            "expected_artifact": "Artifact versioning baseline evidence",
            "source_context": "SAAS-0936 artifact versioning live check",
            "urgency": "G3 Product Runtime / SAAS-0936",
        },
        "document_ids": ["doc-demo-001"],
    }
    create_status, task_run = request_json("POST", "/api/task-runs", payload)
    artifact_id = task_run.get("artifact_id") if isinstance(task_run, dict) else None
    artifact_status, artifact = request_json("GET", f"/api/artifacts/{artifact_id}") if artifact_id else (0, {})
    versions_status, versions = request_json("GET", f"/api/artifacts/{artifact_id}/versions") if artifact_id else (0, [])
    missing_status, missing = request_json("GET", "/api/artifacts/artifact-missing-for-versions/versions")

    first_version = versions[0] if isinstance(versions, list) and versions else {}
    checks = {
        "task_run_created": create_status == 200 and bool(artifact_id),
        "artifact_loaded": artifact_status == 200 and artifact.get("id") == artifact_id,
        "versions_loaded": versions_status == 200 and isinstance(versions, list) and len(versions) >= 1,
        "version_matches_artifact": first_version.get("version") == artifact.get("version"),
        "content_hash_present": len(first_version.get("content_hash", "")) == 64,
        "missing_artifact_returns_404": missing_status == 404 and bool(missing.get("detail")),
    }
    passed = all(checks.values())

    evidence = {
        "task": "SAAS-0936",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks": checks,
        "passed": passed,
        "task_run_id": task_run.get("id") if isinstance(task_run, dict) else None,
        "artifact_id": artifact_id,
        "artifact_version": artifact.get("version") if isinstance(artifact, dict) else None,
        "versions_total": len(versions) if isinstance(versions, list) else 0,
        "first_version_hash": first_version.get("content_hash"),
        "missing_status": missing_status,
    }
    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_0936_ARTIFACT_VERSIONING_LIVE_CHECK_2026-07-03.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
