# Symbiot Supabase Foundation

Status: `OBP-035A / YELLOW`.

This folder contains the Supabase schema foundation for Symbiot business memory.

## What this is

Supabase is the structured server memory for:

- users and organizations;
- Obsidian vaults;
- projects and business missions;
- business roles;
- role training materials;
- approved knowledge sources;
- future RAG chunks;
- result artifacts;
- mission runs and steps;
- evidence;
- provider metadata without secret values;
- audit and sync events.

## What this is not

- Not a full market-ready backend.
- Not a silent copy of the user's full Obsidian vault.
- Not production tenant security proof.
- Not a completed RAG layer.
- Not a replacement for the local connector.

## Migration

Current migration:

```text
migrations/202607170235_business_memory_foundation.sql
```

The migration enables RLS skeleton policies and creates the first business-memory tables.

## Connector endpoints

Protected by the local connector token:

```text
GET /cloud/status
GET /cloud/schema
```

`/cloud/status` reports `not_configured_yellow` until Supabase environment variables are configured and a live connection proof is run.

Expected environment variables for a future live proof:

```text
SYMBIOT_SUPABASE_URL
SYMBIOT_SUPABASE_ANON_KEY
SYMBIOT_SUPABASE_SERVICE_ROLE_KEY
```

The service role key must never be sent to the Obsidian plugin, mobile web panel, markdown notes, evidence files or admin snapshot.
