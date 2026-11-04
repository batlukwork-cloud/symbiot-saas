# Dispatcher MVP

Статус: `working / safe local runnable MVP`.

Диспетчерская - первый модуль управляемого входа миссий SYM-SaaS. Она принимает входящее событие, показывает человеку карточку решения и запрещает runtime до явного Human Gate.

## Источники

- `CURRENT_STATE_SYM_SAAS.md`
- `CHANGELOG_SYM_SAAS.md`
- `EVIDENCE_REGISTRY_SYM_SAAS.md`
- `2026-08-01_ДИСПЕТЧЕР_ОПЕРАЦИОННЫЙ ЦИКЛ РАБОТЫ СИБИОТА.docx`
- `D5_CANVAS-SYM-SAAS-ДИСПЕТЧЕРСКАЯ_WORKFLOW_МИССИИ_2026-08-01.canvas`
- Obsidian-правило: `D0_RULE-SYM-CORE-Правило_именования_code_runtime_и_человеческих_документов`

## Структура

```text
00_ARCHITECTURE      architecture notes, schemas and route decisions
01_CONNECTOR_SERVICE local mock/service code
02_SUPABASE_SCHEMA   future SQL migrations and schema notes
03_DESKTOP_UI        future Desktop Inbox/Card UI
04_TELEGRAM_BOT      future Telegram adapter
05_OBSIDIAN_BRIDGE   future confirmed-write bridge
06_TESTS_EVIDENCE    local proofs and acceptance checklists
99_ARCHIVE           inactive or superseded materials
```

## Naming Boundary

Code/runtime/build files use English ASCII names. Human-readable Obsidian, client and business documents may use Russian names. This folder follows that boundary: technical files are ASCII; explanatory text may be Russian.

## MVP Scope

Safe local proofs:

1. Accept a local mock event envelope.
2. Normalize it into `dispatch_event`.
3. Produce a decision card for Desktop/Telegram.
4. Keep runtime blocked until Human Gate.
5. Leave Obsidian unchanged before confirmation.
6. Expose local connector routes without external webhooks.
7. Record Human Gate acceptance as a mission contract draft.
8. Keep runtime, Supabase live and Obsidian writes blocked after the draft.

## Local Connector Routes

```text
POST /dispatch/events
GET  /dispatch/inbox
GET  /dispatch/events/:eventId/card
POST /dispatch/events/:eventId/decision
```

The routes are source-level local handlers, not a production network service.

## Local Dev Server

`01_CONNECTOR_SERVICE/local_dev_server.js` starts a local-only runnable dispatcher on `127.0.0.1`. The browser UI calls the same local connector routes used by EV-119.

## Local UI Mock

The first user-control mock is intentionally local:

- Desktop: `03_DESKTOP_UI/dispatcher_mock_ui.html`
- Telegram view model: `04_TELEGRAM_BOT/telegram_mock_view.js`

The UI shows inbox, decision card, LLM status, runtime stop state and Human Gate action. Human Gate `accept` creates a visible mission contract draft only; execution and Obsidian writes remain blocked.

## How To Test Locally

Run:

```powershell
& '<локальный путь>
```

Open:

```text
http://127.0.0.1:8788/
```

Manual acceptance:

1. The inbox shows one Telegram event.
2. The decision card shows `LLM OFF` and `Runtime остановлен`.
3. Press `Подтвердить черновик`.
4. A mission contract draft appears.
5. Press `Запустить локальную миссию`.
6. A result panel appears with sandbox mission folder and 6 artifacts.
7. Production, Supabase live and external webhooks remain untouched.

Evidence: `06_TESTS_EVIDENCE/SYM_DISPATCHER_MVP_LOCAL_WORKING_DISPATCHER_PROOF_2026-08-02.json`.
End-to-end evidence: `06_TESTS_EVIDENCE/SYM_DISPATCHER_MVP_LOCAL_E2E_PROOF_2026-08-02.json`.

## External Trigger Inputs

Current working inputs:

- Telegram-compatible update endpoint: `POST /api/telegram/update`
- Telegram polling adapter: `04_TELEGRAM_BOT/telegram_polling_adapter.js`
- Email spool endpoint: `POST /api/email/poll`
- Email spool poller: `01_CONNECTOR_SERVICE/email_spool_poller.js`

Runbook: `00_ARCHITECTURE/LOCAL_OPERATIONS_RUNBOOK.md`.

## Sources Screen

Open `http://127.0.0.1:8788/` and switch to `Источники`.

Working controls:

- Telegram: token input, `Подключить`, `Проверить`, `Прозвонить цепочку`
- Email: spool connect, `Проверить`, `Прозвонить цепочку`
- WhatsApp: local WhatsApp Cloud API-compatible update, `Прозвонить цепочку`
- Webhook: local generic JSON endpoint, `Прозвонить цепочку`
- Folder: local TXT/JSON spool, `Прозвонить цепочку`
- Bitrix24: local task-event compatible endpoint, `Прозвонить цепочку`

Telegram token is kept only in local process memory. It is not written to files, Obsidian or evidence.

All six source controls were browser-proofed in EV-125. Each source completed:

```text
trigger -> decision card -> Human Gate -> mission contract draft -> approved local sandbox mission -> 6 artifacts
```

Evidence: `06_TESTS_EVIDENCE/SYM_DISPATCHER_MVP_ALL_SOURCES_SCREEN_PROOF_2026-08-02.json`.

## Out Of Scope

- production Supabase
- secrets and real API keys
- external webhook gateway
- WhatsApp production
- real personal data
- readiness or D1/TST-001 status changes
