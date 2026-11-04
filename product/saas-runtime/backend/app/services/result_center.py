import json

from app.schemas import (
    AcceptanceDecisionImpactItem,
    AcceptanceDecisionRouteOption,
    AcceptanceDecisionState,
    AccumulatedBusinessAssetItem,
    AccumulatedBusinessAssetWorkspaceState,
    BusinessAssetDecisionItem,
    BusinessAssetDecisionWorkspaceState,
    BusinessAssetGAcceptancePackageItem,
    BusinessAssetGAcceptancePackageWorkspaceState,
    BusinessAssetGCheckHandoffItem,
    BusinessAssetGCheckHandoffWorkspaceState,
    BusinessAssetGDecisionChecklistItem,
    BusinessAssetGDecisionChecklistWorkspaceState,
    BusinessAssetGDecisionDraftOption,
    BusinessAssetGDecisionDraftWorkspaceState,
    BusinessAssetGDecisionImpactItem,
    BusinessAssetGDecisionImpactWorkspaceState,
    BusinessAssetGDecisionReadinessItem,
    BusinessAssetGDecisionReadinessWorkspaceState,
    BusinessAssetGDecisionReviewSummaryItem,
    BusinessAssetGDecisionReviewSummaryWorkspaceState,
    BusinessAssetGReviewExecutionItem,
    BusinessAssetGReviewExecutionWorkspaceState,
    BusinessAssetManualReviewItem,
    BusinessAssetManualReviewWorkspaceState,
    BusinessAssetRouteOutcomeItem,
    BusinessAssetRouteOutcomeWorkspaceState,
    CycleAcceptanceWorkspaceItem,
    CycleAcceptanceWorkspaceState,
    CycleContinuityWorkspaceItem,
    CycleContinuityWorkspaceState,
    CycleExecutionBriefItem,
    CycleExecutionBriefState,
    CurrentCycleOutcomeItem,
    CurrentCycleOutcomeWorkspaceState,
    FollowupContinuityState,
    FollowupExecutionWorkspaceItem,
    FollowupExecutionWorkspaceState,
    FollowupLineageItem,
    GateResult,
    OutcomeNextCycleLaunchItem,
    OutcomeNextCycleLaunchPayload,
    OutcomeNextCycleLauncherState,
    PersistedArtifactDraftState,
    PersistedNextStepReviewState,
    ResultAction,
    ResultActionRecord,
    ScenarioResumeState,
    ScenarioResumeStep,
    TaskRunResultCenter,
    UserWorkspacePersistenceState,
)
from app.services.llm_gateway import get_llm_evidence
from app.services.quality_gates import evaluate_task_run
from app.services.rag_index import search
from app.services.task_run_store import (
    get_artifact,
    get_result_action_by_related_task_run_id,
    get_task_run,
    list_audit_events_for_target,
    list_result_action_records,
)


def _dedupe_gates(gates: list[GateResult]) -> list[GateResult]:
    seen: set[str] = set()
    result: list[GateResult] = []
    for gate in gates:
        if gate.id in seen:
            continue
        seen.add(gate.id)
        result.append(gate)
    return result


_ACCEPTANCE_ROUTE_ACTIONS = {
    "acceptance-decision-accept": "accept",
    "acceptance-decision-revise": "revise",
    "acceptance-decision-continue": "continue",
}


def _decode_action_payload(record: ResultActionRecord | None) -> dict[str, str]:
    if record is None or not record.comment:
        return {}
    try:
        payload = json.loads(record.comment)
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(key): "" if value is None else str(value) for key, value in payload.items()}


def _build_acceptance_decision_state(
    *,
    artifact_ready: bool,
    product_status: str,
    action_history: list[ResultActionRecord],
    next_task_available: bool,
) -> AcceptanceDecisionState:
    route_record = next(
        (record for record in reversed(action_history) if record.action_id in _ACCEPTANCE_ROUTE_ACTIONS),
        None,
    )
    selected_route = _ACCEPTANCE_ROUTE_ACTIONS.get(route_record.action_id) if route_record else None
    can_accept = product_status in {"ready_for_acceptance", "accepted"}
    can_revise = artifact_ready
    can_continue = next_task_available or product_status == "accepted"

    route_specs = [
        (
            "accept",
            "Принять",
            "Зафиксировать актив",
            "Результат считается полезным и остается базой клиентского сценария.",
            can_accept,
        ),
        (
            "revise",
            "Поправить",
            "Вернуться к черновику",
            "Пользователь уточняет результат до продолжения сценария.",
            can_revise,
        ),
        (
            "continue",
            "Продолжить",
            "Готовить следующий цикл",
            "Сценарий ведется дальше к следующему бизнес-результату.",
            can_continue,
        ),
    ]
    routes = [
        AcceptanceDecisionRouteOption(
            id=route_id,
            title=title,
            primary=primary,
            detail=detail,
            status=route_id,
            availability="selected" if selected_route == route_id else "available" if available else "blocked",
        )
        for route_id, title, primary, detail, available in route_specs
    ]
    selected_option = next((route for route in routes if route.id == selected_route), routes[0])
    selected_label = selected_option.title if selected_route else "Маршрут не выбран"

    impacts = [
        AcceptanceDecisionImpactItem(
            title="Выбранный маршрут",
            value=selected_option.primary if selected_route else "Нужно выбрать действие",
            detail=selected_option.detail,
            status=selected_route or "review",
        ),
        AcceptanceDecisionImpactItem(
            title="Что станет активом",
            value="Результат TaskRun" if artifact_ready else "Артефакт еще не готов",
            detail="Актив сохраняется как основа клиентского пакета." if artifact_ready else "Сначала нужен созданный артефакт.",
            status="asset",
        ),
        AcceptanceDecisionImpactItem(
            title="Инструкция человеку",
            value=(
                "Можно использовать результат"
                if selected_route == "accept"
                else "Сначала поправить черновик"
                if selected_route == "revise"
                else "Открыть следующий запуск"
                if selected_route == "continue"
                else "Выбрать маршрут приемки"
            ),
            detail="Система хранит решение и возвращает его при повторном открытии Result Center.",
            status="instruction",
        ),
        AcceptanceDecisionImpactItem(
            title="Следующий цикл",
            value="Доступен" if can_continue else "Ожидает приемки",
            detail="Переход к следующему запуску не теряется между сессиями.",
            status="cycle",
        ),
    ]
    checklist = [
        AcceptanceDecisionImpactItem(
            title="Review",
            value="Сохранен" if selected_route else "Ожидает выбора",
            detail=route_record.created_at if route_record else "Нажмите Принять, Поправить или Продолжить.",
            status="review",
        ),
        AcceptanceDecisionImpactItem(
            title="Стоп",
            value="Внутри MVP",
            detail="Ближайшая остановка остается в пользовательском сценарии, без production и внешней отправки.",
            status="stop",
        ),
        AcceptanceDecisionImpactItem(
            title="Готовность",
            value="Можно продолжать" if selected_route else "Нужно решение",
            detail="Выбор маршрута хранится в runtime history Result Center.",
            status="ready",
        ),
    ]
    gates = [
        GateResult(
            id="acceptance-decision-route-recorded",
            title="Acceptance decision route recorded",
            status="passed" if selected_route else "warning",
            reason=(
                f"Selected route: {selected_label}."
                if selected_route
                else "User has not selected a persisted acceptance route yet."
            ),
            action=None if selected_route else "Select accept, revise or continue.",
        ),
        GateResult(
            id="acceptance-decision-route-actionable",
            title="Acceptance decision route actionable",
            status="passed" if any(route.availability != "blocked" for route in routes) else "failed",
            reason="At least one route is available for the current Result Center state.",
            action=None,
        ),
        GateResult(
            id="acceptance-decision-route-local",
            title="Acceptance decision route local",
            status="passed",
            reason="Decision is stored in local MVP runtime action history.",
            action=None,
        ),
    ]
    return AcceptanceDecisionState(
        selected_route=selected_route,
        selected_action_id=route_record.action_id if route_record else None,
        selected_at=route_record.created_at if route_record else None,
        selected_by=route_record.actor if route_record else None,
        summary=(
            f"Маршрут: {selected_label}. Решение сохранено в Result Center."
            if selected_route
            else "Маршрут приемки еще не выбран."
        ),
        routes=routes,
        impacts=impacts,
        checklist=checklist,
        gates=gates,
    )


def _build_user_workspace_state(action_history: list[ResultActionRecord]) -> UserWorkspacePersistenceState:
    artifact_record = next(
        (
            record
            for record in reversed(action_history)
            if record.action_id in {"workspace-artifact-draft-save", "workspace-artifact-draft-reset"}
        ),
        None,
    )
    artifact_payload = _decode_action_payload(artifact_record)
    if artifact_record and artifact_record.action_id == "workspace-artifact-draft-save":
        artifact_draft = PersistedArtifactDraftState(
            status="saved",
            title=artifact_payload.get("title"),
            body=artifact_payload.get("body"),
            next=artifact_payload.get("next"),
            saved_at=artifact_record.created_at,
            saved_by=artifact_record.actor,
            summary="Сохраненная правка черновика восстановлена из Result Center.",
        )
    elif artifact_record and artifact_record.action_id == "workspace-artifact-draft-reset":
        artifact_draft = PersistedArtifactDraftState(
            status="reset",
            saved_at=artifact_record.created_at,
            saved_by=artifact_record.actor,
            summary="Пользователь сбросил черновик к версии Симбиота.",
        )
    else:
        artifact_draft = PersistedArtifactDraftState(
            status="empty",
            summary="Сохраненной правки черновика пока нет.",
        )

    review_record = next(
        (record for record in reversed(action_history) if record.action_id == "workspace-next-step-review-confirm"),
        None,
    )
    review_payload = _decode_action_payload(review_record)
    next_step_review = PersistedNextStepReviewState(
        confirmed=review_record is not None,
        goal=review_payload.get("goal"),
        expected_artifact=review_payload.get("expected_artifact"),
        source_context=review_payload.get("source_context"),
        urgency=review_payload.get("urgency"),
        source_label=review_payload.get("source_label"),
        confirmed_at_label=review_payload.get("confirmed_at_label"),
        confirmed_at=review_record.created_at if review_record else None,
        confirmed_by=review_record.actor if review_record else None,
        summary=(
            "Подтвержденный следующий шаг восстановлен из Result Center."
            if review_record
            else "Следующий шаг еще не подтвержден."
        ),
    )
    gates = [
        GateResult(
            id="workspace-artifact-draft-persisted",
            title="Workspace artifact draft persisted",
            status="passed" if artifact_draft.status == "saved" else "warning",
            reason=artifact_draft.summary,
            action=None if artifact_draft.status == "saved" else "Save artifact draft before relying on it as next-step source.",
        ),
        GateResult(
            id="workspace-next-step-review-persisted",
            title="Workspace next-step review persisted",
            status="passed" if next_step_review.confirmed else "warning",
            reason=next_step_review.summary,
            action=None if next_step_review.confirmed else "Confirm next-step review before creating a follow-up TaskRun.",
        ),
        GateResult(
            id="workspace-state-local-runtime",
            title="Workspace state local runtime",
            status="passed",
            reason="Workspace state is stored through existing local Result Center action history.",
            action=None,
        ),
    ]
    saved_parts = [
        part
        for part, active in [
            ("черновик", artifact_draft.status == "saved"),
            ("review", next_step_review.confirmed),
        ]
        if active
    ]
    return UserWorkspacePersistenceState(
        artifact_draft=artifact_draft,
        next_step_review=next_step_review,
        gates=gates,
        summary="Сохранено: " + ", ".join(saved_parts) if saved_parts else "Рабочее состояние еще не сохранялось.",
    )


def _build_followup_continuity_state(task_run_id: str) -> FollowupContinuityState:
    source_action = get_result_action_by_related_task_run_id(task_run_id)
    if source_action is None:
        return FollowupContinuityState(
            is_followup=False,
            cycle_number=1,
            summary="Этот TaskRun не является открытым follow-up из Result Center.",
            gates=[
                GateResult(
                    id="followup-continuity-not-followup",
                    title="Follow-up continuity not required",
                    status="warning",
                    reason="No parent create-next-task action points to this TaskRun.",
                    action="Create a follow-up TaskRun from Result Center to see continuity context.",
                )
            ],
        )

    lineage: list[FollowupLineageItem] = []
    seen_task_run_ids = {task_run_id}
    current_task_run_id = task_run_id
    immediate_source_action = source_action
    persisted_review: PersistedNextStepReviewState | None = None
    source_artifact_title: str | None = None
    max_depth = 12
    stopped_by_loop = False

    for _ in range(max_depth):
        parent_action = get_result_action_by_related_task_run_id(current_task_run_id)
        if parent_action is None:
            break
        if parent_action.task_run_id in seen_task_run_ids:
            stopped_by_loop = True
            break
        seen_task_run_ids.add(parent_action.task_run_id)
        parent_task_run = get_task_run(parent_action.task_run_id)
        parent_artifact = get_artifact(parent_task_run.artifact_id) if parent_task_run and parent_task_run.artifact_id else None
        parent_action_history = list_result_action_records(parent_action.task_run_id)
        parent_workspace_state = _build_user_workspace_state(parent_action_history)
        parent_review = parent_workspace_state.next_step_review
        if persisted_review is None:
            persisted_review = parent_review
            source_artifact_title = parent_artifact.title if parent_artifact else None
        lineage.append(
            FollowupLineageItem(
                task_run_id=parent_action.task_run_id,
                artifact_title=parent_artifact.title if parent_artifact else None,
                action_id=parent_action.id,
                goal=parent_review.goal,
                expected_artifact=parent_review.expected_artifact,
                source_label=parent_review.source_label,
                created_at=parent_action.created_at,
            )
        )
        current_task_run_id = parent_action.task_run_id

    lineage = list(reversed(lineage))
    cycle_number = len(lineage) + 1
    if persisted_review is None:
        persisted_review = PersistedNextStepReviewState(
            confirmed=False,
            summary="Связанный source Result Center не сохранил review следующего шага.",
        )
    source_task_run = get_task_run(immediate_source_action.task_run_id)
    source_artifact = get_artifact(source_task_run.artifact_id) if source_task_run and source_task_run.artifact_id else None
    has_review_payload = bool(persisted_review.goal and persisted_review.expected_artifact)
    gates = [
        GateResult(
            id="followup-continuity-source-linked",
            title="Follow-up source linked",
            status="passed",
            reason=f"Current TaskRun was created by create-next-task action {immediate_source_action.id}.",
        ),
        GateResult(
            id="followup-continuity-review-restored",
            title="Follow-up review restored",
            status="passed" if has_review_payload else "warning",
            reason=(
                "Persisted next-step review from source Result Center is available."
                if has_review_payload
                else "Source action exists, but persisted next-step review payload is incomplete."
            ),
            action=None if has_review_payload else "Review the source Result Center before accepting continuity.",
        ),
        GateResult(
            id="followup-lineage-cycle-number",
            title="Follow-up cycle number restored",
            status="passed",
            reason=f"Backend restored cycle {cycle_number} from {len(lineage)} parent Result Center action(s).",
        ),
        GateResult(
            id="followup-lineage-chain-restored",
            title="Follow-up lineage restored",
            status="warning" if stopped_by_loop else "passed",
            reason=(
                "Lineage traversal stopped because a parent loop was detected."
                if stopped_by_loop
                else "Lineage is derived from existing create-next-task action links."
            ),
            action="Review lineage links before accepting continuity." if stopped_by_loop else None,
        ),
        GateResult(
            id="followup-continuity-local-runtime",
            title="Follow-up continuity local runtime",
            status="passed",
            reason="Continuity context is derived from existing local Result Center action history.",
        ),
    ]
    return FollowupContinuityState(
        is_followup=True,
        cycle_number=cycle_number,
        source_task_run_id=immediate_source_action.task_run_id,
        source_artifact_title=source_artifact_title or (source_artifact.title if source_artifact else None),
        source_action_id=immediate_source_action.id,
        goal=persisted_review.goal,
        expected_artifact=persisted_review.expected_artifact,
        source_context=persisted_review.source_context,
        urgency=persisted_review.urgency,
        source_label=persisted_review.source_label,
        confirmed_at=persisted_review.confirmed_at,
        lineage=lineage,
        summary=(
            f"Этот запуск открывает цикл {cycle_number} и продолжает результат {immediate_source_action.task_run_id}: {persisted_review.goal}."
            if persisted_review.goal
            else f"Этот запуск открывает цикл {cycle_number} и связан с исходным результатом {immediate_source_action.task_run_id}."
        ),
        gates=gates,
    )


