const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createHash, randomUUID } = require("crypto");
const { hydrateApiVaultEnv } = require("./api-vault-env");

const rootDir = path.resolve(__dirname, "..");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP047_SUPABASE_RAG_PERSISTENCE_PROOF_2026-07-21.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_047_SUPABASE_RAG_PERSISTENCE_2026-07-21.md");
const foundationMigrationPath = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const graphMigrationPath = path.join(__dirname, "supabase", "migrations", "202607200120_mission_graph_persistence.sql");
const connectorPort = 8799;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;
const tempAppData = path.join(rootDir, "runtime_logs", "obp047_temp_appdata");

function env(name, fallback = "") { return process.env[name] || fallback || ""; }
function fingerprint(value) { return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null; }
function envConfig() {
  return {
    supabaseUrl: env("SYMBIOT_SUPABASE_URL", env("SUPABASE_URL")).trim(),
    anonKey: env("SYMBIOT_SUPABASE_ANON_KEY", env("SYMBIOT_SUPABASE_PUBLISHABLE_KEY", env("SUPABASE_ANON_KEY", env("SUPABASE_PUBLISHABLE_KEY")))).trim(),
    serviceRoleKey: env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SYMBIOT_SUPABASE_SECRET_KEY", env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SECRET_KEY")))).trim(),
    dbUrl: env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL")).trim(),
    testUserId: env("SYMBIOT_SUPABASE_TEST_USER_ID").trim()
  };
}
function configSummary(config) {
  let urlHost = null;
  try { urlHost = config.supabaseUrl ? new URL(config.supabaseUrl).host : null; } catch (_) { urlHost = "invalid_url"; }
  return { supabaseUrlPresent: Boolean(config.supabaseUrl), supabaseUrlHost: urlHost, anonKeyPresent: Boolean(config.anonKey), anonKeyFingerprint: fingerprint(config.anonKey), serviceRoleKeyPresent: Boolean(config.serviceRoleKey), serviceRoleKeyFingerprint: fingerprint(config.serviceRoleKey), dbUrlPresent: Boolean(config.dbUrl), dbUrlFingerprint: fingerprint(config.dbUrl), testUserIdPresent: Boolean(config.testUserId), testUserIdFingerprint: fingerprint(config.testUserId) };
}
function noSecretLeak(evidence, config) {
  const text = JSON.stringify(evidence);
  return [config.anonKey, config.serviceRoleKey, config.dbUrl].filter(Boolean).every((secret) => !text.includes(secret));
}
async function withPgClient(config, fn) {
  let Client;
  try { ({ Client } = require("pg")); } catch (error) { return { ok: false, skipped: true, reason: "pg_dependency_missing", error: error.message }; }
  const client = new Client({ connectionString: config.dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
async function applyMigration(config, migrationPath) {
  return withPgClient(config, async (client) => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await client.query(sql);
    return { ok: true, migration: path.basename(migrationPath), migrationSha256: createHash("sha256").update(sql).digest("hex") };
  });
}
async function createTemporaryTestUser(config) {
  if (config.testUserId) return { userId: config.testUserId, created: false, cleanup: async () => ({ ok: true, skipped: true, reason: "configured_test_user" }) };
  const userId = randomUUID();
  const email = `symbiot-obp047-${userId}@example.com`;
  await withPgClient(config, async (client) => {
    await client.query("insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ($1, 'authenticated', 'authenticated', $2, now(), $3::jsonb, $4::jsonb, now(), now(), false, false)", [userId, email, JSON.stringify({ provider: "email", providers: ["email"] }), JSON.stringify({ proof: "OBP-047", temporary: true })]);
  });
  return { userId, created: true, cleanup: async () => withPgClient(config, async (client) => { await client.query("delete from auth.users where id=$1", [userId]); return { ok: true, skipped: false }; }) };
}
async function seedOwnerScope(config, userId) {
  return withPgClient(config, async (client) => {
    const organizationId = randomUUID();
    const vaultId = randomUUID();
    const missionId = randomUUID();
    await client.query("insert into public.organizations (id, owner_user_id, name) values ($1,$2,$3)", [organizationId, userId, "OBP-047 proof org"]);
    await client.query("insert into public.vaults (id, organization_id, owner_user_id, vault_fingerprint, vault_name) values ($1,$2,$3,$4,$5)", [vaultId, organizationId, userId, `obp047-${vaultId}`, "OBP-047 Proof Vault"]);
    await client.query("insert into public.missions (id, organization_id, vault_id, owner_user_id, title, mission_type, status) values ($1,$2,$3,$4,$5,$6,$7)", [missionId, organizationId, vaultId, userId, "OBP-047 RAG persistence mission", "client_mission", "draft"]);
    return { ok: true, organizationId, vaultId, missionId };
  });
}
async function cleanupOwnerScope(config, userId, organizationId) {
  return withPgClient(config, async (client) => {
    if (organizationId) await client.query("delete from public.organizations where id=$1", [organizationId]);
    return { ok: true, organizationDeleted: Boolean(organizationId), userIdFingerprint: fingerprint(userId) };
  });
}
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){ const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline){ try { const response = await fetch(`${connectorUrl}/health`); const json = await response.json(); if (response.ok && json.ok) return json; } catch(error){ lastError = error; } await sleep(150); } throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`); }
function readConnectorToken(){ const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json"); const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8")); if (!parsed.token) throw new Error("connector token missing"); return parsed.token; }
async function verifyRows(config, scope) {
  return withPgClient(config, async (client) => {
    const result = await client.query(
      `select
        (select count(*)::int from public.knowledge_sources where vault_id=$1 and owner_user_id=$2) as source_count,
        (select count(*)::int from public.knowledge_chunks kc join public.knowledge_sources ks on ks.id=kc.source_id where ks.vault_id=$1 and kc.owner_user_id=$2) as chunk_count,
        (select count(*)::int from public.knowledge_chunks kc join public.knowledge_sources ks on ks.id=kc.source_id where ks.vault_id=$1 and kc.owner_user_id=$2 and kc.embedding is not null) as embedding_count,
        (select count(*)::int from public.runs where vault_id=$1 and owner_user_id=$2 and runtime_level='supabase_rag_persistence_mvp') as run_count,
        (select count(*)::int from public.artifacts where vault_id=$1 and owner_user_id=$2 and artifact_type='rag_context_result') as artifact_count,
        (select count(*)::int from public.evidence_items where vault_id=$1 and owner_user_id=$2 and evidence_type='rag_persistence_proof') as evidence_count,
        (select count(*)::int from public.audit_events where vault_id=$1 and owner_user_id=$2 and action='rag_context_persist') as audit_count`,
      [scope.vaultId, scope.userId]
    );
    return { ok: true, ...result.rows[0] };
  });
}
function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-047: Supabase Vector/RAG Persistence",
    "",
    "Дата: 2026-07-21",
    "Проект / код: SYM-SaaS / Symbiot Obsidian Plugin + SaaS Runtime Backend",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "",
    "- connector endpoint `/cloud/rag-context/write`;",
    "- запись selected sources в `knowledge_sources`;",
    "- запись citations/chunks в `knowledge_chunks`;",
    "- наличие vector field через stable hash vector, не semantic embedding;",
    "- запись run/artifact/evidence/audit;",
    "- cleanup тестовых данных;",
    "- no-secret-leak в evidence.",
    "",
    "## Что не считать готовым",
    "",
    "- production semantic embeddings;",
    "- автоматический RAG по всему vault;",
    "- tenant security audit уровня production;",
    "- market-ready external memory.",
    "",
    `JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}
