# Runbook: Keycloak OIDC Setup for Symbiot Runtime

Date: 2026-07-02
Status: MVP production-baseline runbook

## 1. Local Engineering Check

Start local Keycloak profile only for development:

```powershell
docker compose --profile idp up keycloak
```

Local URL:

```text
http://127.0.0.1:8080
```

The docker-compose profile uses `start-dev`. Do not use this mode for production.

## 2. Production Realm

Create realm:

```text
symbiot
```

Create OIDC client:

```text
symbiot-runtime
```

Expected issuer:

```text
https://idp.example.ru/realms/symbiot
```

Expected JWKS URL:

```text
https://idp.example.ru/realms/symbiot/protocol/openid-connect/certs
```

## 3. Required Claims

Access token must include:

- `sub`;
- `email`;
- `tenant_id`;
- `roles`;
- `department`;
- `access_level`;
- `iat`;
- `exp`.

Runtime maps:

| Claim | Runtime field |
|---|---|
| `email` or `sub` | `actor` |
| `roles[0]` | `role` |
| `department` | `department` |
| `access_level` | `access_level` |
| `tenant_id` | `tenant_id` |
| `jti` or `sub` | `session_id` |

## 4. Runtime Environment

```text
SYMBIOT_IDENTITY_PROVIDER_MODE=oidc_jwt
SYMBIOT_OIDC_PROVIDER=keycloak
SYMBIOT_OIDC_ISSUER=https://idp.example.ru/realms/symbiot
SYMBIOT_OIDC_CLIENT_ID=symbiot-runtime
SYMBIOT_OIDC_AUDIENCE=symbiot-runtime
SYMBIOT_OIDC_JWKS_URL=https://idp.example.ru/realms/symbiot/protocol/openid-connect/certs
```

## 5. Acceptance Tests

Before client pilot:

- valid signed JWT returns `200`;
- no token returns `401`;
- wrong audience returns `401`;
- expired token returns `401`;
- tenant mismatch returns `403`;
- admin API requires `roles` containing `admin` and `access_level=admin`;
- Runtime status shows `provider=keycloak`;
- Runtime status shows `jwks_source=remote_jwks_url`;
- Runtime status shows `production_sso_ready=true`.

## 6. Production Hardening

Before external pilot:

- use HTTPS;
- configure fixed hostname;
- use production database;
- configure backup;
- configure admin recovery;
- restrict admin console;
- enable audit logs;
- document user lifecycle: invite, disable, role change, tenant change.
