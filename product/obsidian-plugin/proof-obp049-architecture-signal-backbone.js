const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");
const { createHash, randomUUID } = require("crypto");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP049_ARCHITECTURE_SIGNAL_BACKBONE_PROOF_2026-07-22.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_049_ARCHITECTURE_SIGNAL_BACKBONE_2026-07-22.md");
const foundationMigrationPath = path.join(connectorDir, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const graphMigrationPath = path.join(connectorDir, "supabase", "migrations", "202607200120_mission_graph_persistence.sql");
const testVault = path.join(root, "test_vault", "SYM_OBP049_ARCHITECTURE_SIGNAL_BACKBONE_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp049_temp_appdata");
const connectorPort = 8819;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;

function env(name, fallback = "") { return process.env[name] || fallback || ""; }
function fingerprint(value) { return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null; }
function envConfig() {
  return {
    dbUrl: env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL")).trim(),
    serviceRoleKey: env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SYMBIOT_SUPABASE_SECRET_KEY", env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SECRET_KEY")))).trim()
  };
}
function configSummary(config) {
  return {
    dbUrlPresent: Boolean(config.dbUrl),
    dbUrlFingerprint: fingerprint(config.dbUrl),
    serviceRoleKeyPresent: Boolean(config.serviceRoleKey),
    serviceRoleKeyFingerprint: fingerprint(config.serviceRoleKey)
  };
}
function noSecretLeak(evidence, config, token) {
  const text = JSON.stringify(evidence);
  return [config.dbUrl, config.serviceRoleKey, token].filter(Boolean).every((secret) => !text.includes(secret));
}
async function withPgClient(config, fn) {
  let Client;
  try { ({ Client } = require(path.join(connectorDir, "node_modules", "pg"))); } catch (error) { ({ Client } = require("pg")); }
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
  const email = `symbiot-obp049-${userId}@example.com`;
  await withPgClient(config, async (client) => {
    await client.query(
      "insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ($1, 'authenticated', 'authenticated', $2, now(), $3::jsonb, $4::jsonb, now(), now(), false, false)",
      [userId, email, JSON.stringify({ provider: "email", providers: ["email"] }), JSON.stringify({ proof: "OBP-049", temporary: true })]
    );
  });
  return {
    userId,
    cleanup: async () => withPgClient(config, async (client) => {
      await client.query("delete from auth.users where id=$1", [userId]);
      return { ok: true };
    })
  };
}
async function seedOrganization(config, userId) {
  return withPgClient(config, async (client) => {
    const organizationId = randomUUID();
    await client.query("insert into public.organizations (id, owner_user_id, name) values ($1,$2,$3)", [organizationId, userId, "OBP-049 proof org"]);
    return { ok: true, organizationId };
  });
}
async function cleanupOrganization(config, organizationId) {
  return withPgClient(config, async (client) => {
    if (organizationId) await client.query("delete from public.organizations where id=$1", [organizationId]);
    return { ok: true, organizationDeleted: Boolean(organizationId) };
  });
}
async function verifySyncEvent(config, syncEventId) {
  return withPgClient(config, async (client) => {
    const result = await client.query("select metadata from public.sync_events where id=$1", [syncEventId]);
    const metadata = result.rows[0] ? result.rows[0].metadata || {} : {};
    return {
      ok: result.rowCount === 1,
      architectureSignalBackbone: metadata.architectureSignalBackbone === true,
      architectureSignalCount: metadata.architectureSignalCount || 0,
      latestArchitectureSignalStatus: metadata.latestArchitectureSignalStatus || null,
      latestArchitectureSignalIdFingerprint: fingerprint(metadata.latestArchitectureSignalId || "")
    };
  });
}
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${connectorUrl}/health`);
      const json = await response.json();
      if (response.ok && json.ok) return json;
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`);
}
async function readConnectorToken(){
  const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json");
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
      if (parsed.token) return parsed.token;
      lastError = new Error("connector token missing");
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`connector token timeout: ${lastError ? lastError.message : "unknown"}`);
}
function assertCheck(condition, message){ if (!condition) throw new Error(message); return true; }
function vaultPath(relativePath){ return path.join(testVault, ...relativePath.split("/")); }
function fileObj(relativePath){
  const full = vaultPath(relativePath);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return { path: relativePath, fullPath: full, stat: { size: stat.size, mtime: stat.mtimeMs } };
}
function makeVault(){
  return {
    getName(){ return "SYM_OBP049_ARCHITECTURE_SIGNAL_BACKBONE_VAULT"; },
    getAbstractFileByPath(relativePath){ return fileObj(relativePath); },
    async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; },
    async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return fileObj(relativePath); },
    async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return fileObj(file.path); },
    async read(file){ return fs.readFileSync(file.fullPath || vaultPath(file.path), "utf8"); }
  };
}
class Notice { constructor(message) { Notice.messages.push(String(message)); } }
Notice.messages = [];
class Modal { constructor(app) { this.app = app; this.contentEl = createElementMock(); } open(){ if (this.onOpen) return this.onOpen(); return undefined; } close(){} }
class Plugin { constructor(app, manifest){ this.app = app; this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.1" }; this.commands = []; this.ribbonIcons = []; } async loadData(){ return Plugin.mockSettings || {}; } async saveData(data){ this.savedData = data; } addRibbonIcon(icon,title,callback){ this.ribbonIcons.push({ icon,title,callback }); } addCommand(command){ this.commands.push(command); } addSettingTab(tab){ this.settingTab = tab; } addStatusBarItem(){ return { addClass(){}, setText(text){ this.text = text; } }; } }
class PluginSettingTab { constructor(app, plugin){ this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); } }
class Setting { constructor(containerEl){ this.containerEl = containerEl; } setName(){ return this; } setDesc(){ return this; } addText(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } addToggle(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } }
function createElementMock(){
  return {
    children: [],
    empty(){ this.children = []; },
    addClass(){},
    querySelector(){ return null; },
    createEl(tag, options = {}){ const child = createElementMock(); child.tag = tag; child.text = options.text || ""; child.addEventListener = () => {}; child.setAttribute = () => {}; this.children.push(child); return child; },
    createDiv(options = {}){ const child = createElementMock(); child.tag = "div"; child.cls = options.cls || ""; child.addEventListener = () => {}; this.children.push(child); return child; },
    setText(text){ this.text = text; }
  };
}
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain){ if (request === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting }; return originalLoad.call(this, request, parent, isMain); };

