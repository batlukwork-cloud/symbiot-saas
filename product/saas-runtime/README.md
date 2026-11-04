# Symbiot Runtime MVP

Status: G3 Core Integration / Day 0 scaffold + first running evidence.

This folder is the first implementation workspace for the SaaS Runtime approved through:

- G0.1 Compliance Gate
- G1 Scope Freeze
- G2 UX + Architecture Freeze

## Purpose

Build the MVP Runtime path:

`Catalog -> Wizard -> TaskRun -> LLM/RAG -> Quality Gates -> Artifact -> Audit`

## Stack Baseline

- Frontend: Next.js / React / TypeScript.
- Backend: Python FastAPI.
- Database: PostgreSQL, pgvector-ready.
- Queue/cache: Redis.
- Storage: S3-compatible storage / MinIO later.
- AI: LLM Gateway abstraction, provider fallback, mock provider first.
- Security baseline: OWASP ASVS Level 2 + Level 3 for critical areas.
- AI baseline: NIST AI RMF Govern / Map / Measure / Manage.

## Structure

- `backend` - FastAPI service skeleton.
- `frontend` - Next.js Runtime GUI skeleton.
- `contracts` - API and data contracts.
- `docs` - G3 implementation notes.
- `scripts` - smoke checks and support scripts.

## Local Start

Backend dependencies are declared in `backend/requirements.txt`.
Frontend dependencies are declared in `frontend/package.json`.

Before full local run, execute:

```powershell
python scripts\g3_smoke_check.py
```

This verifies that G3 scaffold files and contract coverage exist.

### Backend

```powershell
cd <локальный путь>
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Control URL:

```text
http://127.0.0.1:8000/health
```

### Frontend

```powershell
cd <локальный путь>
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Control URL:

```text
http://127.0.0.1:3000
```

Production build check:

```powershell
npm run build
```

## Identity Provider Modes

The runtime supports two authentication modes:

- `SYMBIOT_IDENTITY_PROVIDER_MODE=demo_headers` for local MVP evidence.
- `SYMBIOT_IDENTITY_PROVIDER_MODE=oidc_jwt` for verified Bearer JWT validation.

In `oidc_jwt` mode the runtime requires `Authorization: Bearer <JWT>` and validates:

- RS256 signature through JWKS;
- issuer;
- audience;
- expiration and issued-at;
- `sub`, `tenant_id`, `roles` and `access_level` claims.

The runtime ignores role/access demo headers in OIDC mode. If `x-tenant-id` is sent, it must match the token `tenant_id`.

Required production variables:

- `SYMBIOT_OIDC_ISSUER`
- `SYMBIOT_OIDC_CLIENT_ID`
- `SYMBIOT_OIDC_JWKS_URL`

`SYMBIOT_OIDC_JWKS_JSON` is available only for local reproducible evidence and tests. Production/client pilot requires remote JWKS URL and external identity-provider approval.

### G3 First Running Evidence

Verified on 2026-07-01:

- backend `/health`: 200;
- backend `/api/processes`: 200;
- backend `/api/task-runs/run-demo-001`: 200;
- backend `/api/artifacts/artifact-demo-001`: 200;
- backend `/api/audit-events`: 200;
- backend `/api/admin/llm-providers`: 200;
- frontend `/`: 200;
- frontend `npm run build`: passed.

Known risk:

- `npm audit` after `next@15.5.19` shows 2 moderate findings through transitive `postcss` inside Next.js. Critical findings were removed. This must remain in the ASVS risk register until resolved by framework update or compensating controls.

### G3 MVP Path Evidence

Verified on 2026-07-01:

`Catalog -> TaskRun -> Artifact -> Audit`

How to repeat:

1. Start backend and frontend.
2. Open `http://127.0.0.1:3000`.
3. Click `Запустить MVP path`.
4. Check that the page shows:
   - `run-demo-001`;
   - `Source Coverage Gate`;
   - `Коммерческое предложение demo`;
   - `task_run.completed`.

Evidence files:

- `runtime_logs/G3_MVP_PATH_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_MVP_PATH_UI_2026-07-01.png`

### G3 LLM/RAG/Quality Evidence

Verified on 2026-07-01:

`Catalog -> TaskRun -> RAG -> LLM Gateway -> Quality Gates -> Artifact -> Audit`

Control URLs:

