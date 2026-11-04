# G3 Task Intake + Role Preview

Дата: 2026-07-03
КСГ: SAAS-0925
Статус: закрыто

## Назначение

Этот слой делает постановку задачи и выбор рабочей группы управляемым продуктовым сценарием. Пользователь не просто вводит текст в форму, а видит, готова ли задача к запуску, какая рабочая группа выбрана, почему она выбрана и какие gates должны пройти до TaskRun.

## Что реализовано

- Добавлен backend endpoint `/api/task-runs/intake-preview`.
- Добавлены схемы `TaskIntakePreviewRequest`, `TaskIntakePreviewResponse`, `WorkgroupRolePreview`.
- Добавлен сервис `task_intake.py`, который:
  - проверяет обязательные поля задачи;
  - выбирает рабочую группу из runtime role directory;
  - возвращает основания выбора;
  - возвращает gates готовности входа;
  - возвращает recommended profile для запуска TaskRun.
- Frontend подключен к preview API.
- Кнопка запуска главного сценария блокируется, пока intake preview не готов.
- UI показывает:
  - readiness score;
  - missing fields;
  - workgroup roles;
  - responsibilities;
  - selection reasons;
  - task intake gates;
  - recommended profile.

## Проверка

- `backend\.venv\Scripts\python.exe -m compileall backend\app`: passed.
- `python scripts\g3_smoke_check.py`: passed, 46 API markers.
- `npm run build`: passed.
- live backend `/health`: `ok`.
- live `/api/task-runs/intake-preview`: `ready`, `readiness_score=100`, `workgroup_count=5`, `gate_count=5`.
- live frontend `/`: `200`.
- frontend contains `Task Intake Preview`: `true`.
- frontend contains `Role Preview`: `true`.

## Следующий слой

`SAAS-0926`: TaskRun Monitor + Result Center. Нужно сделать выполнение, результат, evidence and actions еще более управляемыми как продуктовый путь.

## Связи

- [[Task Intake + Role Preview]]
- [[Product Workbench MVP]]
- [[Product-Fit Gate v0.1]]
- [[Runtime]]
- [[Quality Gates]]
- [[Audit Layer]]
- [[RAG]]
