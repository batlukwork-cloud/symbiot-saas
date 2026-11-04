# ADR-002 Production IAM/SSO Design

Status: accepted for design baseline, implementation pending
Date: 2026-07-02
Gate: G3 Core Integration

## Context

The Runtime MVP currently authenticates requests through demo headers:

- `x-symbiot-session`
- `x-tenant-id`
- `x-actor`
- `x-role`
- `x-department`
- `x-access-level`

This is acceptable for local engineering evidence, but it is not a production identity layer. A client-data pilot requires verified identity, tenant isolation, role mapping and auditable session controls.

## Decision

Production IAM will use OIDC/OAuth2 with JWT validation as the baseline. The runtime will keep demo headers only as a local MVP mode.

The identity-provider status endpoint must expose:

- current provider mode;
- target protocol;
- configured OIDC fields as booleans only;
- required claims;
- runtime claim/header mapping;
- ASVS/NIST control mapping;
- stop condition before client-data pilot.

Endpoint:

- `GET /api/security/identity-provider/status`

## Required Claims

Production JWT must provide:

- `sub` - stable user identifier;
- `email` - user contact identity;
- `tenant_id` - tenant scope;
- `roles` - runtime role or role set;
- `access_level` - read, standard, manager or admin.

## Runtime Mapping

| JWT claim | Runtime field |
|---|---|
| `sub` | `x-actor` / `RuntimeSession.actor` |
| `tenant_id` | `x-tenant-id` / `RuntimeSession.tenant_id` |
| `roles` | `x-role` / `RuntimeSession.role` |
| `department` | `x-department` / `RuntimeSession.department` |
| `access_level` | `x-access-level` / `RuntimeSession.access_level` |

## Configuration

Required environment variables for production mode:

- `SYMBIOT_IDENTITY_PROVIDER_MODE=oidc`
- `SYMBIOT_OIDC_ISSUER`
- `SYMBIOT_OIDC_CLIENT_ID`
- `SYMBIOT_OIDC_JWKS_URL`

Optional:

- `SYMBIOT_OIDC_AUDIENCE`
- `SYMBIOT_OIDC_JWKS_JSON` for local verification evidence only

No secret values may be returned through API, logs or evidence files.

## Runtime Validation

`ENG-SaaS-0028` adds executable Bearer JWT validation:

- JWT signature is verified with RS256 and JWKS;
- issuer is checked against `SYMBIOT_OIDC_ISSUER`;
- audience is checked against `SYMBIOT_OIDC_AUDIENCE` or `SYMBIOT_OIDC_CLIENT_ID`;
- `exp`, `iat`, `sub`, `tenant_id`, `roles` and `access_level` are required;
- `x-role`, `x-department` and `x-access-level` headers are ignored in OIDC mode;
- optional `x-tenant-id` must match the token tenant;
- invalid token returns `401`;
- tenant mismatch returns `403`.

Remote `SYMBIOT_OIDC_JWKS_URL` remains the required production configuration. Inline `SYMBIOT_OIDC_JWKS_JSON` is allowed only for local reproducible evidence and automated tests.

## Standards Mapping

| Standard | Control focus |
|---|---|
| OWASP ASVS V2 | authentication source and token validation |
| OWASP ASVS V3 | session binding and lifecycle |
| OWASP ASVS V4 | role/tenant authorization |
| OWASP ASVS V10 | audit logging and redaction |
| ISO/IEC/IEEE 12207 | architecture, configuration, verification and operation evidence |
| NIST AI RMF Govern/Map/Manage | identity governance for AI-enabled workflows and client-data controls |

## Stop Conditions

Client-data pilot is blocked until:

- OIDC issuer, client id and JWKS URL are configured;
- JWT signature and issuer/audience validation are implemented;
- role claims are mapped into the runtime role directory;
- tenant mismatch is rejected by tests;
- admin, secrets, RAG, file upload and audit APIs require verified identity;
- session and access events are captured in the audit chain.

## Consequences

Positive:

- production authentication is separated from MVP demo mode;
- the dashboard can show honest IAM readiness;
- compliance evidence can prove whether identity is demo or production.

Trade-offs:

- true SSO setup requires an external identity provider decision;
- local demo remains useful, but cannot be marketed as production security.

## Evidence

This ADR is implemented as a design/status layer in `ENG-SaaS-0027`. Production SSO integration remains a later implementation task.

`ENG-SaaS-0028` implements and tests verified JWT validation. External identity provider selection and remote JWKS production setup remain open.

`ENG-SaaS-0029` selects Keycloak as baseline IdP and captures remote JWKS validation evidence. See `ADR-003_PRODUCTION_IDP_KEYCLOAK_REMOTE_JWKS.md`.
