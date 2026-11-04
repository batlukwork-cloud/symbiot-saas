const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_SUPABASE_LIVE_CONNECTION_PROOF_2026-07-17.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_035A2_SUPABASE_LIVE_CONNECTION_2026-07-17.md");
const migrationPath = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");

const requiredTables = [
  "profiles",
  "organizations",
  "organization_members",
  "vaults",
  "projects",
  "business_roles",
  "role_training_items",
  "missions",
  "knowledge_sources",
  "knowledge_chunks",
  "artifacts",
  "runs",
  "run_steps",
  "evidence_items",
  "providers",
  "audit_events",
  "sync_events"
];

function env(name, fallback = "") {
  return process.env[name] || fallback || "";
}

function fingerprint(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

function redact(value) {
  if (!value) return "";
  return `[redacted:${fingerprint(value)}]`;
}

function envConfig() {
  const supabaseUrl = env("SYMBIOT_SUPABASE_URL", env("SUPABASE_URL")).trim();
  const anonKey = env("SYMBIOT_SUPABASE_ANON_KEY", env("SYMBIOT_SUPABASE_PUBLISHABLE_KEY", env("SUPABASE_ANON_KEY", env("SUPABASE_PUBLISHABLE_KEY")))).trim();
  const serviceRoleKey = env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SYMBIOT_SUPABASE_SECRET_KEY", env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SECRET_KEY")))).trim();
  const dbUrl = env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL")).trim();
  const testUserId = env("SYMBIOT_SUPABASE_TEST_USER_ID").trim();
  return { supabaseUrl, anonKey, serviceRoleKey, dbUrl, testUserId };
}

function configSummary(config) {
  let urlHost = null;
  if (config.supabaseUrl) {
    try { urlHost = new URL(config.supabaseUrl).host; } catch (_) { urlHost = "invalid_url"; }
  }
  return {
    supabaseUrlPresent: Boolean(config.supabaseUrl),
    supabaseUrlHost: urlHost,
    anonKeyPresent: Boolean(config.anonKey),
    anonKeyFingerprint: fingerprint(config.anonKey),
    publishableKeySupported: true,
    serviceRoleKeyPresent: Boolean(config.serviceRoleKey),
    serviceRoleKeyFingerprint: fingerprint(config.serviceRoleKey),
    secretKeySupported: true,
    dbUrlPresent: Boolean(config.dbUrl),
    dbUrlFingerprint: fingerprint(config.dbUrl),
    testUserIdPresent: Boolean(config.testUserId),
    testUserIdFingerprint: fingerprint(config.testUserId)
  };
}

