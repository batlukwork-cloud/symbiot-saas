# MVP Data Model

## Entities

| Entity | Purpose | G2 Control |
|---|---|---|
| Tenant | Client workspace and data boundary | Tenant isolation |
| User | Runtime user | RBAC / ASVS |
| Role | Permission group | Access control |
| Process | Business process card | Protected process logic boundary |
| ExecutionProfile | Runtime policy: speed, quality, gates, cost | AI Governance |
| TaskRun | One execution of a process | State recovery |
| Document | Uploaded knowledge source | File upload security |
| SourceChunk | RAG fragment | RAG access filtering |
| PiiClassificationEvidence | PII findings, redacted text and risk level | Client-data RAG approval gate |
| HumanApprovalRecord | Named human decision before risky RAG/export use | NIST AI RMF Manage / ASVS data protection |
| RagApprovalReleaseEvidence | Evidence that client data entered RAG only after approval | Release evidence |
| GateResult | Quality gate evidence | NIST Measure/Manage |
| Artifact | Versioned task result | Result evidence |
| LLMProvider | Provider configuration without secrets | Secrets storage |
| AuditEvent | Redacted event trail | Immutable audit |