```text
http://127.0.0.1:8000/api/rag/search?query=Symbiot%20Runtime
http://127.0.0.1:8000/api/rag/evidence/run-demo-001
http://127.0.0.1:8000/api/llm-gateway/evidence/run-demo-001
http://127.0.0.1:8000/api/quality/evidence/run-demo-001
http://127.0.0.1:8000/api/runtime/evidence/run-demo-001
```

Evidence files:

- `runtime_logs/G3_LLM_RAG_QUALITY_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_LLM_RAG_QUALITY_UI_2026-07-01.png`

Current limitation:

- LLM Gateway is still a mock provider.
- RAG uses demo chunks, not a vector index.
- Quality Gates are executable demo gates, not the full ASVS/NIST catalog.

### G3 Provider/RAG/Gate Catalog Evidence

Verified on 2026-07-01:

`Provider registry -> Document ingest -> RAG search -> LLM Gateway evidence -> Quality Gate catalog -> Runtime evidence`

Control URLs:

```text
http://127.0.0.1:8000/api/admin/llm-providers
http://127.0.0.1:8000/api/documents
http://127.0.0.1:8000/api/documents/ingest
http://127.0.0.1:8000/api/quality/gates
http://127.0.0.1:8000/api/rag/search?query=provider%20adapter%20quality%20gate
http://127.0.0.1:8000/api/runtime/evidence/run-demo-001
```

Evidence files:

- `runtime_logs/G3_PROVIDER_RAG_GATE_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_PROVIDER_RAG_GATE_UI_2026-07-01.png`

Current limitation:

- Real LLM provider is represented as `not_configured`.
- RAG has been moved from memory to SQLite MVP storage; vector search is still open.
- Quality catalog has been expanded to 12 gates; production controls still require implementation evidence.

### G3 Persistent Provider/RAG/Gate Evidence

Verified on 2026-07-01:

`SQLite storage -> Document ingest -> RAG search -> Provider fallback -> 12 Quality Gates -> UI/API evidence`

Control URLs:

```text
http://127.0.0.1:8000/api/documents/storage-status
http://127.0.0.1:8000/api/admin/llm-providers
http://127.0.0.1:8000/api/llm-gateway/evidence/run-demo-001?provider_id=openai-compatible-primary
http://127.0.0.1:8000/api/quality/gates
http://127.0.0.1:8000/api/runtime/evidence/run-demo-001
```

Evidence files:

- `runtime_logs/G3_PERSISTENT_PROVIDER_GATE_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_PERSISTENT_PROVIDER_GATE_UI_2026-07-01.png`

Current limitation:

- SQLite is persistent MVP storage, not final production storage.
- RAG still uses keyword scoring; vector search remains open.
- Real LLM provider must be configured through environment variables before production use.
- File scanning, OCR upload policy, PII classifier and interactive human approval are still warning gates.

### G3 Vector Index + Upload/OCR Policy Evidence

Verified on 2026-07-01:

`SQLite chunks -> deterministic vector MVP -> vector-status -> upload/OCR policy -> 13 Quality Gates -> UI/API evidence`

Control URLs:

```text
http://127.0.0.1:8000/api/rag/vector-status
http://127.0.0.1:8000/api/rag/search?query=OCR%20vector%20ASVS%20policy%20evidence
http://127.0.0.1:8000/api/documents/upload-policy/check
http://127.0.0.1:8000/api/quality/gates
http://127.0.0.1:8000/api/runtime/evidence/run-demo-001
```

Evidence files:

- `runtime_logs/G3_VECTOR_UPLOAD_POLICY_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_VECTOR_UPLOAD_POLICY_UI_2026-07-01.png`

Current limitation:

- Vector search is a deterministic MVP vector, not final embeddings/pgvector.
- Binary multipart upload is not implemented in this layer.
- OCR routing is defined by policy, but the OCR/UKR pipeline is not connected to Runtime yet.
- Malware/content scanning is declared and checked as a warning control, but the scanner is not connected yet.

### G3 Binary Upload + OCR/Scanner Evidence

Verified on 2026-07-01:

`Multipart upload -> SQLite upload record -> SHA256/storage key -> scanner adapter -> OCR/UKR dispatch job -> 16 Quality Gates -> UI/API evidence`

Control URLs:

```text
http://127.0.0.1:8000/api/documents/upload
http://127.0.0.1:8000/api/documents/upload-runtime-status
http://127.0.0.1:8000/api/documents/uploads
http://127.0.0.1:8000/api/documents/ocr-jobs
http://127.0.0.1:8000/api/quality/gates
http://127.0.0.1:8000/api/quality/evidence/run-demo-001
```