function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-049: Architecture Signal Backbone",
    "",
    "Дата: 2026-07-22",
    "Проект / код: SYM-SaaS",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "- команда и кнопка `Архитектурная шина` в Obsidian plugin;",
    "- создание документа сигнала в vault;",
    "- connector endpoint `/architecture/signal/record`;",
    "- admin snapshot содержит сигнал;",
    "- Supabase sync_event содержит metadata/status/hash, без полного текста vault и без секретов.",
    "",
    `JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main(){
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(testVault, { recursive: true, force: true });
  fs.rmSync(tempAppData, { recursive: true, force: true });
  fs.mkdirSync(testVault, { recursive: true });
  fs.mkdirSync(tempAppData, { recursive: true });
  process.env.APPDATA = tempAppData;

  const config = envConfig();
  const evidence = {
    id: "SYM_OBSIDIAN_PLUGIN_OBP049_ARCHITECTURE_SIGNAL_BACKBONE_PROOF_2026-07-22",
    date: "2026-07-22",
    project: "SYM-SaaS",
    gate: "OBP-049 Architecture Signal Backbone",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    config: configSummary(config),
    checks: {},
    boundaries: [
      "metadata/status/hash only",
      "no full vault content sync",
      "no secret values sync",
      "not second real computer acceptance",
      "not production remote relay"
    ]
  };
  if (!config.dbUrl) {
    evidence.status = "BLOCKED_MISSING_SUPABASE_DB_URL_YELLOW";
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath }, null, 2));
    process.exitCode = 2;
    return;
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

    server = spawn(process.execPath, [connectorServer], {
      cwd: connectorDir,
      env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_CONNECTOR_HOST: "127.0.0.1", SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md` },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    await waitForHealth();
    const token = await readConnectorToken();

    Plugin.mockSettings = {
      coreRoot: "00_Core",
      rolesRoot: "01_Roles",
      missionsRoot: "02_Missions",
      sourcesRoot: "03_Sources",
      resultsRoot: "04_Results",
      evidenceRoot: "05_Evidence",
      connectorUrl,
      connectorToken: token,
      autoRegister: false
    };
    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = { vault: makeVault(), workspace: { getLeaf(){ return { async openFile(file){ openedFiles.push(file.path); } }; } } };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
    await plugin.onload();

    const vaultFingerprint = createHash("sha256").update("SYM_OBP049_ARCHITECTURE_SIGNAL_BACKBONE_VAULT").digest("hex").slice(0, 24);
    const vaultId = randomUUID();
    const result = await plugin.runArchitectureSignalBackbone({ ownerUserId: testUser.userId, organizationId, vaultFingerprint, vaultId });
    const documentText = fs.readFileSync(vaultPath(result.documentPath), "utf8");
    const resultText = fs.readFileSync(vaultPath(result.resultPath), "utf8");
    const evidenceText = fs.readFileSync(vaultPath(result.evidencePath), "utf8");
    const appStateResponse = await fetch(`${connectorUrl}/app/state`, { headers: { Authorization: `Bearer ${token}` } });
    const appState = await appStateResponse.json();
    const signalInAppState = Array.isArray(appState.architectureSignals) && appState.architectureSignals.some((signal) => signal.id === result.signalId);
    const syncEvent = await verifySyncEvent(config, result.adminSync.sync.syncEventId);

    evidence.checks.commandRegistered = assertCheck(plugin.commands.some((command) => command.id === "symbiot-architecture-signal-backbone"), "architecture signal command missing");
    evidence.checks.controlPanelButtonPresent = assertCheck(fs.readFileSync(path.join(pluginDir, "main.js"), "utf8").includes("\"Архитектурная шина\""), "control panel button missing");
    evidence.checks.documentCreated = assertCheck(documentText.includes("Архитектурный сигнал Симбиота") && documentText.includes(result.signalId), "signal document missing");
    evidence.checks.documentHashCalculated = assertCheck(Boolean(result.sha256) && result.sha256.length === 64, "signal sha256 missing");
    evidence.checks.connectorSignalRecorded = assertCheck(result.connectorSignalRecorded && result.signal && result.signal.id === result.signalId, "connector signal not recorded");
    evidence.checks.snapshotHasSignal = assertCheck(result.snapshotHasSignal, "snapshot missing signal");
    evidence.checks.appStateHasSignal = assertCheck(signalInAppState, "app state missing signal");
    evidence.checks.adminSyncPassed = assertCheck(result.adminSyncPassed && result.adminSync.sync.architecture_signal_count >= 1, "admin sync missing architecture signal");
    evidence.checks.supabaseSyncEventMetadata = assertCheck(syncEvent.ok && syncEvent.architectureSignalBackbone && syncEvent.architectureSignalCount >= 1, "Supabase sync metadata missing architecture signal");
    evidence.checks.resultNoteCreated = assertCheck(resultText.includes("Architecture Signal Backbone - результат") && openedFiles.includes(result.resultPath), "result note not opened");
    evidence.checks.evidenceNoteCreated = assertCheck(evidenceText.includes("Architecture Signal Backbone - Evidence") && evidenceText.includes("readiness_changed: false"), "evidence note missing");
    evidence.checks.metadataOnly = assertCheck(result.metadataOnly && result.signal.document.contentStored === false, "metadata-only boundary broken");
    evidence.checks.noSecretLeak = assertCheck(noSecretLeak(evidence, config, token) && noSecretLeak(result, config, token), "secret leak in proof evidence");
    evidence.checks.cleanupOrganization = await cleanupOrganization(config, organizationId);
    evidence.checks.temporaryTestUserCleanup = await testUser.cleanup();
    evidence.connectorStdout = stdout.join("");
    evidence.connectorStderr = stderr.join("");
    evidence.signal = {
      id: result.signalId,
      status: result.status,
      documentPath: result.documentPath,
      resultPath: result.resultPath,
      evidencePath: result.evidencePath,
      sha256: result.sha256,
      syncEventIdFingerprint: fingerprint(result.adminSync.sync.syncEventId),
      supabaseSyncEvent: syncEvent
    };
    const passed = Object.values(evidence.checks).every((value) => value === true || (value && value.ok === true));
    evidence.passed = passed;
    evidence.status = passed ? "PASS_WITH_CONDITIONS_ARCHITECTURE_SIGNAL_BACKBONE_YELLOW" : "FAILED_ARCHITECTURE_SIGNAL_BACKBONE_RED";
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ passed, status: evidence.status, evidencePath, reportPath, signal: evidence.signal }, null, 2));
    process.exitCode = passed ? 0 : 1;
  } catch (error) {
    evidence.status = "FAILED_ARCHITECTURE_SIGNAL_BACKBONE_RED";
    evidence.blocker = error.message;
    evidence.errorStack = error.stack ? error.stack.split("\n").slice(0, 8) : [];
    try { if (organizationId) evidence.checks.cleanupOrganization = await cleanupOrganization(config, organizationId); } catch (cleanupError) { evidence.cleanupError = cleanupError.message; }
    try { if (testUser) evidence.checks.temporaryTestUserCleanup = await testUser.cleanup(); } catch (cleanupError) { evidence.userCleanupError = cleanupError.message; }
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    writeReport(evidence);
    console.error(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
    Module._load = originalLoad;
  }
}

main();