async function restTableCheck(config) {
  if (!config.supabaseUrl || !(config.serviceRoleKey || config.anonKey)) {
    return { ok: false, skipped: true, reason: "missing_supabase_url_or_key" };
  }
  const key = config.serviceRoleKey || config.anonKey;
  const results = [];
  for (const table of requiredTables) {
    const url = `${config.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}?select=*&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: "application/json"
      }
    });
    const text = await response.text();
    results.push({
      table,
      status: response.status,
      ok: response.ok,
      responseKind: text.trim().startsWith("[") ? "json_array" : text.trim().startsWith("{") ? "json_object" : "text"
    });
  }
  return {
    ok: results.every((item) => item.ok),
    skipped: false,
    results,
    missingOrBlockedTables: results.filter((item) => !item.ok).map((item) => ({ table: item.table, status: item.status }))
  };
}

async function withPgClient(config, fn) {
  if (!config.dbUrl) return { ok: false, skipped: true, reason: "missing_db_url" };
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch (error) {
    return { ok: false, skipped: true, reason: "pg_dependency_missing", error: error.message };
  }
  const client = new Client({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applyMigration(config) {
  if (!fs.existsSync(migrationPath)) return { ok: false, skipped: false, reason: "migration_missing" };
  return withPgClient(config, async (client) => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await client.query(sql);
    return { ok: true, skipped: false, migrationSha256: createHash("sha256").update(sql).digest("hex") };
  });
}

async function verifyTablesViaPg(config) {
  return withPgClient(config, async (client) => {
    const result = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
      [requiredTables]
    );
    const present = result.rows.map((row) => row.table_name);
    const rls = await client.query(
      "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) order by c.relname",
      [requiredTables]
    );
    const rlsEnabled = rls.rows.filter((row) => row.rls_enabled).map((row) => row.table_name);
    return {
      ok: present.length === requiredTables.length && rlsEnabled.length === requiredTables.length,
      skipped: false,
      presentTables: present,
      missingTables: requiredTables.filter((table) => !present.includes(table)),
      rlsEnabledTables: rlsEnabled,
      rlsMissingTables: requiredTables.filter((table) => !rlsEnabled.includes(table))
    };
  });
}

async function smokeInsertSelect(config) {
  if (!config.dbUrl || !config.testUserId) return { ok: false, skipped: true, reason: "missing_db_url_or_test_user_id" };
  return withPgClient(config, async (client) => {
    const suffix = randomUUID();
    const organizationId = randomUUID();
    const vaultId = randomUUID();
    const missionId = randomUUID();
    const roleId = randomUUID();
    const evidenceId = randomUUID();
    await client.query("begin");
    try {
      await client.query("insert into public.organizations (id, owner_user_id, name) values ($1, $2, $3)", [organizationId, config.testUserId, `OBP-035A.2 proof org ${suffix}`]);
      await client.query("insert into public.vaults (id, organization_id, owner_user_id, vault_fingerprint, vault_name) values ($1, $2, $3, $4, $5)", [vaultId, organizationId, config.testUserId, `proof-${suffix}`, "Proof Vault"]);
      await client.query("insert into public.business_roles (id, organization_id, vault_id, owner_user_id, title, purpose) values ($1, $2, $3, $4, $5, $6)", [roleId, organizationId, vaultId, config.testUserId, "Proof business role", "Proof role for live Supabase smoke"]);
      await client.query("insert into public.missions (id, organization_id, vault_id, owner_user_id, title, assigned_role_ids) values ($1, $2, $3, $4, $5, $6::uuid[])", [missionId, organizationId, vaultId, config.testUserId, "Proof mission", [roleId]]);
      await client.query("insert into public.evidence_items (id, organization_id, vault_id, mission_id, owner_user_id, status, summary) values ($1, $2, $3, $4, $5, $6, $7)", [evidenceId, organizationId, vaultId, missionId, config.testUserId, "yellow", "Proof evidence row"]);
      await client.query("insert into public.audit_events (organization_id, vault_id, owner_user_id, actor_type, action, target_type, target_id, result) values ($1, $2, $3, $4, $5, $6, $7, $8)", [organizationId, vaultId, config.testUserId, "proof", "supabase_live_smoke", "mission", missionId, "ok"]);
      const check = await client.query(
        "select m.id as mission_id, br.id as role_id, ei.id as evidence_id from public.missions m join public.business_roles br on br.id = any(m.assigned_role_ids) join public.evidence_items ei on ei.mission_id = m.id where m.id = $1",
        [missionId]
      );
      await client.query("rollback");
      return { ok: check.rowCount === 1, skipped: false, insertedAndRolledBack: true, checkedMission: missionId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function noSecretLeak(evidence, config) {
  const text = JSON.stringify(evidence);
  return [config.anonKey, config.serviceRoleKey, config.dbUrl].filter(Boolean).every((secret) => !text.includes(secret));
}

function classifyLiveError(error, config) {
  const message = error && error.message ? error.message : "";
  let dbHost = null;
  if (config.dbUrl) {
    try { dbHost = new URL(config.dbUrl).hostname; } catch (_) { dbHost = "invalid_db_url"; }
  }
  if (message.includes("ENOTFOUND") || message.includes("EAI_AGAIN")) {
    return {
      status: "BLOCKED_DB_CONNECTION_HOST_UNREACHABLE_YELLOW",
      blocker: `DB host is not reachable from Node runtime${dbHost ? `: ${dbHost}` : ""}. Use Supabase Session/Transaction pooler connection string or IPv4-compatible database URL.`
    };
  }
  if (message.includes("password authentication failed") || message.includes("SASL")) {
    return {
      status: "BLOCKED_DB_CONNECTION_AUTH_FAILED_YELLOW",
      blocker: "Database connection reached Postgres, but username/password authentication failed. Reset/copy the database password and rerun proof."
    };
  }
  if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("ECONNREFUSED")) {
    return {
      status: "BLOCKED_DB_CONNECTION_NETWORK_YELLOW",
      blocker: `Database network connection failed${dbHost ? ` for ${dbHost}` : ""}. Check Supabase pooler/direct connection mode and local network access.`
    };
  }
  return {
    status: "FAILED_LIVE_SUPABASE_FOUNDATION",
    blocker: message || "unknown_live_supabase_error"
  };
}

function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-035A.2: Live Supabase Project Connection",
    "",
    "Дата: 2026-07-17",
    "Проект / код: SYM-SaaS / Symbiot SaaS Runtime Platform",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "",
    "- наличие Supabase credentials;",
    "- возможность применить migration через DB URL;",
    "- наличие таблиц и RLS в live project;",
    "- REST-доступ к таблицам через Supabase API;",
    "- smoke insert/select для owner-scoped бизнес-памяти, если задан test user id;",
    "- отсутствие секретов в evidence.",
    "",
    "## Результат",
    "",
    `- status: \`${evidence.status}\``,
    `- blocker: \`${evidence.blocker || "none"}\``,
    "",
    "## Что не считать готовым",
    "",
    "- RAG retrieval/citations;",
    "- production tenant security;",
    "- admin dashboard runtime;",
    "- OpenRouter gateway;",
    "- market-ready release.",
    "",
    "## Evidence",
    "",
    `- JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const config = envConfig();
  const summary = configSummary(config);
  const evidence = {
    id: "SYM_OBSIDIAN_PLUGIN_SUPABASE_LIVE_CONNECTION_PROOF_2026-07-17",
    project: "SYM-SaaS / Symbiot Obsidian Plugin Connector",
    gate: "OBP-035A.2 Live Supabase Project Connection + Migration Apply Proof",
    date: "2026-07-17",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    config: summary,
    checks: {},
    boundaries: [
      "No full Obsidian vault upload.",
      "Service role key must stay in trusted runtime only.",
      "RAG/admin sync/security remain separate gates."
    ]
  };

  const missing = [];
  if (!config.supabaseUrl) missing.push("SYMBIOT_SUPABASE_URL");
  if (!config.serviceRoleKey) missing.push("SYMBIOT_SUPABASE_SECRET_KEY or SYMBIOT_SUPABASE_SERVICE_ROLE_KEY");
  if (!config.dbUrl) missing.push("SYMBIOT_SUPABASE_DB_URL");

  if (missing.length) {
    evidence.status = "BLOCKED_MISSING_SUPABASE_CREDENTIALS_YELLOW";
    evidence.blocker = `Missing ${missing.join(", ")}`;
    evidence.nextStep = "Set Supabase URL, service role key and DB connection string, then rerun npm run proof:supabase-live.";
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 2;
    return;
  }

  try {
    evidence.checks.applyMigration = await applyMigration(config);
    evidence.checks.verifyTablesViaPg = await verifyTablesViaPg(config);
    evidence.checks.restTableCheck = await restTableCheck(config);
    evidence.checks.smokeInsertSelect = await smokeInsertSelect(config);
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    const hardPass = Boolean(
      evidence.checks.applyMigration.ok &&
      evidence.checks.verifyTablesViaPg.ok &&
      evidence.checks.restTableCheck.ok &&
      evidence.checks.smokeInsertSelect.ok &&
      evidence.checks.noSecretLeak
    );
    const partialPass = Boolean(
      evidence.checks.applyMigration.ok &&
      evidence.checks.verifyTablesViaPg.ok &&
      evidence.checks.restTableCheck.ok &&
      evidence.checks.noSecretLeak
    );
    evidence.status = hardPass ? "PASS_WITH_CONDITIONS_LIVE_SUPABASE_FOUNDATION" : partialPass ? "PARTIAL_PASS_LIVE_SUPABASE_FOUNDATION_OWNER_SMOKE_SKIPPED" : "FAILED_LIVE_SUPABASE_FOUNDATION";
    if (!evidence.checks.smokeInsertSelect.ok) evidence.blocker = evidence.checks.smokeInsertSelect.reason || "owner_scoped_smoke_failed";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, blocker: evidence.blocker || null, evidencePath, reportPath }, null, 2));
    if (!hardPass) process.exitCode = 1;
  } catch (error) {
    const classified = classifyLiveError(error, config);
    evidence.status = classified.status;
    evidence.blocker = classified.blocker;
    evidence.error = error.message;
    evidence.errorStack = error.stack ? error.stack.split("\n").slice(0, 5) : [];
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.error(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, error: error.message, evidencePath, reportPath }, null, 2));
    process.exitCode = 1;
  }
}

main();