def _form_data_text(form_data: dict[str, object], key: str) -> str | None:
    value = form_data.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _form_data_list(form_data: dict[str, object], key: str) -> list[str]:
    value = form_data.get(key)
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _latest_linked_followup_task_run_id(action_history: list[ResultActionRecord]) -> str | None:
    return next(
        (
            record.related_task_run_id
            for record in reversed(action_history)
            if record.action_id == "create-next-task" and record.related_task_run_id
        ),
        None,
    )


def _step_status(done: bool, active: bool) -> str:
    if done:
        return "done"
    if active:
        return "active"
    return "waiting"


def _build_followup_execution_workspace_state(
    *,
    task_run_id: str,
    form_data: dict[str, object],
    product_status: str,
    artifact_ready: bool,
    followup_continuity: FollowupContinuityState,
) -> FollowupExecutionWorkspaceState:
    is_active = followup_continuity.is_followup
    inherited_workgroup = _form_data_list(form_data, "selected_workgroup")
    goal = followup_continuity.goal or _form_data_text(form_data, "goal") or "Продолжить результат предыдущего цикла"
    expected_artifact = (
        followup_continuity.expected_artifact
        or _form_data_text(form_data, "expected_artifact")
        or "Рабочий артефакт текущего цикла"
    )
    source_context = (
        followup_continuity.source_context
        or _form_data_text(form_data, "source_context")
        or followup_continuity.summary
    )
    source_label = (
        followup_continuity.source_label
        or _form_data_text(form_data, "scenario_pack_id")
        or _form_data_text(form_data, "business_mission_id")
        or "source-result"
    )

    if product_status == "accepted":
        primary_action = "create-next-cycle"
        primary_action_label = "Готовить следующий цикл"
        summary = f"Цикл {followup_continuity.cycle_number} принят. Можно готовить следующий рабочий цикл."
    elif artifact_ready:
        primary_action = "accept-current-result"
        primary_action_label = "Принять результат цикла"
        summary = f"Цикл {followup_continuity.cycle_number} сформировал результат. Следующее действие - принять решение."
    elif is_active:
        primary_action = "review-current-result"
        primary_action_label = "Проверить ход цикла"
        summary = f"Цикл {followup_continuity.cycle_number} открыт из предыдущего результата и ожидает рабочего результата."
    else:
        primary_action = "continue-from-source"
        primary_action_label = "Открыть продолжение"
        summary = "Это первый цикл. Follow-up workspace появится после создания следующего запуска."

    items = [
        FollowupExecutionWorkspaceItem(
            id="cycle-source",
            title="Основа цикла",
            value=followup_continuity.source_task_run_id or "Первый запуск",
            detail=followup_continuity.source_artifact_title or source_context,
            status="ready" if is_active and followup_continuity.source_task_run_id else "waiting",
        ),
        FollowupExecutionWorkspaceItem(
            id="cycle-goal",
            title="Цель сейчас",
            value=goal,
            detail=source_label,
            status="active" if is_active else "waiting",
        ),
        FollowupExecutionWorkspaceItem(
            id="cycle-artifact",
            title="Ожидаемый результат",
            value=expected_artifact,
            detail="Текущий TaskRun уже вернул артефакт." if artifact_ready else "Артефакт появится после выполнения текущего цикла.",
            status="ready" if artifact_ready else "active" if is_active else "waiting",
        ),
        FollowupExecutionWorkspaceItem(
            id="cycle-workgroup",
            title="Команда",
            value=f"{len(inherited_workgroup)} ролей" if inherited_workgroup else "Команда не восстановлена",
            detail=", ".join(inherited_workgroup) if inherited_workgroup else "Payload не содержит selected_workgroup.",
            status="ready" if inherited_workgroup else "blocked",
        ),
        FollowupExecutionWorkspaceItem(
            id="cycle-decision",
            title="Ближайшее решение",
            value=primary_action_label,
            detail=summary,
            status="active" if is_active else "waiting",
        ),
    ]
    gates = [
        GateResult(
            id="followup-execution-workspace-active",
            title="Follow-up execution workspace active",
            status="passed" if is_active else "warning",
            reason=(
                f"TaskRun is cycle {followup_continuity.cycle_number} follow-up."
                if is_active
                else "Workspace is waiting for a follow-up TaskRun."
            ),
            action=None if is_active else "Create and open a follow-up TaskRun from Result Center.",
        ),
        GateResult(
            id="followup-execution-source-visible",
            title="Follow-up source visible",
            status="passed" if followup_continuity.source_task_run_id else "warning",
            reason=(
                f"Source TaskRun {followup_continuity.source_task_run_id} is visible."
                if followup_continuity.source_task_run_id
                else "No source TaskRun is linked to this result."
            ),
        ),
        GateResult(
            id="followup-execution-workgroup-restored",
            title="Follow-up workgroup restored",
            status="passed" if inherited_workgroup else "warning",
            reason=(
                f"{len(inherited_workgroup)} workgroup role(s) restored from TaskRun payload."
                if inherited_workgroup
                else "Selected workgroup is not present in TaskRun payload."
            ),
            action=None if inherited_workgroup else "Open a TaskRun created from the scenario payload.",
        ),
        GateResult(
            id="followup-execution-existing-runtime-only",
            title="Follow-up execution existing runtime only",
            status="passed",
            reason="Workspace is derived from existing TaskRun payload and Result Center continuity.",
        ),
    ]
    return FollowupExecutionWorkspaceState(
        is_active=is_active,
        cycle_number=followup_continuity.cycle_number,
        source_task_run_id=followup_continuity.source_task_run_id,
        current_task_run_id=task_run_id,
        title=f"Рабочий цикл {followup_continuity.cycle_number}",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        inherited_workgroup=inherited_workgroup,
        items=items,
        gates=gates,
    )


def _build_current_cycle_outcome_workspace_state(
    *,
    product_status: str,
    artifact_title: str | None,
    artifact_content: str | None,
    acceptance_decision: AcceptanceDecisionState,
    followup_execution_workspace: FollowupExecutionWorkspaceState,
) -> CurrentCycleOutcomeWorkspaceState:
    is_active = followup_execution_workspace.is_active
    selected_route = acceptance_decision.selected_route
    artifact_ready = bool(artifact_title)

    if selected_route == "revise":
        primary_action = "revise-current-result"
        primary_action_label = "Доработать результат"
        summary = f"Цикл {followup_execution_workspace.cycle_number} направлен на правку перед продолжением."
    elif selected_route == "continue" or product_status == "accepted":
        primary_action = "continue-next-cycle"
        primary_action_label = "Продолжить цепочку"
        summary = f"Цикл {followup_execution_workspace.cycle_number} можно превращать в следующий полезный цикл."
    elif selected_route == "accept":
        primary_action = "accept-current-result"
        primary_action_label = "Зафиксировать результат"
        summary = f"Результат цикла {followup_execution_workspace.cycle_number} выбран как актив."
    else:
        primary_action = "choose-route"
        primary_action_label = "Выбрать решение"
        summary = (
            f"Цикл {followup_execution_workspace.cycle_number} готов к решению по результату."
            if artifact_ready
            else f"Цикл {followup_execution_workspace.cycle_number} ожидает результата перед приемкой."
        )

    items = [
        CurrentCycleOutcomeItem(
            id="current-cycle-result",
            title="Результат цикла",
            value=artifact_title or "Результат еще не готов",
            detail=artifact_content or "После выполнения TaskRun здесь появится содержание результата.",
            status="ready" if artifact_ready else "waiting",
        ),
        CurrentCycleOutcomeItem(
            id="current-cycle-status",
            title="Статус",
            value=product_status,
            detail=summary,
            status="active" if is_active else "waiting",
        ),
        CurrentCycleOutcomeItem(
            id="current-cycle-route",
            title="Маршрут",
            value=selected_route or "Не выбран",
            detail=acceptance_decision.summary,
            status=selected_route or "waiting",
        ),
        CurrentCycleOutcomeItem(
            id="current-cycle-next-asset",
            title="Следующий актив",
            value=followup_execution_workspace.items[2].value if len(followup_execution_workspace.items) > 2 else "Артефакт цикла",
            detail="Принятый результат станет основой следующего шага сценария.",
            status="continue" if selected_route == "continue" or product_status == "accepted" else "waiting",
        ),
    ]
    route_items = [
        CurrentCycleOutcomeItem(
            id=f"route-{route.id}",
            title=route.title,
            value=route.primary,
            detail=route.detail,
            status=route.id,
        )
        for route in acceptance_decision.routes
    ]
    gates = [
        GateResult(
            id="current-cycle-outcome-followup-active",
            title="Current cycle outcome follow-up active",
            status="passed" if is_active else "warning",
            reason=(
                f"Outcome workspace is attached to follow-up cycle {followup_execution_workspace.cycle_number}."
                if is_active
                else "Outcome workspace waits for a follow-up cycle."
            ),
            action=None if is_active else "Open a follow-up TaskRun to evaluate cycle outcome.",
        ),
        GateResult(
            id="current-cycle-outcome-artifact-visible",
            title="Current cycle outcome artifact visible",
            status="passed" if artifact_ready else "warning",
            reason=(
                f"Cycle artifact is visible: {artifact_title}."
                if artifact_ready
                else "Current cycle does not have a visible artifact yet."
            ),
            action=None if artifact_ready else "Run current cycle before accepting outcome.",
        ),
        GateResult(
            id="current-cycle-outcome-route-ready",
            title="Current cycle outcome route ready",
            status="passed" if selected_route else "warning",
            reason=(
                f"Acceptance route selected: {selected_route}."
                if selected_route
                else "User can choose accept, revise or continue route."
            ),
            action=None if selected_route else "Choose a result route before moving to the next cycle.",
        ),
        GateResult(
            id="current-cycle-outcome-existing-runtime-only",
            title="Current cycle outcome existing runtime only",
            status="passed",
            reason="Outcome workspace is derived from existing artifact, acceptance decision and follow-up workspace.",
        ),
    ]
    return CurrentCycleOutcomeWorkspaceState(
        is_active=is_active,
        cycle_number=followup_execution_workspace.cycle_number,
        artifact_title=artifact_title,
        selected_route=selected_route,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        summary=summary,
        items=items,
        route_items=route_items,
        gates=gates,
    )