Evidence files:

- `runtime_logs/G3_BINARY_UPLOAD_OCR_SCANNER_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_BINARY_UPLOAD_OCR_SCANNER_UI_2026-07-01.png`

Current limitation:

- Scanner adapter verifies file storage, readability and hash, but it is not a production malware/content scanning engine yet.
- OCR-required files create a dispatch job for the existing OCR/UKR pipeline, but the OCR execution worker is not yet controlled by Runtime.
- OCR service registry still has historical path variants; Runtime records the current physical OCR pipeline path in `/api/documents/upload-runtime-status`.
- Real LLM provider, final embeddings/pgvector, PII classifier and interactive human approval remain open G3/G4 risks.

### G3 OCR Execution + Post-OCR RAG + Scanner + pgvector Path Evidence

Verified on 2026-07-01:

`Upload -> Windows Defender scan -> OCR worker -> REA OCR pipeline -> manifest/text output -> RAG ingest -> search -> 20 Quality Gates -> pgvector migration path`

Control URLs:

```text
http://127.0.0.1:8000/api/documents/ocr-worker-status
http://127.0.0.1:8000/api/documents/ocr-jobs/{job_id}/execute
http://127.0.0.1:8000/api/documents/ocr-jobs/execute-next
http://127.0.0.1:8000/api/rag/search?query=SYMBIOT_ENG0009_OCR_RAG_READY
http://127.0.0.1:8000/api/rag/embedding-status
http://127.0.0.1:8000/api/rag/vector-status
http://127.0.0.1:8000/api/rag/pgvector-migration.sql
http://127.0.0.1:8000/api/quality/gates
```

Evidence files:

- `runtime_logs/G3_OCR_EXECUTION_RAG_SCANNER_PGVECTOR_EVIDENCE_2026-07-01.json`
- `runtime_logs/G3_OCR_EXECUTION_RAG_SCANNER_PGVECTOR_UI_2026-07-01.png`

Verified test path:

- uploaded file: `upload-demo-002`;
- scanner: Windows Defender `passed`;
- OCR job: `ocr-demo-002 completed`;
- indexed document: `doc-demo-003`;
- RAG search marker: `SYMBIOT_ENG0009_OCR_RAG_READY`;
- quality catalog: `20 gates`.

Current limitation:

- Live PostgreSQL/pgvector migration is not applied in the local MVP run; migration SQL and Docker target are ready.
- Embedding provider uses deterministic local fallback until `SYMBIOT_EMBEDDING_BASE_URL` and `SYMBIOT_EMBEDDING_API_KEY` are configured.
- OCR quality depends on the current REA OCR pipeline and installed system Python packages.
- Real LLM provider, PII classifier and interactive human approval remain open G3/G4 risks.

### G3 Live pgvector Product Memory Layer

Implemented on 2026-07-01:

`SQLite knowledge store -> pgvector migration endpoint -> pgvector sync endpoint -> search mode evidence -> UI fallback/live status`

Control URLs:

```text
http://127.0.0.1:8000/api/rag/pgvector-status
http://127.0.0.1:8000/api/rag/pgvector/apply-migration
http://127.0.0.1:8000/api/rag/pgvector/sync
http://127.0.0.1:8000/api/rag/vector-status
http://127.0.0.1:8000/api/rag/search?query=SYMBIOT_ENG0009_OCR_RAG_READY
```

Infrastructure requirement:

- install Docker or PostgreSQL with the `pgvector` extension;
- set `DATABASE_URL`;
- run `/api/rag/pgvector/apply-migration`;
- run `/api/rag/pgvector/sync`.

Current local limitation:

- Docker/PostgreSQL are not installed on this workstation, so Runtime exposes `pgvector_fallback` until the database dependency is available.
- The application layer is ready for live pgvector; the production readiness gate remains open until a live database run is captured as evidence.

### G3 Live pgvector Execution Evidence

Verified on 2026-07-01:

`Portable PostgreSQL 16.14 -> pgvector 0.8.3 -> migration -> SQLite sync -> pgvector_live search`

Runtime location:

```text
D:\symbiot_pgvector_runtime
```

