# Event Envelope Schema

Статус: `working / source-level schema`.

## Purpose

`event_envelope` is the single incoming format for Telegram, Desktop UI, email, Bitrix24, file watcher and later channels.

## Required Fields

| Field | Type | Meaning |
|---|---|---|
| `tenant_id` | string | owner boundary |
| `workspace_id` | string | workspace or vault context |
| `channel` | string | `telegram`, `desktop`, `email`, `bitrix24`, `file_watcher`, `obsidian` |
| `sender.id` | string | channel sender id |
| `received_at` | ISO string | event timestamp |
| `payload.text` | string | raw user text, transcript or message body |

## Optional Fields

| Field | Type | Meaning |
|---|---|---|
| `attachments[]` | array | file refs, hashes and mime types |
| `payload.subject` | string | email/task subject |
| `payload.raw_ref` | string | reference to raw source |
| `risk_flags[]` | array | risk markers such as `personal_data`, `legal`, `money`, `security` |
| `metadata` | object | channel-specific data |

## Normalized Dispatch Event

```json
{
  "id": "dispatch_evt_<stable_hash>",
  "tenant_id": "tenant_demo",
  "workspace_id": "workspace_demo",
  "channel": "telegram",
  "sender": {
    "id": "tg_1001",
    "display_name": "Demo Sender"
  },
  "received_at": "2026-08-02T10:00:00.000Z",
  "status": "action_proposed",
  "payload": {
    "text": "Проверь договор и собери пакет документов"
  },
  "attachments": [],
  "risk_flags": [],
  "llm": {
    "status": "OFF_MOCK",
    "model_calls": 0
  }
}
```

## Decision Card Fields

| Field | Meaning |
|---|---|
| `event_id` | link to dispatch event |
| `title` | short human title |
| `summary` | what Symbiot understood |
| `suggested_action` | proposed action before execution |
| `allowed_decisions` | `accept`, `correct`, `clarify`, `defer`, `archive` |
| `human_gate_required` | must be `true` before runtime |
| `runtime_started` | must be `false` before confirmation |
| `obsidian_writes` | must be empty before confirmation |

## Local Connector Routes

| Route | Result |
|---|---|
| `POST /dispatch/events` | creates local `dispatch_event` and decision card |
| `GET /dispatch/inbox` | lists pending decision cards |
| `GET /dispatch/events/:eventId/card` | returns one decision card and draft if it exists |
| `POST /dispatch/events/:eventId/decision` | records Human Gate decision |

These routes are local source-level handlers. They do not open a network port and do not call production systems.

## Mission Contract Draft Fields

| Field | Meaning |
|---|---|
| `id` | stable draft id |
| `event_id` | source dispatch event |
| `status` | `draft_created_after_human_gate` |
| `goal` | human-readable mission goal from the accepted event |
| `proposed_roles` | draft role set for later confirmation |
| `proposed_budget` | draft budget boundary, not allocated in this proof |
| `permissions.runtime_allowed` | must remain `false` in this proof |
| `permissions.obsidian_write_allowed` | must remain `false` in this proof |
| `runtime_started` | must remain `false` |
| `obsidian_writes` | must remain empty |
