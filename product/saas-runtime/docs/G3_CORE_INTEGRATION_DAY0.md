# G3 Core Integration Day 0

Date: 2026-07-01

## Scope

Day 0 creates the runtime implementation workspace and keeps the G2-approved architecture visible in code.

## Included

- Backend FastAPI skeleton.
- Frontend Next.js skeleton.
- OpenAPI contract draft.
- MVP data model draft.
- Docker Compose with PostgreSQL, Redis, backend, frontend.
- Smoke-check script.

## Not Yet Done

- Real database migrations.
- Real authentication.
- Real LLM provider integration.
- Real RAG indexing.
- Persistent audit store.
- End-to-end browser test.

## Gate Impact

G3 is open, not closed. Closing G3 requires a working scenario:

`Catalog -> Wizard -> TaskRun -> LLM/RAG -> Gates -> Artifact -> Audit`

