from __future__ import annotations

from dataclasses import dataclass

from app.schemas import (
    GateResult,
    TaskIntakePreviewRequest,
    TaskIntakePreviewResponse,
    WorkgroupRequirementPreview,
    WorkgroupRolePreview,
)
from app.services.role_directory import get_role


REQUIRED_FIELDS = ["goal", "expected_artifact", "source_context", "urgency"]

BASE_ROLE_IDS = ["runtime-operator", "qa-lead", "kontroler-riskov", "sekretar-los"]
COMMERCIAL_ROLE_IDS = ["commercial-director", "direktor-po-prodazham", "direktor-po-marketingu"]
EVIDENCE_ROLE_IDS = ["arhivarius-i-reestrator", "metodolog"]
UX_ROLE_IDS = ["dizayner", "dizayner-produkta-i-interfeysov"]
LEGACY_ALIASES = {"sales-manager": "commercial-director"}


@dataclass(frozen=True)
class RoleRequirement:
    id: str
    title: str
    required: bool
    role_ids: tuple[str, ...]
    permission_any: tuple[str, ...] = ()


def _value(payload: TaskIntakePreviewRequest, field: str) -> str:
    return str(getattr(payload, field, "") or "").strip()


def _text(payload: TaskIntakePreviewRequest) -> str:
    return f"{payload.process_id} {payload.goal} {payload.expected_artifact} {payload.source_context}".lower()


def _gate(gate_id: str, title: str, passed: bool, reason: str, action: str | None = None) -> GateResult:
    return GateResult(
        id=gate_id,
        title=title,
        status="passed" if passed else "warning",
        reason=reason,
        action=action,
    )


def _normalize_role_ids(role_ids: list[str]) -> list[str]:
    normalized: list[str] = []
    for role_id in role_ids:
        mapped = LEGACY_ALIASES.get(role_id, role_id)
        if mapped not in normalized:
            normalized.append(mapped)
    return normalized


def _append_unique(target: list[str], role_ids: list[str]) -> None:
    for role_id in role_ids:
        if role_id not in target:
            target.append(role_id)


def _recommended_role_ids(payload: TaskIntakePreviewRequest) -> list[str]:
    text = _text(payload)
    role_ids = list(BASE_ROLE_IDS)

    commercial_markers = ["commercial", "коммер", "кп", "предлож", "продаж", "маркет", "клиент", "оффер"]
    evidence_markers = ["источник", "доказ", "evidence", "аудит", "верси", "паспорт", "документ", "rag", "ocr"]
    ux_markers = ["интерфейс", "ux", "ui", "дизайн", "экран", "упаков", "визуал"]

    if payload.process_id == "commercial-proposal" or any(marker in text for marker in commercial_markers):
        _append_unique(role_ids, COMMERCIAL_ROLE_IDS)
    else:
        _append_unique(role_ids, ["commercial-director"])

    if any(marker in text for marker in evidence_markers):
        _append_unique(role_ids, EVIDENCE_ROLE_IDS)

    if any(marker in text for marker in ux_markers):
        _append_unique(role_ids, UX_ROLE_IDS)

    return [role_id for role_id in role_ids if get_role(role_id) is not None]


def _requirements(payload: TaskIntakePreviewRequest, recommended_role_ids: list[str]) -> list[RoleRequirement]:
    text = _text(payload)
    requirements = [
        RoleRequirement("dispatch", "Диспетчер запуска", True, ("runtime-operator",), ("task.dispatch",)),
        RoleRequirement("domain-owner", "Владелец бизнес-смысла", True, tuple(COMMERCIAL_ROLE_IDS), ()),
        RoleRequirement("quality", "Приемка качества", True, ("qa-lead",), ()),
        RoleRequirement("risk", "Контроль рисков", True, ("kontroler-riskov",), ()),
        RoleRequirement("logging", "Фиксация хода работы", True, ("sekretar-los",), ()),
        RoleRequirement("evidence", "Доказательная база", True, tuple(EVIDENCE_ROLE_IDS + ["qa-lead"]), ()),
    ]
    if any(marker in text for marker in ["интерфейс", "ux", "ui", "дизайн", "экран", "упаков", "визуал"]):
        requirements.append(RoleRequirement("design", "Дизайн и восприятие", False, tuple(UX_ROLE_IDS), ()))
    if any(role_id in recommended_role_ids for role_id in EVIDENCE_ROLE_IDS):
        requirements.append(RoleRequirement("method", "Методологическая переработка", False, ("metodolog",), ()))
    return requirements


