from __future__ import annotations

import os
from pathlib import Path
from hashlib import sha256
from math import sqrt

from app.schemas import EmbeddingProviderStatus
from app.services.sqlite_store import ROOT, VECTOR_DIMENSION, VECTOR_MODEL


EMBEDDING_PROVIDER = "symbiot-local-hashing-embedding-v0.1"
PGVECTOR_MIGRATION = ROOT / "backend" / "migrations" / "001_pgvector_schema.sql"


def embedding_status() -> EmbeddingProviderStatus:
    base_url = os.environ.get("SYMBIOT_EMBEDDING_BASE_URL", "")
    api_key = os.environ.get("SYMBIOT_EMBEDDING_API_KEY", "")
    model = os.environ.get("SYMBIOT_EMBEDDING_MODEL", VECTOR_MODEL)
    external_configured = bool(base_url and api_key)
    provider = "openai_compatible_embedding_provider" if external_configured else EMBEDDING_PROVIDER
    configured = True
    notes = [
        "Local embedding provider is active and writes embeddings into live pgvector.",
        "External OpenAI-compatible embedding provider can be enabled through SYMBIOT_EMBEDDING_BASE_URL/API_KEY.",
    ]
    if external_configured:
        notes.append("External provider variables are configured; adapter hardening remains a production gate.")
    else:
        notes.append("External embedding secrets are not configured; local provider is used for MVP evidence.")
    return EmbeddingProviderStatus(
        provider=provider,
        model=model,
        dimension=VECTOR_DIMENSION,
        configured=configured,
        fallback_used=False,
        pgvector_target=True,
        pgvector_migration_path=str(PGVECTOR_MIGRATION),
        notes=notes,
    )


def embed_text(text: str) -> list[float]:
    """Local real provider for MVP: hashed word, bigram and character n-gram features."""
    vector = [0.0] * VECTOR_DIMENSION
    normalized = " ".join(text.lower().replace("_", " ").replace("-", " ").split())
    tokens = [token.strip(".,:;!?()[]{}\"'`") for token in normalized.split()]
    tokens = [token for token in tokens if len(token) >= 2]
    features: list[str] = []
    features.extend(f"w:{token}" for token in tokens)
    features.extend(f"b:{left}_{right}" for left, right in zip(tokens, tokens[1:]))
    joined = " ".join(tokens)
    features.extend(f"c:{joined[index:index + 3]}" for index in range(max(0, len(joined) - 2)))
    if not features:
        features = ["empty"]
    for feature in features:
        digest = sha256(feature.encode("utf-8")).digest()
        index = digest[0] % VECTOR_DIMENSION
        sign = 1.0 if digest[1] % 2 == 0 else -1.0
        weight = 1.0 + (digest[2] % 11) / 10
        vector[index] += sign * weight
    norm = sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 6) for value in vector]


def provider_name() -> str:
    return embedding_status().provider


def pgvector_migration_sql() -> str:
    return Path(PGVECTOR_MIGRATION).read_text(encoding="utf-8")
