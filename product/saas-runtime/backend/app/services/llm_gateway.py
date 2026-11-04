import os

from app.schemas import LlmGatewayEvidence, LlmProviderConfig


def _provider_registry() -> list[LlmProviderConfig]:
    base_url = os.getenv("SYMBIOT_LLM_BASE_URL", "").strip()
    api_key = os.getenv("SYMBIOT_LLM_API_KEY", "").strip()
    model = os.getenv("SYMBIOT_LLM_MODEL", "provider-selected").strip() or "provider-selected"
    provider_enabled = bool(base_url and api_key)
    return [
        LlmProviderConfig(
        id="mock-provider",
        provider_type="mock",
        status="enabled",
        model="mock-g3-runtime-v0",
        base_url_configured=False,
        api_key_configured=False,
        secrets_redacted=True,
        fallback_priority=1,
        asvs_controls=["ASVS-2.10 secrets storage", "ASVS-10.3 logging privacy"],
        nist_controls=["NIST AI RMF Govern", "NIST AI RMF Measure"],
    ),
    LlmProviderConfig(
        id="openai-compatible-primary",
        provider_type="openai_compatible",
        status="enabled" if provider_enabled else "not_configured",
        model=model,
        base_url_configured=bool(base_url),
        api_key_configured=bool(api_key),
        secrets_redacted=True,
        fallback_priority=2,
        asvs_controls=["ASVS-2.10 secrets storage", "ASVS-13 API security"],
        nist_controls=["NIST AI RMF Map", "NIST AI RMF Manage"],
    ),
    ]


def list_providers() -> list[LlmProviderConfig]:
    return _provider_registry()


def get_provider(provider_id: str = "mock-provider") -> LlmProviderConfig:
    providers = _provider_registry()
    return next((provider for provider in providers if provider.id == provider_id), providers[0])


def get_llm_evidence(task_run_id: str, provider_id: str = "mock-provider") -> LlmGatewayEvidence:
    requested_provider = get_provider(provider_id)
    provider = requested_provider if requested_provider.status == "enabled" else get_provider("mock-provider")
    return LlmGatewayEvidence(
        task_run_id=task_run_id,
        provider_id=provider.id,
        provider_type=provider.provider_type,
        model=provider.model,
        prompt_template_version="runtime-mvp-path-v0.2",
        input_tokens_estimate=740,
        output_tokens_estimate=260,
        fallback_used=provider.id != requested_provider.id,
        secrets_redacted=provider.secrets_redacted,
        response_status="completed" if provider.id == requested_provider.id else "fallback",
    )
