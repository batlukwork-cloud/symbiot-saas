const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { requestHeaders } = require("./connector-auth-helper");

const port = Number(process.env.SYMBIOT_CONNECTOR_SUPABASE_PROOF_PORT || 8804);
const baseUrl = `http://127.0.0.1:${port}`;
const rootDir = path.resolve(__dirname, "..");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_SUPABASE_BUSINESS_MEMORY_FOUNDATION_PROOF_2026-07-17.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_035A_SUPABASE_BUSINESS_MEMORY_FOUNDATION_2026-07-17.md");
const migrationPath = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const fakeServiceKey = "supabase-service-role-secret-proof-value-never-output";
const fakeAnonKey = "supabase-anon-secret-proof-value-never-output";

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

async function request(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: requestHeaders(body),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (error) { json = { parseError: error.message, raw: text }; }
  return { method, route, status: response.status, ok: response.ok, text, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const result = await request("GET", "/health");
      if (result.ok && result.json && result.json.ok) return result;
    } catch (_) {}
    await wait(150);
  }
  throw new Error("Connector service did not become healthy in 5s");
}

function analyzeMigration() {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const presentTables = requiredTables.filter((table) => new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\b`, "i").test(sql));
  const rlsTables = requiredTables.filter((table) => new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql));
  const ownerTables = requiredTables.filter((table) => table === "profiles" || new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}[\\s\\S]*?owner_user_id\\s+uuid`, "i").test(sql));
  return {
    migrationPath,
    migrationSha256: sha256(sql),
    presentTables,
    missingTables: requiredTables.filter((table) => !presentTables.includes(table)),
    rlsTables,
    rlsMissingTables: requiredTables.filter((table) => !rlsTables.includes(table)),
    ownerScopedTables: ownerTables,
    ownerScopeMissingTables: requiredTables.filter((table) => !ownerTables.includes(table)),
    hasVectorExtension: /create\s+extension\s+if\s+not\s+exists\s+vector/i.test(sql),
    hasKnowledgeChunksEmbedding: /knowledge_chunks[\s\S]*embedding\s+vector\(1536\)/i.test(sql),
    hasProviderKeyFingerprint: /key_fingerprint\s+text/i.test(sql),
    hasNoPlainSecretColumn: !/(api_key|secret_key|service_role_key)\s+text/i.test(sql)
  };
}

function noSecretLeak(values) {
  return values.every((value) => {
    const text = String(value || "");
    return !text.includes(fakeServiceKey) && !text.includes(fakeAnonKey);
  });
}

function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-035A: Supabase Business Memory Foundation",
    "",
    "Дата: 2026-07-17",
    "Проект / код: SYM-SaaS / Symbiot SaaS Runtime Platform",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что доказано",
    "",
    "- создана Supabase migration для бизнес-памяти Симбиота;",
    "- schema содержит пользователя, организацию, vault, проекты, миссии, роли бизнеса, обучение ролей, источники, RAG chunks, результаты, runs, evidence, providers, audit и sync;",
    "- RLS включен на обязательных таблицах;",
    "- connector отдает `/cloud/status` и `/cloud/schema`;",
    "- секретные Supabase ключи не возвращаются в response;",
    "- readiness не повышалась.",
    "",
    "## Что не доказано",
    "",
    "- live Supabase connection;",
    "- применение миграций в реальном Supabase project;",
    "- runtime sync plugin -> Supabase;",
    "- RAG retrieval/citations;",
    "- production tenant security.",
    "",
    "## Evidence",
    "",
    `- JSON: \`${evidencePath}\``,
    `- Migration: \`${migrationPath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(migrationPath)) throw new Error("migration file missing");

  const migration = analyzeMigration();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(port),
      SYMBIOT_SUPABASE_URL: "https://obp035a-proof.supabase.co",
      SYMBIOT_SUPABASE_ANON_KEY: fakeAnonKey,
      SYMBIOT_SUPABASE_SERVICE_ROLE_KEY: fakeServiceKey
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    const health = await waitForHealth();
    const cloudStatus = await request("GET", "/cloud/status");
    const cloudSchema = await request("GET", "/cloud/schema");
    const snapshot = await request("GET", "/admin/snapshot");
    const preflight = await request("GET", "/preflight");

    const responseTexts = [health.text, cloudStatus.text, cloudSchema.text, snapshot.text, preflight.text];
    const checks = {
      migrationFilePresent: fs.existsSync(migrationPath),
      allRequiredTablesPresent: migration.missingTables.length === 0,
      allRequiredTablesHaveRls: migration.rlsMissingTables.length === 0,
      allTablesOwnerScoped: migration.ownerScopeMissingTables.length === 0,
      vectorExtensionPresent: migration.hasVectorExtension,
      knowledgeEmbeddingColumnPresent: migration.hasKnowledgeChunksEmbedding,
      providersUseFingerprintNotSecret: migration.hasProviderKeyFingerprint && migration.hasNoPlainSecretColumn,
      healthOk: health.ok,
      cloudStatusOk: cloudStatus.ok,
      cloudSchemaOk: cloudSchema.ok,
      snapshotIncludesCloud: Boolean(snapshot.json && snapshot.json.cloud),
      preflightIncludesCloud: Boolean(preflight.json && preflight.json.preflight && preflight.json.preflight.cloud),
      cloudConfiguredYellow: cloudStatus.json && cloudStatus.json.status === "configured_yellow_until_live_connection_proof",
      connectionProofNotClaimed: cloudStatus.json && cloudStatus.json.connectionProof === "not_run_in_obp035a",
      schemaVersionPresent: Boolean(cloudStatus.json && cloudStatus.json.schemaVersion),
      noSecretLeak: noSecretLeak(responseTexts)
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_SUPABASE_BUSINESS_MEMORY_FOUNDATION_PROOF_2026-07-17",
      project: "SYM-SaaS / Symbiot Obsidian Plugin Connector",
      gate: "OBP-035A Business Memory Foundation / Supabase Schema",
      date: "2026-07-17",
      status: passed ? "PASS_WITH_CONDITIONS_SUPABASE_BUSINESS_MEMORY_FOUNDATION" : "FAILED",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      baseUrl,
      migration,
      checks,
      responses: {
        health: { status: health.status, ok: health.ok },
        cloudStatus: cloudStatus.json,
        cloudSchema: {
          status: cloudSchema.status,
          ok: cloudSchema.ok,
          tableCount: cloudSchema.json && Array.isArray(cloudSchema.json.tables) ? cloudSchema.json.tables.length : 0,
          humanMeaningKeys: cloudSchema.json && cloudSchema.json.humanMeaning ? Object.keys(cloudSchema.json.humanMeaning) : []
        },
        snapshot: { status: snapshot.status, ok: snapshot.ok, hasCloud: checks.snapshotIncludesCloud },
        preflight: { status: preflight.status, ok: preflight.ok, hasCloud: checks.preflightIncludesCloud }
      },
      boundaries: [
        "Live Supabase connection is not proved in OBP-035A.",
        "Migration is not applied to a real project in this proof.",
        "RAG retrieval and citations are not implemented yet.",
        "Production tenant security remains OBP-029.",
        "No full Obsidian vault upload is allowed without explicit user source consent."
      ]
    };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    if (!passed) {
      console.error(JSON.stringify(evidence.checks, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath }, null, 2));
    }
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
