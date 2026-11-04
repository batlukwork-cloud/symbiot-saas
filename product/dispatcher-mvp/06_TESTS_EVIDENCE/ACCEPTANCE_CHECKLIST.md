# Dispatcher MVP Acceptance Checklist

Статус: `working / first safe checklist`.

## Naming Boundary

- [ ] Code/runtime/build filenames are English ASCII.
- [ ] Human-readable Obsidian and business documents may use Russian names.
- [ ] README explains which folders are runtime/code and which are documentation.

## Event To Decision Card

- [ ] A mock event envelope creates a normalized `dispatch_event`.
- [ ] The event contains channel, sender, workspace, tenant, time and text.
- [ ] A decision card is created for the same event.
- [ ] The card shows source, summary, suggested action and LLM status.

## Human Gate

- [ ] Runtime is not started before human confirmation.
- [ ] The block reason is `HUMAN_GATE_REQUIRED`.
- [ ] `mission_contract` is empty before confirmation.
- [ ] `obsidian_writes` is empty before confirmation.

## Local Connector Routes

- [ ] `POST /dispatch/events` creates a local event and decision card.
- [ ] `GET /dispatch/inbox` returns the pending decision card.
- [ ] `GET /dispatch/events/:eventId/card` returns the same card.
- [ ] `POST /dispatch/events/:eventId/decision` accepts a Human Gate decision.

## Mission Contract Draft

- [ ] Human Gate `accept` creates a `mission_contract_draft`.
- [ ] The draft contains goal, source, roles, budget boundary and acceptance checklist.
- [ ] Runtime remains blocked after draft creation.
- [ ] Obsidian write permission remains blocked after draft creation.
- [ ] Supabase live and external webhook permissions remain blocked.

## Local UI Mock

- [ ] Desktop mock shows inbox and selected decision card.
- [ ] Desktop mock shows LLM status and runtime stop state.
- [ ] Desktop Human Gate button creates a visible mission contract draft.
- [ ] Telegram mock message contains Human Gate buttons.
- [ ] Telegram `accept` callback creates draft-only state through local routes.
- [ ] Browser proof checks desktop and mobile viewport render without blank UI.

## Local End-To-End Result

- [ ] User can open local Dispatcher on `127.0.0.1`.
- [ ] User can confirm mission contract draft.
- [ ] User can start local sandbox mission after the draft.
- [ ] Sandbox Obsidian bridge creates a mission folder.
- [ ] Mission folder contains passport, contract, result, evidence, reflection and manifest.
- [ ] Manifest confirms no production, Supabase live, external webhook, real data, D1 or readiness change.

## Sources Full Chain

- [ ] User can open `Источники`.
- [ ] Telegram source can run full-chain from local Telegram-compatible update.
- [ ] Email source can connect/test local spool and run full-chain.
- [ ] WhatsApp source can run full-chain from WhatsApp-compatible local update.
- [ ] Webhook source can run full-chain from generic local JSON trigger.
- [ ] Folder source can run full-chain from local TXT/JSON spool.
- [ ] Bitrix24 source can run full-chain from Bitrix24-compatible local task event.
- [ ] Every source creates a decision card, waits for Human Gate, creates mission contract draft and writes 6 sandbox artifacts only after approved local mission start.

## Project Guardrails

- [ ] No production Supabase credentials are used.
- [ ] No external webhook gateway is touched.
- [ ] No real personal data is used in tests.
- [ ] No D1/TST-001, readiness or market-ready status is changed by this checklist.