Start/stop helpers:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_pgvector_runtime.ps1
powershell -ExecutionPolicy Bypass -File scripts\stop_pgvector_runtime.ps1
```

Backend must run with:

```text
DATABASE_URL=postgresql://symbiot:symbiot@127.0.0.1:55432/symbiot_runtime
```

Control URLs:

```text
http://127.0.0.1:8000/api/rag/pgvector-status
http://127.0.0.1:8000/api/rag/vector-status
http://127.0.0.1:8000/api/rag/search?query=SYMBIOT_ENG0009_OCR_RAG_READY
```

Verified result:

- PostgreSQL: `16.14`;
- pgvector extension: `0.8.3`;
- synchronized documents: `3`;
- synchronized chunks: `5`;
- synchronized vectors: `5`;
- RAG search marker: `source_coverage=passed`;
- RAG index mode: `pgvector_live`.

Evidence file:

- `runtime_logs/G3_LIVE_PGVECTOR_EXECUTION_EVIDENCE_2026-07-01.json`

Residual risk:

- local Windows pgvector binary is an unofficial dev-runtime package; production should use an approved Docker image, managed PostgreSQL with pgvector, or internally approved build.

### G3 Real Embedding Provider + RAG Eval Set Evidence

Verified on 2026-07-01:

`Local embedding provider -> live pgvector sync -> RAG eval set -> pass rate / MRR evidence`

Control URLs:

```text
http://127.0.0.1:8000/api/rag/embedding-status
http://127.0.0.1:8000/api/rag/eval-set
http://127.0.0.1:8000/api/rag/evaluate
http://127.0.0.1:8000/api/rag/vector-status
```

Provider:

- `symbiot-local-hashing-embedding-v0.1`;
- configured: `true`;
- fallback: `false`;
- writes embeddings into live pgvector.

Eval set:

- file: `backend/evals/rag_semantic_eval_set.json`;
- cases: `4`;
- pass rate: `1.0`;
- MRR: `1.0`;
- threshold: passed.

Current limitation:

- this is a local MVP embedding provider, not yet an externally governed neural embedding service;
- production hardening still requires an approved external or managed embedding provider, secrets policy, larger eval set and drift monitoring.

### G3 Provider Governance + RAG Drift Monitoring Evidence

Verified on 2026-07-01:

`Expanded eval set -> thresholds -> eval history -> provider governance -> drift monitoring -> quality gates`

Control URLs:

```text
http://127.0.0.1:8000/api/rag/eval-thresholds
http://127.0.0.1:8000/api/rag/eval-history
http://127.0.0.1:8000/api/rag/provider-governance
http://127.0.0.1:8000/api/rag/evaluate
http://127.0.0.1:8000/api/quality/evidence/run-demo-001
```

Verified result:

- eval cases: `12`;
- pass rate: `1.0`;
- MRR: `1.0`;
- index mode: `pgvector_live`;
- quality gates: `26`;
- engineering readiness: `true`;
- client data readiness: `false`.

Evidence file:

- `runtime_logs/G3_PROVIDER_GOVERNANCE_MONITORING_EVIDENCE_2026-07-01.json`

Current limitation:

- client data remains blocked until PII classifier and human approval workflow are implemented;
- external managed embedding provider governance is not configured yet;
- the eval set is sufficient for MVP engineering evidence, not for production/client-data pilot.

### G3 Keycloak Realm Bootstrap Evidence

Verified on 2026-07-02:

`Keycloak baseline -> realm import package -> runtime client/roles/claims/users -> readiness endpoint`

Control URLs:

```text
http://127.0.0.1:8000/api/security/identity-provider/status
http://127.0.0.1:8000/api/security/identity-provider/keycloak-bootstrap
```

Bootstrap package:

```text
config/keycloak/symbiot-realm.json
```

Runbook:

```text
docs/RUNBOOK_KEYCLOAK_REALM_BOOTSTRAP.md
```

Verified result:

- realm: `symbiot`;
- client: `symbiot-runtime`;
- required roles: `admin`, `role-admin`, `runtime-operator`, `qa-lead`, `observer`;
- required claims: `tenant_id`, `roles`, `access_level`;
- disabled bootstrap users: `symbiot-admin`, `symbiot-operator`, `symbiot-qa`;
- `bootstrap_package_ready=true`.

Current limitation:

- production HTTPS Keycloak issuer/JWKS is still open;
- real users, MFA, client secret, redirect domain and key-rotation procedure must be configured before client pilot.