def _role_matches_requirement(role: dict[str, object], requirement: RoleRequirement) -> bool:
    runtime_role = str(role["runtime_role"])
    permissions = set(str(permission) for permission in role.get("permissions", []))
    return runtime_role in requirement.role_ids or bool(set(requirement.permission_any) & permissions)


def _role_preview(role_id: str, responsibility: str, selection_reason: str) -> WorkgroupRolePreview | None:
    role = get_role(role_id)
    if role is None:
        return None
    return WorkgroupRolePreview(
        runtime_role=str(role["runtime_role"]),
        display_name=str(role["display_name"]),
        symbiot_role_ref=str(role["symbiot_role_ref"]),
        department=str(role["department"]),
        access_level=str(role["access_level"]),
        permissions=sorted(str(permission) for permission in role.get("permissions", [])),
        responsibility=responsibility,
        selection_reason=selection_reason,
    )


def _responsibility(role_id: str) -> str:
    responsibilities = {
        "runtime-operator": "Диспетчеризирует задачу, проверяет вход и запускает TaskRun.",
        "commercial-director": "Отвечает за коммерческий смысл, ценность и пригодность результата для клиента.",
        "direktor-po-prodazham": "Проверяет продающую логику, следующий шаг и применимость результата в продажах.",
        "direktor-po-marketingu": "Проверяет позиционирование, упаковку и понятность оффера.",
        "qa-lead": "Принимает результат по quality gates, acceptance и evidence.",
        "kontroler-riskov": "Проверяет риски, стоп-условия и последствия следующего шага.",
        "sekretar-los": "Фиксирует ход работы, результат, решения и воспроизводимость маршрута.",
        "arhivarius-i-reestrator": "Проверяет evidence, ссылки, версии и сохранность артефакта.",
        "metodolog": "Превращает входящие материалы в методику, критерии и рабочий инструмент.",
        "dizayner": "Проверяет визуальную упаковку результата и восприятие пользователем.",
        "dizayner-produkta-i-interfeysov": "Проверяет экранный сценарий, UX-логику и понятность действий.",
    }
    return responsibilities.get(role_id, "Участвует в задаче по своей зоне ответственности.")


def _selection_reason(role_id: str, override_active: bool, recommended_role_ids: list[str]) -> str:
    if override_active and role_id not in recommended_role_ids:
        return "Добавлен пользователем вручную; система проверяет, какую capability он закрывает."
    reasons = {
        "runtime-operator": "Обязателен: без диспетчера нельзя управляемо запустить TaskRun.",
        "commercial-director": "Выбран как доменный владелец коммерческого результата.",
        "direktor-po-prodazham": "Нужен для проверки продаваемости результата и следующего действия.",
        "direktor-po-marketingu": "Нужен для упаковки оффера и формулировок для клиента.",
        "qa-lead": "Обязателен для приемки результата и quality gates.",
        "kontroler-riskov": "Обязателен для проверки рисков и стоп-условий.",
        "sekretar-los": "Обязателен для фиксации маршрута, решения и evidence.",
        "arhivarius-i-reestrator": "Подключен из-за источников, версий или доказательной базы.",
        "metodolog": "Подключен, когда вход нужно превратить в методику или критерии.",
        "dizayner": "Подключен, когда результат требует визуальной упаковки.",
        "dizayner-produkta-i-interfeysov": "Подключен, когда задача затрагивает UX/UI сценарий.",
    }
    return reasons.get(role_id, "Выбран алгоритмом по смыслу задачи и требованиям роли.")


