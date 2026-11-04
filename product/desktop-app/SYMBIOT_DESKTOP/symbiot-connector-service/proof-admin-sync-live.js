const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");
const { createHash, randomUUID } = require("crypto");
const { hydrateApiVaultEnv } = require("./api-vault-env");

const rootDir = path.resolve(__dirname, "..");
const pluginDir = fs.existsSync(path.join(rootDir, "symbiot-obsidian-plugin")) ? path.join(rootDir, "symbiot-obsidian-plugin") : path.join(rootDir, "obsidian-plugin");
const connectorServer = path.join(__dirname, "server.js");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP036_ADMIN_SYNC_LIVE_PROOF_2026-07-21.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_036_ADMIN_SYNC_2026-07-21.md");
const foundationMigrationPath = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const graphMigrationPath = path.join(__dirname, "supabase", "migrations", "202607200120_mission_graph_persistence.sql");
const connectorPort = 8806;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;
const tempAppData = path.join(rootDir, "runtime_logs", "obp036_temp_appdata");
const testVault = path.join(rootDir, "test_vault", "SYM_OBP036_ADMIN_SYNC_VAULT");
const fakeOpenRouterKey = "sk-or-v1-proof-admin-sync-key-not-real";

function env(name, fallback = "") { return process.env[name] || fallback || ""; }
function fingerprint(value) { return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null; }
function envConfig() {
  return {
    dbUrl: env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL")).trim(),
    serviceRoleKey: env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SYMBIOT_SUPABASE_SECRET_KEY", env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SECRET_KEY")))).trim()
  };
}
function configSummary(config) {
  return { dbUrlPresent: Boolean(config.dbUrl), dbUrlFingerprint: fingerprint(config.dbUrl), serviceRoleKeyPresent: Boolean(config.serviceRoleKey), serviceRoleKeyFingerprint: fingerprint(config.serviceRoleKey) };
}
function noSecretLeak(evidence, config) {
  const text = JSON.stringify(evidence);
  return [config.dbUrl, config.serviceRoleKey, fakeOpenRouterKey].filter(Boolean).every((secret) => !text.includes(secret));
}
async function withPgClient(config, fn) {
  let Client;
  try { ({ Client } = require("pg")); } catch (error) { return { ok: false, reason: "pg_dependency_missing", error: error.message }; }
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
  const userId = randomUUID();
  const email = `symbiot-obp036-${userId}@example.com`;
  await withPgClient(config, async (client) => {
    await client.query("insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ($1, 'authenticated', 'authenticated', $2, now(), $3::jsonb, $4::jsonb, now(), now(), false, false)", [userId, email, JSON.stringify({ provider: "email", providers: ["email"] }), JSON.stringify({ proof: "OBP-036", temporary: true })]);
  });
  return { userId, cleanup: async () => withPgClient(config, async (client) => { await client.query("delete from auth.users where id=$1", [userId]); return { ok: true }; }) };
}
async function seedOrganization(config, userId) {
  return withPgClient(config, async (client) => {
    const organizationId = randomUUID();
    await client.query("insert into public.organizations (id, owner_user_id, name) values ($1,$2,$3)", [organizationId, userId, "OBP-036 proof org"]);
    return { ok: true, organizationId };
  });
}
async function cleanupOrganization(config, organizationId) {
  return withPgClient(config, async (client) => {
    if (organizationId) await client.query("delete from public.organizations where id=$1", [organizationId]);
    return { ok: true, organizationDeleted: Boolean(organizationId) };
  });
}
async function verifyRows(config, scope) {
  return withPgClient(config, async (client) => {
    const result = await client.query(
      `select
        (select count(*)::int from public.vaults where owner_user_id=$1 and vault_fingerprint=$2) as vault_count,
        (select count(*)::int from public.providers p join public.vaults v on v.id=p.vault_id where p.owner_user_id=$1 and v.vault_fingerprint=$2) as provider_count,
        (select count(*)::int from public.missions m join public.vaults v on v.id=m.vault_id where m.owner_user_id=$1 and v.vault_fingerprint=$2) as mission_count,
        (select count(*)::int from public.runs r join public.vaults v on v.id=r.vault_id where r.owner_user_id=$1 and v.vault_fingerprint=$2) as run_count,
        (select count(*)::int from public.artifacts a join public.vaults v on v.id=a.vault_id where a.owner_user_id=$1 and v.vault_fingerprint=$2) as artifact_count,
        (select count(*)::int from public.evidence_items e join public.vaults v on v.id=e.vault_id where e.owner_user_id=$1 and v.vault_fingerprint=$2) as evidence_count,
        (select count(*)::int from public.sync_events s join public.vaults v on v.id=s.vault_id where s.owner_user_id=$1 and v.vault_fingerprint=$2 and s.sync_type='admin_snapshot_sync') as sync_event_count,
        (select count(*)::int from public.audit_events a join public.vaults v on v.id=a.vault_id where a.owner_user_id=$1 and v.vault_fingerprint=$2 and a.action='admin_snapshot_sync') as audit_count`,
      [scope.ownerUserId, scope.vaultFingerprint]
    );
    return { ok: true, ...result.rows[0] };
  });
}
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){ const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline){ try { const response = await fetch(`${connectorUrl}/health`); const json = await response.json(); if (response.ok && json.ok) return json; } catch(error){ lastError = error; } await sleep(150); } throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`); }
async function readConnectorToken(){ const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json"); const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline) { try { const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8")); if (parsed.token) return parsed.token; lastError = new Error("connector token missing"); } catch (error) { lastError = error; } await sleep(150); } throw new Error(`connector token timeout: ${lastError ? lastError.message : "unknown"}`); }
function assertCheck(condition, message){ if (!condition) throw new Error(message); return true; }
function vaultPath(relativePath){ return path.join(testVault, ...relativePath.split("/")); }
function fileObj(relativePath){ const full = vaultPath(relativePath); if (!fs.existsSync(full)) return null; const stat = fs.statSync(full); return { path: relativePath, fullPath: full, stat: { size: stat.size, mtime: stat.mtimeMs } }; }
function makeVault(){ return { getName(){ return "SYM_OBP036_ADMIN_SYNC_VAULT"; }, getAbstractFileByPath(relativePath){ return fileObj(relativePath); }, async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; }, async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return fileObj(relativePath); }, async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return fileObj(file.path); }, async read(file){ return fs.readFileSync(file.fullPath || vaultPath(file.path), "utf8"); } }; }
class Notice { constructor(message) { Notice.messages.push(String(message)); } }
Notice.messages = [];
class Modal { constructor(app) { this.app = app; this.contentEl = createElementMock(); } open(){ if (this.onOpen) return this.onOpen(); return undefined; } close(){} }
class Plugin { constructor(app, manifest){ this.app = app; this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.1" }; this.commands = []; this.ribbonIcons = []; } async loadData(){ return Plugin.mockSettings || {}; } async saveData(data){ this.savedData = data; } addRibbonIcon(icon,title,callback){ this.ribbonIcons.push({ icon,title,callback }); } addCommand(command){ this.commands.push(command); } addSettingTab(tab){ this.settingTab = tab; } addStatusBarItem(){ return { addClass(){}, setText(text){ this.text = text; } }; } }
class PluginSettingTab { constructor(app, plugin){ this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); } }
class Setting { constructor(containerEl){ this.containerEl = containerEl; } setName(){ return this; } setDesc(){ return this; } addText(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } addToggle(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } }
function createElementMock(){ return { children: [], empty(){ this.children = []; }, addClass(){}, querySelector(){ return null; }, createEl(tag, options = {}){ const child = createElementMock(); child.tag = tag; child.text = options.text || ""; child.addEventListener = () => {}; child.setAttribute = () => {}; this.children.push(child); return child; }, createDiv(options = {}){ const child = createElementMock(); child.tag = "div"; child.cls = options.cls || ""; child.addEventListener = () => {}; this.children.push(child); return child; }, setText(text){ this.text = text; } }; }
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain){ if (request === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting }; return originalLoad.call(this, request, parent, isMain); };
function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-036: Admin Sync",
    "",
    "Дата: 2026-07-21",
    "Проект / код: SYM-SaaS",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "- plugin command/button `Admin Sync`;",
    "- connector endpoint `/cloud/admin-sync/write`;",
    "- Supabase writes: vaults, providers, missions, runs, artifacts, evidence_items, sync_events, audit_events;",
    "- no full vault content sync;",
    "- no secret value sync;",
    "- cleanup temporary Supabase owner scope.",
    "",
    `JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(tempAppData, { recursive: true, force: true });
  fs.rmSync(testVault, { recursive: true, force: true });
  fs.mkdirSync(tempAppData, { recursive: true });
  fs.mkdirSync(testVault, { recursive: true });
  process.env.APPDATA = tempAppData;
  hydrateApiVaultEnv();
  const config = envConfig();
  const evidence = { id: "SYM_OBSIDIAN_PLUGIN_OBP036_ADMIN_SYNC_LIVE_PROOF_2026-07-21", date: "2026-07-21", project: "SYM-SaaS / OBP-036 Admin Sync", readinessChanged: false, readiness: "13205 / 14075 = 93.8%", config: configSummary(config), checks: {}, boundaries: ["metadata/status/hash only", "no full vault content", "no secret values", "not production tenant admin dashboard"] };
  if (!config.dbUrl) {
    evidence.status = "BLOCKED_MISSING_SUPABASE_DB_URL_YELLOW";
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath }, null, 2));
    process.exitCode = 2; return;
  }
  let server = null;
  let testUser = null;
  let organizationId = null;
  try {
    evidence.checks.applyFoundationMigration = await applyMigration(config, foundationMigrationPath);
    if (fs.existsSync(graphMigrationPath)) evidence.checks.applyGraphMigration = await applyMigration(config, graphMigrationPath);
    testUser = await createTemporaryTestUser(config);
    evidence.checks.temporaryTestUser = { ok: Boolean(testUser.userId), userIdFingerprint: fingerprint(testUser.userId) };
    const org = await seedOrganization(config, testUser.userId);
    organizationId = org.organizationId;
    evidence.checks.seedOrganization = { ok: true, organizationIdFingerprint: fingerprint(organizationId) };
    server = spawn(process.execPath, [connectorServer], { cwd: __dirname, env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_CONNECTOR_HOST: "127.0.0.1", SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await waitForHealth();
    const token = await readConnectorToken();
    const missionId = randomUUID();
    await fetch(`${connectorUrl}/plugin/register`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof-obp036", deviceId: "proof-device-obp036", vaultId: "SYM_OBP036_ADMIN_SYNC_VAULT", pluginVersion: "0.1.1" }) });
    await fetch(`${connectorUrl}/mission/create`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof-obp036", missionId, title: "OBP-036 Admin Sync proof mission", missionType: "client_mission" }) });
    await fetch(`${connectorUrl}/openrouter/gateway/connect`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof-obp036", apiKey: fakeOpenRouterKey, live: false }) });
    await fetch(`${connectorUrl}/agent-runtime/run`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof-obp036", approved: true, missionId, task: "Проверить admin sync", expectedResult: "Supabase admin snapshot rows" }) });
    Plugin.mockSettings = { coreRoot: "00_Core", rolesRoot: "01_Roles", missionsRoot: "02_Missions", sourcesRoot: "03_Sources", resultsRoot: "04_Results", evidenceRoot: "05_Evidence", connectorUrl, connectorToken: token, autoRegister: false };
    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = { vault: makeVault(), workspace: { getLeaf(){ return { async openFile(file){ openedFiles.push(file.path); } }; } } };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
    await plugin.onload();
    const vaultFingerprint = createHash("sha256").update("SYM_OBP036_ADMIN_SYNC_VAULT").digest("hex").slice(0, 24);
    const syncResult = await plugin.runAdminSyncMvp({ ownerUserId: testUser.userId, organizationId, vaultFingerprint });
    const verify = await verifyRows(config, { ownerUserId: testUser.userId, vaultFingerprint });
    const missingOwnerResponse = await fetch(`${connectorUrl}/cloud/admin-sync/write`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof-obp036-missing-owner", vault: { name: "missing owner", fingerprint: "missing-owner" }, ownerUserId: null }) });
    const missingOwnerJson = await missingOwnerResponse.json();
    evidence.checks.pluginCommandRegistered = assertCheck(plugin.commands.some((command) => command.id === "symbiot-admin-sync"), "admin sync command missing");
    evidence.checks.endpointResponse = { ok: syncResult.response.ok && syncResult.sync && syncResult.sync.ok, status: syncResult.status, runtimeLevel: syncResult.sync && syncResult.sync.runtimeLevel, counts: syncResult.sync ? { vault: syncResult.sync.vault_count, providers: syncResult.sync.provider_count, missions: syncResult.sync.mission_count, runs: syncResult.sync.run_count, artifacts: syncResult.sync.artifact_count, evidence: syncResult.sync.evidence_count, syncEvents: syncResult.sync.sync_event_count, audit: syncResult.sync.audit_count } : {} };
    evidence.checks.verifyRows = verify;
    evidence.checks.missingOwnerBlocked = { ok: missingOwnerResponse.status === 409 && missingOwnerJson.reason === "owner_user_id_required", status: missingOwnerResponse.status, reason: missingOwnerJson.reason };
    evidence.checks.resultNoteCreated = assertCheck(openedFiles.some((file) => file.startsWith("04_Results/ADMIN_SYNC_RESULT_")), "admin sync result note not opened");
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config) && noSecretLeak(syncResult, config);
    evidence.checks.cleanupOrganization = await cleanupOrganization(config, organizationId);
    evidence.checks.temporaryTestUserCleanup = await testUser.cleanup();
    const passed = evidence.checks.applyFoundationMigration.ok && evidence.checks.temporaryTestUser.ok && evidence.checks.seedOrganization.ok && evidence.checks.pluginCommandRegistered && evidence.checks.endpointResponse.ok && evidence.checks.endpointResponse.counts.vault >= 1 && evidence.checks.endpointResponse.counts.providers >= 3 && evidence.checks.endpointResponse.counts.missions >= 1 && evidence.checks.endpointResponse.counts.runs >= 1 && evidence.checks.endpointResponse.counts.artifacts >= 1 && evidence.checks.endpointResponse.counts.evidence >= 1 && evidence.checks.endpointResponse.counts.syncEvents >= 1 && evidence.checks.endpointResponse.counts.audit >= 1 && verify.vault_count >= 1 && verify.provider_count >= 3 && verify.mission_count >= 1 && verify.run_count >= 1 && verify.artifact_count >= 1 && verify.evidence_count >= 1 && verify.sync_event_count >= 1 && verify.audit_count >= 1 && evidence.checks.missingOwnerBlocked.ok && evidence.checks.resultNoteCreated && evidence.checks.noSecretLeak && evidence.checks.cleanupOrganization.ok && evidence.checks.temporaryTestUserCleanup.ok;
    evidence.status = passed ? "PASS_WITH_CONDITIONS_ADMIN_SYNC_YELLOW" : "FAILED_ADMIN_SYNC_RED";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath, counts: evidence.checks.endpointResponse.counts }, null, 2));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    evidence.status = "FAILED_ADMIN_SYNC_RED";
    evidence.blocker = error.message;
    evidence.errorStack = error.stack ? error.stack.split("\n").slice(0, 8) : [];
    try { if (organizationId) evidence.checks.cleanupOrganization = await cleanupOrganization(config, organizationId); } catch (cleanupError) { evidence.cleanupError = cleanupError.message; }
    try { if (testUser) evidence.checks.temporaryTestUserCleanup = await testUser.cleanup(); } catch (cleanupError) { evidence.userCleanupError = cleanupError.message; }
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8"); writeReport(evidence);
    console.error(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
    Module._load = originalLoad;
  }
}
main();