def _build_outcome_next_cycle_launcher_state(
    *,
    task_run_id: str,
    artifact_title: str | None,
    artifact_content: str | None,
    action_history: list[ResultActionRecord],
    user_workspace_state: UserWorkspacePersistenceState,
    followup_execution_workspace: FollowupExecutionWorkspaceState,
    current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState,
) -> OutcomeNextCycleLauncherState:
    is_active = followup_execution_workspace.is_active
    selected_route = current_cycle_outcome_workspace.selected_route
    current_cycle = followup_execution_workspace.cycle_number
    target_cycle = current_cycle + 1
    linked_task_run_id = _latest_linked_followup_task_run_id(action_history)
    review = user_workspace_state.next_step_review

    default_title = artifact_title or (
        followup_execution_workspace.items[2].value
        if len(followup_execution_workspace.items) > 2
        else "результат цикла"
    )
    goal = review.goal or f"Продолжить сценарий в цикле {target_cycle} на базе результата: {default_title}"
    expected_artifact = review.expected_artifact or f"Цикл {target_cycle}: следующий полезный артефакт по принятому outcome"
    source_context = (
        review.source_context
        or f"Outcome cycle {current_cycle}: route={selected_route or 'not-selected'}; task_run={task_run_id}; artifact={artifact_content or default_title}"
    )
    urgency = review.urgency or f"Открыть цикл {target_cycle} и довести его до проверяемого результата"
    source_label = review.source_label or f"outcome-cycle-{current_cycle}-{selected_route or 'pending'}"
    confirmed_at_label = review.confirmed_at_label or "Ожидает подтверждения в Result Center"
    payload = OutcomeNextCycleLaunchPayload(
        goal=goal,
        expected_artifact=expected_artifact,
        source_context=source_context,
        urgency=urgency,
        source_label=source_label,
        confirmed_at_label=confirmed_at_label,
    )

    if selected_route == "continue" and linked_task_run_id:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {target_cycle}"
        summary = f"Цикл {target_cycle} уже создан из outcome текущего цикла."
    elif selected_route == "continue" and review.confirmed:
        primary_action = "create-next-cycle"
        primary_action_label = f"Создать цикл {target_cycle}"
        summary = f"Пусковой пакет цикла {target_cycle} подтвержден и готов к созданию."
    elif selected_route == "continue":
        primary_action = "confirm-next-cycle"
        primary_action_label = "Подтвердить запуск"
        summary = f"Outcome цикла {current_cycle} выбран для продолжения; осталось подтвердить пусковой пакет."
    elif selected_route == "revise":
        primary_action = "revise-current-result"
        primary_action_label = "Вернуться к правке"
        summary = f"Цикл {current_cycle} требует правки перед запуском следующего цикла."
    elif selected_route == "accept":
        primary_action = "accept-current-result"
        primary_action_label = "Зафиксировать актив"
        summary = f"Цикл {current_cycle} принят как актив; следующий цикл не навязывается."
    else:
        primary_action = "choose-route"
        primary_action_label = "Выбрать маршрут"
        summary = f"Чтобы открыть цикл {target_cycle}, сначала выберите маршрут outcome."

    items = [
        OutcomeNextCycleLaunchItem(
            id="launcher-source-outcome",
            title="Основа запуска",
            value=default_title,
            detail=f"Текущий TaskRun: {task_run_id}",
            status="ready" if artifact_title else "waiting",
        ),
        OutcomeNextCycleLaunchItem(
            id="launcher-route",
            title="Маршрут",
            value=selected_route or "Не выбран",
            detail=current_cycle_outcome_workspace.summary,
            status="continue" if selected_route == "continue" else "ready" if selected_route else "waiting",
        ),
        OutcomeNextCycleLaunchItem(
            id="launcher-review",
            title="Review запуска",
            value="Подтвержден" if review.confirmed else "Ожидает",
            detail=confirmed_at_label,
            status="review" if review.confirmed else "active" if selected_route == "continue" else "waiting",
        ),
        OutcomeNextCycleLaunchItem(
            id="launcher-target-cycle",
            title="Следующий цикл",
            value=linked_task_run_id or f"Цикл {target_cycle}",
            detail=expected_artifact,
            status="cycle" if linked_task_run_id else "active" if review.confirmed else "waiting",
        ),
        OutcomeNextCycleLaunchItem(
            id="launcher-first-action",
            title="Первое действие",
            value=urgency,
            detail=goal,
            status="ready" if selected_route == "continue" else "waiting",
        ),
    ]
    gates = [
        GateResult(
            id="outcome-next-cycle-launcher-active",
            title="Outcome next cycle launcher active",
            status="passed" if is_active else "warning",
            reason=(
                f"Launcher is attached to follow-up cycle {current_cycle}."
                if is_active
                else "Launcher waits for a follow-up cycle."
            ),
            action=None if is_active else "Open a follow-up TaskRun before launching another cycle.",
        ),
        GateResult(
            id="outcome-next-cycle-launcher-route-continue",
            title="Outcome route can launch next cycle",
            status="passed" if selected_route == "continue" else "warning",
            reason=(
                "Continue route is selected."
                if selected_route == "continue"
                else "Next cycle launch waits until user selects continue route."
            ),
            action=None if selected_route == "continue" else "Select continue route to prepare the next cycle.",
        ),
        GateResult(
            id="outcome-next-cycle-launcher-review-state",
            title="Outcome launch review state",
            status="passed" if review.confirmed or linked_task_run_id else "warning",
            reason=(
                "Next-cycle launch review is confirmed or the next TaskRun already exists."
                if review.confirmed or linked_task_run_id
                else "Next-cycle launch review is still waiting for confirmation."
            ),
            action=None if review.confirmed or linked_task_run_id else "Confirm the launch package before creating the next cycle.",
        ),
        GateResult(
            id="outcome-next-cycle-launcher-existing-runtime-only",
            title="Outcome launcher existing runtime only",
            status="passed",
            reason="Launcher is derived from existing Result Center state, persisted next-step review and result action history.",
        ),
    ]
    return OutcomeNextCycleLauncherState(
        is_active=is_active,
        cycle_number=current_cycle,
        target_cycle_number=target_cycle,
        selected_route=selected_route,
        review_confirmed=review.confirmed,
        linked_task_run_id=linked_task_run_id,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        summary=summary,
        launch_payload=payload,
        items=items,
        gates=gates,
    )


def _build_cycle_execution_brief_state(
    *,
    task_run_id: str,
    form_data: dict[str, object],
    product_status: str,
    artifact_title: str | None,
    artifact_content: str | None,
    followup_continuity: FollowupContinuityState,
    followup_execution_workspace: FollowupExecutionWorkspaceState,
) -> CycleExecutionBriefState:
    is_active = followup_continuity.is_followup and followup_continuity.cycle_number >= 3
    inherited_workgroup = _form_data_list(form_data, "selected_workgroup")
    source_context = (
        followup_continuity.source_context
        or _form_data_text(form_data, "source_context")
        or followup_continuity.summary
        or "Источник предыдущего цикла восстановлен из Result Center."
    )
    goal = followup_continuity.goal or _form_data_text(form_data, "goal") or followup_execution_workspace.items[1].value
    expected_artifact = (
        followup_continuity.expected_artifact
        or _form_data_text(form_data, "expected_artifact")
        or followup_execution_workspace.items[2].value
    )
    inherited_outcome = followup_continuity.source_artifact_title or source_context
    acceptance_stop = f"Приемка цикла {followup_continuity.cycle_number}"

    if artifact_title or product_status == "ready_for_acceptance":
        primary_action = "accept-cycle-result"
        primary_action_label = "Принять результат цикла"
        summary = f"Цикл {followup_continuity.cycle_number} сформировал результат и готов к приемке."
    elif is_active:
        primary_action = "execute-cycle"
        primary_action_label = "Выполнить цикл"
        summary = f"Цикл {followup_continuity.cycle_number} открыт из outcome предыдущего цикла и готов к работе."
    else:
        primary_action = "review-inherited-outcome"
        primary_action_label = "Проверить основу"
        summary = "Execution brief появится после открытия третьего и следующих циклов."

    items = [
        CycleExecutionBriefItem(
            id="cycle-execution-inherited-outcome",
            title="Унаследовано",
            value=inherited_outcome,
            detail=followup_continuity.source_task_run_id or "Источник будет виден после создания следующего цикла.",
            status="inherited" if is_active and followup_continuity.source_task_run_id else "waiting",
        ),
        CycleExecutionBriefItem(
            id="cycle-execution-current-goal",
            title="Что сделать сейчас",
            value=goal,
            detail=source_context,
            status="active" if is_active else "waiting",
        ),
        CycleExecutionBriefItem(
            id="cycle-execution-artifact",
            title="Ожидаемый результат",
            value=artifact_title or expected_artifact,
            detail=artifact_content or "Этот артефакт должен стать следующим проверяемым результатом цепочки.",
            status="ready" if artifact_title else "active" if is_active else "waiting",
        ),
        CycleExecutionBriefItem(
            id="cycle-execution-workgroup",
            title="Команда",
            value=f"{len(inherited_workgroup)} ролей" if inherited_workgroup else "Команда не восстановлена",
            detail=", ".join(inherited_workgroup) if inherited_workgroup else "Payload не содержит selected_workgroup.",
            status="ready" if inherited_workgroup else "blocked",
        ),
        CycleExecutionBriefItem(
            id="cycle-execution-acceptance-stop",
            title="Где остановка",
            value=acceptance_stop,
            detail="Следующая ручная остановка остается внутри пользовательской приемки результата, без production.",
            status="stop" if is_active else "waiting",
        ),
        CycleExecutionBriefItem(
            id="cycle-execution-next-action",
            title="Следующее действие",
            value=primary_action_label,
            detail=summary,
            status="check" if artifact_title else "active" if is_active else "waiting",
        ),
    ]
    gates = [
        GateResult(
            id="cycle-execution-brief-active",
            title="Cycle execution brief active",
            status="passed" if is_active else "warning",
            reason=(
                f"TaskRun is follow-up cycle {followup_continuity.cycle_number}."
                if is_active
                else "Execution brief is reserved for cycle 3 and later."
            ),
            action=None if is_active else "Open a third-cycle TaskRun created from outcome launcher.",
        ),
        GateResult(
            id="cycle-execution-brief-source-visible",
            title="Cycle execution source visible",
            status="passed" if followup_continuity.source_task_run_id else "warning",
            reason=(
                f"Source TaskRun {followup_continuity.source_task_run_id} is visible."
                if followup_continuity.source_task_run_id
                else "No source TaskRun is linked."
            ),
        ),
        GateResult(
            id="cycle-execution-brief-workgroup-restored",
            title="Cycle execution workgroup restored",
            status="passed" if inherited_workgroup else "warning",
            reason=(
                f"{len(inherited_workgroup)} workgroup role(s) restored."
                if inherited_workgroup
                else "Selected workgroup is not present in TaskRun payload."
            ),
        ),
        GateResult(
            id="cycle-execution-brief-existing-runtime-only",
            title="Cycle execution brief existing runtime only",
            status="passed",
            reason="Brief is derived from existing follow-up continuity, TaskRun payload and current artifact.",
        ),
    ]
    return CycleExecutionBriefState(
        is_active=is_active,
        cycle_number=followup_continuity.cycle_number,
        source_task_run_id=followup_continuity.source_task_run_id,
        current_task_run_id=task_run_id,
        inherited_outcome=inherited_outcome,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        summary=summary,
        items=items,
        gates=gates,
    )


def _build_cycle_acceptance_workspace_state(
    *,
    task_run_id: str,
    product_status: str,
    artifact_title: str | None,
    artifact_content: str | None,
    action_history: list[ResultActionRecord],
    acceptance_decision: AcceptanceDecisionState,
    followup_continuity: FollowupContinuityState,
    current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> CycleAcceptanceWorkspaceState:
    is_active = followup_continuity.is_followup and followup_continuity.cycle_number >= 3
    selected_route = acceptance_decision.selected_route
    linked_followup_task_run_id = _latest_linked_followup_task_run_id(action_history)
    result_title = artifact_title or followup_continuity.expected_artifact or "Результат текущего цикла"
    cycle_label = f"цикла {followup_continuity.cycle_number}"

    if not is_active:
        primary_action = "wait-cycle-result"
        primary_action_label = "Открыть третий цикл"
        summary = "Workspace приемки появится в третьем и следующих циклах пользовательской цепочки."
    elif not artifact_title:
        primary_action = "wait-cycle-result"
        primary_action_label = "Дождаться результата"
        summary = f"Цикл {followup_continuity.cycle_number} открыт, но результат еще не готов к приемке."
    elif linked_followup_task_run_id:
        primary_action = "open-next-cycle"
        primary_action_label = "Открыть следующий цикл"
        summary = f"Решение по результату {cycle_label} принято, следующий цикл уже создан."
    elif selected_route == "continue":
        primary_action = "continue-next-cycle"
        primary_action_label = "Создать следующий цикл"
        summary = f"Outcome {cycle_label} выбран как основа продолжения цепочки."
    elif selected_route == "revise":
        primary_action = "revise-cycle-result"
        primary_action_label = "Вернуть на правку"
        summary = f"Результат {cycle_label} направлен на правку перед следующим шагом."
    elif selected_route == "accept" or product_status == "accepted":
        primary_action = "accept-cycle-result"
        primary_action_label = "Зафиксировать принятие"
        summary = f"Результат {cycle_label} выбран как готовый бизнес-актив."
    else:
        primary_action = "choose-cycle-route"
        primary_action_label = "Выбрать решение"
        summary = f"Результат {cycle_label} готов к пользовательской приемке."

    acceptance_items = [
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-result",
            title="Что принимаем",
            value=result_title,
            detail=artifact_content or current_cycle_outcome_workspace.summary,
            status="ready" if artifact_title else "blocked",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-criteria",
            title="Критерий",
            value="Можно использовать дальше",
            detail="Пользователь должен понять, достаточно ли результата для следующего бизнес-действия.",
            status="criteria",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-signal",
            title="Сигнал готовности",
            value="Артефакт и evidence видны",
            detail="Результат принят на уровне Result Center без внешней отправки и production-контура.",
            status="signal" if artifact_title else "blocked",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-decision",
            title="Решение",
            value=acceptance_decision.summary,
            detail=selected_route or "Маршрут еще не выбран: принять, поправить или продолжить.",
            status="decision" if selected_route else "risk",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-asset",
            title="Бизнес-актив",
            value=current_cycle_outcome_workspace.items[2].value if len(current_cycle_outcome_workspace.items) > 2 else result_title,
            detail="Итог цикла должен накапливаться как reusable SMB-актив, а не теряться в истории запусков.",
            status="asset",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-next",
            title="Следующий переход",
            value=primary_action_label,
            detail=summary,
            status="next",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-stop",
            title="Стоп-точка",
            value=f"Приемка {cycle_label}",
            detail="Дальше пользователь выбирает маршрут результата; production и внешние обязательства не включены.",
            status="stop",
        ),
    ]
    decision_items = [
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-route-accept",
            title="Принять",
            value="Закрыть как актив",
            detail="Результат остается итогом текущего цикла и может быть использован внутри сценария.",
            status="ready" if selected_route == "accept" or product_status == "accepted" else "decision",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-route-revise",
            title="Поправить",
            value="Вернуть в работу",
            detail="Цикл остается в пользовательской петле, но следующий запуск не создается автоматически.",
            status="ready" if selected_route == "revise" else "risk",
        ),
        CycleAcceptanceWorkspaceItem(
            id="cycle-acceptance-route-continue",
            title="Продолжить",
            value="Запустить следующий цикл",
            detail=(
                f"Следующий TaskRun уже создан: {linked_followup_task_run_id}."
                if linked_followup_task_run_id
                else "Outcome становится пусковым пакетом следующего цикла."
            ),
            status="ready" if selected_route == "continue" else "next",
        ),
    ]
    gates = [
        GateResult(
            id="cycle-acceptance-workspace-active",
            title="Cycle acceptance workspace active",
            status="passed" if is_active else "warning",
            reason=(
                f"TaskRun is cycle {followup_continuity.cycle_number}; cycle acceptance workspace is active."
                if is_active
                else "Cycle acceptance workspace is reserved for cycle 3 and later."
            ),
            action=None if is_active else "Open a cycle 3 TaskRun.",
        ),
        GateResult(
            id="cycle-acceptance-result-visible",
            title="Cycle result visible",
            status="passed" if artifact_title else "warning",
            reason=(
                f"Artifact is visible for cycle acceptance: {artifact_title}."
                if artifact_title
                else "Cycle artifact is not visible yet."
            ),
        ),
        GateResult(
            id="cycle-acceptance-route-visible",
            title="Cycle route visible",
            status="passed" if selected_route else "warning",
            reason=(
                f"Selected route is {selected_route}."
                if selected_route
                else "User route is not selected yet."
            ),
        ),
        GateResult(
            id="cycle-acceptance-next-transition-visible",
            title="Cycle next transition visible",
            status="passed" if selected_route or linked_followup_task_run_id else "warning",
            reason=(
                "Acceptance workspace explains the next transition for the selected route."
                if selected_route or linked_followup_task_run_id
                else "Next transition waits for user route selection."
            ),
        ),
        GateResult(
            id="cycle-acceptance-existing-runtime-only",
            title="Cycle acceptance existing runtime only",
            status="passed",
            reason="Workspace is derived from Result Center, artifact, acceptance decision, outcome launcher and action history.",
        ),
    ]
    return CycleAcceptanceWorkspaceState(
        is_active=is_active,
        cycle_number=followup_continuity.cycle_number,
        current_task_run_id=task_run_id,
        source_task_run_id=followup_continuity.source_task_run_id,
        result_title=result_title,
        selected_route=selected_route,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        summary=summary,
        acceptance_items=acceptance_items,
        decision_items=decision_items,
        gates=gates,
    )