async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(tempAppData, { recursive: true, force: true });
  fs.mkdirSync(tempAppData, { recursive: true });
  process.env.APPDATA = tempAppData;
  hydrateApiVaultEnv();
  const config = envConfig();
  const evidence = { id: "SYM_OBSIDIAN_PLUGIN_OBP047_SUPABASE_RAG_PERSISTENCE_PROOF_2026-07-21", project: "SYM-SaaS / OBP-047 Supabase Vector/RAG Persistence", date: "2026-07-21", readinessChanged: false, readiness: "13205 / 14075 = 93.8%", config: configSummary(config), checks: {}, boundaries: ["selected sources only", "no full vault sync", "stable hash vector is not semantic embedding", "test rows are cleaned up", "no secrets in evidence"] };
  const missing = [];
  if (!config.dbUrl) missing.push("SYMBIOT_SUPABASE_DB_URL");
  if (missing.length) {
    evidence.status = "BLOCKED_MISSING_SUPABASE_RAG_CREDENTIALS_YELLOW";
    evidence.blocker = `Missing ${missing.join(", ")}`;
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 2; return;
  }
  let server = null;
  let testUser = null;
  let scope = null;
  try {
    evidence.checks.applyFoundationMigration = await applyMigration(config, foundationMigrationPath);
    if (fs.existsSync(graphMigrationPath)) evidence.checks.applyGraphMigration = await applyMigration(config, graphMigrationPath);
    testUser = await createTemporaryTestUser(config);
    evidence.checks.temporaryTestUser = { ok: Boolean(testUser.userId), created: testUser.created, userIdFingerprint: fingerprint(testUser.userId) };
    const seeded = await seedOwnerScope(config, testUser.userId);
    scope = { userId: testUser.userId, ...seeded };
    evidence.checks.seedOwnerScope = { ok: seeded.ok, organizationIdFingerprint: fingerprint(seeded.organizationId), vaultIdFingerprint: fingerprint(seeded.vaultId), missionIdFingerprint: fingerprint(seeded.missionId) };
    server = spawn(process.execPath, [path.join(__dirname, "server.js")], { cwd: __dirname, env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_CONNECTOR_HOST: "127.0.0.1", SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await waitForHealth();
    const token = readConnectorToken();
    const payload = {
      source: "proof-obp047",
      organizationId: seeded.organizationId,
      vaultId: seeded.vaultId,
      missionId: seeded.missionId,
      ownerUserId: testUser.userId,
      query: "клиент коммерческое предложение evidence следующий шаг",
      resultPath: "04_Results/CONTEXT_RETRIEVER_RESULT_OBP047.md",
      evidencePath: "05_Evidence/CONTEXT_RETRIEVER_EVIDENCE_OBP047.md",
      sources: [
        { vaultPath: "03_Sources/FILE_WORKBENCH/OBP047_Client_Context.md", fileName: "OBP047_Client_Context.md", extension: "md", bytes: 180, sha256: createHash("sha256").update("client context").digest("hex") },
        { vaultPath: "03_Sources/FILE_WORKBENCH/OBP047_Evidence_Context.md", fileName: "OBP047_Evidence_Context.md", extension: "md", bytes: 140, sha256: createHash("sha256").update("evidence context").digest("hex") }
      ],
      citations: [
        { id: "S1.1", vaultPath: "03_Sources/FILE_WORKBENCH/OBP047_Client_Context.md", line: 3, excerpt: "Клиенту нужно коммерческое предложение с понятным следующим шагом и короткой аргументацией.", score: 4 },
        { id: "S2.1", vaultPath: "03_Sources/FILE_WORKBENCH/OBP047_Evidence_Context.md", line: 3, excerpt: "Перед выдачей результата нужны citations, статус источников, evidence и проверка риска обещаний.", score: 3 }
      ]
    };
    const response = await fetch(`${connectorUrl}/cloud/rag-context/write`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const json = await response.json();
    evidence.checks.endpointResponse = { ok: response.ok && json.ok, status: json.status, runtimeLevel: json.runtimeLevel, sourceCount: json.source_count, chunkCount: json.chunk_count, embeddingCount: json.embedding_count, evidenceCount: json.evidence_count, boundaries: json.boundaries || [] };
    const unsafe = await fetch(`${connectorUrl}/cloud/rag-context/write`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...payload, sources: [{ vaultPath: "../secret.md" }] }) });
    const unsafeJson = await unsafe.json();
    evidence.checks.unsafePathBlocked = { ok: unsafe.status === 409 && unsafeJson.reason === "unsafe_vault_path", status: unsafe.status, reason: unsafeJson.reason };
    evidence.checks.verifyRows = await verifyRows(config, scope);
    evidence.checks.cleanupOwnerScope = await cleanupOwnerScope(config, testUser.userId, seeded.organizationId);
    evidence.checks.temporaryTestUserCleanup = await testUser.cleanup();
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    const passed = evidence.checks.applyFoundationMigration.ok && evidence.checks.temporaryTestUser.ok && evidence.checks.seedOwnerScope.ok && evidence.checks.endpointResponse.ok && evidence.checks.endpointResponse.sourceCount >= 2 && evidence.checks.endpointResponse.chunkCount >= 2 && evidence.checks.endpointResponse.embeddingCount >= 2 && evidence.checks.unsafePathBlocked.ok && evidence.checks.verifyRows.source_count >= 2 && evidence.checks.verifyRows.chunk_count >= 2 && evidence.checks.verifyRows.run_count >= 1 && evidence.checks.verifyRows.evidence_count >= 1 && evidence.checks.verifyRows.audit_count >= 1 && evidence.checks.cleanupOwnerScope.ok && evidence.checks.temporaryTestUserCleanup.ok && evidence.checks.noSecretLeak;
    evidence.status = passed ? "PASS_WITH_CONDITIONS_SUPABASE_RAG_PERSISTENCE_YELLOW" : "FAILED_SUPABASE_RAG_PERSISTENCE_RED";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath, endpoint: evidence.checks.endpointResponse, verifyRows: evidence.checks.verifyRows }, null, 2));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    evidence.status = "FAILED_SUPABASE_RAG_PERSISTENCE_RED";
    evidence.blocker = error.message;
    evidence.errorStack = error.stack ? error.stack.split("\n").slice(0, 6) : [];
    try { if (scope && scope.organizationId) evidence.checks.cleanupOwnerScope = await cleanupOwnerScope(config, scope.userId, scope.organizationId); } catch (cleanupError) { evidence.cleanupError = cleanupError.message; }
    try { if (testUser) evidence.checks.temporaryTestUserCleanup = await testUser.cleanup(); } catch (cleanupError) { evidence.userCleanupError = cleanupError.message; }
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.error(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
}
main();
