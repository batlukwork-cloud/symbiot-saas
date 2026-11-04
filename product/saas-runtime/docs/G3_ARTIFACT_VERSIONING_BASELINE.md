# G3 Artifact Versioning Baseline

Status: implemented for `SAAS-0936`.

## Purpose

The Runtime must expose artifact version history so a user can see that generated outputs are not anonymous one-off blobs.

## Product Behavior

Every saved artifact receives a baseline version record in `artifact_versions`.

The version record contains:

- artifact id;
- TaskRun id;
- version;
- title;
- content hash;
- source;
- created timestamp.

## API

`GET /api/artifacts/{artifact_id}/versions`

## Evidence

Live check script:

`scripts/g3_artifact_versioning_check.py`

Evidence file:

`runtime_logs/SAAS_0936_ARTIFACT_VERSIONING_LIVE_CHECK_2026-07-03.json`

The check proves:

- TaskRun creates an artifact;
- artifact can be loaded;
- version history can be loaded;
- first version matches current artifact version;
- version content hash exists;
- missing artifact versions return `404`.

## Links

- [[TaskRun Detail Reload]]
- [[TaskRun State Persistence]]
- [[TaskRun Monitor + Result Center]]
- [[Quality Gates]]