def _build_cycle_continuity_workspace_state(
    *,
    task_run_id: str,
    form_data: dict[str, object],
    product_status: str,
    artifact_title: str | None,
    artifact_content: str | None,
    followup_continuity: FollowupContinuityState,
    cycle_execution_brief: CycleExecutionBriefState,
    cycle_acceptance_workspace: CycleAcceptanceWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> CycleContinuityWorkspaceState:
    is_active = followup_continuity.is_followup and followup_continuity.cycle_number >= 4
    cycle_number = followup_continuity.cycle_number
    next_cycle_number = cycle_number + 1
    goal = followup_continuity.goal or _form_data_text(form_data, "goal") or "Продолжить пользовательский сценарий"
    expected_artifact = (
        artifact_title
        or followup_continuity.expected_artifact
        or _form_data_text(form_data, "expected_artifact")
        or f"Результат цикла {cycle_number}"
    )
    source_basis = (
        followup_continuity.source_artifact_title
        or followup_continuity.source_context
        or cycle_execution_brief.inherited_outcome
        or "Основа предыдущего цикла восстановлена из Result Center."
    )
    source_detail = followup_continuity.source_task_run_id or "Источник будет связан после создания follow-up TaskRun."

    if artifact_title and cycle_acceptance_workspace.primary_action == "open-next-cycle":
        primary_action = "continue-chain"
        primary_action_label = f"Открыть цикл {next_cycle_number}"
        summary = f"Цикл {cycle_number} принят и уже связан со следующим переходом."
    elif artifact_title:
        primary_action = "accept-cycle-result"
        primary_action_label = "Принять результат"
        summary = f"Цикл {cycle_number} показывает результат, приемку и следующий переход в одном рабочем пространстве."
    elif is_active:
        primary_action = "execute-cycle"
        primary_action_label = "Выполнить цикл"
        summary = f"Цикл {cycle_number} открыт из принятого результата предыдущего цикла и готов к работе."
    else:
        primary_action = "review-cycle-basis"
        primary_action_label = "Проверить основу"
        summary = "Continuity workspace включается с четвертого цикла пользовательской цепочки."

    items = [
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-basis",
            title="Основа",
            value=source_basis,
            detail=source_detail,
            status="basis" if is_active and followup_continuity.source_task_run_id else "waiting",
        ),
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-task",
            title="Задача сейчас",
            value=goal,
            detail=followup_continuity.summary or "Цель восстановлена из payload следующего цикла.",
            status="active" if is_active else "waiting",
        ),
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-result",
            title="Результат",
            value=expected_artifact,
            detail=artifact_content or "Этот результат станет следующей принимаемой единицей сценария.",
            status="ready" if artifact_title else "active" if is_active else "waiting",
        ),
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-acceptance",
            title="Приемка",
            value=cycle_acceptance_workspace.primary_action_label,
            detail=cycle_acceptance_workspace.summary,
            status="acceptance" if cycle_acceptance_workspace.is_active else "waiting",
        ),
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-next-transition",
            title="Дальше",
            value=outcome_next_cycle_launcher.primary_action_label,
            detail=outcome_next_cycle_launcher.summary,
            status="next" if outcome_next_cycle_launcher.is_active else "waiting",
        ),
        CycleContinuityWorkspaceItem(
            id="cycle-continuity-stop",
            title="Стоп-точка",
            value=f"Приемка цикла {cycle_number}",
            detail="Следующая остановка остается внутри пользовательской приемки; production, deploy и security-зоны не включены.",
            status="stop" if is_active else "waiting",
        ),
    ]
    gates = [
        GateResult(
            id="cycle-continuity-workspace-active",
            title="Cycle continuity workspace active",
            status="passed" if is_active else "warning",
            reason=(
                f"TaskRun is follow-up cycle {cycle_number}; continuity workspace is active."
                if is_active
                else "Cycle continuity workspace is reserved for cycle 4 and later."
            ),
            action=None if is_active else "Open cycle 4 from the cycle 3 acceptance route.",
        ),
        GateResult(
            id="cycle-continuity-source-visible",
            title="Cycle continuity source visible",
            status="passed" if followup_continuity.source_task_run_id else "warning",
            reason=(
                f"Source TaskRun {followup_continuity.source_task_run_id} is visible."
                if followup_continuity.source_task_run_id
                else "No source TaskRun is linked."
            ),
        ),
        GateResult(
            id="cycle-continuity-task-visible",
            title="Cycle continuity task visible",
            status="passed" if goal and expected_artifact else "warning",
            reason=f"Goal and expected artifact are visible for cycle {cycle_number}.",
        ),
        GateResult(
            id="cycle-continuity-acceptance-visible",
            title="Cycle continuity acceptance visible",
            status="passed" if cycle_acceptance_workspace.is_active else "warning",
            reason="Cycle acceptance workspace is attached to this cycle.",
        ),
        GateResult(
            id="cycle-continuity-existing-runtime-only",
            title="Cycle continuity existing runtime only",
            status="passed",
            reason="Workspace is derived from follow-up continuity, cycle execution brief, acceptance workspace and outcome launcher.",
        ),
    ]
    return CycleContinuityWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        current_task_run_id=task_run_id,
        source_task_run_id=followup_continuity.source_task_run_id,
        title=f"Цикл {cycle_number}: самостоятельная рабочая зона",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_accumulated_business_asset_workspace_state(
    *,
    task_run_id: str,
    product_status: str,
    artifact_title: str | None,
    artifact_content: str | None,
    followup_continuity: FollowupContinuityState,
    cycle_continuity_workspace: CycleContinuityWorkspaceState,
    current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> AccumulatedBusinessAssetWorkspaceState:
    is_active = followup_continuity.is_followup and followup_continuity.cycle_number >= 4
    cycle_number = followup_continuity.cycle_number
    accumulated_cycles = max(cycle_number, len(followup_continuity.lineage) + 1)
    lineage_labels = [
        f"{item.task_run_id}: {item.artifact_title or item.goal or item.source_label}"
        for item in followup_continuity.lineage[-3:]
    ]
    chain_value = " -> ".join(lineage_labels) if lineage_labels else "Цепочка появится после follow-up запусков."
    result_title = artifact_title or followup_continuity.expected_artifact or current_cycle_outcome_workspace.artifact_title or "Рабочий результат"
    reusable_output = artifact_content or current_cycle_outcome_workspace.summary or "Результат можно переиспользовать как основу следующего цикла."
    next_business_use = (
        outcome_next_cycle_launcher.launch_payload.goal
        if outcome_next_cycle_launcher.is_active
        else followup_continuity.goal
        or cycle_continuity_workspace.summary
    )

    if product_status == "accepted" and outcome_next_cycle_launcher.linked_task_run_id:
        primary_action = "continue-asset-chain"
        primary_action_label = f"Открыть цикл {cycle_number + 1}"
        summary = f"Накопленный актив из {accumulated_cycles} циклов принят и связан со следующим циклом."
    elif artifact_title:
        primary_action = "accept-current-asset"
        primary_action_label = "Принять актив"
        summary = f"Накопленный актив из {accumulated_cycles} циклов готов к пользовательской приемке."
    else:
        primary_action = "review-asset"
        primary_action_label = "Проверить актив"
        summary = f"Симбиот показывает, что уже накоплено за {accumulated_cycles} циклов и что можно использовать дальше."

    items = [
        AccumulatedBusinessAssetItem(
            id="business-asset-basis",
            title="База актива",
            value=followup_continuity.source_artifact_title or "Принятый результат предыдущего цикла",
            detail=followup_continuity.source_task_run_id or "Источник будет виден после создания follow-up.",
            status="basis" if is_active and followup_continuity.source_task_run_id else "waiting",
        ),
        AccumulatedBusinessAssetItem(
            id="business-asset-chain",
            title="Цепочка",
            value=f"{accumulated_cycles} связанных цикла",
            detail=chain_value,
            status="chain" if is_active and followup_continuity.lineage else "waiting",
        ),
        AccumulatedBusinessAssetItem(
            id="business-asset-current-value",
            title="Ценность сейчас",
            value=result_title,
            detail=current_cycle_outcome_workspace.summary or cycle_continuity_workspace.summary,
            status="value" if is_active else "waiting",
        ),
        AccumulatedBusinessAssetItem(
            id="business-asset-reusable-output",
            title="Переиспользуемый результат",
            value="Можно брать в следующий рабочий цикл",
            detail=reusable_output,
            status="reusable" if artifact_title or is_active else "waiting",
        ),
        AccumulatedBusinessAssetItem(
            id="business-asset-next-use",
            title="Следующее применение",
            value=outcome_next_cycle_launcher.primary_action_label,
            detail=next_business_use,
            status="next" if outcome_next_cycle_launcher.is_active else "waiting",
        ),
        AccumulatedBusinessAssetItem(
            id="business-asset-limit",
            title="Граница обещаний",
            value="Локальный MVP-актив, не production release",
            detail="Рыночная, дизайн- и production-приемка остаются отдельными gate; клиенту это пока нельзя обещать как готовый SaaS.",
            status="limit",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-workspace-active",
            title="Accumulated business asset workspace active",
            status="passed" if is_active else "warning",
            reason=(
                f"TaskRun is follow-up cycle {cycle_number}; accumulated asset workspace is active."
                if is_active
                else "Accumulated asset workspace is reserved for cycle 4 and later."
            ),
            action=None if is_active else "Open cycle 4 from the accepted cycle chain.",
        ),
        GateResult(
            id="business-asset-lineage-visible",
            title="Accumulated asset lineage visible",
            status="passed" if len(followup_continuity.lineage) >= 3 else "warning",
            reason=f"{len(followup_continuity.lineage)} lineage records are visible in Result Center.",
        ),
        GateResult(
            id="business-asset-value-visible",
            title="Accumulated asset value visible",
            status="passed" if result_title and next_business_use else "warning",
            reason="Current value and next business use are visible to the user.",
        ),
        GateResult(
            id="business-asset-release-limited",
            title="Accumulated asset release limited",
            status="warning",
            reason="This is a local MVP runtime/demo block; market, design and production release gates remain open.",
            action="Use only for internal MVP validation before G acceptance.",
        ),
        GateResult(
            id="business-asset-existing-runtime-only",
            title="Accumulated asset existing runtime only",
            status="passed",
            reason="Workspace is derived from follow-up continuity, outcome workspace, cycle continuity workspace and launcher state.",
        ),
    ]
    return AccumulatedBusinessAssetWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=followup_continuity.source_task_run_id,
        title="Накопленный бизнес-актив",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_decision_workspace_state(
    *,
    task_run_id: str,
    followup_continuity: FollowupContinuityState,
    acceptance_decision: AcceptanceDecisionState,
    accumulated_business_asset_workspace: AccumulatedBusinessAssetWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetDecisionWorkspaceState:
    is_active = accumulated_business_asset_workspace.is_active
    cycle_number = accumulated_business_asset_workspace.cycle_number
    accumulated_cycles = accumulated_business_asset_workspace.accumulated_cycles
    selected_route = acceptance_decision.selected_route

    accept_detail = "Зафиксировать актив как рабочую основу текущего SMB-сценария."
    revise_detail = "Вернуть актив на правку: уточнить формулировку, ценность или следующий бизнес-ход."
    continue_detail = (
        outcome_next_cycle_launcher.launch_payload.goal
        if outcome_next_cycle_launcher.is_active
        else "Продолжить цепочку после принятия текущего актива."
    )

    if selected_route == "accept":
        primary_action = "accept-asset"
        primary_action_label = "Актив принят"
        summary = "Пользователь выбрал принять накопленный актив; следующий шаг можно готовить без внешнего release."
    elif selected_route == "revise":
        primary_action = "revise-asset"
        primary_action_label = "Поправить актив"
        summary = "Пользователь выбрал доработку; актив не считается принятым до новой проверки."
    elif selected_route == "continue" and outcome_next_cycle_launcher.linked_task_run_id:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Пользователь выбрал продолжение, и следующий цикл уже связан с этим активом."
    elif selected_route == "continue":
        primary_action = "continue-asset"
        primary_action_label = "Продолжить актив"
        summary = "Пользователь выбрал продолжение; следующий цикл можно создать после подтверждения."
    else:
        primary_action = "choose-asset-route"
        primary_action_label = "Выбрать маршрут"
        summary = "Выберите, что делать с накопленным бизнес-активом: принять, поправить или продолжить."

    items = [
        BusinessAssetDecisionItem(
            id="business-asset-decision-accept",
            title="Принять",
            value="Считать актив рабочей основой",
            detail=accept_detail,
            status="accept" if selected_route == "accept" else "waiting",
        ),
        BusinessAssetDecisionItem(
            id="business-asset-decision-revise",
            title="Поправить",
            value="Уточнить актив перед продолжением",
            detail=revise_detail,
            status="revise" if selected_route == "revise" else "waiting",
        ),
        BusinessAssetDecisionItem(
            id="business-asset-decision-continue",
            title="Продолжить",
            value=outcome_next_cycle_launcher.primary_action_label,
            detail=continue_detail,
            status="continue" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetDecisionItem(
            id="business-asset-decision-effect",
            title="Бизнес-эффект",
            value=f"{accumulated_cycles} цикла превращены в reusable asset",
            detail=accumulated_business_asset_workspace.summary,
            status="effect" if is_active else "waiting",
        ),
        BusinessAssetDecisionItem(
            id="business-asset-decision-proof",
            title="Доказательство",
            value="Lineage и Result Center восстановлены",
            detail="Decision workspace использует существующие runtime-данные: acceptance decision, asset workspace, outcome launcher и lineage.",
            status="proof" if is_active and accumulated_business_asset_workspace.source_task_run_id else "waiting",
        ),
        BusinessAssetDecisionItem(
            id="business-asset-decision-guard",
            title="Граница",
            value="Не market/release GREEN",
            detail="Это внутренний MVP decision workspace; дизайн, рынок и production остаются отдельными gate.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-decision-workspace-active",
            title="Business asset decision workspace active",
            status="passed" if is_active else "warning",
            reason=(
                f"Cycle {cycle_number} accumulated asset is active; decision workspace can be shown."
                if is_active
                else "Business asset decision workspace requires an active accumulated asset."
            ),
            action=None if is_active else "Open cycle 4 accumulated business asset workspace first.",
        ),
        GateResult(
            id="business-asset-decision-routes-visible",
            title="Business asset decision routes visible",
            status="passed" if len(items) >= 6 else "warning",
            reason="Accept, revise, continue, effect, proof and guard cards are exposed.",
        ),
        GateResult(
            id="business-asset-decision-selected-route-restored",
            title="Business asset decision selected route restored",
            status="passed" if selected_route else "warning",
            reason=(
                f"Selected route is {selected_route}."
                if selected_route
                else "No asset decision route has been selected yet."
            ),
            action=None if selected_route else "Choose accept, revise or continue in the Result Center.",
        ),
        GateResult(
            id="business-asset-decision-release-limited",
            title="Business asset decision release limited",
            status="warning",
            reason="Runtime decision is available, but design, market and release gates remain YELLOW.",
            action="Use for internal MVP validation only.",
        ),
        GateResult(
            id="business-asset-decision-existing-runtime-only",
            title="Business asset decision existing runtime only",
            status="passed",
            reason="Decision workspace is derived from existing Result Center runtime state without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetDecisionWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=accumulated_business_asset_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Решение по бизнес-активу",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_route_outcome_workspace_state(
    *,
    task_run_id: str,
    business_asset_decision_workspace: BusinessAssetDecisionWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetRouteOutcomeWorkspaceState:
    is_active = business_asset_decision_workspace.is_active
    selected_route = business_asset_decision_workspace.selected_route
    cycle_number = business_asset_decision_workspace.cycle_number
    accumulated_cycles = business_asset_decision_workspace.accumulated_cycles
    next_cycle_label = f"цикл {outcome_next_cycle_launcher.target_cycle_number}"

    if selected_route == "accept":
        primary_action = "confirm-accepted-asset"
        primary_action_label = "Актив принят"
        consequence = "Актив можно использовать как текущую рабочую основу."
        next_action = "Зафиксировать принятое состояние и перейти к следующей управляемой задаче."
        summary = "Маршрут принятия показывает, что актив остается внутри MVP и не становится рыночным release."
    elif selected_route == "revise":
        primary_action = "revise-asset"
        primary_action_label = "Вернуться к правке"
        consequence = "Актив требует уточнения перед следующим циклом."
        next_action = "Открыть решение результата и вернуть актив на доработку."
        summary = "Маршрут правки сохраняет контроль качества: актив не считается принятым."
    elif selected_route == "continue" and outcome_next_cycle_launcher.linked_task_run_id:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть {next_cycle_label}"
        consequence = f"Актив уже превратился в следующий рабочий цикл: {outcome_next_cycle_launcher.linked_task_run_id}."
        next_action = outcome_next_cycle_launcher.summary
        summary = "Маршрут продолжения показывает, какой следующий цикл создан из накопленного актива."
    elif selected_route == "continue":
        primary_action = "review-route-outcome"
        primary_action_label = "Проверить продолжение"
        consequence = f"Актив готов стать основой для {next_cycle_label}."
        next_action = outcome_next_cycle_launcher.summary
        summary = "Маршрут продолжения подготовлен, но следующий цикл еще не открыт."
    else:
        primary_action = "review-route-outcome"
        primary_action_label = "Проверить маршруты"
        consequence = "Маршрут еще не выбран."
        next_action = "Выберите принять, поправить или продолжить актив."
        summary = "Outcome workspace включается после выбора маршрута по бизнес-активу."

    items = [
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-selected",
            title="Выбранный маршрут",
            value=selected_route or "Не выбран",
            detail=business_asset_decision_workspace.summary,
            status="selected" if selected_route else "waiting",
        ),
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-consequence",
            title="Что это значит",
            value=consequence,
            detail=f"Основа: {accumulated_cycles} связанных цикла в активе.",
            status="outcome" if selected_route else "waiting",
        ),
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-next",
            title="Следующее действие",
            value=primary_action_label,
            detail=next_action,
            status="next" if selected_route else "waiting",
        ),
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-handoff",
            title="Передача",
            value=outcome_next_cycle_launcher.linked_task_run_id or next_cycle_label,
            detail=outcome_next_cycle_launcher.launch_payload.source_context,
            status="handoff" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-proof",
            title="Proof",
            value="Decision + lineage восстановлены",
            detail="Outcome построен из existing Result Center: decision workspace, selected route, outcome launcher, linked TaskRun.",
            status="proof" if is_active else "waiting",
        ),
        BusinessAssetRouteOutcomeItem(
            id="business-asset-route-guard",
            title="Граница",
            value="Не внешний release",
            detail="Даже после выбора маршрута дизайн, рынок, production и release остаются отдельными YELLOW/G gates.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-route-outcome-active",
            title="Business asset route outcome active",
            status="passed" if is_active else "warning",
            reason=(
                f"Cycle {cycle_number} business asset decision workspace is active."
                if is_active
                else "Route outcome requires an active business asset decision workspace."
            ),
            action=None if is_active else "Open the business asset decision workspace first.",
        ),
        GateResult(
            id="business-asset-route-selected",
            title="Business asset route selected",
            status="passed" if selected_route else "warning",
            reason=f"Selected route: {selected_route}." if selected_route else "No route has been selected yet.",
            action=None if selected_route else "Choose accept, revise or continue.",
        ),
        GateResult(
            id="business-asset-route-next-visible",
            title="Business asset route next visible",
            status="passed" if next_action else "warning",
            reason="The next action and consequence are visible to the user.",
        ),
        GateResult(
            id="business-asset-route-release-limited",
            title="Business asset route release limited",
            status="warning",
            reason="Route outcome is a local MVP runtime layer; design, market and release gates remain YELLOW.",
            action="Use only for internal MVP validation until manual G acceptance.",
        ),
        GateResult(
            id="business-asset-route-existing-runtime-only",
            title="Business asset route existing runtime only",
            status="passed",
            reason="Route outcome is derived from existing decision workspace and outcome launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetRouteOutcomeWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_decision_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Итог решения по активу",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_manual_review_workspace_state(
    *,
    task_run_id: str,
    business_asset_route_outcome_workspace: BusinessAssetRouteOutcomeWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetManualReviewWorkspaceState:
    is_active = business_asset_route_outcome_workspace.is_active
    selected_route = business_asset_route_outcome_workspace.selected_route
    cycle_number = business_asset_route_outcome_workspace.cycle_number
    accumulated_cycles = business_asset_route_outcome_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Маршрут продолжения можно проверять вручную: виден смысл, следующий цикл и граница release."
    elif selected_route:
        primary_action = "review-manual-check"
        primary_action_label = "Проверить вручную"
        summary = "Маршрут выбран; нужно ручное UX/design/market/release решение Дмитрия перед внешними обещаниями."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Перед ручной проверкой нужно выбрать маршрут по накопленному активу."

    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    items = [
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-scenario",
            title="Сценарий",
            value="Открыть актив -> увидеть итог маршрута -> понять следующий шаг",
            detail=f"Проверяется пользовательская цепочка цикла {cycle_number}, а не production readiness.",
            status="scenario" if is_active else "waiting",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-clarity",
            title="Понятность",
            value=selected_route or "Маршрут не выбран",
            detail=business_asset_route_outcome_workspace.summary,
            status="clarity" if selected_route else "waiting",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-business",
            title="Бизнес-смысл",
            value=f"{accumulated_cycles} цикла должны читаться как SMB-актив",
            detail="Пользователь должен понять пользу без объяснений Codex: что накоплено, что решено и что дальше.",
            status="business" if is_active else "waiting",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-next",
            title="Следующий шаг",
            value=business_asset_route_outcome_workspace.primary_action_label,
            detail=f"Целевой переход: {next_target}.",
            status="next" if selected_route else "waiting",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-proof",
            title="Runtime proof",
            value="Lineage, route outcome и next-cycle launcher восстановлены",
            detail="Проверка должна опираться на live API, compileall и Next build, а не на наличие карточки.",
            status="proof" if is_active else "waiting",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-guard",
            title="Не обещать",
            value="Не market/release GREEN",
            detail="Design, market, client/public release, production, security/tenant, integrations/pricing остаются YELLOW/G.",
            status="guard",
        ),
        BusinessAssetManualReviewItem(
            id="business-asset-manual-review-dmitry",
            title="Что смотрит Дмитрий",
            value="Понятно ли что делать без пояснений",
            detail="Если смысл маршрута, следующий шаг или граница обещаний неочевидны - gate остается YELLOW.",
            status="manual",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-manual-review-active",
            title="Business asset manual review active",
            status="passed" if is_active else "warning",
            reason=(
                f"Cycle {cycle_number} route outcome workspace is active."
                if is_active
                else "Manual review requires an active route outcome workspace."
            ),
            action=None if is_active else "Open route outcome workspace first.",
        ),
        GateResult(
            id="business-asset-manual-review-route-visible",
            title="Business asset manual review route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for review.",
            action=None if selected_route else "Choose route before manual review.",
        ),
        GateResult(
            id="business-asset-manual-review-checklist-visible",
            title="Business asset manual review checklist visible",
            status="passed" if len(items) == 7 else "warning",
            reason="Scenario, clarity, business, next, proof, guard and Dmitry review cards are visible.",
        ),
        GateResult(
            id="business-asset-manual-review-release-limited",
            title="Business asset manual review release limited",
            status="warning",
            reason="Manual review workspace prepares G acceptance but does not close design, market or release gates.",
            action="Keep RYG YELLOW until Dmitry manually accepts UX/design/market/release.",
        ),
        GateResult(
            id="business-asset-manual-review-existing-runtime-only",
            title="Business asset manual review existing runtime only",
            status="passed",
            reason="Manual review workspace is derived from route outcome and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetManualReviewWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_route_outcome_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Ручная проверка бизнес-актива",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_acceptance_package_workspace_state(
    *,
    task_run_id: str,
    business_asset_manual_review_workspace: BusinessAssetManualReviewWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGAcceptancePackageWorkspaceState:
    is_active = business_asset_manual_review_workspace.is_active
    selected_route = business_asset_manual_review_workspace.selected_route
    cycle_number = business_asset_manual_review_workspace.cycle_number
    accumulated_cycles = business_asset_manual_review_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "G-package собран: можно вручную проверить смысл, evidence и границы обещаний перед продолжением."
    elif selected_route:
        primary_action = "review-g-package"
        primary_action_label = "Проверить G-package"
        summary = "Пакет приемки собран, но качественное UX/design/market/release решение остается ручным G-gate."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Перед G-package нужно выбрать маршрут по накопленному бизнес-активу."

    route_label = {
        "accept": "принять текущий SMB-актив",
        "revise": "вернуть актив на доработку",
        "continue": "продолжить следующий цикл",
    }.get(selected_route or "", "маршрут не выбран")
    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    items = [
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-scope",
            title="Что принимаем",
            value=f"SMB-актив из {accumulated_cycles} циклов",
            detail=f"Проверяется пользовательский смысл цикла {cycle_number}, а не production readiness.",
            status="scope" if is_active else "waiting",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-route",
            title="Маршрут",
            value=route_label,
            detail=business_asset_manual_review_workspace.summary,
            status="route" if selected_route else "waiting",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-proof",
            title="Evidence",
            value="Live API + compile/build required",
            detail="Пакет может стать готовым только после runtime proof, compileall и Next build.",
            status="proof" if is_active else "waiting",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-conditions",
            title="YELLOW условия",
            value="Design, market и release не закрыты",
            detail="HTML/demo или локальный runtime не считаются рыночной и публичной приемкой.",
            status="condition",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-risk",
            title="Риск обещания",
            value="Не обещать production/security/tenant",
            detail="Security, tenant, audit access, integrations и pricing не открывались в этом броске.",
            status="risk",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-decision",
            title="Решение Дмитрия",
            value="Принять / вернуть / продолжить",
            detail=f"Если выбран continue, целевой переход: {next_target}.",
            status="decision" if selected_route else "waiting",
        ),
        BusinessAssetGAcceptancePackageItem(
            id="business-asset-g-package-guard",
            title="Ограничитель",
            value="Не ставить market/release GREEN",
            detail="Этот workspace готовит ручную G-проверку, но не заменяет ее автоматическим статусом.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-package-active",
            title="Business asset G-package active",
            status="passed" if is_active else "warning",
            reason=(
                f"Manual review workspace for cycle {cycle_number} is active."
                if is_active
                else "G-package requires active manual review workspace."
            ),
            action=None if is_active else "Open manual review workspace first.",
        ),
        GateResult(
            id="business-asset-g-package-route-visible",
            title="Business asset G-package route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route in G-package.",
            action=None if selected_route else "Choose route before G acceptance package.",
        ),
        GateResult(
            id="business-asset-g-package-complete",
            title="Business asset G-package complete",
            status="passed" if len(items) == 7 else "warning",
            reason="Scope, route, evidence, conditions, risk, decision and guard cards are visible.",
        ),
        GateResult(
            id="business-asset-g-package-release-limited",
            title="Business asset G-package release limited",
            status="warning",
            reason="G-package supports manual acceptance but does not close design, market or release gates.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts UX/design/market/release.",
        ),
        GateResult(
            id="business-asset-g-package-existing-runtime-only",
            title="Business asset G-package existing runtime only",
            status="passed",
            reason="G-package is derived from manual review and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGAcceptancePackageWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_manual_review_workspace.source_task_run_id,
        selected_route=selected_route,
        title="G-package приемки бизнес-актива",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_review_execution_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_acceptance_package_workspace: BusinessAssetGAcceptancePackageWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGReviewExecutionWorkspaceState:
    is_active = business_asset_g_acceptance_package_workspace.is_active
    selected_route = business_asset_g_acceptance_package_workspace.selected_route
    cycle_number = business_asset_g_acceptance_package_workspace.cycle_number
    accumulated_cycles = business_asset_g_acceptance_package_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "G-проверка операционно собрана: видны шаги ручной проверки и безопасный переход к следующему циклу."
    elif selected_route:
        primary_action = "execute-g-review"
        primary_action_label = "Пройти G-проверку"
        summary = "Проверьте пакет по шагам; качественная приемка и release остаются ручным решением Дмитрия."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Для прохождения G-проверки нужно сначала выбрать маршрут бизнес-актива."

    route_label = {
        "accept": "принять актив внутри MVP",
        "revise": "вернуть актив на доработку",
        "continue": "продолжить следующий цикл",
    }.get(selected_route or "", "маршрут не выбран")
    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    items = [
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-open-package",
            title="Открыть пакет",
            value="G-package виден",
            detail="Пользователь начинает проверку с одного экрана, а не из разрозненных карточек.",
            status="ready" if is_active else "waiting",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-scope",
            title="Сверить scope",
            value=f"{accumulated_cycles} цикла SMB-актива",
            detail=f"Проверка относится к циклу {cycle_number} и не равна production acceptance.",
            status="check" if is_active else "waiting",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-route",
            title="Сверить маршрут",
            value=route_label,
            detail="Маршрут должен быть понятен без объяснения Codex: принять, вернуть или продолжить.",
            status="check" if selected_route else "waiting",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-proof",
            title="Проверить evidence",
            value="Runtime proof + build evidence",
            detail="Проверка опирается на live API, compileall и Next build, а не на сам факт наличия UI.",
            status="proof" if is_active else "waiting",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-yellow-conditions",
            title="YELLOW условия",
            value="Design/market/release открыты вручную",
            detail="Если пользовательский смысл неочевиден, gate остается YELLOW и не идет наружу.",
            status="condition",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-decision",
            title="Ручное решение",
            value="Принять / вернуть / продолжить",
            detail=f"Если selected route = continue, целевой переход: {next_target}.",
            status="decision" if selected_route else "waiting",
        ),
        BusinessAssetGReviewExecutionItem(
            id="business-asset-g-review-release-guard",
            title="Release guard",
            value="Не GREEN без Дмитрия",
            detail="Этот workspace помогает пройти проверку, но не закрывает market/client/public release.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-review-execution-active",
            title="Business asset G review execution active",
            status="passed" if is_active else "warning",
            reason=(
                f"G acceptance package for cycle {cycle_number} is active."
                if is_active
                else "G review execution requires active G-package workspace."
            ),
            action=None if is_active else "Open G acceptance package first.",
        ),
        GateResult(
            id="business-asset-g-review-execution-route-visible",
            title="Business asset G review execution route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for G review.",
            action=None if selected_route else "Choose route before G review execution.",
        ),
        GateResult(
            id="business-asset-g-review-execution-steps-visible",
            title="Business asset G review execution steps visible",
            status="passed" if len(items) == 7 else "warning",
            reason="Open package, scope, route, evidence, YELLOW conditions, decision and release guard steps are visible.",
        ),
        GateResult(
            id="business-asset-g-review-execution-release-limited",
            title="Business asset G review execution release limited",
            status="warning",
            reason="Review execution supports manual acceptance but does not close design, market or release gates.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts UX/design/market/release.",
        ),
        GateResult(
            id="business-asset-g-review-execution-existing-runtime-only",
            title="Business asset G review execution existing runtime only",
            status="passed",
            reason="G review execution is derived from G-package and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGReviewExecutionWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_acceptance_package_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Прохождение G-проверки бизнес-актива",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_check_handoff_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_review_execution_workspace: BusinessAssetGReviewExecutionWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGCheckHandoffWorkspaceState:
    is_active = business_asset_g_review_execution_workspace.is_active
    selected_route = business_asset_g_review_execution_workspace.selected_route
    cycle_number = business_asset_g_review_execution_workspace.cycle_number
    accumulated_cycles = business_asset_g_review_execution_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Handoff готов: Дмитрий видит, что проверить вручную, и может безопасно открыть следующий цикл."
    elif selected_route:
        primary_action = "review-handoff"
        primary_action_label = "Проверить handoff"
        summary = "Handoff собирает цель, критерии, evidence, стоп-условия и следующий шаг для ручной G-приемки."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Для handoff нужно сначала выбрать маршрут бизнес-актива."

    route_label = {
        "accept": "принять текущий актив внутри MVP",
        "revise": "вернуть актив на доработку",
        "continue": "разрешить следующий цикл внутри MVP",
    }.get(selected_route or "", "маршрут не выбран")
    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    items = [
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-owner",
            title="Кто принимает",
            value="Дмитрий вручную",
            detail="Автоматический runtime proof не заменяет качественную UX/design/market/release приемку.",
            status="owner",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-target",
            title="Что проверять",
            value=f"SMB-актив из {accumulated_cycles} циклов",
            detail=f"Проверяется понятность сценария цикла {cycle_number}: scope, route, evidence и next action.",
            status="target" if is_active else "waiting",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-criteria",
            title="Критерии",
            value="Понятно без пояснений Codex",
            detail="Пользователь должен увидеть, что принять, что вернуть, что продолжить и почему это не release.",
            status="criteria" if is_active else "waiting",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-evidence",
            title="Evidence",
            value="Live API + compile/build",
            detail="Доказан local MVP runtime; ручной UX/design/market смысл остается отдельной проверкой.",
            status="evidence" if is_active else "waiting",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-stop",
            title="Когда остановить",
            value="Если смысл или обещания неочевидны",
            detail="При сомнении gate остается YELLOW; запрещено считать это public/client release.",
            status="stop",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-next",
            title="Следующий шаг",
            value=route_label,
            detail=f"Целевой переход: {next_target}.",
            status="next" if selected_route else "waiting",
        ),
        BusinessAssetGCheckHandoffItem(
            id="business-asset-g-check-handoff-guard",
            title="Запрет",
            value="Не market/release GREEN",
            detail="Production, security/tenant, integrations, pricing и Evidence Acceptance Center не открывались.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-check-handoff-active",
            title="Business asset G check handoff active",
            status="passed" if is_active else "warning",
            reason=(
                f"G review execution workspace for cycle {cycle_number} is active."
                if is_active
                else "G check handoff requires active G review execution workspace."
            ),
            action=None if is_active else "Open G review execution workspace first.",
        ),
        GateResult(
            id="business-asset-g-check-handoff-route-visible",
            title="Business asset G check handoff route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for handoff.",
            action=None if selected_route else "Choose route before G check handoff.",
        ),
        GateResult(
            id="business-asset-g-check-handoff-complete",
            title="Business asset G check handoff complete",
            status="passed" if len(items) == 7 else "warning",
            reason="Owner, target, criteria, evidence, stop condition, next step and guard are visible.",
        ),
        GateResult(
            id="business-asset-g-check-handoff-manual-gate",
            title="Business asset G check handoff manual gate",
            status="warning",
            reason="Dmitry manual UX/design/market/release acceptance is still required.",
            action="Stop at manual G decision before any external promise.",
        ),
        GateResult(
            id="business-asset-g-check-handoff-existing-runtime-only",
            title="Business asset G check handoff existing runtime only",
            status="passed",
            reason="Handoff is derived from G review execution and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGCheckHandoffWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_review_execution_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Handoff ручной G-проверки",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_decision_draft_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_check_handoff_workspace: BusinessAssetGCheckHandoffWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGDecisionDraftWorkspaceState:
    is_active = business_asset_g_check_handoff_workspace.is_active
    selected_route = business_asset_g_check_handoff_workspace.selected_route
    cycle_number = business_asset_g_check_handoff_workspace.cycle_number
    accumulated_cycles = business_asset_g_check_handoff_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Decision draft готов: вариант продолжения выбран в MVP, следующий цикл уже связан, release остается YELLOW."
    elif selected_route:
        primary_action = "review-decision-draft"
        primary_action_label = "Проверить draft решения"
        summary = "Draft показывает ручные варианты решения и последствия без автоматического закрытия G-приемки."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Для draft решения нужно сначала выбрать маршрут бизнес-актива."

    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    options = [
        BusinessAssetGDecisionDraftOption(
            id="business-asset-g-decision-draft-accept",
            title="Принять внутри MVP",
            value="Asset accepted for internal MVP use",
            detail=f"Подходит, если SMB-актив из {accumulated_cycles} циклов понятен и не требует следующего цикла.",
            status="accept" if selected_route == "accept" else "waiting",
        ),
        BusinessAssetGDecisionDraftOption(
            id="business-asset-g-decision-draft-revise",
            title="Вернуть на доработку",
            value="Revise asset before acceptance",
            detail="Подходит, если scope, критерии, evidence или next action неочевидны без пояснений.",
            status="revise" if selected_route == "revise" else "waiting",
        ),
        BusinessAssetGDecisionDraftOption(
            id="business-asset-g-decision-draft-continue",
            title="Продолжить цикл",
            value=f"Open {next_target}",
            detail="Подходит, если текущий актив понятен, но пользовательский сценарий нужно усилить следующим MVP-циклом.",
            status="continue" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetGDecisionDraftOption(
            id="business-asset-g-decision-draft-guard",
            title="Граница обещаний",
            value="Not market/release GREEN",
            detail="Любой draft-выбор остается внутренним MVP-решением до ручной UX/design/market/release приемки Дмитрия.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-decision-draft-active",
            title="Business asset G decision draft active",
            status="passed" if is_active else "warning",
            reason=(
                f"G check handoff workspace for cycle {cycle_number} is active."
                if is_active
                else "G decision draft requires active G check handoff workspace."
            ),
            action=None if is_active else "Open G check handoff workspace first.",
        ),
        GateResult(
            id="business-asset-g-decision-draft-route-visible",
            title="Business asset G decision draft route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for decision draft.",
            action=None if selected_route else "Choose route before G decision draft.",
        ),
        GateResult(
            id="business-asset-g-decision-draft-options-visible",
            title="Business asset G decision draft options visible",
            status="passed" if len(options) == 4 else "warning",
            reason="Accept, revise, continue and promise-boundary options are visible.",
        ),
        GateResult(
            id="business-asset-g-decision-draft-manual-gate",
            title="Business asset G decision draft manual gate",
            status="warning",
            reason="Decision draft prepares Dmitry's manual G decision but does not apply UX/design/market/release acceptance.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts.",
        ),
        GateResult(
            id="business-asset-g-decision-draft-existing-runtime-only",
            title="Business asset G decision draft existing runtime only",
            status="passed",
            reason="Decision draft is derived from G check handoff and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGDecisionDraftWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_check_handoff_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Draft ручного G-решения",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        options=options,
        gates=gates,
    )


def _build_business_asset_g_decision_impact_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_decision_draft_workspace: BusinessAssetGDecisionDraftWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGDecisionImpactWorkspaceState:
    is_active = business_asset_g_decision_draft_workspace.is_active
    selected_route = business_asset_g_decision_draft_workspace.selected_route
    cycle_number = business_asset_g_decision_draft_workspace.cycle_number
    accumulated_cycles = business_asset_g_decision_draft_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Impact понятен: выбранное продолжение ведет в связанный следующий MVP-цикл, не в release."
    elif selected_route:
        primary_action = "review-impact"
        primary_action_label = "Проверить последствия"
        summary = "Impact показывает последствия выбранного draft-решения до ручного G-подтверждения."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Для impact нужно сначала выбрать draft-решение по бизнес-активу."

    route_label = {
        "accept": "Принять актив внутри MVP",
        "revise": "Вернуть актив на доработку",
        "continue": "Продолжить следующий MVP-цикл",
    }.get(selected_route or "", "Маршрут не выбран")
    effect_label = {
        "accept": "SMB-актив фиксируется как внутренне понятный результат текущей цепочки.",
        "revise": "Цепочка остается на доработке; внешний показ и release не открываются.",
        "continue": "Открывается следующий цикл усиления пользовательского сценария.",
    }.get(selected_route or "", "Сначала нужен выбранный draft-маршрут.")
    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    items = [
        BusinessAssetGDecisionImpactItem(
            id="business-asset-g-decision-impact-selected",
            title="Выбранный вариант",
            value=route_label,
            detail=f"Draft относится к циклу {cycle_number} и {accumulated_cycles} накопленным циклам.",
            status="selected" if selected_route else "waiting",
        ),
        BusinessAssetGDecisionImpactItem(
            id="business-asset-g-decision-impact-effect",
            title="Что изменится",
            value="Внутренний MVP-сценарий",
            detail=effect_label,
            status="effect" if selected_route else "waiting",
        ),
        BusinessAssetGDecisionImpactItem(
            id="business-asset-g-decision-impact-next",
            title="Следующий шаг",
            value=next_target,
            detail="Переход допустим только внутри user MVP и не открывает внешний контур.",
            status="next" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetGDecisionImpactItem(
            id="business-asset-g-decision-impact-manual",
            title="Ручная граница",
            value="Дмитрий подтверждает качественно",
            detail="Runtime proof подтверждает поведение, но не заменяет UX/design/market/release приемку.",
            status="manual",
        ),
        BusinessAssetGDecisionImpactItem(
            id="business-asset-g-decision-impact-guard",
            title="Что не меняется",
            value="RYG остается YELLOW",
            detail="Production, security/tenant, integrations, pricing, client/public release и Evidence Acceptance Center не открывались.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-decision-impact-active",
            title="Business asset G decision impact active",
            status="passed" if is_active else "warning",
            reason=(
                f"G decision draft workspace for cycle {cycle_number} is active."
                if is_active
                else "G decision impact requires active G decision draft workspace."
            ),
            action=None if is_active else "Open G decision draft workspace first.",
        ),
        GateResult(
            id="business-asset-g-decision-impact-route-visible",
            title="Business asset G decision impact route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for impact.",
            action=None if selected_route else "Choose route before G decision impact.",
        ),
        GateResult(
            id="business-asset-g-decision-impact-items-visible",
            title="Business asset G decision impact items visible",
            status="passed" if len(items) == 5 else "warning",
            reason="Selected route, effect, next step, manual boundary and guard are visible.",
        ),
        GateResult(
            id="business-asset-g-decision-impact-manual-gate",
            title="Business asset G decision impact manual gate",
            status="warning",
            reason="Impact preview does not apply Dmitry's manual UX/design/market/release acceptance.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts.",
        ),
        GateResult(
            id="business-asset-g-decision-impact-existing-runtime-only",
            title="Business asset G decision impact existing runtime only",
            status="passed",
            reason="Decision impact is derived from decision draft and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGDecisionImpactWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_decision_draft_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Последствия G-решения",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_decision_readiness_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_decision_impact_workspace: BusinessAssetGDecisionImpactWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGDecisionReadinessWorkspaceState:
    is_active = business_asset_g_decision_impact_workspace.is_active
    selected_route = business_asset_g_decision_impact_workspace.selected_route
    cycle_number = business_asset_g_decision_impact_workspace.cycle_number
    accumulated_cycles = business_asset_g_decision_impact_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Материалы для ручной G-проверки собраны; продолжение связано, но acceptance и release остаются ручными."
    elif selected_route:
        primary_action = "review-readiness"
        primary_action_label = "Проверить готовность"
        summary = "Материалы для ручной G-проверки собраны, но качественное решение Дмитрия еще не применено."
    else:
        primary_action = "return-to-decision"
        primary_action_label = "Вернуться к решению"
        summary = "Для readiness нужен выбранный вариант и impact по бизнес-активу."

    next_target = (
        outcome_next_cycle_launcher.linked_task_run_id
        or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    )
    route_label = {
        "accept": "accept внутри MVP",
        "revise": "revise до ручной приемки",
        "continue": "continue в следующий MVP-цикл",
    }.get(selected_route or "", "маршрут не выбран")
    items = [
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-route",
            title="Вариант выбран",
            value=route_label,
            detail=f"Цикл {cycle_number}; накоплено {accumulated_cycles} циклов бизнес-актива.",
            status="ready" if selected_route else "waiting",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-impact",
            title="Impact виден",
            value="Последствия показаны",
            detail="Пользователь видит эффект, следующий шаг, ручную границу и release guard.",
            status="ready" if is_active else "waiting",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-evidence",
            title="Runtime evidence",
            value="Live API + compile/build required",
            detail="Readiness может фиксироваться только после live proof, compileall и Next build.",
            status="evidence" if is_active else "waiting",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-blockers",
            title="Что блокирует GREEN",
            value="Design/market/release не приняты",
            detail="Остаются ручная UX/design приемка, market/client/public release и production/security/tenant слои.",
            status="blocker",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-manual-owner",
            title="Кто решает",
            value="Дмитрий вручную",
            detail="Workspace готовит проверку, но не применяет qualitative acceptance.",
            status="manual",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-next",
            title="Следующий шаг",
            value=next_target,
            detail="Переход допустим только внутри user MVP до ручного внешнего решения.",
            status="ready" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetGDecisionReadinessItem(
            id="business-asset-g-decision-readiness-guard",
            title="Release guard",
            value="RYG remains YELLOW",
            detail="Нельзя обещать production-ready, client/public release или Evidence Acceptance Center.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-decision-readiness-active",
            title="Business asset G decision readiness active",
            status="passed" if is_active else "warning",
            reason=(
                f"G decision impact workspace for cycle {cycle_number} is active."
                if is_active
                else "G decision readiness requires active G decision impact workspace."
            ),
            action=None if is_active else "Open G decision impact workspace first.",
        ),
        GateResult(
            id="business-asset-g-decision-readiness-route-visible",
            title="Business asset G decision readiness route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for readiness.",
            action=None if selected_route else "Choose route before G decision readiness.",
        ),
        GateResult(
            id="business-asset-g-decision-readiness-items-visible",
            title="Business asset G decision readiness items visible",
            status="passed" if len(items) == 7 else "warning",
            reason="Route, impact, evidence, blockers, manual owner, next step and release guard are visible.",
        ),
        GateResult(
            id="business-asset-g-decision-readiness-manual-gate",
            title="Business asset G decision readiness manual gate",
            status="warning",
            reason="Readiness for manual review is not the same as Dmitry's UX/design/market/release acceptance.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts.",
        ),
        GateResult(
            id="business-asset-g-decision-readiness-existing-runtime-only",
            title="Business asset G decision readiness existing runtime only",
            status="passed",
            reason="Decision readiness is derived from decision impact and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGDecisionReadinessWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_decision_impact_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Готовность к ручной G-проверке",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        items=items,
        gates=gates,
    )


def _build_business_asset_g_decision_checklist_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_decision_readiness_workspace: BusinessAssetGDecisionReadinessWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGDecisionChecklistWorkspaceState:
    is_active = business_asset_g_decision_readiness_workspace.is_active
    selected_route = business_asset_g_decision_readiness_workspace.selected_route
    cycle_number = business_asset_g_decision_readiness_workspace.cycle_number
    accumulated_cycles = business_asset_g_decision_readiness_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Чек-лист ручной G-проверки собран; следующий цикл создан, но acceptance и release остаются ручными."
    elif selected_route:
        primary_action = "review-checklist"
        primary_action_label = "Пройти чек-лист"
        summary = "Чек-лист показывает, что именно Дмитрию нужно глазами проверить до качественного G-решения."
    else:
        primary_action = "return-to-readiness"
        primary_action_label = "Вернуться к readiness"
        summary = "Чек-лист появится после выбранного маршрута и readiness материалов."

    route_label = {
        "accept": "accept внутри MVP",
        "revise": "revise до ручной приемки",
        "continue": "continue в следующий MVP-цикл",
    }.get(selected_route or "", "маршрут не выбран")
    next_target = outcome_next_cycle_launcher.linked_task_run_id or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    checklist = [
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-route",
            title="Понять маршрут",
            value=route_label,
            detail="Проверить, что выбранный вариант не выглядит как внешняя приемка продукта.",
            status="check" if selected_route else "waiting",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-screen",
            title="Экран понятен",
            value="без объяснений Codex",
            detail="Дмитрий должен видеть, что делать дальше, без устного сопровождения.",
            status="focus" if is_active else "waiting",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-evidence",
            title="Evidence видно",
            value="runtime/build only",
            detail="Проверка касается local MVP runtime; рынок, дизайн и release отдельно не закрыты.",
            status="check" if is_active else "waiting",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-boundary",
            title="Ручная граница",
            value="решает Дмитрий",
            detail="Workspace не применяет qualitative UX/design/market acceptance автоматически.",
            status="manual",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-blockers",
            title="Что не GREEN",
            value="design/market/release",
            detail="Эти gates должны оставаться YELLOW до отдельной ручной приемки.",
            status="blocker",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-next",
            title="Следующий шаг",
            value=next_target,
            detail="Продолжение допустимо только внутри пользовательского MVP и текущего сценария.",
            status="check" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetGDecisionChecklistItem(
            id="business-asset-g-decision-checklist-guard",
            title="Запрет обещаний",
            value="не production-ready",
            detail="Нельзя обещать клиентский release, tenant/security слой, pricing, integrations или Evidence Acceptance Center.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-decision-checklist-active",
            title="Business asset G decision checklist active",
            status="passed" if is_active else "warning",
            reason=(
                f"G decision readiness workspace for cycle {cycle_number} is active."
                if is_active
                else "G decision checklist requires active G decision readiness workspace."
            ),
            action=None if is_active else "Open G decision readiness workspace first.",
        ),
        GateResult(
            id="business-asset-g-decision-checklist-route-visible",
            title="Business asset G decision checklist route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for checklist.",
            action=None if selected_route else "Choose route before manual G checklist.",
        ),
        GateResult(
            id="business-asset-g-decision-checklist-items-visible",
            title="Business asset G decision checklist items visible",
            status="passed" if len(checklist) == 7 else "warning",
            reason="Route, screen clarity, evidence, manual boundary, blockers, next step and promise guard are visible.",
        ),
        GateResult(
            id="business-asset-g-decision-checklist-manual-gate",
            title="Business asset G decision checklist manual gate",
            status="warning",
            reason="Checklist supports Dmitry's review but does not close UX/design/market/release gates.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts.",
        ),
        GateResult(
            id="business-asset-g-decision-checklist-existing-runtime-only",
            title="Business asset G decision checklist existing runtime only",
            status="passed",
            reason="Decision checklist is derived from decision readiness and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGDecisionChecklistWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_decision_readiness_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Чек-лист ручной G-проверки",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        checklist=checklist,
        gates=gates,
    )


def _build_business_asset_g_decision_review_summary_workspace_state(
    *,
    task_run_id: str,
    business_asset_g_decision_checklist_workspace: BusinessAssetGDecisionChecklistWorkspaceState,
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState,
) -> BusinessAssetGDecisionReviewSummaryWorkspaceState:
    is_active = business_asset_g_decision_checklist_workspace.is_active
    selected_route = business_asset_g_decision_checklist_workspace.selected_route
    cycle_number = business_asset_g_decision_checklist_workspace.cycle_number
    accumulated_cycles = business_asset_g_decision_checklist_workspace.accumulated_cycles
    has_next_cycle = bool(outcome_next_cycle_launcher.linked_task_run_id)

    if selected_route == "continue" and has_next_cycle:
        primary_action = "open-next-cycle"
        primary_action_label = f"Открыть цикл {outcome_next_cycle_launcher.target_cycle_number}"
        summary = "Сводка ручной G-проверки собрана; следующий MVP-цикл открыт, но qualitative acceptance и release не закрыты."
    elif selected_route:
        primary_action = "review-summary"
        primary_action_label = "Проверить сводку"
        summary = "Сводка показывает, что можно проверить в интерфейсе и что нельзя считать готовым рынку."
    else:
        primary_action = "return-to-checklist"
        primary_action_label = "Вернуться к чек-листу"
        summary = "Сводка появится после checklist и выбранного маршрута G-решения."

    route_label = {
        "accept": "accept внутри MVP",
        "revise": "revise до ручной приемки",
        "continue": "continue в следующий MVP-цикл",
    }.get(selected_route or "", "маршрут не выбран")
    next_target = outcome_next_cycle_launcher.linked_task_run_id or f"цикл {outcome_next_cycle_launcher.target_cycle_number}"
    review_items = [
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-route",
            title="Маршрут",
            value=route_label,
            detail=f"Цикл {cycle_number}; накоплено {accumulated_cycles} циклов бизнес-актива.",
            status="summary" if selected_route else "waiting",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-checklist",
            title="Что проверить",
            value="экранный сценарий",
            detail="Маршрут, экран, evidence, ручная граница, blockers, next step и promise guard сведены в один обзор.",
            status="check" if is_active else "waiting",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-evidence",
            title="Что доказано",
            value="local MVP runtime",
            detail="Backend contract, frontend screen, live API, compileall и Next build могут быть доказаны технически.",
            status="summary" if is_active else "waiting",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-not-green",
            title="Что не GREEN",
            value="UX/design/market/release",
            detail="Ручная приемка, рыночная пригодность, client/public release и production readiness не закрыты.",
            status="blocker",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-owner",
            title="Кто решает",
            value="Дмитрий",
            detail="Сводка помогает проверке, но не заменяет качественное решение владельца продукта.",
            status="manual",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-next",
            title="Следующий шаг",
            value=next_target,
            detail="Разрешен только user MVP сценарий без production/security/tenant/pricing/integrations.",
            status="check" if selected_route == "continue" else "waiting",
        ),
        BusinessAssetGDecisionReviewSummaryItem(
            id="business-asset-g-decision-review-summary-guard",
            title="Risk guard",
            value="RYG stays YELLOW",
            detail="Нельзя обещать рынку или клиенту release, Evidence Acceptance Center или production-ready платформу.",
            status="guard",
        ),
    ]
    gates = [
        GateResult(
            id="business-asset-g-decision-review-summary-active",
            title="Business asset G decision review summary active",
            status="passed" if is_active else "warning",
            reason=(
                f"G decision checklist workspace for cycle {cycle_number} is active."
                if is_active
                else "G decision review summary requires active checklist workspace."
            ),
            action=None if is_active else "Open G decision checklist workspace first.",
        ),
        GateResult(
            id="business-asset-g-decision-review-summary-route-visible",
            title="Business asset G decision review summary route visible",
            status="passed" if selected_route else "warning",
            reason=f"Selected route is {selected_route}." if selected_route else "No selected route for review summary.",
            action=None if selected_route else "Choose route before G decision review summary.",
        ),
        GateResult(
            id="business-asset-g-decision-review-summary-items-visible",
            title="Business asset G decision review summary items visible",
            status="passed" if len(review_items) == 7 else "warning",
            reason="Route, checklist, evidence, not-GREEN blockers, owner, next step and risk guard are visible.",
        ),
        GateResult(
            id="business-asset-g-decision-review-summary-manual-gate",
            title="Business asset G decision review summary manual gate",
            status="warning",
            reason="Review summary is not Dmitry's acceptance and does not close UX/design/market/release gates.",
            action="Keep overall RYG YELLOW until Dmitry manually accepts.",
        ),
        GateResult(
            id="business-asset-g-decision-review-summary-existing-runtime-only",
            title="Business asset G decision review summary existing runtime only",
            status="passed",
            reason="Review summary is derived from checklist and next-cycle launcher without new admin/evidence layers.",
        ),
    ]
    return BusinessAssetGDecisionReviewSummaryWorkspaceState(
        is_active=is_active,
        cycle_number=cycle_number,
        accumulated_cycles=accumulated_cycles,
        current_task_run_id=task_run_id,
        source_task_run_id=business_asset_g_decision_checklist_workspace.source_task_run_id,
        selected_route=selected_route,
        title="Сводка ручной G-проверки",
        summary=summary,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        review_items=review_items,
        gates=gates,
    )


def _build_scenario_resume_state(
    *,
    task_run_id: str,
    form_data: dict[str, object],
    product_status: str,
    artifact_ready: bool,
    action_history: list[ResultActionRecord],
    user_workspace_state: UserWorkspacePersistenceState,
    followup_continuity: FollowupContinuityState,
) -> ScenarioResumeState:
    linked_followup_task_run_id = _latest_linked_followup_task_run_id(action_history)
    scenario_label = (
        _form_data_text(form_data, "business_mission_id")
        or _form_data_text(form_data, "scenario_pack_id")
        or _form_data_text(form_data, "goal")
        or followup_continuity.goal
        or task_run_id
    )
    has_payload = bool(form_data)
    next_step_confirmed = user_workspace_state.next_step_review.confirmed
    accepted = product_status == "accepted"
    ready_for_review = product_status == "ready_for_acceptance"

    if linked_followup_task_run_id:
        primary_action = "open-followup"
        primary_action_label = "Открыть следующий цикл"
        primary_target = linked_followup_task_run_id
        summary = f"Сценарий восстановлен. Следующий запуск уже создан: {linked_followup_task_run_id}."
    elif product_status == "needs_revision" and artifact_ready:
        primary_action = "continue-edit"
        primary_action_label = "Вернуться к правке"
        primary_target = None
        summary = "Сценарий восстановлен. Текущий результат требует правки перед продолжением."
    elif not accepted:
        primary_action = "review-result"
        primary_action_label = "Проверить результат"
        primary_target = None
        summary = "Сценарий восстановлен. Следующее действие - принять решение по результату."
    elif not next_step_confirmed:
        primary_action = "confirm-next-step"
        primary_action_label = "Подтвердить следующий шаг"
        primary_target = None
        summary = "Результат принят. Перед новым запуском нужно подтвердить следующий шаг."
    else:
        primary_action = "create-next-task"
        primary_action_label = "Создать следующий цикл"
        primary_target = None
        summary = "Результат принят и следующий шаг подтвержден. Можно создавать новый цикл."

    steps = [
        ScenarioResumeStep(
            id="scenario-payload",
            title="Контекст миссии",
            status=_step_status(has_payload, not has_payload),
            detail=(
                f"Восстановлен сценарий: {scenario_label}."
                if has_payload
                else "Payload сценария не найден, продолжение строится по Result Center."
            ),
        ),
        ScenarioResumeStep(
            id="result-review",
            title="Результат",
            status=_step_status(accepted or ready_for_review, product_status in {"running", "needs_revision"}),
            detail=(
                "Результат принят."
                if accepted
                else "Результат готов к решению пользователя."
                if ready_for_review
                else "Результат требует правки."
                if product_status == "needs_revision"
                else f"Статус: {product_status}."
            ),
            action_id="accept-result",
        ),
        ScenarioResumeStep(
            id="next-step-review",
            title="Следующий шаг",
            status=_step_status(next_step_confirmed, accepted and not next_step_confirmed),
            detail=user_workspace_state.next_step_review.summary,
            action_id="workspace-next-step-review-confirm",
        ),
        ScenarioResumeStep(
            id="followup-task-run",
            title="Следующий цикл",
            status=_step_status(bool(linked_followup_task_run_id), accepted and next_step_confirmed),
            detail=(
                f"Связанный запуск: {linked_followup_task_run_id}."
                if linked_followup_task_run_id
                else "Следующий запуск можно создать из принятого результата."
                if accepted and next_step_confirmed
                else "Ожидает принятого результата и подтвержденного шага."
            ),
            action_id="create-next-task",
            target_task_run_id=linked_followup_task_run_id,
        ),
    ]

    gates = [
        GateResult(
            id="scenario-resume-payload-restored",
            title="Scenario resume payload restored",
            status="passed" if has_payload else "warning",
            reason=(
                "TaskRun payload contains user scenario context."
                if has_payload
                else "Scenario resume can continue from Result Center, but payload context is incomplete."
            ),
            action=None if has_payload else "Open the original TaskRun or rerun with scenario payload.",
        ),
        GateResult(
            id="scenario-resume-primary-action-ready",
            title="Scenario resume primary action ready",
            status="passed",
            reason=f"Primary continuation action is {primary_action}.",
        ),
        GateResult(
            id="scenario-resume-existing-history-only",
            title="Scenario resume existing history only",
            status="passed",
            reason="Resume state is derived from TaskRun payload, Result Center action history and follow-up links.",
        ),
        GateResult(
            id="scenario-resume-followup-link",
            title="Scenario resume follow-up link",
            status="passed" if linked_followup_task_run_id or primary_action != "open-followup" else "warning",
            reason=(
                f"Follow-up TaskRun {linked_followup_task_run_id} is linked."
                if linked_followup_task_run_id
                else "No linked follow-up is required for the current primary action."
            ),
        ),
    ]

    return ScenarioResumeState(
        is_resumable=has_payload or artifact_ready or bool(action_history) or followup_continuity.is_followup,
        scenario_label=scenario_label,
        primary_action=primary_action,
        primary_action_label=primary_action_label,
        primary_action_target_task_run_id=primary_target,
        summary=summary,
        steps=steps,
        gates=gates,
    )


def build_task_run_result_center(task_run_id: str) -> TaskRunResultCenter:
    task_run = get_task_run(task_run_id)
    if task_run is None:
        raise KeyError(task_run_id)
    artifact = get_artifact(task_run.artifact_id) if task_run.artifact_id else None
    audit_events = list_audit_events_for_target(task_run.id)
    action_history = list_result_action_records(task_run.id)
    completed_action_ids = {record.action_id for record in action_history}
    evidence = {
        "task_run_id": task_run.id,
        "rag": search("Symbiot Runtime MVP path"),
        "llm": get_llm_evidence(task_run.id),
        "quality": evaluate_task_run(task_run.id),
        "audit_event_ids": [event.id for event in audit_events],
    }
    all_gates = _dedupe_gates([*task_run.gates, *evidence["quality"].gates])

    artifact_ready = artifact is not None
    quality_acceptable = evidence["quality"].overall_status in {"passed", "warning"}
    evidence_ready = quality_acceptable and bool(evidence["audit_event_ids"])
    if "accept-result" in completed_action_ids:
        product_status = "accepted"
    elif "return-to-revision" in completed_action_ids:
        product_status = "needs_revision"
    elif task_run.status in {"queued", "running"}:
        product_status = "running"
    elif task_run.status == "completed" and artifact_ready and evidence_ready:
        product_status = "ready_for_acceptance"
    else:
        product_status = "needs_revision"

    acceptance_checklist = [
        GateResult(
            id="result-artifact-ready",
            title="Artifact ready",
            status="passed" if artifact_ready else "failed",
            reason="User-visible artifact is attached to TaskRun." if artifact_ready else "TaskRun has no artifact yet.",
            action=None if artifact_ready else "Rerun task or return to execution.",
        ),
        GateResult(
            id="result-quality-passed",
            title="Quality evidence passed",
            status="passed" if evidence["quality"].overall_status == "passed" else "warning",
            reason=evidence["quality"].evidence_summary,
            action=None if quality_acceptable else "Return result to revision before acceptance.",
        ),
        GateResult(
            id="result-sources-linked",
            title="Sources linked",
            status="passed" if artifact and artifact.sources else "warning",
            reason=f"{len(artifact.sources) if artifact else 0} source references are visible in the result.",
            action=None if artifact and artifact.sources else "Attach source references before client-facing use.",
        ),
        GateResult(
            id="result-audit-captured",
            title="Audit captured",
            status="passed" if evidence["audit_event_ids"] else "warning",
            reason=f"{len(evidence['audit_event_ids'])} audit events are linked to TaskRun.",
            action=None if evidence["audit_event_ids"] else "Record audit event before acceptance.",
        ),
        GateResult(
            id="result-next-action-defined",
            title="Next action defined",
            status="passed",
            reason="Result Center offers acceptance, revision and next-task actions.",
        ),
    ]

    ready_for_acceptance = product_status == "ready_for_acceptance"
    next_task_available = ready_for_acceptance or product_status == "accepted"
    acceptance_decision = _build_acceptance_decision_state(
        artifact_ready=artifact_ready,
        product_status=product_status,
        action_history=action_history,
        next_task_available=next_task_available,
    )
    user_workspace_state = _build_user_workspace_state(action_history)
    followup_continuity = _build_followup_continuity_state(task_run.id)
    form_data = dict(getattr(task_run, "form_data", {}) or {})
    scenario_resume = _build_scenario_resume_state(
        task_run_id=task_run.id,
        form_data=form_data,
        product_status=product_status,
        artifact_ready=artifact_ready,
        action_history=action_history,
        user_workspace_state=user_workspace_state,
        followup_continuity=followup_continuity,
    )
    followup_execution_workspace = _build_followup_execution_workspace_state(
        task_run_id=task_run.id,
        form_data=form_data,
        product_status=product_status,
        artifact_ready=artifact_ready,
        followup_continuity=followup_continuity,
    )
    current_cycle_outcome_workspace = _build_current_cycle_outcome_workspace_state(
        product_status=product_status,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        acceptance_decision=acceptance_decision,
        followup_execution_workspace=followup_execution_workspace,
    )
    outcome_next_cycle_launcher = _build_outcome_next_cycle_launcher_state(
        task_run_id=task_run.id,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        action_history=action_history,
        user_workspace_state=user_workspace_state,
        followup_execution_workspace=followup_execution_workspace,
        current_cycle_outcome_workspace=current_cycle_outcome_workspace,
    )
    cycle_execution_brief = _build_cycle_execution_brief_state(
        task_run_id=task_run.id,
        form_data=form_data,
        product_status=product_status,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        followup_continuity=followup_continuity,
        followup_execution_workspace=followup_execution_workspace,
    )
    cycle_acceptance_workspace = _build_cycle_acceptance_workspace_state(
        task_run_id=task_run.id,
        product_status=product_status,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        action_history=action_history,
        acceptance_decision=acceptance_decision,
        followup_continuity=followup_continuity,
        current_cycle_outcome_workspace=current_cycle_outcome_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    cycle_continuity_workspace = _build_cycle_continuity_workspace_state(
        task_run_id=task_run.id,
        form_data=form_data,
        product_status=product_status,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        followup_continuity=followup_continuity,
        cycle_execution_brief=cycle_execution_brief,
        cycle_acceptance_workspace=cycle_acceptance_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    accumulated_business_asset_workspace = _build_accumulated_business_asset_workspace_state(
        task_run_id=task_run.id,
        product_status=product_status,
        artifact_title=artifact.title if artifact else None,
        artifact_content=artifact.content if artifact else None,
        followup_continuity=followup_continuity,
        cycle_continuity_workspace=cycle_continuity_workspace,
        current_cycle_outcome_workspace=current_cycle_outcome_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_decision_workspace = _build_business_asset_decision_workspace_state(
        task_run_id=task_run.id,
        followup_continuity=followup_continuity,
        acceptance_decision=acceptance_decision,
        accumulated_business_asset_workspace=accumulated_business_asset_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_route_outcome_workspace = _build_business_asset_route_outcome_workspace_state(
        task_run_id=task_run.id,
        business_asset_decision_workspace=business_asset_decision_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_manual_review_workspace = _build_business_asset_manual_review_workspace_state(
        task_run_id=task_run.id,
        business_asset_route_outcome_workspace=business_asset_route_outcome_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_acceptance_package_workspace = _build_business_asset_g_acceptance_package_workspace_state(
        task_run_id=task_run.id,
        business_asset_manual_review_workspace=business_asset_manual_review_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_review_execution_workspace = _build_business_asset_g_review_execution_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_acceptance_package_workspace=business_asset_g_acceptance_package_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_check_handoff_workspace = _build_business_asset_g_check_handoff_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_review_execution_workspace=business_asset_g_review_execution_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_decision_draft_workspace = _build_business_asset_g_decision_draft_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_check_handoff_workspace=business_asset_g_check_handoff_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_decision_impact_workspace = _build_business_asset_g_decision_impact_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_decision_draft_workspace=business_asset_g_decision_draft_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_decision_readiness_workspace = _build_business_asset_g_decision_readiness_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_decision_impact_workspace=business_asset_g_decision_impact_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_decision_checklist_workspace = _build_business_asset_g_decision_checklist_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_decision_readiness_workspace=business_asset_g_decision_readiness_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    business_asset_g_decision_review_summary_workspace = _build_business_asset_g_decision_review_summary_workspace_state(
        task_run_id=task_run.id,
        business_asset_g_decision_checklist_workspace=business_asset_g_decision_checklist_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
    )
    actions = [
        ResultAction(
            id="accept-result",
            title="Принять результат",
            status="completed" if "accept-result" in completed_action_ids else "available" if ready_for_acceptance else "blocked",
            description="Дмитрий подтверждает, что артефакт можно считать результатом задачи.",
            next_status="accepted" if ready_for_acceptance else None,
        ),
        ResultAction(
            id="return-to-revision",
            title="Вернуть на доработку",
            status="completed" if "return-to-revision" in completed_action_ids else "available" if artifact_ready else "blocked",
            description="Результат уходит обратно в рабочую группу с замечаниями.",
            next_status="needs_revision" if artifact_ready else None,
        ),
        ResultAction(
            id="create-next-task",
            title="Создать следующую задачу",
            status="completed" if "create-next-task" in completed_action_ids else "available" if next_task_available else "blocked",
            description="На базе результата открывается следующий управляемый TaskRun.",
            next_status="waiting" if next_task_available else None,
        ),
        ResultAction(
            id="export-evidence",
            title="Сохранить evidence",
            status="available" if evidence_ready else "blocked",
            description="Собрать доказательства: sources, gates, LLM/RAG, audit trail.",
            next_status=None,
        ),
    ]

    next_step = (
        "Результат принят. Следующий продуктовый шаг можно создавать на базе принятого артефакта."
        if product_status == "accepted"
        else "Результат возвращен на доработку. Рабочая группа должна исправить замечания и снова пройти приемку."
        if product_status == "needs_revision"
        else
        "Проверить артефакт и выбрать действие: принять, вернуть на доработку или создать следующую задачу."
        if ready_for_acceptance
        else "Довести TaskRun до состояния artifact + passed evidence before acceptance."
    )
    return TaskRunResultCenter(
        task_run_id=task_run.id,
        product_status=product_status,
        artifact=artifact,
        evidence=evidence,
        timeline=task_run.stages,
        gates=all_gates,
        actions=actions,
        action_history=action_history,
        acceptance_checklist=acceptance_checklist,
        acceptance_decision=acceptance_decision,
        user_workspace_state=user_workspace_state,
        followup_continuity=followup_continuity,
        scenario_resume=scenario_resume,
        followup_execution_workspace=followup_execution_workspace,
        current_cycle_outcome_workspace=current_cycle_outcome_workspace,
        outcome_next_cycle_launcher=outcome_next_cycle_launcher,
        cycle_execution_brief=cycle_execution_brief,
        cycle_acceptance_workspace=cycle_acceptance_workspace,
        cycle_continuity_workspace=cycle_continuity_workspace,
        accumulated_business_asset_workspace=accumulated_business_asset_workspace,
        business_asset_decision_workspace=business_asset_decision_workspace,
        business_asset_route_outcome_workspace=business_asset_route_outcome_workspace,
        business_asset_manual_review_workspace=business_asset_manual_review_workspace,
        business_asset_g_acceptance_package_workspace=business_asset_g_acceptance_package_workspace,
        business_asset_g_review_execution_workspace=business_asset_g_review_execution_workspace,
        business_asset_g_check_handoff_workspace=business_asset_g_check_handoff_workspace,
        business_asset_g_decision_draft_workspace=business_asset_g_decision_draft_workspace,
        business_asset_g_decision_impact_workspace=business_asset_g_decision_impact_workspace,
        business_asset_g_decision_readiness_workspace=business_asset_g_decision_readiness_workspace,
        business_asset_g_decision_checklist_workspace=business_asset_g_decision_checklist_workspace,
        business_asset_g_decision_review_summary_workspace=business_asset_g_decision_review_summary_workspace,
        next_step=next_step,
    )
