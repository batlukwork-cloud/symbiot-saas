from app.schemas import (
    Artifact,
    AuditEvent,
    DocumentRecord,
    GateResult,
    LlmGatewayEvidence,
    ProcessCard,
    QualityEvidence,
    RagChunk,
    RagSearchResponse,
    RuntimeEvidence,
    StageStatus,
    TaskRun,
)


PROCESSES = [
    ProcessCard(
        id="commercial-proposal",
        version="1.0.0",
        name="Коммерческое предложение",
        category="Продажи",
        description="Собрать КП на основе данных клиента, продуктовой базы, условий сделки и шаблонов.",
        expected_output="DOCX/PDF artifact with sources, checks, warnings and version.",
        required_inputs=["client_name", "need", "product", "deadline"],
    )
]

DOCUMENTS = [
    DocumentRecord(id="doc-demo-001", name="Продуктовая база demo.md", type="md", index_status="indexed", access_scope="tenant:demo")
]

RAG_CHUNKS = [
    RagChunk(
        id="chunk-demo-001",
        document_id="doc-demo-001",
        title="Продуктовая база demo.md",
        text="Symbiot Runtime собирает процесс, источники, LLM-черновик, gate-проверки, artifact и audit trail.",
        score=0.92,
        access_scope="tenant:demo",
    ),
    RagChunk(
        id="chunk-demo-002",
        document_id="doc-demo-001",
        title="Продуктовая база demo.md",
        text="MVP path должен доказываться evidence: API response, UI screenshot, build, hashes and audit events.",
        score=0.86,
        access_scope="tenant:demo",
    ),
]

PASSED_GATE = GateResult(
    id="gate-source-coverage",
    title="Source Coverage Gate",
    status="passed",
    reason="Demo source chunks are available for the selected process.",
)

SECRETS_GATE = GateResult(
    id="gate-secrets-redaction",
    title="Secrets Redaction Gate",
    status="passed",
    reason="Provider evidence confirms that secrets are redacted from audit payloads.",
)

TENANT_GATE = GateResult(
    id="gate-tenant-scope",
    title="Tenant Scope Gate",
    status="passed",
    reason="RAG chunks are limited to tenant:demo scope.",
)

TASK_RUNS = {
    "run-demo-001": TaskRun(
        id="run-demo-001",
        process_id="commercial-proposal",
        profile_id="working",
        status="completed",
        stages=[
            StageStatus(id="input", title="Input completeness", status="completed"),
            StageStatus(id="rag", title="RAG source search", status="completed"),
            StageStatus(id="llm", title="LLM draft generation", status="completed"),
            StageStatus(id="gates", title="Quality gates", status="completed"),
            StageStatus(id="artifact", title="Artifact assembly", status="completed"),
        ],
        gates=[PASSED_GATE, SECRETS_GATE, TENANT_GATE],
        artifact_id="artifact-demo-001",
    )
}

ARTIFACTS = {
    "artifact-demo-001": Artifact(
        id="artifact-demo-001",
        task_run_id="run-demo-001",
        version="0.1-demo",
        title="Коммерческое предложение demo",
        content="Demo artifact assembled through Catalog -> Wizard -> TaskRun -> RAG/LLM -> Gates -> Artifact with evidence captured for G3.",
        sources=["doc-demo-001", "chunk-demo-001", "chunk-demo-002"],
        checks=[PASSED_GATE, SECRETS_GATE, TENANT_GATE],
    )
}

AUDIT_EVENTS = [
    AuditEvent(
        id="audit-demo-001",
        actor="demo-user",
        action="task_run.completed",
        target="run-demo-001",
        redacted_payload={"artifact_id": "artifact-demo-001", "secrets": "[redacted]"},
    )
]

RAG_RESPONSES = {
    "run-demo-001": RagSearchResponse(
        query="Symbiot Runtime MVP path",
        chunks=RAG_CHUNKS,
        min_score=0.75,
        source_coverage="passed",
    )
}

LLM_EVIDENCE = {
    "run-demo-001": LlmGatewayEvidence(
        task_run_id="run-demo-001",
        provider_id="mock-provider",
        provider_type="mock",
        model="mock-g3-runtime-v0",
        prompt_template_version="runtime-mvp-path-v0.1",
        input_tokens_estimate=620,
        output_tokens_estimate=210,
        fallback_used=False,
        secrets_redacted=True,
        response_status="completed",
    )
}

QUALITY_EVIDENCE = {
    "run-demo-001": QualityEvidence(
        task_run_id="run-demo-001",
        gates=[PASSED_GATE, SECRETS_GATE, TENANT_GATE],
        overall_status="passed",
        evidence_summary="Demo run passed source coverage, secrets redaction and tenant scope gates.",
    )
}

RUNTIME_EVIDENCE = {
    "run-demo-001": RuntimeEvidence(
        task_run_id="run-demo-001",
        rag=RAG_RESPONSES["run-demo-001"],
        llm=LLM_EVIDENCE["run-demo-001"],
        quality=QUALITY_EVIDENCE["run-demo-001"],
        audit_event_ids=["audit-demo-001"],
    )
}
