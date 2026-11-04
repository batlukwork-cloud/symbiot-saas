# Dispatcher MVP Architecture

Статус: `working / source-level architecture`.

## Product Rule

Диспетчерская начинается не с поля ввода в Desktop UI, а с входящего события. Событие становится карточкой решения. Runtime запускается только после Human Gate.

## Naming Rule

Архитектура применяет Obsidian-правило `D0_RULE-SYM-CORE-Правило_именования_code_runtime_и_человеческих_документов`:

- code/runtime/build files: English ASCII;
- Obsidian, client, business and human documents: Russian allowed;
- machine-readable schemas and proof scripts: English ASCII.

## MVP Route

```text
trigger event
  -> channel adapter
  -> event envelope
  -> dispatch_event
  -> decision card
  -> Human Gate
  -> mission contract
  -> confirmed Obsidian write
  -> Role Runtime
  -> evidence
  -> reflection
```

## Layer Ownership

| Layer | MVP Address | Responsibility |
|---|---|---|
| Connector service | `01_CONNECTOR_SERVICE` | receive and normalize events |
| Supabase schema | `02_SUPABASE_SCHEMA` | planned machine state, not live production in this throw |
| Desktop UI | `03_DESKTOP_UI` | future inbox and decision card |
| Telegram bot | `04_TELEGRAM_BOT` | future mobile event source and button channel |
| Obsidian bridge | `05_OBSIDIAN_BRIDGE` | write only confirmed mission artifacts |
| Tests/evidence | `06_TESTS_EVIDENCE` | local proofs and acceptance checklist |

## Guardrails

- No runtime before Human Gate.
- Human Gate may create a mission contract draft, but not start runtime.
- No Obsidian result folder before a separate confirmed write decision.
- No production secrets, deploy, external webhook or real personal data.
- No readiness change without runtime evidence and gate acceptance.
- LLM is optional and must be visible as `LLM ON`, `LLM OFF`, or `waiting for human`.

## First Proof

The first local proof must show:

- a mock event creates a `dispatch_event`;
- a decision card is produced;
- `runtime.started` is `false`;
- block reason is `HUMAN_GATE_REQUIRED`;
- `obsidianWrites` remains empty before confirmation.

## Local Connector Proof

The second local proof must show:

- `POST /dispatch/events` stores a local event and decision card;
- `GET /dispatch/inbox` exposes the pending card;
- `GET /dispatch/events/:eventId/card` opens the same card;
- `POST /dispatch/events/:eventId/decision` records Human Gate acceptance;
- Human Gate acceptance creates a `mission_contract_draft`;
- runtime remains blocked with `MISSION_CONTRACT_DRAFT_ONLY`;
- Obsidian writes, Supabase live and external webhooks remain untouched.

## Local UI Proof

The third local proof must show:

- Desktop mock renders inbox, selected decision card and Human Gate action;
- Telegram mock returns a safe local message shape with Human Gate buttons;
- clicking Desktop Human Gate creates a visible mission contract draft;
- Telegram `accept` uses local connector routes and creates the same draft-only state;
- desktop and mobile viewports render without blank UI;
- runtime, Obsidian writes, Supabase live and external webhooks remain blocked.

## Local Working Proof

The fourth local proof must show:

- local dev server binds only to `127.0.0.1`;
- browser loads the Desktop UI from the local server;
- UI seeds the demo event through `POST /api/demo/seed`;
- Human Gate button posts to `POST /dispatch/events/:eventId/decision`;
- API state contains the mission contract draft after the click;
- runtime remains blocked, with no Obsidian write and no production systems touched.

## Local End-To-End Proof

The fifth local proof must show:

- after mission contract draft, a second human approval starts local sandbox runtime;
- local runtime scope is explicitly `local_sandbox_only`;
- sandbox Obsidian bridge writes mission artifacts only inside `05_OBSIDIAN_BRIDGE/sandbox_obsidian_vault`;
- six artifacts are created: passport, contract, result, evidence, reflection and manifest;
- manifest states that production, Supabase live, external webhook, real personal data, D1 and readiness were not touched.
