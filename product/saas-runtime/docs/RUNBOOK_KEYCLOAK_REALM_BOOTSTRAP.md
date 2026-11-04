# Runbook: Keycloak Realm Bootstrap Package

Status: G3 engineering baseline.

This runbook describes the reproducible Keycloak realm package for Symbiot Runtime.

## Files

```text
config/keycloak/symbiot-realm.json
```

The package contains:

- realm `symbiot`;
- OIDC client `symbiot-runtime`;
- runtime roles: `admin`, `role-admin`, `runtime-operator`, `qa-lead`, `observer`;
- required claims: `tenant_id`, `roles`, `access_level`;
- disabled bootstrap users for admin/operator/QA checks.

## Local Dev Import

Start local Keycloak:

```powershell
docker compose --profile idp up keycloak
```

Then import `config/keycloak/symbiot-realm.json` through the Keycloak admin console or through the Keycloak admin CLI.

Local dev URL:

```text
http://127.0.0.1:8080
```

## Production Requirements

Before client pilot:

- replace example redirect URI and web origin with the real HTTPS Runtime domain;
- create a real confidential client secret;
- create real users or connect federation;
- enforce MFA for admin/role-admin users;
- configure HTTPS Keycloak hostname;
- set Runtime environment:

```text
SYMBIOT_IDENTITY_PROVIDER_MODE=oidc_jwt
SYMBIOT_OIDC_PROVIDER=keycloak
SYMBIOT_OIDC_ISSUER=https://idp.example.ru/realms/symbiot
SYMBIOT_OIDC_CLIENT_ID=symbiot-runtime
SYMBIOT_OIDC_AUDIENCE=symbiot-runtime
SYMBIOT_OIDC_JWKS_URL=https://idp.example.ru/realms/symbiot/protocol/openid-connect/certs
```

## Runtime Check

Control endpoint:

```text
/api/security/identity-provider/keycloak-bootstrap
```

Acceptance:

- `bootstrap_package_ready=true`;
- `realm_ready=true`;
- `client_ready=true`;
- `roles_ready=true`;
- `claims_ready=true`;
- `bootstrap_users_ready=true`;
- production pilot additionally requires `production_endpoint_ready=true`.
