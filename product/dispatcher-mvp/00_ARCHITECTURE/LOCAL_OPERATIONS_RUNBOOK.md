# Dispatcher MVP Local Operations Runbook

Статус: `working / local runnable full-chain`.

## Start Dispatcher

```cmd
D:\01_ПРОДУКТЫ\01_СИМБИОТ\03_SAAS_РАЗРАБОТКА\05_L4_РАЗРАБОТКА_ПРОИЗВОДСТВО\10_DISPATCHER_MVP\RUN_DISPATCHER_MVP.cmd
```

Open:

```text
http://127.0.0.1:8788/
```

## Manual Full Chain

1. Press `Telegram` or `Email` in the inbox pane.
2. Press `Подтвердить черновик`.
3. Press `Запустить локальную миссию`.
4. Check the result panel.
5. Check sandbox artifacts in `05_OBSIDIAN_BRIDGE/sandbox_obsidian_vault/02_Missions`.

## Sources Screen

Open `Источники` in the top navigation.

Telegram:

1. Paste BotFather token into `Bot token`.
2. Press `Подключить`.
3. Press `Проверить`.
4. Press `Прозвонить цепочку`.

The token is kept only in local process memory and is not written to evidence or Obsidian.

Email:

1. Press `Подключить`.
2. Press `Проверить`.
3. Press `Прозвонить цепочку`.

This uses the local email spool until an IMAP/OAuth provider is added.

Other local source inputs:

1. WhatsApp: press `Прозвонить цепочку`; the local endpoint accepts WhatsApp Cloud API-compatible updates at `/api/whatsapp/update`.
2. Webhook: press `Прозвонить цепочку`; the local endpoint accepts generic JSON triggers at `/api/webhook/event`.
3. Folder: press `Прозвонить цепочку`; the local file spool accepts TXT/JSON files.
4. Bitrix24: press `Прозвонить цепочку`; the local endpoint accepts Bitrix24-compatible task events at `/api/bitrix24/event`.

Expected result for every source: decision card, Human Gate, mission contract draft, approved local sandbox mission and 6 sandbox artifacts.

## Telegram Polling

Set token in the local environment:

```cmd
set DISPATCHER_TELEGRAM_BOT_TOKEN=<token>
```

Run:

```cmd
D:\01_ПРОДУКТЫ\01_СИМБИОТ\03_SAAS_РАЗРАБОТКА\05_L4_РАЗРАБОТКА_ПРОИЗВОДСТВО\10_DISPATCHER_MVP\RUN_TELEGRAM_POLLING.cmd
```

The adapter uses Telegram `getUpdates` polling and posts each message into local Dispatcher `/api/telegram/update`.

## Email Spool

Run:

```cmd
D:\01_ПРОДУКТЫ\01_СИМБИОТ\03_SAAS_РАЗРАБОТКА\05_L4_РАЗРАБОТКА_ПРОИЗВОДСТВО\10_DISPATCHER_MVP\RUN_EMAIL_SPOOL_POLLER.cmd
```

Drop email JSON files into:

```text
D:\01_ПРОДУКТЫ\01_СИМБИОТ\03_SAAS_РАЗРАБОТКА\05_L4_РАЗРАБОТКА_ПРОИЗВОДСТВО\10_DISPATCHER_MVP\01_CONNECTOR_SERVICE\local_inbox\email
```

Expected shape:

```json
{
  "id": "email_001",
  "from": {
    "email": "client@example.local",
    "name": "Client"
  },
  "subject": "Новая задача",
  "text": "Проверь договор и собери пакет документов",
  "attachments": [],
  "risk_flags": []
}
```

## Acceptance

The full local chain is accepted when:

- trigger creates a decision card;
- Human Gate creates mission contract draft;
- second Human Gate starts local sandbox runtime;
- six artifacts are written in sandbox;
- manifest keeps production, Supabase live, external webhook, real personal data, D1 and readiness unchanged.
