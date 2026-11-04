from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas import Artifact, AuditEvent, GateResult, ResultActionDecisionRequest, StageStatus, TaskRun, TaskRunCreate
from app.services.mock_store import ARTIFACTS, AUDIT_EVENTS, RAG_CHUNKS, TASK_RUNS
from app.services.security_context import RuntimeSession
from app.services.task_run_store import list_result_action_records, save_task_run_bundle


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _artifact_title(payload: TaskRunCreate) -> str:
    expected = str(payload.form_data.get("expected_artifact") or "").strip()
    if expected:
        return expected
    goal = str(payload.form_data.get("goal") or "").strip()
    return f"Результат задачи: {goal[:70]}" if goal else "Результат задачи Симбиота"


def _artifact_content(payload: TaskRunCreate, session: RuntimeSession) -> str:
    goal = str(payload.form_data.get("goal") or "не указана").strip()
    source_context = str(payload.form_data.get("source_context") or "без дополнительных источников").strip()
    urgency = str(payload.form_data.get("urgency") or "normal").strip()
    return (
        "Симбиот выполнил управляемый TaskRun и собрал первый проверяемый артефакт.\n"
        f"Цель: {goal}.\n"
        f"Контекст/источники: {source_context}.\n"
        f"Срочность: {urgency}.\n"
        f"Исполнительский контур: роль {session.role}, департамент {session.department}, tenant {session.tenant_id}.\n"
        "Следующее действие выбирается в Result Center: принять, вернуть на доработку или создать следующую задачу."
    )


def create_managed_task_run(payload: TaskRunCreate, session: RuntimeSession) -> TaskRun:
    task_run_id = _new_id("run")
    artifact_id = _new_id("artifact")

    gates = [
        GateResult(
            id="gate-managed-taskrun-created",
            title="Managed TaskRun Created",
            status="passed",
            reason="TaskRun has a unique runtime id and is not a demo fallback copy.",
        ),
        GateResult(
            id="gate-artifact-attached",
            title="Artifact Attached",
            status="passed",
            reason="A user-visible artifact is generated and attached to this TaskRun.",
        ),
        GateResult(
            id="gate-tenant-bound",
            title="Tenant Bound",
            status="passed",
            reason=f"TaskRun is executed inside tenant scope {session.tenant_id}.",
        ),
    ]
    task_run = TaskRun(
        id=task_run_id,
        process_id=payload.process_id,
        profile_id=payload.profile_id,
        status="completed",
        stages=[
            StageStatus(id="input", title="Input completeness", status="completed"),
            StageStatus(id="workgroup", title="Workgroup selected", status="completed"),
            StageStatus(id="execution", title="Managed execution", status="completed"),
            StageStatus(id="gates", title="Quality gates", status="completed"),
            StageStatus(id="artifact", title="Artifact assembly", status="completed"),
        ],
        gates=gates,
        artifact_id=artifact_id,
        form_data=dict(payload.form_data),
    )

    source_ids = [*payload.document_ids]
    if not source_ids:
        source_ids = [chunk.id for chunk in RAG_CHUNKS[:2]]

    artifact = Artifact(
        id=artifact_id,
        task_run_id=task_run_id,
        version="0.1-runtime",
        title=_artifact_title(payload),
        content=_artifact_content(payload, session),
        sources=source_ids,
        checks=gates,
    )

    audit_event = AuditEvent(
        id=_new_id("audit"),
        actor=session.actor,
        action="task_run.completed",
        target=task_run_id,
        redacted_payload={
            "artifact_id": artifact_id,
            "process_id": payload.process_id,
            "profile_id": payload.profile_id,
            "tenant_id": session.tenant_id,
            "created_at": datetime.now(UTC).isoformat(),
            "form_data_keys": sorted(payload.form_data.keys()),
            "secrets": "[redacted]",
        },
    )

    TASK_RUNS[task_run_id] = task_run
    ARTIFACTS[artifact_id] = artifact
    AUDIT_EVENTS.append(audit_event)
    save_task_run_bundle(task_run, artifact, audit_event)
    return task_run


def _clean_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _decode_workspace_payload(comment: str | None) -> dict[str, str]:
    if not comment:
        return {}
    try:
        payload = json.loads(comment)
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        str(key): text
        for key, value in payload.items()
        if (text := _clean_optional_text(value)) is not None
    }


def _latest_persisted_next_step_review(task_run_id: str) -> dict[str, str]:
    action_history = list_result_action_records(task_run_id)
    for record in reversed(action_history):
        if record.action_id != "workspace-next-step-review-confirm":
            continue
        payload = _decode_workspace_payload(record.comment)
        if payload.get("goal") or payload.get("expected_artifact"):
            return payload
    return {}


def create_followup_task_run(
    source_task_run: TaskRun,
    session: RuntimeSession,
    decision: ResultActionDecisionRequest | None = None,
) -> TaskRun:
    decision = decision or ResultActionDecisionRequest()
    persisted_review = _latest_persisted_next_step_review(source_task_run.id)
    explicit_goal = _clean_optional_text(decision.followup_goal)
    explicit_expected_artifact = _clean_optional_text(decision.followup_expected_artifact)
    explicit_source_context = _clean_optional_text(decision.followup_source_context)
    explicit_urgency = _clean_optional_text(decision.followup_urgency)
    followup_payload_source = (
        "request"
        if explicit_goal or explicit_expected_artifact or explicit_source_context or explicit_urgency
        else "workspace-next-step-review-confirm"
        if persisted_review
        else "default"
    )
    goal = (
        explicit_goal
        or persisted_review.get("goal")
        or f"Продолжить работу на базе результата {source_task_run.id}"
    )
    expected_artifact = (
        explicit_expected_artifact
        or persisted_review.get("expected_artifact")
        or "Следующий управляемый артефакт по принятому результату"
    )
    source_context = (
        explicit_source_context
        or persisted_review.get("source_context")
        or f"Follow-up TaskRun created from Result Center action for {source_task_run.id}"
    )
    urgency = explicit_urgency or persisted_review.get("urgency") or "follow-up"
    inherited_context = {
        key: value
        for key, value in source_task_run.form_data.items()
        if key in {"business_mission_id", "scenario_pack_id", "role_pack_id", "selected_workgroup"}
    }
    payload = TaskRunCreate(
        process_id=source_task_run.process_id,
        profile_id=source_task_run.profile_id,
        form_data={
            **inherited_context,
            "goal": goal,
            "expected_artifact": expected_artifact,
            "source_context": source_context,
            "urgency": urgency,
            "source_task_run_id": source_task_run.id,
            "followup_payload_source": followup_payload_source,
            "followup_source_label": persisted_review.get("source_label", ""),
        },
        document_ids=[source_task_run.artifact_id] if source_task_run.artifact_id else [],
    )
    return create_managed_task_run(payload, session)
