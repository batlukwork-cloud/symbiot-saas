from __future__ import annotations

import re
from datetime import datetime, timezone

from app.schemas import (
    ExportDecision,
    GateResult,
    HumanApprovalRecord,
    PiiClassificationEvidence,
    PiiFinding,
)


CLASSIFICATIONS: dict[str, PiiClassificationEvidence] = {}
APPROVALS: dict[str, HumanApprovalRecord] = {}
EXPORTS: dict[str, ExportDecision] = {}
RAG_RELEASES: dict[str, dict[str, str]] = {}


PII_PATTERNS: list[tuple[str, str, str, str, re.Pattern[str]]] = [
    ("email", "Email", "medium", "[email]", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("phone", "Phone", "high", "[phone]", re.compile(r"(?<!\d)(?:\+7|8)[\s(.-]*\d{3}[\s). -]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)")),
    ("passport_ru", "Russian passport", "critical", "[passport]", re.compile(r"(?<!\d)\d{2}\s?\d{2}\s?\d{6}(?!\d)")),
    ("snils", "SNILS", "critical", "[snils]", re.compile(r"(?<!\d)\d{3}-\d{3}-\d{3}\s?\d{2}(?!\d)")),
    ("inn_person", "Personal INN", "high", "[inn]", re.compile(r"(?<!\d)\d{12}(?!\d)")),
]

SEVERITY_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_id(prefix: str, store: dict[str, object]) -> str:
    return f"{prefix}-{len(store) + 1:03d}"


def _risk_level(findings: list[PiiFinding]) -> str:
    risk = "none"
    for finding in findings:
        if SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[risk]:
            risk = finding.severity
    return risk


def classify_text(
    *,
    text: str,
    artifact_id: str | None,
    access_scope: str,
    purpose: str,
) -> PiiClassificationEvidence:
    findings: list[PiiFinding] = []
    redacted_text = text
    replacements: list[tuple[int, int, str]] = []

    for pii_type, label, severity, token, pattern in PII_PATTERNS:
        for match in pattern.finditer(text):
            preview = match.group(0)
            findings.append(
                PiiFinding(
                    id=f"pii-{len(findings) + 1:03d}",
                    pii_type=pii_type,
                    label=label,
                    severity=severity,
                    evidence_preview=preview[:3] + "***" + preview[-2:],
                    start=match.start(),
                    end=match.end(),
                    confidence=0.92,
                )
            )
            replacements.append((match.start(), match.end(), token))

    for start, end, token in sorted(replacements, reverse=True):
        redacted_text = redacted_text[:start] + token + redacted_text[end:]

    risk = _risk_level(findings)
    gates = [
        GateResult(
            id="gate-pii-classifier",
            title="PII Classifier Gate",
            status="passed",
            reason=f"Classifier executed; findings={len(findings)}; risk={risk}.",
        ),
        GateResult(
            id="gate-pii-redaction",
            title="PII Redaction Gate",
            status="passed" if findings else "warning",
            reason="PII tokens are redacted before export decision." if findings else "No PII found in submitted text.",
        ),
    ]

    record = PiiClassificationEvidence(
        id=_next_id("pii-classification", CLASSIFICATIONS),
        artifact_id=artifact_id,
        access_scope=access_scope,
        purpose=purpose,
        pii_detected=bool(findings),
        risk_level=risk,  # type: ignore[arg-type]
        findings=findings,
        redacted_text=redacted_text,
        asvs_controls=["ASVS V8 Data Protection", "ASVS V10 Logging", "ASVS V13 API"],
        nist_controls=["NIST AI RMF Govern", "NIST AI RMF Map", "NIST AI RMF Manage"],
        gates=gates,
    )
    CLASSIFICATIONS[record.id] = record
    return record


def create_approval(
    *,
    artifact_id: str,
    classification_id: str,
    requester: str,
    reviewer: str,
    purpose: str,
) -> HumanApprovalRecord:
    record = HumanApprovalRecord(
        id=_next_id("approval", APPROVALS),
        artifact_id=artifact_id,
        classification_id=classification_id,
        requester=requester,
        reviewer=reviewer,
        purpose=purpose,
        status="pending",
        created_at=_now(),
    )
    APPROVALS[record.id] = record
    return record


def approval_required(classification: PiiClassificationEvidence) -> bool:
    return classification.pii_detected or classification.risk_level in {"high", "critical"}


def create_rag_approval_if_required(
    *,
    artifact_id: str,
    classification: PiiClassificationEvidence,
    requester: str = "runtime-system",
    reviewer: str = "Dmitry",
    purpose: str = "rag_ingest_client_data",
) -> HumanApprovalRecord | None:
    if not approval_required(classification):
        return None
    return create_approval(
        artifact_id=artifact_id,
        classification_id=classification.id,
        requester=requester,
        reviewer=reviewer,
        purpose=purpose,
    )


def approve_request(*, approval_id: str, reviewer: str, decision_comment: str) -> HumanApprovalRecord:
    if approval_id not in APPROVALS:
        raise ValueError(f"Approval request not found: {approval_id}")
    current = APPROVALS[approval_id]
    approved = current.model_copy(
        update={
            "reviewer": reviewer,
            "status": "approved",
            "decided_at": _now(),
            "decision_comment": decision_comment,
        }
    )
    APPROVALS[approval_id] = approved
    return approved


def get_classification(classification_id: str) -> PiiClassificationEvidence | None:
    return CLASSIFICATIONS.get(classification_id)


def get_approval(approval_id: str) -> HumanApprovalRecord | None:
    return APPROVALS.get(approval_id)


def record_rag_release(*, source_id: str, source_type: str, approval_id: str, document_id: str) -> None:
    RAG_RELEASES[source_id] = {
        "source_id": source_id,
        "source_type": source_type,
        "approval_id": approval_id,
        "document_id": document_id,
        "released_at": _now(),
    }


def decide_export(
    *,
    artifact_id: str,
    classification_id: str,
    approval_id: str | None,
    channel: str,
) -> ExportDecision:
    classification = CLASSIFICATIONS[classification_id]
    approval = APPROVALS.get(approval_id or "")
    approval_passed = approval is not None and approval.status == "approved"
    requires_approval = classification.pii_detected or classification.risk_level in {"high", "critical"}
    allowed = not requires_approval or approval_passed

    gates = [
        GateResult(
            id="gate-pii-redaction",
            title="PII Redaction Gate",
            status="passed",
            reason="Export decision uses redacted content only.",
        ),
        GateResult(
            id="gate-human-approval",
            title="Human Approval Gate",
            status="passed" if approval_passed else "warning",
            reason="Named reviewer approved external use." if approval_passed else "PII requires human approval before export.",
            action=None if approval_passed else "Create and approve a human approval request.",
        ),
        GateResult(
            id="gate-export-block",
            title="Export Block Gate",
            status="passed",
            reason="Export was allowed after approval." if allowed else "Export is blocked until human approval is completed.",
            action=None if allowed else "Keep artifact inside tenant draft zone.",
        ),
    ]

    decision = ExportDecision(
        id=_next_id("export", EXPORTS),
        artifact_id=artifact_id,
        channel=channel,
        status="allowed" if allowed else "blocked",
        reason="Human approval satisfied." if allowed else "PII detected and approval is missing or pending.",
        classification_id=classification_id,
        approval_id=approval_id,
        redacted_content=classification.redacted_text if allowed else None,
        gates=gates,
    )
    EXPORTS[decision.id] = decision
    return decision


def data_protection_status() -> dict[str, object]:
    blocked = sum(1 for export in EXPORTS.values() if export.status == "blocked")
    pending = sum(1 for approval in APPROVALS.values() if approval.status == "pending")
    gates = [
        GateResult(
            id="gate-pii-classifier",
            title="PII Classifier Gate",
            status="passed",
            reason="Rule-based MVP classifier is executable and returns typed findings.",
        ),
        GateResult(
            id="gate-human-approval",
            title="Human Approval Gate",
            status="passed" if APPROVALS else "warning",
            reason="Approval workflow is executable." if APPROVALS else "No approval evidence has been created in this runtime session.",
        ),
        GateResult(
            id="gate-client-data-rag-approval",
            title="Client Data RAG Approval Gate",
            status="passed" if RAG_RELEASES else "warning",
            reason="At least one client-data source was released into RAG only after named approval."
            if RAG_RELEASES
            else "No approved client-data RAG release evidence has been created in this runtime session.",
        ),
        GateResult(
            id="gate-export-block",
            title="Export Block Gate",
            status="passed" if EXPORTS else "warning",
            reason="Export decisions enforce block/allow logic." if EXPORTS else "No export decision evidence has been created in this runtime session.",
        ),
    ]
    return {
        "classifier": "symbiot-rule-pii-classifier-v0.1",
        "approvals_total": len(APPROVALS),
        "pending_approvals": pending,
        "exports_total": len(EXPORTS),
        "blocked_exports": blocked,
        "rag_releases_total": len(RAG_RELEASES),
        "client_data_ready": bool(CLASSIFICATIONS and APPROVALS and RAG_RELEASES),
        "client_data_condition": "Client data can enter RAG only through classification and named human approval.",
        "gates": gates,
    }
