# Graph Executor MVP

Исполняемый runtime графа `symbiot.dispatcher_cycle` (v0.1). Читает `graph-package.dispatch_cycle.v0.1.json` и исполняет узлы: state store (SQLite), checkpoints, event log, human-in-loop, routing по таблице с приоритетами.

Статус: `working / local sandbox MVP` (доказан 06.08.2026, 24/24 теста PASS). Не production: не открывает сетевые порты наружу (только 127.0.0.1), не использует реальные LLM по умолчанию (LLM OFF, model_calls=0), пишет артефакты только в sandbox.

## Структура

| Файл | Назначение |
|---|---|
| `executor.js` | Ядро: цикл исполнения, маршрутизация, checkpoints, human-in-loop |
| `state_store.js` | SQLite (node:sqlite): executions, events, checkpoints, event_index |
| `router.js` | Оценка expr-условий и выбор маршрута по приоритету |
| `handlers.js` | Обработчики 13 узлов + waiting (детерминированные моки, LLM OFF) |
| `api.js` | HTTP API на 127.0.0.1:8790 |
| `test_executor.js` | Прогон 24 eval-сценариев |

## Запуск

```bash
node test_executor.js        # тесты (24 проверки)
node api.js                  # HTTP API — в разработке runbook
```

## API (127.0.0.1:8790)

```
POST /api/executor/start   {"payload": {"id","channel","received_at","text",...}}
GET  /api/executor/:id/status
POST /api/executor/:id/decide   {"task_id","decision","comment?","answers?"}
GET  /api/executor/:id/events
GET  /api/executor/:id/checkpoints
```

## Ключевые гарантии (из паспорта графа и ТЗ диспетчера)

- **Human Gate**: до решения человека `runtime_started=false`, `obsidian_writes=0`, `model_calls=0`.
- **Дедупликация событий** по `event_id` (индексация после проверки в узле intake).
- **Лимиты циклов**: contract ≤1 доработка, evidence ≤1, human.accept ≤2 возврата, clarify ≤2 раунда (настраивается в маршрутах).
- **Idempotency**: повторный вход `result.report` не создаёт дубль (проверка `report.sent`).
- **Reflection**: причины возвратов сохраняются в `acceptance_history` → `reflection.records`.
- **Terminal states**: `accepted / rejected / cancelled / archived / failed / requires_human`.

## Известные ограничения MVP

- LLM-узлы (classify/propose/contract/runtime) — детерминированные моки; реальный LLM-адаптер подключается через `GRAPH_EXECUTOR_LLM_URL` / `GRAPH_EXECUTOR_LLM_KEY` (OpenAI-совместимый) — не реализован в этом броске.
- `attempts` хранятся с ключами без точек (`contract_build`), expr-пути не поддерживают скобочную нотацию.
- Таймеры (defer/waiting) — только ручное решение через `/decide`; автоматические напоминания не реализованы.
- Одна БД на процесс; конкурентные execution-ы не тестировались.
- Артефакты пишутся в `sandbox_vault/` (переопределяется параметром конструктора).

## Доказательства (прогон 06.08.2026)

```
T1 EVAL-001 happy path        5/5 PASS (путь: intake→…→archive, 9 файлов, checkpoints)
T2 EVAL-002 битое событие     3/3 PASS (requires_human, model_calls=0)
T3 EVAL-003 дубль             2/2 PASS (второй execution → cancelled)
T4 EVAL-005 reject            2/2 PASS (rejected + причина)
T5 EVAL-006 revision          3/3 PASS (rework_pass=2, причина в reflection)
T6 EVAL-019 неполный контракт 3/3 PASS (contract rework, runtime не запускался до валидного)
T7 defer                      2/2 PASS (waiting → resume → human.gate)
T8 HTTP API smoke             4/4 PASS (start/decide/status/events)
ИТОГО: 24/24 PASS
```

Связанные артефакты: паспорт графа и routing — в `00_GRAPH_STUDIO` (Obsidian), package — в `04_L3_ПРОЕКТИРОВАНИЕ\02_АРХИТЕКТУРА\graph-package.dispatch_cycle.v0.1.json`.