def build_task_intake_preview(payload: TaskIntakePreviewRequest) -> TaskIntakePreviewResponse:
    missing_fields = [field for field in REQUIRED_FIELDS if not _value(payload, field)]
    recommended_role_ids = _recommended_role_ids(payload)
    selected_role_ids = _normalize_role_ids(payload.selected_role_ids) if payload.selected_role_ids else recommended_role_ids
    selected_role_ids = [role_id for role_id in selected_role_ids if get_role(role_id) is not None]
    override_active = bool(payload.selected_role_ids) and selected_role_ids != recommended_role_ids

    requirements = _requirements(payload, recommended_role_ids)
    role_records = {role_id: get_role(role_id) for role_id in selected_role_ids}
    requirement_previews: list[WorkgroupRequirementPreview] = []
    missing_required_capabilities: list[str] = []

    for requirement in requirements:
        matched = [
            role_id
            for role_id, role in role_records.items()
            if role is not None and _role_matches_requirement(role, requirement)
        ]
        satisfied = bool(matched)
        if requirement.required and not satisfied:
            missing_required_capabilities.append(requirement.title)
        requirement_previews.append(
            WorkgroupRequirementPreview(
                id=requirement.id,
                title=requirement.title,
                required=requirement.required,
                satisfied=satisfied,
                matched_role_ids=matched,
                missing_reason=None if satisfied else "Нет роли, закрывающей это обязательное требование.",
            )
        )

    matched_role_ids = sorted({role_id for requirement in requirement_previews for role_id in requirement.matched_role_ids})
    redundant_role_ids = sorted([role_id for role_id in selected_role_ids if role_id not in matched_role_ids and role_id not in recommended_role_ids])

    workgroup = [
        role
        for role_id in selected_role_ids
        if (
            role := _role_preview(
                role_id,
                responsibility=_responsibility(role_id),
                selection_reason=_selection_reason(role_id, override_active, recommended_role_ids),
            )
        )
        is not None
    ]

    gates = [
        _gate(
            "gate-task-intake-completeness",
            "Task Intake Completeness",
            len(missing_fields) == 0,
            "Все обязательные поля заполнены." if not missing_fields else f"Не заполнено: {', '.join(missing_fields)}.",
            "Заполнить недостающие поля перед запуском." if missing_fields else None,
        ),
        _gate(
            "gate-workgroup-required-capabilities",
            "Required Workgroup Capabilities",
            len(missing_required_capabilities) == 0,
            "Все обязательные capability закрыты ролями."
            if not missing_required_capabilities
            else f"Не закрыто: {', '.join(missing_required_capabilities)}.",
            "Добавить недостающие роли или вернуть рекомендованный состав." if missing_required_capabilities else None,
        ),
        _gate(
            "gate-workgroup-role-directory",
            "Role Directory Gate",
            len(workgroup) == len(selected_role_ids),
            "Все выбранные роли найдены в role_directory.",
            "Убрать неизвестные роли." if len(workgroup) != len(selected_role_ids) else None,
        ),
        _gate(
            "gate-workgroup-overrides",
            "Manual Override Gate",
            len(redundant_role_ids) == 0,
            "Лишних ручных ролей нет." if not redundant_role_ids else f"Роли без явного вклада: {', '.join(redundant_role_ids)}.",
            "Подтвердить ручное добавление или убрать лишние роли." if redundant_role_ids else None,
        ),
    ]

    readiness_checks = [len(missing_fields) == 0, len(redundant_role_ids) == 0]
    readiness_checks.extend(requirement.satisfied for requirement in requirement_previews if requirement.required)
    passed_count = sum(1 for check in readiness_checks if check)
    readiness_score = int(round((passed_count / len(readiness_checks)) * 100))
    status = "ready" if readiness_score == 100 and all(gate.status == "passed" for gate in gates) else "needs_input"
    decision = (
        "Система рекомендует состав по смыслу задачи и закрытым capability."
        if not override_active
        else "Пользователь изменил состав; система проверяет ручной override по обязательным capability."
    )

    return TaskIntakePreviewResponse(
        process_id=payload.process_id,
        status=status,
        readiness_score=readiness_score,
        required_fields=REQUIRED_FIELDS,
        missing_fields=missing_fields,
        recommended_profile_id="product-fit-managed-task",
        recommended_role_ids=recommended_role_ids,
        selected_role_ids=selected_role_ids,
        workgroup=workgroup,
        requirements=requirement_previews,
        missing_required_capabilities=missing_required_capabilities,
        redundant_role_ids=redundant_role_ids,
        override_active=override_active,
        workgroup_decision=decision,
        selection_basis=[
            "смысл задачи и ожидаемый артефакт определяют доменный контур",
            "каждая обязательная capability должна быть закрыта ролью из role_directory",
            "ручной выбор пользователя допускается, но проверяется по недостающим и лишним ролям",
            "качество, риски, evidence и фиксация маршрута обязательны до запуска TaskRun",
            "выбор рабочей группы должен быть объясним пользователю до старта",
        ],
        gates=gates,
        next_action=(
            "Можно запускать главный сценарий."
            if status == "ready"
            else "Исправить состав рабочей группы или вернуться к рекомендованному набору."
        ),
    )
