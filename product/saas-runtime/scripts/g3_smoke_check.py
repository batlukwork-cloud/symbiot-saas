from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "README.md",
    ".env.example",
    "docker-compose.yml",
    "backend/requirements.txt",
    "backend/app/main.py",
    "backend/app/schemas.py",
    "backend/app/routers/health.py",
    "backend/app/routers/processes.py",
    "backend/app/routers/task_runs.py",
    "backend/app/routers/documents.py",
    "backend/app/routers/artifacts.py",
    "backend/app/routers/audit.py",
    "backend/app/routers/admin.py",
    "backend/app/services/sqlite_store.py",
    "backend/app/services/ocr_worker.py",
    "backend/app/services/embedding_provider.py",
    "backend/app/services/identity_provider.py",
    "backend/app/services/idp_url_policy.py",
    "backend/app/services/keycloak_bootstrap.py",
    "backend/app/services/keycloak_production_readiness.py",
    "backend/app/services/task_run_execution.py",
    "backend/app/services/task_run_store.py",
    "backend/app/services/pgvector_store.py",
    "backend/app/services/rag_eval.py",
    "backend/evals/rag_semantic_eval_set.json",
    "backend/evals/rag_eval_thresholds.json",
    "backend/migrations/001_pgvector_schema.sql",
    "scripts/start_pgvector_runtime.ps1",
    "scripts/stop_pgvector_runtime.ps1",
    "frontend/package.json",
    "frontend/app/page.tsx",
    "frontend/app/layout.tsx",
    "contracts/openapi.mvp.yaml",
    "contracts/data-model.md",
    "docs/G3_CORE_INTEGRATION_DAY0.md",
    "docs/ADR-002_PRODUCTION_IAM_SSO_DESIGN.md",
    "docs/ADR-003_PRODUCTION_IDP_KEYCLOAK_REMOTE_JWKS.md",
    "docs/RUNBOOK_KEYCLOAK_OIDC_SETUP.md",
    "docs/RUNBOOK_KEYCLOAK_REALM_BOOTSTRAP.md",
    "config/keycloak/symbiot-realm.json",
    "docs/RUNBOOK_KEYCLOAK_PRODUCTION_HTTPS_DEPLOYMENT.md",
    "docker-compose.production.keycloak.yml",
    "config/keycloak/Caddyfile",
    "config/keycloak/production.env.example",
    "scripts/g3_product_demo_runbook_check.py",
    "docs/G3_PRODUCT_DEMO_RUNBOOK.md",
    "scripts/g3_editable_next_task_brief_check.py",
    "docs/G3_EDITABLE_NEXT_TASK_BRIEF.md",
    "scripts/g3_taskrun_detail_reload_check.py",
    "docs/G3_TASKRUN_DETAIL_RELOAD.md",
    "scripts/g3_artifact_versioning_check.py",
    "docs/G3_ARTIFACT_VERSIONING_BASELINE.md",
    "scripts/g3_product_evidence_pack_check.py",
    "docs/G3_PRODUCT_EVIDENCE_PACK.md",
    "scripts/start_g3_local_demo.ps1",
    "scripts/stop_g3_local_demo.ps1",
    "scripts/g3_local_demo_launch_readiness_check.py",
    "docs/G3_LOCAL_DEMO_LAUNCH_RUNBOOK.md",
    "docs/G3_DMITRY_UI_ACCEPTANCE_CHECKLIST.md",
    "docs/G3_PRODUCT_EVIDENCE_SEGMENT_REVIEW.md",
]

REQUIRED_API_MARKERS = [
    "/health",
    "/processes",
    "/task-runs",
    "/task-runs/intake-preview",
    "/task-runs/{task_run_id}/result-center",
    "/task-runs/{task_run_id}/result-actions/{action_id}",
    "/documents",
    "/documents/storage-status",
    "/documents/upload-policy/check",
    "/documents/upload",
    "/documents/upload-runtime-status",
    "/documents/uploads/{file_id}/approve-rag",
    "/documents/ocr-jobs",
    "/documents/ocr-worker-status",
    "/documents/ocr-jobs/execute-next",
    "/documents/ocr-jobs/{job_id}/approve-rag",
    "/rag/vector-status",
    "/rag/embedding-status",
    "/rag/pgvector-migration.sql",
    "/rag/pgvector-status",
    "/rag/pgvector/apply-migration",
    "/rag/pgvector/sync",
    "/rag/eval-set",
    "/rag/eval-thresholds",
    "/rag/evaluate",
    "/rag/eval-history",
    "/rag/provider-governance",
    "/artifacts/{artifact_id}",
    "/artifacts/{artifact_id}/versions",
    "/audit-events",
    "/audit-events/retention-status",
    "/audit-events/persistence-status",
    "/audit-events/access-model-status",
    "/audit-events/access-check",
    "/audit-events/access-audit",
    "/audit-events/access-audit/verify",
    "/audit-events/export-package",
    "/security/identity-provider/status",
    "/security/identity-provider/keycloak-bootstrap",
    "/security/identity-provider/production-readiness",
    "/security/role-directory/status",
    "/security/role-directory/coverage",
    "/security/role-directory/admin-status",
    "/security/role-directory/audit",
    "/security/role-directory/audit/verify",
    "/security/role-directory/roles/{runtime_role}",
    "/security/role-directory",
    "/security/access-policy-directory-validation",
    "/admin/llm-providers",
]


def main() -> None:
    missing = [item for item in REQUIRED_FILES if not (ROOT / item).exists()]
    if missing:
        raise SystemExit(f"Missing G3 scaffold files: {missing}")

    openapi = (ROOT / "contracts/openapi.mvp.yaml").read_text(encoding="utf-8")
    missing_api = [marker for marker in REQUIRED_API_MARKERS if marker not in openapi]
    if missing_api:
        raise SystemExit(f"Missing API contract markers: {missing_api}")

    print("G3 smoke check passed")
    print(f"Root: {ROOT}")
    print(f"Files checked: {len(REQUIRED_FILES)}")
    print(f"API markers checked: {len(REQUIRED_API_MARKERS)}")


if __name__ == "__main__":
    main()
