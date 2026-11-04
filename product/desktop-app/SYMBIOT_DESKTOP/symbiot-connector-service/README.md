# Symbiot Connector Service

Local connector for Symbiot Obsidian Plugin.

## Start

Double-click `start-symbiot-connector.cmd` or run:

```bash
npm run start
```

Default URL: `http://127.0.0.1:8787`.

## Checks

```bash
npm run check
npm run proof
npm run proof:mobile
```

## Current Capability

- Obsidian plugin registration and admin snapshot.
- Mission create/run with approval guard.
- Three-slot LLM Hub with local encrypted MVP provider store.
- Mobile web panel and QR pairing at `/mobile`.
- Safe Windows MVP actions: `list_processes`, `check_path`; `open_url` and `open_folder` require approval.

## Boundaries

- Production remote relay is not enabled.
- Production tenant secret storage is not completed.
- Arbitrary program execution is intentionally blocked.
- Marketplace publication remains a separate release gate.
