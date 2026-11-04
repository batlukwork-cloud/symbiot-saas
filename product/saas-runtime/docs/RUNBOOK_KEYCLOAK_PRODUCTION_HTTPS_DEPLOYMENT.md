# Runbook: Keycloak Production HTTPS Deployment Readiness

Status: G3 deployment readiness package.

This runbook turns the Keycloak bootstrap package into a production HTTPS deployment candidate.

## Official Baseline

- Keycloak production environments require secure communication over HTTPS.
- Keycloak production hostname must be explicit and correctly configured.
- Reverse proxy headers must be set and overwritten by the proxy.
- Management port must not be exposed publicly.

Official references:

- `https://www.keycloak.org/server/configuration-production`
- `https://www.keycloak.org/server/hostname`
- `https://www.keycloak.org/server/reverseproxy`

## Files

```text
docker-compose.production.keycloak.yml
config/keycloak/Caddyfile
config/keycloak/production.env.example
config/keycloak/symbiot-realm.json
```

## Deployment Steps

1. Point DNS `idp.your-domain.ru` to the production server.
2. Copy `config/keycloak/production.env.example` to a secrets-managed `.env.production.keycloak`.
3. Replace every password and domain placeholder.
4. Start Keycloak with:

```powershell
docker compose --env-file .env.production.keycloak -f docker-compose.production.keycloak.yml up -d
```

5. Verify JWKS:

```text
https://idp.your-domain.ru/realms/symbiot/protocol/openid-connect/certs
```

6. Configure Runtime:

```text
SYMBIOT_IDENTITY_PROVIDER_MODE=oidc_jwt
SYMBIOT_OIDC_PROVIDER=keycloak
SYMBIOT_OIDC_ISSUER=https://idp.your-domain.ru/realms/symbiot
SYMBIOT_OIDC_CLIENT_ID=symbiot-runtime
SYMBIOT_OIDC_AUDIENCE=symbiot-runtime
SYMBIOT_OIDC_JWKS_URL=https://idp.your-domain.ru/realms/symbiot/protocol/openid-connect/certs
SYMBIOT_OIDC_JWKS_JSON=
```

## Runtime Readiness Check

Control endpoint:

```text
/api/security/identity-provider/production-readiness
```

Acceptance:

- `mode=oidc_jwt`;
- `provider=keycloak`;
- `issuer_policy.production_like=true`;
- `jwks_policy.production_like=true`;
- `inline_jwks_disabled=true`;
- `jwks_live.reachable=true`;
- `jwks_live.keys_total > 0`;
- `bootstrap_package_ready=true`;
- `production_endpoint_ready=true`.

## Stop Condition

Do not start a client pilot while `production_endpoint_ready=false`.
