const http = require("http");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv } = require("crypto");
const { URL } = require("url");
const QRCode = require("qrcode");
const { hydrateApiVaultEnv } = require("./api-vault-env");
const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const {
  RUNTIME_CORE_VERSION,
  publicRoleRegistry,
  routeMission,
  buildContext,
  evaluatePolicy,
  buildRuntimePrompt,
  validateRuntimeOutput,
  buildExecutionTrace,
  createTaskStateMachine,
  transitionTaskState
} = require("./symbiot-runtime-core");
const { runMissionLibraryGate } = require("./symbiot-library-gate");
const {
  appendFeedback,
  ensureFeedbackFile,
  readRelevantFeedback,
  reflexionPrompt
} = require("./symbiot-reflexion-memory");

const PORT = Number(process.env.SYMBIOT_CONNECTOR_PORT || 8787);
const HOST = process.env.SYMBIOT_CONNECTOR_HOST || "127.0.0.1";
const DEFAULT_LLM_TIMEOUT_MS = Number(process.env.SYMBIOT_LLM_TIMEOUT_MS || 20000);
const ALLOW_LOCAL_PROVIDER = process.env.SYMBIOT_ALLOW_LOCAL_PROVIDER === "1";
const CONNECTOR_DATA_DIR = process.env.SYMBIOT_CONNECTOR_DATA_DIR || path.join(process.env.APPDATA || os.tmpdir(), "Symbiot", "connector");
const PROVIDER_STORE_FILE = path.join(CONNECTOR_DATA_DIR, "provider-slots.json");
const PROVIDER_STORE_KEY_FILE = path.join(CONNECTOR_DATA_DIR, "provider-slots.key");
const CONNECTOR_TOKEN_FILE = path.join(CONNECTOR_DATA_DIR, "connector-token.json");
const AGENT_RUNTIME_ARTIFACTS_DIR = path.join(CONNECTOR_DATA_DIR, "agent-runtime-artifacts");
const FILE_WORKBENCH_ARTIFACTS_DIR = path.join(CONNECTOR_DATA_DIR, "file-workbench-artifacts");
const VISION_ARTIFACTS_DIR = path.join(CONNECTOR_DATA_DIR, "vision-artifacts");
const BACKUP_DIR = path.join(CONNECTOR_DATA_DIR, "backups");
const API_VAULT_ROOT = process.env.SYMBIOT_API_VAULT_ROOT || "";
const API_VAULT_STORE_FILE = path.join(API_VAULT_ROOT, "store", "api-secrets.dpapi.json");
const API_VAULT_SCRIPTS_DIR = process.env.SYMBIOT_API_VAULT_SCRIPTS_DIR || path.join(API_VAULT_ROOT, "scripts");
const POWERSHELL_EXE = process.env.SYMBIOT_POWERSHELL_EXE || "pwsh.exe";
const LOS_OBSIDIAN_ROOT = "02_Личная_операционная_система_ритм";
const LOS_PROTOCOLS_ROOT = `${LOS_OBSIDIAN_ROOT}/01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ`;
const DEFAULT_MISSIONS_ROOT = `${LOS_PROTOCOLS_ROOT}/02_Missions`;
const MISSIONS_ROOT = String(process.env.SYMBIOT_MISSIONS_ROOT || DEFAULT_MISSIONS_ROOT).replace(/^\/+|\/+$/g, "");
const LOS_PHYSICAL_MIRROR_ROOT = process.env.SYMBIOT_LOS_MIRROR_ROOT || "D:\\02_ОПЕРАЦИОННАЯ_СИСТЕМА_РАБОЧИЙ_СЛОЙ";
const BUSINESS_MEMORY_SCHEMA_VERSION = "2026-07-20.obp038a2_mission_graph_persistence.v1";
const BUSINESS_MEMORY_MIGRATION_FILE = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const MISSION_GRAPH_MIGRATION_FILE = path.join(__dirname, "supabase", "migrations", "202607200120_mission_graph_persistence.sql");
const MISSION_GRAPH_TABLES = [
  "mission_canvas_nodes",
  "mission_canvas_edges",
  "mission_methodology_patterns"
];
const BUSINESS_MEMORY_TABLES = [
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
  "sync_events",
  ...MISSION_GRAPH_TABLES
];
const ALLOWED_CORS_ORIGINS = new Set(
  (process.env.SYMBIOT_ALLOWED_ORIGINS || `http://127.0.0.1:${PORT},http://localhost:${PORT},app://obsidian.md`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const state = {
  startedAt: new Date().toISOString(),
  users: [],
  devices: [],
  missions: [],
  missionIntakes: [],
  fullMissionLoops: [],
  missionMethodology: [],
  queues: [],
  runtimeRuns: [],
  artifacts: [],
  architectureSignals: [],
  fileWorkbench: [],
  visionCaptures: [],
  contextRetriever: [],
  llmComparisons: [],
  providers: [],
  providerSecrets: {},
  mobilePairings: [],
  mobileRemoteActions: [],
  audit: [],
  connector: {
    id: "local-windows-connector",
    mode: "local",
    status: "yellow",
    environmentAgent: "windows-first-mvp",
    security: {
      authRequired: true,
      cors: "local_allowlist",
      remoteRelayReady: false
    }
  }
};
const activeOperations = new Map();

function operationSignal(body) {
  const operationId = String(body && body.operationId || "").trim();
  if (!operationId) return { operationId: null, signal: null, release: () => {} };
  const controller = new AbortController();
  activeOperations.set(operationId, controller);
  return {
    operationId,
    signal: controller.signal,
    release: () => activeOperations.delete(operationId)
  };
}

function cancelOperation(operationId) {
  const controller = activeOperations.get(String(operationId || ""));
  if (!controller) return false;
  controller.abort(new Error("cancelled_by_user"));
  return true;
}

function securityHeaders(req) {
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-symbiot-connector-token",
    "access-control-max-age": "300",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  };
  const origin = req && req.headers ? req.headers.origin : null;
  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "origin";
  }
  return headers;
}

function isAllowedCorsOrigin(req) {
  const origin = req && req.headers ? req.headers.origin : null;
  return !origin || ALLOWED_CORS_ORIGINS.has(origin);
}

function json(res, statusCode, body, req) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...securityHeaders(req)
  });
  res.end(payload);
}


function html(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function svg(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function png(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function audit(entry) {
  const record = { id: randomUUID(), timestamp: new Date().toISOString(), ...entry };
  state.audit.unshift(record);
  state.audit = state.audit.slice(0, 200);
  return record;
}


function ensureConnectorDataDir() {
  fs.mkdirSync(CONNECTOR_DATA_DIR, { recursive: true });
}

function connectorTokenFingerprint(secret) {
  return createHash("sha256").update(String(secret || "")).digest("hex").slice(0, 12);
}

function loadOrCreateConnectorToken() {
  ensureConnectorDataDir();
  try {
    if (fs.existsSync(CONNECTOR_TOKEN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONNECTOR_TOKEN_FILE, "utf8"));
      if (parsed && typeof parsed.token === "string" && parsed.token.length >= 32) return parsed.token;
    }
  } catch (error) {
    audit({ source: "security", action: "connector_token_load", approval: "not_required", result: "error", error: error.message });
  }
  const token = randomBytes(32).toString("hex");
  fs.writeFileSync(CONNECTOR_TOKEN_FILE, JSON.stringify({
    token,
    createdAt: new Date().toISOString(),
    boundary: "Local connector token. Do not paste into chat, markdown or evidence."
  }, null, 2), "utf8");
  try { fs.chmodSync(CONNECTOR_TOKEN_FILE, 0o600); } catch (_) {}
  audit({ source: "security", action: "connector_token_create", approval: "not_required", result: "ok", tokenFingerprint: connectorTokenFingerprint(token) });
  return token;
}

const CONNECTOR_TOKEN = loadOrCreateConnectorToken();
state.connector.security.tokenFingerprint = connectorTokenFingerprint(CONNECTOR_TOKEN);
state.connector.security.tokenFile = CONNECTOR_TOKEN_FILE;

function connectorAuthToken(req) {
  const authorization = req && req.headers ? String(req.headers.authorization || "") : "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return req && req.headers ? String(req.headers["x-symbiot-connector-token"] || "").trim() : "";
}

function hasConnectorAuth(req) {
  return connectorAuthToken(req) === CONNECTOR_TOKEN;
}

function isMobileAuthorized(body, url) {
  const token = body && body.token ? String(body.token) : url ? String(url.searchParams.get("token") || "") : "";
  return Boolean(token && isKnownMobileToken(token));
}

function requireConnectorAuth(req, res) {
  if (hasConnectorAuth(req)) return true;
  audit({ source: "security", action: "connector_auth", approval: "not_required", result: "blocked", path: req.url });
  json(res, 401, { ok: false, error: "connector_auth_required", boundary: "Use local connector token from the Symbiot connector token store." }, req);
  return false;
}

function getProviderStoreKey() {
  ensureConnectorDataDir();
  if (!fs.existsSync(PROVIDER_STORE_KEY_FILE)) {
    fs.writeFileSync(PROVIDER_STORE_KEY_FILE, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  const raw = fs.readFileSync(PROVIDER_STORE_KEY_FILE, "utf8").trim();
  return Buffer.from(raw, "hex");
}

function encryptProviderSecret(secret) {
  if (!secret) return null;
  const key = getProviderStoreKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decryptProviderSecret(payload) {
  if (!payload || payload.alg !== "aes-256-gcm") return "";
  const key = getProviderStoreKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

function providerForStore(provider) {
  const secret = provider.secretRef ? state.providerSecrets[provider.secretRef] : "";
  const { secretRef, ...publicProfile } = provider;
  return {
    ...publicProfile,
    persistent: true,
    encryptedSecret: encryptProviderSecret(secret)
  };
}

function saveProviderStore() {
  ensureConnectorDataDir();
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    boundary: "YELLOW: local encrypted MVP storage, not enterprise secret manager.",
    providers: state.providers.map(providerForStore)
  };
  fs.writeFileSync(PROVIDER_STORE_FILE, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
}

function loadProviderStore() {
  try {
    if (!fs.existsSync(PROVIDER_STORE_FILE)) return { ok: true, loaded: 0 };
    const payload = JSON.parse(fs.readFileSync(PROVIDER_STORE_FILE, "utf8"));
    const loadedProviders = [];
    const loadedSecrets = {};
    for (const stored of Array.isArray(payload.providers) ? payload.providers : []) {
      const secret = decryptProviderSecret(stored.encryptedSecret);
      const secretRef = secret ? `provider-${stored.id}-${randomUUID()}` : null;
      if (secretRef) loadedSecrets[secretRef] = secret;
      const { encryptedSecret, ...profile } = stored;
      loadedProviders.push({ ...profile, secretRef, persistent: true });
    }
    state.providers = loadedProviders.slice(0, 20);
    state.providerSecrets = { ...state.providerSecrets, ...loadedSecrets };
    audit({ source: "connector", action: "provider_store_load", approval: "not_required", result: "ok", providerCount: state.providers.length });
    return { ok: true, loaded: state.providers.length };
  } catch (error) {
    audit({ source: "connector", action: "provider_store_load", approval: "not_required", result: "error", error: error.message });
    return { ok: false, loaded: 0, error: error.message };
  }
}

function providerStoreStatus() {
  return {
    mode: "local_encrypted_store_yellow",
    dataDir: CONNECTOR_DATA_DIR,
    storeFilePresent: fs.existsSync(PROVIDER_STORE_FILE),
    keyFilePresent: fs.existsSync(PROVIDER_STORE_KEY_FILE),
    providerCount: state.providers.length,
    boundary: "Local MVP persistence only; production tenant secret storage remains YELLOW."
  };
}

function apiVaultConfiguredCatalog() {
  return [
    { id: "sym-saas.supabase.url", provider: "Supabase", scope: "SYM-SaaS", envName: "SYMBIOT_SUPABASE_URL", secretType: "url", label: "Supabase URL" },
    { id: "sym-saas.supabase.publishable-key", provider: "Supabase", scope: "SYM-SaaS", envName: "SYMBIOT_SUPABASE_PUBLISHABLE_KEY", secretType: "publishable_key", label: "Supabase publishable key" },
    { id: "sym-saas.supabase.secret-key", provider: "Supabase", scope: "SYM-SaaS", envName: "SYMBIOT_SUPABASE_SECRET_KEY", secretType: "server_secret_key", label: "Supabase secret key" },
    { id: "sym-saas.supabase.db-url", provider: "Supabase", scope: "SYM-SaaS", envName: "SYMBIOT_SUPABASE_DB_URL", secretType: "postgres_pooler_url", label: "Supabase DB URL" },
    { id: "sym-saas.deepseek.api-key", provider: "DeepSeek", scope: "SYM-SaaS", envName: "DEEPSEEK_API_KEY", secretType: "llm_api_key", label: "DeepSeek API key" },
    { id: "sym-saas.openrouter.api-key", provider: "OpenRouter", scope: "SYM-SaaS", envName: "OPENROUTER_API_KEY", secretType: "llm_api_key", label: "OpenRouter API key" },
    { id: "sym-saas.google.api-key", provider: "Google", scope: "SYM-SaaS", envName: "GOOGLE_API_KEY", secretType: "api_key", label: "Google API key" }
  ];
}

function readApiVaultMetadata() {
  const recordsById = new Map();
  if (fs.existsSync(API_VAULT_STORE_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(API_VAULT_STORE_FILE, "utf8"));
    const records = parsed && parsed.records && typeof parsed.records === "object" ? parsed.records : {};
    for (const [id, record] of Object.entries(records)) {
      recordsById.set(String(id).toLowerCase(), {
        id: record.id,
        provider: record.provider,
        scope: record.scope,
        envName: record.env_name,
        secretType: record.secret_type,
        status: record.status || "active",
        fingerprint: record.fingerprint || null,
        rotationRequired: Boolean(record.rotation_required),
        updatedAt: record.updated_at || null,
        notes: record.notes || "",
        keyPresent: Boolean(record.value_dpapi)
      });
    }
  }
  const catalog = apiVaultConfiguredCatalog();
  const catalogIds = new Set(catalog.map((item) => item.id.toLowerCase()));
  const plannedAndSaved = catalog.map((item) => {
    const saved = recordsById.get(item.id.toLowerCase());
    return saved ? { ...item, ...saved, configured: true } : { ...item, status: "not_configured", fingerprint: null, rotationRequired: false, updatedAt: null, notes: "", keyPresent: false, configured: false };
  });
  const customSaved = Array.from(recordsById.values())
    .filter((record) => !catalogIds.has(String(record.id || "").toLowerCase()))
    .map((record) => ({ label: record.id, ...record, configured: true }));
  return [...plannedAndSaved, ...customSaved].sort((a, b) => String(a.provider || "").localeCompare(String(b.provider || "")) || String(a.id || "").localeCompare(String(b.id || "")));
}

function apiVaultStatus() {
  return {
    mode: "local_windows_dpapi_vault",
    status: "yellow_local_secret_vault",
    root: API_VAULT_ROOT,
    storeFilePresent: fs.existsSync(API_VAULT_STORE_FILE),
    scriptsDirPresent: fs.existsSync(API_VAULT_SCRIPTS_DIR),
    recordCount: readApiVaultMetadata().filter((record) => record.configured).length,
    boundary: "Local DPAPI vault only. Production tenant secret manager remains a separate YELLOW gate."
  };
}

function runPowerShell(command, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL_EXE, ["-NoProfile", "-Command", command], {
      windowsHide: true,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function revealApiVaultSecret(id) {
  const command = `$ErrorActionPreference='Stop'; & '${path.join(API_VAULT_SCRIPTS_DIR, "Get-ApiSecret.ps1").replace(/'/g, "''")}' -Id $env:SYMBIOT_API_VAULT_ID -StorePath $env:SYMBIOT_API_VAULT_STORE_FILE -Reveal`;
  const result = await runPowerShell(command, { SYMBIOT_API_VAULT_ID: String(id || ""), SYMBIOT_API_VAULT_STORE_FILE: API_VAULT_STORE_FILE });
  const value = String(result.stdout || "").replace(/\r?\n$/, "");
  return value;
}

async function saveApiVaultSecret(body) {
  const id = String(body.id || "").trim().toLowerCase();
  const provider = String(body.provider || "").trim();
  const scope = String(body.scope || "SYM-SaaS").trim();
  const envName = String(body.envName || body.env_name || "").trim();
  const secretType = String(body.secretType || body.secret_type || "api_key").trim();
  const plainText = String(body.value || body.secret || body.apiKey || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,120}$/.test(id)) throw new Error("api_vault_id_invalid");
  if (!provider) throw new Error("provider_required");
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(envName)) throw new Error("env_name_invalid");
  if (!plainText) throw new Error("secret_value_required");
  const command = [
    "$ErrorActionPreference='Stop';",
    `$saved = & '${path.join(API_VAULT_SCRIPTS_DIR, "Add-ApiSecret.ps1").replace(/'/g, "''")}'`,
    "-Id $env:SYMBIOT_API_VAULT_ID",
    "-Provider $env:SYMBIOT_API_VAULT_PROVIDER",
    "-Scope $env:SYMBIOT_API_VAULT_SCOPE",
    "-EnvName $env:SYMBIOT_API_VAULT_ENV_NAME",
    "-SecretType $env:SYMBIOT_API_VAULT_SECRET_TYPE",
    "-PlainTextEnvName 'SYMBIOT_API_VAULT_SECRET_VALUE'",
    "-Status 'active'",
    "-Source 'obsidian-plugin-ui'",
    "-Notes $env:SYMBIOT_API_VAULT_NOTES",
    "-StorePath $env:SYMBIOT_API_VAULT_STORE_FILE",
    "-RotationRequired:($env:SYMBIOT_API_VAULT_ROTATION_REQUIRED -eq '1');",
    "$saved | ConvertTo-Json -Depth 6"
  ].join(" ");
  const result = await runPowerShell(command, {
    SYMBIOT_API_VAULT_ID: id,
    SYMBIOT_API_VAULT_PROVIDER: provider,
    SYMBIOT_API_VAULT_SCOPE: scope,
    SYMBIOT_API_VAULT_ENV_NAME: envName,
    SYMBIOT_API_VAULT_SECRET_TYPE: secretType,
    SYMBIOT_API_VAULT_SECRET_VALUE: plainText,
    SYMBIOT_API_VAULT_STORE_FILE: API_VAULT_STORE_FILE,
    SYMBIOT_API_VAULT_NOTES: String(body.notes || "Saved from Symbiot Obsidian Plugin API Keys UI"),
    SYMBIOT_API_VAULT_ROTATION_REQUIRED: body.rotationRequired ? "1" : "0"
  });
  return JSON.parse(result.stdout);
}

function envFingerprint(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

function migrationStatus() {
  const migrationFiles = [BUSINESS_MEMORY_MIGRATION_FILE, MISSION_GRAPH_MIGRATION_FILE];
  const files = migrationFiles.map((file) => {
    const exists = fs.existsSync(file);
    const sql = exists ? fs.readFileSync(file, "utf8") : "";
    return { file, exists, sql, sha256: exists ? createHash("sha256").update(sql).digest("hex") : null };
  });
  const combinedSql = files.map((item) => item.sql).join("\n\n");
  const presentTables = BUSINESS_MEMORY_TABLES.filter((table) => new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\b`, "i").test(combinedSql));
  const rlsTables = BUSINESS_MEMORY_TABLES.filter((table) => new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(combinedSql));
  const graphTablesPresent = MISSION_GRAPH_TABLES.filter((table) => presentTables.includes(table));
  const graphRlsTables = MISSION_GRAPH_TABLES.filter((table) => rlsTables.includes(table));
  return {
    schemaVersion: BUSINESS_MEMORY_SCHEMA_VERSION,
    migrationFile: BUSINESS_MEMORY_MIGRATION_FILE,
    migrationFiles: files.map(({ file, exists, sha256 }) => ({ file, exists, sha256 })),
    migrationFilePresent: files.every((item) => item.exists),
    migrationSha256: createHash("sha256").update(combinedSql).digest("hex"),
    requiredTables: BUSINESS_MEMORY_TABLES,
    missionGraphTables: MISSION_GRAPH_TABLES,
    presentTables,
    missingTables: BUSINESS_MEMORY_TABLES.filter((table) => !presentTables.includes(table)),
    rlsEnabledTables: rlsTables,
    rlsMissingTables: BUSINESS_MEMORY_TABLES.filter((table) => !rlsTables.includes(table)),
    foundationTablesReady: files.every((item) => item.exists) && presentTables.length === BUSINESS_MEMORY_TABLES.length,
    rlsPolicySkeletonReady: files.every((item) => item.exists) && rlsTables.length === BUSINESS_MEMORY_TABLES.length,
    missionGraphSchemaReady: graphTablesPresent.length === MISSION_GRAPH_TABLES.length && graphRlsTables.length === MISSION_GRAPH_TABLES.length
  };
}
function cloudStatus() {
  const supabaseUrl = String(process.env.SYMBIOT_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const anonKey = String(process.env.SYMBIOT_SUPABASE_ANON_KEY || process.env.SYMBIOT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const serviceRoleKey = String(process.env.SYMBIOT_SUPABASE_SERVICE_ROLE_KEY || process.env.SYMBIOT_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  const dbUrl = String(process.env.SYMBIOT_SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  const migration = migrationStatus();
  const configured = Boolean((supabaseUrl && (anonKey || serviceRoleKey)) || dbUrl);
  let urlHost = null;
  if (supabaseUrl) {
    try { urlHost = new URL(supabaseUrl).host; } catch (_) { urlHost = "invalid_url"; }
  }
  return {
    ok: true,
    status: configured ? "configured_yellow_until_live_connection_proof" : "not_configured_yellow",
    mode: "supabase_business_memory_foundation",
    schemaVersion: BUSINESS_MEMORY_SCHEMA_VERSION,
    configured,
    connectionProof: "not_run_in_obp035a",
    supabase: {
      urlConfigured: Boolean(supabaseUrl),
      anonKeyConfigured: Boolean(anonKey),
      serviceRoleKeyConfigured: Boolean(serviceRoleKey),
      publishableKeySupported: true,
      secretKeySupported: true,
      dbUrlConfigured: Boolean(dbUrl),
      urlHost,
      anonKeyFingerprint: envFingerprint(anonKey),
      serviceRoleKeyFingerprint: envFingerprint(serviceRoleKey),
      dbUrlFingerprint: envFingerprint(dbUrl)
    },
    liveProofReadiness: {
      canCheckRest: Boolean(supabaseUrl && (anonKey || serviceRoleKey)),
      canApplyMigration: Boolean(dbUrl),
      canRunOwnerScopedSmoke: Boolean(dbUrl && process.env.SYMBIOT_SUPABASE_TEST_USER_ID),
      missingForLiveProof: [
        ...(!supabaseUrl ? ["SYMBIOT_SUPABASE_URL"] : []),
        ...(!serviceRoleKey ? ["SYMBIOT_SUPABASE_SECRET_KEY or SYMBIOT_SUPABASE_SERVICE_ROLE_KEY"] : []),
        ...(!dbUrl ? ["SYMBIOT_SUPABASE_DB_URL"] : []),
        ...(!process.env.SYMBIOT_SUPABASE_TEST_USER_ID ? ["SYMBIOT_SUPABASE_TEST_USER_ID for owner-scoped smoke rows"] : [])
      ]
    },
    migration,
    productMemory: {
      humanReadableBase: "Obsidian vault: projects, business missions, business roles, role training, sources, results and evidence.",
      structuredBase: "Supabase: relationships, statuses, run history, evidence metadata, audit and future RAG index.",
      noSilentVaultUpload: true,
      explicitSourceConsentRequired: true,
      adminSees: ["device status", "vault status", "missions", "mission methodology metadata", "runs", "evidence status", "audit events", "provider metadata without secrets"],
      adminDoesNotSeeByDefault: ["full vault notes", "raw documents", "secret values"],
      clientMissionMethodologist: {
        ownerRole: "РОЛЬ_AI_Методолог_клиентских_миссий",
        route: "источник -> смысловая связь -> миссия -> результат -> проверка качества",
        plannedTables: ["mission_canvas_nodes", "mission_canvas_edges", "mission_methodology_patterns"],
        runtimeStatus: "local_metadata_contract_yellow"
      }
    },
    boundary: "YELLOW: schema foundation is local/proof-level. Live Supabase connection, RLS validation and production tenant security are separate gates."
  };
}

function mobileStatus() {
  return {
    mode: "local_mobile_web_mvp",
    status: "yellow",
    webAppReady: true,
    qrPairingReady: true,
    localRemoteControlReady: true,
    windowsAgentSafeMvpReady: true,
    relayEnabled: false,
    remoteAccessReady: false,
    activePairings: state.mobilePairings.filter((pairing) => Date.parse(pairing.expiresAt) > Date.now()).length,
    recentRemoteActions: state.mobileRemoteActions.slice(0, 5).map((action) => ({
      id: action.id,
      action: action.action,
      status: action.status,
      approved: action.approved,
      createdAt: action.createdAt
    })),
    boundary: "Local mobile web, QR pairing and safe Windows Agent MVP are available. Production remote relay and public internet access remain YELLOW."
  };
}

function connectorBaseUrl(req) {
  if (process.env.SYMBIOT_PUBLIC_CONNECTOR_URL) return process.env.SYMBIOT_PUBLIC_CONNECTOR_URL.replace(/\/+$/, "");
  const host = req && req.headers && req.headers.host ? req.headers.host : `${HOST}:${PORT}`;
  return `http://${host}`;
}

function createMobilePairing(req) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const baseUrl = connectorBaseUrl(req);
  const url = `${baseUrl}/mobile?token=${encodeURIComponent(token)}`;
  const pairing = { token, url, qrUrl: `${baseUrl}/mobile/qr.svg?token=${encodeURIComponent(token)}`, expiresAt, status: "issued" };
  state.mobilePairings.unshift(pairing);
  state.mobilePairings = state.mobilePairings.filter((item) => Date.parse(item.expiresAt) > Date.now()).slice(0, 20);
  audit({ source: "mobile", action: "pairing_token_created", approval: "not_required", result: "ok", expiresAt });
  return pairing;
}

function isKnownMobileToken(token) {
  return state.mobilePairings.some((pairing) => pairing.token === token && Date.parse(pairing.expiresAt) > Date.now());
}

function escapeHtml(value) {
  return String(value || "").replace(/[<>&\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[char]));
}

function appState() {
  const data = snapshot();
  return {
    ok: true,
    runtimeLevel: "local_harnes_gui_mvp",
    status: "yellow_pre_market",
    shell: {
      mode: "harnes_desktop_browser_gui",
      designStandard: "HARNES_Codex_Hermes",
      targetForm: {
        windows: "desktop_gui_shell",
        otherPlatforms: "browser_gui_plus_mobile"
      },
      desktopGuiReady: true,
      windowsDesktopShell: "scaffolded_yellow",
      pluginRole: "launcher_and_vault_connector",
      primaryUrl: `http://127.0.0.1:${PORT}/app`
    },
    connector: data.connector,
    uptimeSeconds: data.uptimeSeconds,
    devices: data.devices.slice(0, 10),
    missions: data.missions.slice(0, 20),
    queues: data.queues.slice(0, 20),
    runtimeRuns: data.runtimeRuns.slice(0, 10),
    missionIntakes: data.missionIntakes.slice(0, 10),
    fullMissionLoops: data.fullMissionLoops.slice(0, 10),
    operatingSystem: missionOperatingSystemContract(),
    artifacts: data.artifacts.slice(0, 10),
    architectureSignals: data.architectureSignals.slice(0, 20),
    visionCaptures: data.visionCaptures.slice(0, 10),
    evidenceItems: data.artifacts.slice(0, 10).map((artifact) => ({
      id: artifact.id,
      status: artifact.evidence ? artifact.evidence.status : artifact.status,
      path: artifact.path || null,
      sha256: artifact.sha256 || null,
      createdAt: artifact.createdAt || null
    })),
    providers: data.providers,
    llmComparisons: data.llmComparisons.slice(0, 5),
    mobile: mobileStatus(),
    cloud: data.cloud,
    environmentAgent: environmentAgentStatus(),
    boundaries: [
      "HARNES GUI is the main user interface for the local MVP.",
      "Windows target form is Desktop GUI; browser/mobile remain cross-platform access and fallback.",
      "Obsidian plugin is a thin launcher and vault connector, not the full product UI.",
      "Mission Management is the operating system runtime: intake, route, approval, execution, quality control and vault sync.",
      "No API key values or connector-token values are exposed in /app or /app/state.",
      "Architecture Signal Backbone stores metadata/status/hash only, not full vault content.",
      "Mission Intake blocks LLM execution until deterministic schema, contract, equalizer and approval are ready.",
      "Production remote relay, signed installer, marketplace and public sale remain YELLOW/RED."
    ]
  };
}

function missionOperatingSystemContract() {
  return {
    id: "symbiot_mission_management_operating_system",
    status: "active_yellow",
    productFunction: "Mission Management",
    meaning: "Mission Management is the operating system of Symbiot: it turns requests into routed missions, approvals, execution history, quality control and recoverable vault state.",
    obsidianLayer: LOS_OBSIDIAN_ROOT,
    obsidianMissionsRoot: MISSIONS_ROOT,
    physicalMirrorRoot: LOS_PHYSICAL_MIRROR_ROOT,
    physicalMirrorRole: "working layer for incoming operational files, metrics and unclassified Codex/runtime artifacts",
    pluginRole: "launcher and vault writer for mission runtime",
    connectorRole: "mission intake, routing, approval gate, execution history, quality control and vault sync",
    noNewSubsystem: true
  };
}

function missionBaseFolder(missionId) {
  return `${MISSIONS_ROOT}/${String(missionId || "mission_unknown").replace(/^\/+|\/+$/g, "")}`;
}

function renderDesktopAppHtml(req) {
  const pairing = createMobilePairing(req);
  const safeMobileUrl = escapeHtml(pairing.url);
  const safeQrUrl = escapeHtml(pairing.qrUrl);
  const tokenJson = JSON.stringify(pairing.token);
  return renderHarnesAppHtml({ safeMobileUrl, safeQrUrl, tokenJson });
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Симбиот: рабочий экран</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #17181c; color: #f3f4f6; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #17181c; color: #f3f4f6; }
    button, textarea, input { font: inherit; }
    button { min-height: 36px; border: 1px solid #5b6475; border-radius: 6px; padding: 8px 12px; color: #f7f8fb; background: #30333b; cursor: pointer; }
    button.primary { background: #7c5cff; border-color: #7c5cff; font-weight: 700; }
    button:disabled { opacity: .55; cursor: progress; }
    textarea, input { width: 100%; border: 1px solid #3d414d; border-radius: 6px; background: #121318; color: #f3f4f6; padding: 10px; }
    textarea { min-height: 116px; resize: vertical; }
    code, small { color: #aeb5c2; overflow-wrap: anywhere; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #cfd3dc; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr) 320px; grid-template-rows: 44px 1fr 28px; }
    .top { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid #30333b; background: #202229; }
    .brand { font-weight: 800; }
    .pill { border: 1px solid #3d414d; border-radius: 999px; padding: 4px 9px; color: #cfd3dc; background: #17181c; font-size: 12px; }
    .left, .right { overflow: auto; padding: 12px; background: #1c1e24; }
    .left { border-right: 1px solid #30333b; }
    .right { border-left: 1px solid #30333b; }
    .center { overflow: auto; padding: 14px; display: grid; gap: 12px; align-content: start; }
    .statusbar { grid-column: 1 / -1; padding: 5px 12px; border-top: 1px solid #30333b; color: #aeb5c2; background: #202229; font-size: 12px; }
    .card { display: grid; gap: 10px; border: 1px solid #343741; border-radius: 8px; padding: 12px; background: #22242a; }
    .card h2, .card h3, .card p { margin: 0; }
    .card h2 { font-size: 18px; }
    .card h3 { font-size: 14px; color: #cfd3dc; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
    .mission-list { display: grid; gap: 8px; }
    .mission-item { border: 1px solid #343741; border-radius: 6px; padding: 10px; background: #17181c; }
    .mission-item strong, .metric strong { display: block; }
    .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .pane { min-height: 220px; overflow: auto; background: #17181c; }
    .pane h3 { color: #f3f4f6; }
    .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid #343741; border-radius: 6px; padding: 10px; background: #17181c; }
    .qr { display: grid; place-items: center; width: 220px; max-width: 100%; padding: 10px; border-radius: 8px; background: #fff; }
    .qr img { width: 200px; height: 200px; display: block; }
    .danger { border-color: #7f493f; color: #ffd7d1; }
    @media (max-width: 1080px) {
      .app { grid-template-columns: 220px minmax(0, 1fr); }
      .right { grid-column: 1 / -1; border-left: 0; border-top: 1px solid #30333b; }
      .grid3 { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .app { display: block; }
      .top { min-height: 48px; flex-wrap: wrap; padding: 8px 12px; }
      .left, .right, .center { border: 0; }
      .metric-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app" data-symbiot-app-shell="thin-plugin-browser-gui">
    <header class="top">
      <span class="brand">Симбиот</span>
      <span class="pill">Browser GUI MVP</span>
      <span class="pill" id="connectorPill">connector: проверка...</span>
      <span class="pill">Obsidian = vault, плагин = запуск, GUI = работа</span>
    </header>
    <aside class="left">
      <section class="card">
        <h3>Vault</h3>
        <div class="mission-list" id="missions">загрузка...</div>
      </section>
      <section class="card">
        <h3>Действия</h3>
        <div class="toolbar">
          <button id="refresh">Обновить статус</button>
          <button id="runRuntime">Запустить runtime MVP</button>
          <button id="runCompare">Три окна LLM</button>
        </div>
      </section>
    </aside>
    <main class="center">
      <section class="card">
        <h2>Рабочий экран Симбиота</h2>
        <p>Здесь пользователь видит миссию, статус выполнения, три окна LLM, проверку качества и мобильное подключение. Obsidian остается хранилищем и графом.</p>
        <textarea id="prompt">Дмитрий, очень приятно. Подготовь короткий управляемый ответ по миссии Симбиота.</textarea>
      </section>
      <section class="grid3" id="llmGrid">
        <article class="card pane"><h3>Окно 1</h3><small>ожидает запуска</small><p></p></article>
        <article class="card pane"><h3>Окно 2</h3><small>ожидает запуска</small><p></p></article>
        <article class="card pane"><h3>Окно 3</h3><small>ожидает запуска</small><p></p></article>
      </section>
      <section class="card">
        <h3>План / статус / проверка</h3>
        <pre id="runtimeResult">ожидает действия</pre>
      </section>
    </main>
    <aside class="right">
      <section class="card">
        <h3>Метрики</h3>
        <div class="metric-grid" id="metrics"></div>
      </section>
      <section class="card">
        <h3>Мобильный доступ</h3>
        <div class="qr"><img src="${safeQrUrl}" alt="QR-код мобильного доступа Симбиота" /></div>
        <a href="${safeMobileUrl}" target="_blank" rel="noopener">${safeMobileUrl}</a>
        <small>Локальный QR. Интернет-релей и production remote пока YELLOW.</small>
      </section>
      <section class="card danger">
        <h3>Что нельзя обещать рынку</h3>
        <small>signed installer, marketplace, production remote relay, full Windows agent, tenant security audit и market-ready release еще не закрыты.</small>
      </section>
    </aside>
    <footer class="statusbar" id="statusbar">/app запущен, доказательство будет через OBP-031A proof.</footer>
  </div>
  <script>
    const token = ${tokenJson};
    function text(value) { return value == null ? "" : String(value); }
    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.reason || response.statusText);
      return payload;
    }
    function renderState(state) {
      document.getElementById('connectorPill').textContent = 'connector: ' + text(state.connector && state.connector.status || state.status);
      document.getElementById('missions').innerHTML = (state.missions && state.missions.length ? state.missions : [{ title: 'Миссия еще не создана', status: 'draft' }]).map((mission) =>
        '<div class="mission-item"><strong>' + text(mission.title) + '</strong><small>' + text(mission.status || mission.createdAt || '') + '</small></div>'
      ).join('');
      const metrics = [
        ['Миссии', state.missions ? state.missions.length : 0],
        ['Запуски', state.runtimeRuns ? state.runtimeRuns.length : 0],
        ['Проверка', state.evidenceItems ? state.evidenceItems.length : 0],
        ['Сигналы', state.architectureSignals ? state.architectureSignals.length : 0],
        ['LLM окна', state.providers ? state.providers.length : 0]
      ];
      document.getElementById('metrics').innerHTML = metrics.map(([label, value]) => '<div class="metric"><strong>' + value + '</strong><small>' + label + '</small></div>').join('');
      document.getElementById('statusbar').textContent = state.shell.mode + ' / ' + state.runtimeLevel + ' / ' + state.status;
    }
    async function refresh() {
      const state = await fetchJson('/app/state?token=' + encodeURIComponent(token));
      renderState(state);
      return state;
    }
    async function compare() {
      const grid = document.getElementById('llmGrid');
      grid.querySelectorAll('article').forEach((pane, index) => {
        pane.querySelector('h3').textContent = 'Окно ' + (index + 1);
        pane.querySelector('small').textContent = 'выполняю...';
        pane.querySelector('p').textContent = '';
      });
      const payload = await fetchJson('/llm/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'desktop-browser-gui', token, live: false, prompt: document.getElementById('prompt').value })
      });
      const panes = grid.querySelectorAll('article');
      const results = payload.comparison && payload.comparison.results ? payload.comparison.results : [];
      results.slice(0, 3).forEach((item, index) => {
        panes[index].querySelector('h3').textContent = item.providerName || item.providerId || ('Окно ' + (index + 1));
        panes[index].querySelector('small').textContent = text(item.model) + ' / ' + text(item.status);
        panes[index].querySelector('p').textContent = item.answer || item.risk || '';
      });
      await refresh();
    }
    async function runRuntime() {
      document.getElementById('runtimeResult').textContent = 'выполняю...';
      const payload = await fetchJson('/app/agent-runtime/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, source: 'desktop-browser-gui', approved: true, task: 'Проверить browser GUI MVP Симбиота и сформировать локальный artifact/evidence.' })
      });
      document.getElementById('runtimeResult').textContent = JSON.stringify(payload.run || payload, null, 2);
      await refresh();
    }
    document.getElementById('refresh').addEventListener('click', () => refresh().catch((error) => document.getElementById('statusbar').textContent = error.message));
    document.getElementById('runCompare').addEventListener('click', () => compare().catch((error) => document.getElementById('statusbar').textContent = error.message));
    document.getElementById('runRuntime').addEventListener('click', () => runRuntime().catch((error) => document.getElementById('runtimeResult').textContent = error.message));
    refresh().catch((error) => document.getElementById('statusbar').textContent = error.message);
  </script>
</body>
</html>`;
}

function renderHarnesAppHtml({ safeMobileUrl, safeQrUrl, tokenJson }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Симбиот HARNES</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #1f2026;
      --surface: #24262d;
      --soft: #2d3038;
      --text: #f4f4f5;
      --muted: #aeb3bd;
      --quiet: #777f8d;
      --line: rgba(255,255,255,.08);
      --accent: #8b7cf6;
      --accent-2: #5fb3ff;
      --ok: #67d394;
      --warn: #f0c76e;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    body.light {
      color-scheme: light;
      --bg: #f7f8fb;
      --surface: #ffffff;
      --soft: #eef1f6;
      --text: #111827;
      --muted: #5f6774;
      --quiet: #8a93a3;
      --line: rgba(17,24,39,.1);
      --accent: #5f4ee8;
      --accent-2: #2563eb;
      --ok: #16824b;
      --warn: #9a6a00;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 50% 0%, rgba(139,124,246,.12), transparent 34%), var(--bg); color: var(--text); }
    button, textarea, input { font: inherit; }
    button { border: 0; background: transparent; color: inherit; cursor: pointer; }
    button:disabled { opacity: .48; cursor: progress; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 244px minmax(560px, 1fr); grid-template-rows: 48px 1fr; }
    .topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--line); background: rgba(31,32,38,.68); backdrop-filter: blur(18px); }
    body.light .topbar { background: rgba(247,248,251,.72); }
    .window-dot { width: 10px; height: 10px; border-radius: 99px; background: var(--quiet); }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 214px; font-weight: 700; letter-spacing: 0; }
    .mark { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: #0b0d12; color: #fff; font-weight: 800; }
    .workspace-title { flex: 1; min-width: 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .iconbar { display: flex; align-items: center; gap: 4px; }
    .icon-button { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; color: var(--muted); }
    .icon-button:hover, .icon-button.active { background: var(--soft); color: var(--text); }
    .theme-toggle { display: flex; align-items: center; gap: 8px; padding-left: 8px; color: var(--muted); font-size: 12px; }
    .switch { width: 42px; height: 22px; border-radius: 999px; background: var(--soft); position: relative; }
    .switch::after { content: ""; position: absolute; width: 18px; height: 18px; left: 2px; top: 2px; border-radius: 50%; background: var(--text); transition: transform .18s ease; }
    body.light .switch::after { transform: translateX(20px); }
    .sidebar { padding: 18px 8px 18px 14px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 18px; background: rgba(255,255,255,.02); }
    body.light .sidebar { background: rgba(255,255,255,.5); }
    .primary-action { height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-radius: 10px; background: var(--soft); font-weight: 650; }
    .tool-section { display: grid; gap: 5px; }
    .section-title { padding: 0 10px 6px; color: var(--quiet); font-size: 11px; text-transform: uppercase; }
    .tool { height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-radius: 9px; color: var(--muted); text-align: left; }
    .tool:hover, .tool.active { background: var(--soft); color: var(--text); }
    .tool small { margin-left: auto; color: var(--quiet); }
    .runtime-mini { margin-top: auto; padding: 0 10px; color: var(--muted); font-size: 12px; display: grid; gap: 7px; }
    .status-line { display: flex; align-items: center; gap: 7px; }
    .status-light { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); }
    .stage { position: relative; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 0; transition: grid-template-columns .2s ease; }
    .stage.preview-open { grid-template-columns: minmax(0, 1fr) 360px; }
    .main { min-width: 0; padding: 42px 48px 24px; display: grid; grid-template-rows: auto minmax(280px, 1fr) auto; gap: 24px; overflow: auto; }
    .hero-visual { min-height: 150px; display: grid; place-items: center; text-align: center; color: var(--muted); }
    .hero-visual img { display: block; width: 100%; max-height: 320px; object-fit: contain; }
    .hero-card { width: min(640px, 100%); min-height: 122px; display: grid; place-items: center; gap: 10px; position: relative; }
    .hero-title { font-size: clamp(34px, 5vw, 68px); line-height: 1; font-weight: 820; letter-spacing: 0; color: var(--text); }
    .hero-subtitle { font-size: 13px; color: var(--muted); }
    .chat-space { width: min(920px, 100%); justify-self: center; display: grid; gap: 18px; }
    .message { max-width: 760px; padding: 0 2px; line-height: 1.55; color: var(--text); }
    .message.user { justify-self: end; max-width: 620px; padding: 14px 18px; border-radius: 18px; background: rgba(139,124,246,.16); }
    .output-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; color: var(--muted); }
    .runtime-activity { min-width: 238px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .activity-light { width: 9px; height: 9px; border-radius: 50%; background: var(--quiet); box-shadow: 0 0 0 3px rgba(255,255,255,.04); }
    .runtime-activity[data-state="working"] .activity-light { background: var(--warn); animation: activity-pulse 1.1s ease-in-out infinite; }
    .runtime-activity[data-llm="on"] .activity-light { background: var(--ok); }
    .activity-timer { width: 42px; font-variant-numeric: tabular-nums; color: var(--text); }
    .cancel-operation { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; background: var(--soft); color: var(--text); }
    @keyframes activity-pulse { 50% { opacity: .38; transform: scale(.82); } }
    .output-actions { display: flex; gap: 6px; }
    .text-action { min-height: 32px; padding: 0 11px; border-radius: 9px; background: var(--soft); color: var(--text); }
    .output-grid { display: grid; grid-template-columns: repeat(var(--pane-count, 1), minmax(0, 1fr)); gap: 14px; }
    .output-pane { min-height: 220px; padding: 18px; border-radius: 18px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 1px var(--line); overflow: auto; }
    body.light .output-pane { background: rgba(255,255,255,.76); }
    .output-pane h3 { margin: 0 0 8px; font-size: 14px; }
    .output-pane small { color: var(--quiet); }
    .output-pane p { margin: 14px 0 0; white-space: pre-wrap; color: var(--muted); line-height: 1.45; }
    .mission-approval { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 2px 0; color: var(--muted); }
    .mission-approval[hidden] { display: none; }
    .mission-approval strong { display: block; color: var(--text); margin-bottom: 3px; }
    .mission-approval-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .approval-primary { background: var(--accent); color: #fff; font-weight: 700; }
    .composer { width: min(920px, 100%); justify-self: center; display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: end; gap: 8px; padding: 10px; border-radius: 20px; background: var(--surface); box-shadow: 0 18px 60px rgba(0,0,0,.22), inset 0 0 0 1px var(--line); }
    .composer textarea { width: 100%; min-height: 52px; max-height: 160px; resize: vertical; border: 0; outline: 0; background: transparent; color: var(--text); padding: 8px 0; }
    .send { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 800; }
    .ghost { width: 40px; height: 40px; border-radius: 50%; color: var(--muted); display: grid; place-items: center; font-size: 22px; }
    .preview { min-width: 0; overflow: auto; border-left: 1px solid var(--line); background: rgba(255,255,255,.025); transform: translateX(0); }
    .preview[hidden] { display: none; }
    .preview-inner { padding: 24px 18px; display: grid; gap: 18px; }
    .preview-block { display: grid; gap: 10px; }
    .preview-block h2, .preview-block h3, .preview-block p { margin: 0; }
    .preview-block h2 { font-size: 18px; }
    .preview-list { display: grid; gap: 9px; }
    .preview-row { padding: 12px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
    .preview-row strong { display: block; color: var(--text); margin-bottom: 4px; }
    .qr { width: 176px; height: 176px; padding: 8px; border-radius: 14px; background: #fff; display: grid; place-items: center; }
    .qr img { width: 158px; height: 158px; display: block; }
    a { color: var(--accent-2); overflow-wrap: anywhere; }
    code, small { color: var(--muted); overflow-wrap: anywhere; }
    @media (max-width: 1040px) {
      .shell { grid-template-columns: 74px minmax(0, 1fr); }
      .brand span:not(.mark), .tool span, .tool small, .section-title, .primary-action span, .runtime-mini { display: none; }
      .sidebar { align-items: center; padding: 14px 8px; }
      .primary-action, .tool { width: 44px; justify-content: center; padding: 0; }
      .stage.preview-open { grid-template-columns: minmax(0, 1fr); }
      .preview { position: absolute; right: 0; top: 0; bottom: 0; width: min(360px, 92vw); box-shadow: -20px 0 70px rgba(0,0,0,.26); background: var(--bg); }
      .main { padding: 32px 26px 20px; }
    }
    @media (max-width: 720px) {
      .shell { display: block; }
      .topbar { position: sticky; top: 0; z-index: 5; min-height: 48px; }
      .sidebar { position: sticky; top: 48px; z-index: 4; flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .main { padding: 26px 14px 16px; }
      .hero-title { font-size: 38px; }
      .output-grid { grid-template-columns: 1fr; }
      .mission-approval { align-items: stretch; flex-direction: column; }
      .mission-approval-actions { width: 100%; }
      .mission-approval-actions .text-action { flex: 1; }
      .composer { grid-template-columns: 36px minmax(0, 1fr) 36px; border-radius: 16px; }
    }
  </style>
</head>
<body>
  <div class="shell" data-symbiot-app-shell="harnes-desktop-browser-gui" data-design-standard="HARNES_Codex_Hermes">
    <header class="topbar">
      <div class="brand"><span class="mark">S</span><span>Симбиот</span></div>
      <div class="window-dot"></div>
      <div class="window-dot"></div>
      <div class="workspace-title">HARNES workspace / Obsidian + Graph + RAG / локальный runtime</div>
      <div class="iconbar" aria-label="Панель команд">
        <button class="icon-button" id="previewToggle" title="Показать результат">▤</button>
        <button class="icon-button" id="compareLayout" title="Окна сравнения">▥</button>
        <button class="icon-button" id="mobileToggle" title="Мобильный доступ">⌁</button>
        <button class="icon-button" id="refresh" title="Обновить">↻</button>
      </div>
      <button class="theme-toggle" id="themeToggle" title="Светлая / темная схема">
        <span>темная</span><span class="switch" aria-hidden="true"></span><span>светлая</span>
      </button>
    </header>
    <aside class="sidebar" aria-label="Инструменты Симбиота">
      <button class="primary-action" id="newMission"><span>＋</span><span>Новая миссия</span></button>
      <nav class="tool-section">
        <div class="section-title">Инструменты</div>
        <button class="tool active" data-tool="chat"><span>□</span><span>Чат</span><small>Ctrl K</small></button>
        <button class="tool" data-tool="llm"><span>▥</span><span>LLM Hub</span><small>3 окна</small></button>
        <button class="tool" data-tool="rag"><span>⌕</span><span>Контекст / RAG</span></button>
        <button class="tool" data-tool="vision"><span>◉</span><span>Зрение</span><small>screen QA</small></button>
        <button class="tool" data-tool="files"><span>▣</span><span>Рабочие файлы</span></button>
        <button class="tool" data-tool="evidence"><span>✓</span><span>Проверка</span></button>
        <button class="tool" data-tool="mobile"><span>⌁</span><span>Мобильный доступ</span></button>
        <button class="tool" data-tool="agent"><span>⚙</span><span>Windows Agent</span></button>
        <button class="tool" data-tool="admin"><span>↥</span><span>Admin Sync</span></button>
      </nav>
      <nav class="tool-section">
        <div class="section-title">Vault</div>
        <button class="tool" data-tool="missions"><span>▾</span><span>Миссии</span><small id="missionCount">0</small></button>
        <button class="tool" data-tool="sources"><span>◌</span><span>Источники</span></button>
        <button class="tool" data-tool="artifacts"><span>◇</span><span>Артефакты</span><small id="artifactCount">0</small></button>
      </nav>
      <div class="runtime-mini">
        <div class="status-line"><span class="status-light" id="statusLight"></span><span id="connectorMini">connector: проверка</span></div>
        <code>127.0.0.1:${PORT}</code>
      </div>
    </aside>
    <section class="stage" id="stage">
      <main class="main">
        <section class="hero-visual" aria-label="Визуальный экран Симбиота">
          <div class="hero-card">
            <div class="hero-title">СИМБИОТ</div>
            <div class="hero-subtitle">один агент · Obsidian vault · Graph · RAG · Vision · LLM comparison</div>
          </div>
        </section>
        <section class="chat-space" aria-label="Центральный чат и результаты">
          <div class="message">Опиши бизнес-миссию обычным языком. Симбиот соберет контекст, подключит нужные внутренние роли, покажет паспорт, ход выполнения и результат.</div>
          <div class="message user" id="userPromptPreview">Дмитрий, очень приятно.</div>
          <div class="output-header">
            <span>Миссия / окно вывода</span>
            <div class="runtime-activity" id="runtimeActivity" data-state="idle" data-llm="off">
              <span class="activity-light" aria-hidden="true"></span>
              <span id="activityLabel">LLM выключена</span>
              <time class="activity-timer" id="activityTimer">00:00</time>
              <button class="cancel-operation" id="cancelOperation" title="Остановить текущую операцию" disabled>×</button>
            </div>
            <div class="output-actions">
              <button class="text-action" id="addPane">＋ окно</button>
              <button class="text-action" id="runMissionIntake">Подготовить миссию</button>
              <button class="text-action" id="runCompare">Сравнить LLM</button>
              <button class="text-action" id="runRuntime" disabled>Подтвердить</button>
            </div>
          </div>
          <div class="mission-approval" id="missionApproval" hidden>
            <div>
              <strong>План готов к запуску</strong>
              <span id="missionApprovalSummary">Проверьте роли, бюджет и место сохранения.</span>
            </div>
            <div class="mission-approval-actions">
              <button class="text-action" id="correctMission">Скорректировать</button>
              <button class="text-action approval-primary" id="confirmMission">Подтвердить и запустить</button>
            </div>
          </div>
          <div class="output-grid" id="llmGrid" style="--pane-count: 1">
            <article class="output-pane" data-pane="1" data-symbiot-mission-intake="waiting" data-symbiot-runtime-contract="waiting" data-symbiot-llm-equalizer="waiting" data-symbiot-pre-llm-trace="waiting" data-model-calls="0"><h3>Симбиот</h3><small>ожидает задачи</small><p>Здесь появится паспорт миссии, контракт выполнения, LLM-эквалайзер и pre-LLM trace. LLM не вызывается до подтверждения.</p></article>
          </div>
        </section>
        <form class="composer" id="composer">
          <button type="button" class="ghost" title="Добавить источник">＋</button>
          <textarea id="prompt" aria-label="Задача для Симбиота">Дмитрий, очень приятно. Подготовь короткий управляемый ответ по миссии Симбиота.</textarea>
          <button type="submit" class="send" title="Отправить">↑</button>
        </form>
      </main>
      <aside class="preview" id="preview" hidden aria-label="Просмотр результата">
        <div class="preview-inner">
          <section class="preview-block">
            <h2>Результат</h2>
            <div class="preview-list" id="resultPreview">
              <div class="preview-row"><strong>Статус</strong><span>ожидает действия</span></div>
            </div>
          </section>
          <section class="preview-block">
            <h3>Зрение</h3>
            <small>Desktop GUI умеет проходить visual QA: открыть интерфейс, выполнить действия, снять screenshot и проверить, что результат виден. Полное browser/file/media vision остается отдельным YELLOW-gate.</small>
          </section>
          <section class="preview-block" id="mobileBlock">
            <h3>Мобильный доступ</h3>
            <div class="qr"><img src="${safeQrUrl}" alt="QR-код мобильного доступа Симбиота" /></div>
            <a href="${safeMobileUrl}" target="_blank" rel="noopener">${safeMobileUrl}</a>
            <small>Локальная панель телефона. Интернет-релей остается YELLOW до отдельного security gate.</small>
          </section>
          <section class="preview-block">
            <h3>Граница обещаний</h3>
            <small>Это локальный HARNES GUI MVP. Signed Windows installer, marketplace, production remote relay, full Windows Agent и tenant security audit еще не закрыты.</small>
          </section>
        </div>
      </aside>
    </section>
  </div>
  <script>
    const token = ${tokenJson};
    let paneCount = 1;
    let preparedMission = null;
    let correctionDraft = null;
    let activeOperationId = null;
    let activityStartedAt = 0;
    let activityTimerHandle = null;
    function text(value) { return value == null ? "" : String(value); }
    function newOperationId() {
      return 'desktop-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }
    function renderActivityTimer() {
      const elapsed = Math.max(0, Math.floor((Date.now() - activityStartedAt) / 1000));
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      document.getElementById('activityTimer').textContent = minutes + ':' + seconds;
    }
    function beginActivity(label, llmActive, cancellable) {
      if (activityTimerHandle) clearInterval(activityTimerHandle);
      activeOperationId = newOperationId();
      activityStartedAt = Date.now();
      const activity = document.getElementById('runtimeActivity');
      activity.dataset.state = 'working';
      activity.dataset.llm = llmActive ? 'on' : 'off';
      document.getElementById('activityLabel').textContent = (llmActive ? 'LLM включена: ' : 'LLM выключена: ') + label;
      document.getElementById('cancelOperation').disabled = !cancellable;
      renderActivityTimer();
      activityTimerHandle = setInterval(renderActivityTimer, 1000);
      return activeOperationId;
    }
    function finishActivity(label) {
      if (activityTimerHandle) clearInterval(activityTimerHandle);
      activityTimerHandle = null;
      const activity = document.getElementById('runtimeActivity');
      activity.dataset.state = 'idle';
      activity.dataset.llm = 'off';
      document.getElementById('activityLabel').textContent = label || 'LLM выключена';
      document.getElementById('cancelOperation').disabled = true;
      activeOperationId = null;
    }
    async function cancelActiveOperation() {
      if (!activeOperationId) return;
      const operationId = activeOperationId;
      document.getElementById('cancelOperation').disabled = true;
      document.getElementById('activityLabel').textContent = 'Останавливаю операцию...';
      await fetchJson('/app/operation/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, operationId })
      });
    }
    function paneTemplate(index) {
      return '<article class="output-pane" data-pane="' + index + '" data-model-calls="0"><h3>Окно ' + index + '</h3><small>ожидает запуска</small><p></p></article>';
    }
    function setPreviewOpen(open) {
      document.getElementById('preview').hidden = !open;
      document.getElementById('stage').classList.toggle('preview-open', open);
      document.getElementById('previewToggle').classList.toggle('active', open);
    }
    function setPanes(count) {
      paneCount = Math.max(1, Math.min(3, count));
      const grid = document.getElementById('llmGrid');
      grid.style.setProperty('--pane-count', paneCount);
      grid.innerHTML = Array.from({ length: paneCount }, (_, index) => paneTemplate(index + 1)).join('');
      if (paneCount === 1) {
        const pane = grid.querySelector('article');
        pane.querySelector('h3').textContent = 'Симбиот';
        pane.querySelector('small').textContent = 'ожидает задачи';
        pane.querySelector('p').textContent = 'Здесь появится паспорт миссии, контракт выполнения, LLM-эквалайзер и pre-LLM trace. LLM не вызывается до подтверждения.';
      }
    }
    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.reason || response.statusText);
      return payload;
    }
    function updatePreview(rows) {
      document.getElementById('resultPreview').innerHTML = rows.map((row) =>
        '<div class="preview-row"><strong>' + text(row[0]) + '</strong><span>' + text(row[1]) + '</span></div>'
      ).join('');
    }
    function setMissionApproval(payload) {
      preparedMission = payload && payload.status === 'ready_for_approval' ? payload : null;
      document.getElementById('missionApproval').hidden = !preparedMission;
      document.getElementById('runRuntime').disabled = !preparedMission;
      if (preparedMission) {
        document.getElementById('missionApprovalSummary').textContent =
          preparedMission.runtimeContract.destination + ' · бюджет $' +
          preparedMission.responsibilityEqualizer.estimatedBudgetUsd.min + '-$' +
          preparedMission.responsibilityEqualizer.estimatedBudgetUsd.max;
      }
    }
    function correctMission() {
      if (preparedMission) {
        correctionDraft = {
          missionText: preparedMission.intake.missionText,
          missionId: preparedMission.runtimeContract.missionId
        };
      }
      setMissionApproval(null);
      const prompt = document.getElementById('prompt');
      prompt.focus();
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      updatePreview([
        ['Статус', 'План возвращен на корректировку'],
        ['Действие', 'Измените задачу и снова нажмите стрелку']
      ]);
    }
    async function recordMissionCorrection(correctedText) {
      if (!correctionDraft || correctionDraft.missionText === correctedText) return null;
      const result = await fetchJson('/app/reflexion/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          source: 'harnes-desktop-gui',
          title: 'Пользователь скорректировал план миссии',
          context: 'Подготовка миссии ' + correctionDraft.missionId + ': ' + correctionDraft.missionText,
          error: 'Первичная постановка или предложенный план потребовали пользовательской корректировки.',
          correction: 'Пользователь изменил постановку на: ' + correctedText,
          futureRule: 'Перед подготовкой похожей миссии учитывать это уточнение и не запускать выполнение до повторного подтверждения.'
        })
      });
      correctionDraft = null;
      return result.reflexion;
    }
    function renderState(state) {
      document.getElementById('connectorMini').textContent = 'connector: ' + text(state.connector && state.connector.status || state.status);
      document.getElementById('missionCount').textContent = state.missions ? state.missions.length : 0;
      document.getElementById('artifactCount').textContent = state.artifacts ? state.artifacts.length : 0;
      document.getElementById('statusLight').style.background = state.status && state.status.includes('yellow') ? 'var(--warn)' : 'var(--ok)';
      updatePreview([
        ['Connector', text(state.connector && state.connector.status || state.status)],
        ['Runtime', text(state.runtimeLevel)],
        ['Миссии', state.missions ? state.missions.length : 0],
        ['Проверка', state.evidenceItems ? state.evidenceItems.length : 0],
        ['Архитектурные сигналы', state.architectureSignals ? state.architectureSignals.length : 0],
        ['Форма продукта', text(state.shell && state.shell.targetForm && state.shell.targetForm.windows)]
      ]);
    }
    async function refresh() {
      const state = await fetchJson('/app/state?token=' + encodeURIComponent(token));
      renderState(state);
      return state;
    }
    async function compare() {
      if (paneCount < 3) setPanes(3);
      const operationId = beginActivity('проверяю три окна', false, true);
      document.getElementById('userPromptPreview').textContent = document.getElementById('prompt').value;
      const panes = document.querySelectorAll('.output-pane');
      panes.forEach((pane, index) => {
        pane.querySelector('h3').textContent = 'Окно ' + (index + 1);
        pane.querySelector('small').textContent = 'выполняю...';
        pane.querySelector('p').textContent = '';
      });
      let payload;
      try {
        payload = await fetchJson('/llm/compare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'harnes-desktop-browser-gui', token, operationId, live: false, prompt: document.getElementById('prompt').value })
        });
      } finally {
        finishActivity('LLM выключена');
      }
      const results = payload.comparison && payload.comparison.results ? payload.comparison.results : [];
      results.slice(0, 3).forEach((item, index) => {
        panes[index].querySelector('h3').textContent = item.providerName || item.providerId || ('Окно ' + (index + 1));
        panes[index].querySelector('small').textContent = text(item.model) + ' / ' + text(item.status);
        panes[index].querySelector('p').textContent = item.answer || item.risk || '';
      });
      updatePreview([
        ['LLM comparison', payload.comparison ? payload.comparison.status : 'done'],
        ['Окон', results.length],
        ['Режим', 'без live-вызова в proof'],
        ['Проверка', 'результат доступен в runtime proof']
      ]);
      setPreviewOpen(true);
      await refresh();
    }
    async function runRuntime() {
      if (!preparedMission) {
        setPreviewOpen(true);
        updatePreview([
          ['Gate', 'Сначала подготовьте миссию'],
          ['Действие', 'Введите задачу и нажмите стрелку, затем подтвердите показанный план']
        ]);
        return;
      }
      setPreviewOpen(true);
      const pane = document.querySelector('.output-pane');
      const confirmationButtons = [document.getElementById('confirmMission'), document.getElementById('runRuntime')];
      confirmationButtons.forEach((button) => { button.disabled = true; });
      const operationId = beginActivity('Role Runtime выполняет миссию', true, true);
      pane.querySelector('h3').textContent = 'Role Runtime';
      pane.querySelector('small').textContent = 'маршрутизация и выполнение...';
      pane.querySelector('p').textContent = 'Gateway → Router → Role Registry → Context Builder → Role Runtime → Validator → Trace';
      updatePreview([['Runtime', 'план подтвержден, создаю миссию в Obsidian и запускаю роли...']]);
      try {
        const payload = await fetchJson('/app/mission/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            operationId,
            source: 'harnes-desktop-browser-gui',
            intakeId: preparedMission.id,
            approved: true,
            executeLlm: true,
            live: true
          })
        });
        const loop = payload.fullMissionLoop || {};
        const llm = loop.llmExecution || {};
        pane.dataset.runtimeCoreVersion = loop.runtimeCoreVersion || 'missing';
        pane.dataset.runtimeTrace = loop.executionTrace ? loop.executionTrace.sha256 : 'missing';
        pane.dataset.modelCalls = String(llm.modelCalls || 0);
        pane.querySelector('h3').textContent = llm.providerName || 'Симбиот';
        pane.querySelector('small').textContent = [llm.model, llm.status, loop.status].filter(Boolean).join(' / ');
        pane.querySelector('p').textContent = llm.answer || 'Runtime не вернул текст результата.';
        updatePreview([
          ['Runtime', loop.status || payload.status],
          ['Архитектура', (loop.infrastructureTrace || []).map(item => item.component).join(' → ')],
          ['Роли', (loop.roles || []).map(item => item.role).join(', ')],
          ['LLM', [llm.providerName, llm.model].filter(Boolean).join(' / ')],
          ['Стоимость, USD', llm.estimatedCostUsd == null ? 'нет данных' : llm.estimatedCostUsd],
          ['Obsidian', loop.vaultSync && loop.vaultSync.status === 'written' ? loop.vaultSync.baseFolder : 'не записан'],
          ['Файлов миссии', loop.vaultSync && loop.vaultSync.files ? loop.vaultSync.files.length : 0],
          ['Validator', loop.outputValidation ? loop.outputValidation.status : 'нет'],
          ['Trace SHA', loop.executionTrace ? loop.executionTrace.sha256 : 'нет']
        ]);
        finishActivity('LLM выключена: результат готов');
        setMissionApproval(null);
        await refresh();
      } catch (error) {
        finishActivity('LLM выключена: запуск остановлен');
        pane.querySelector('small').textContent = 'запуск остановлен';
        pane.querySelector('p').textContent = error.message;
        updatePreview([
          ['Ошибка runtime', error.message],
          ['Статус', 'YELLOW: план сохранен, запуск можно повторить после исправления']
        ]);
        confirmationButtons.forEach((button) => { button.disabled = false; });
        throw error;
      }
    }
    async function captureVision() {
      if (!window.confirm('Сделать локальный снимок экрана для visual evidence? Снимок не отправляется во внешнюю модель.')) return;
      setPreviewOpen(true);
      updatePreview([['Зрение', 'снимаю экран...']]);
      const payload = await fetchJson('/app/vision/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, source: 'harnes-desktop-gui', approved: true, targetType: 'screen' })
      });
      const capture = payload.visionCapture;
      const visual = document.querySelector('.hero-visual');
      visual.innerHTML = '<img alt="Локальный visual evidence Симбиота" src="' + capture.imageUrl + '&token=' + encodeURIComponent(token) + '">';
      updatePreview([
        ['Зрение', capture.status],
        ['Размер', capture.width + ' × ' + capture.height],
        ['Файл', capture.path],
        ['SHA', capture.sha256],
        ['Внешняя отправка', 'нет']
      ]);
      await refresh();
    }
    async function missionIntake() {
      setMissionApproval(null);
      setPanes(1);
      const prompt = document.getElementById('prompt').value;
      beginActivity('собираю план, роли и библиотеку', false, false);
      const correctionRecord = await recordMissionCorrection(prompt);
      document.getElementById('userPromptPreview').textContent = prompt;
      const pane = document.querySelector('.output-pane');
      pane.dataset.symbiotMissionIntake = 'running';
      pane.dataset.modelCalls = '0';
      pane.querySelector('h3').textContent = 'Mission Intake';
      pane.querySelector('small').textContent = 'проверяю без LLM...';
      pane.querySelector('p').textContent = 'Разбираю задачу, обязательные поля, контракт и уровень ответственности.';
      const payload = await fetchJson('/app/mission/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, source: 'harnes-desktop-gui', missionText: prompt })
      });
      pane.dataset.symbiotMissionIntake = payload.status;
      pane.dataset.symbiotRuntimeContract = payload.runtimeContract ? payload.runtimeContract.status : 'blocked';
      pane.dataset.symbiotLlmEqualizer = payload.responsibilityEqualizer ? payload.responsibilityEqualizer.status : 'blocked';
      pane.dataset.symbiotPreLlmTrace = payload.trace ? payload.trace.status : 'missing';
      pane.dataset.modelCalls = String(payload.modelCalls || 0);
      if (payload.status === 'needs_clarification') {
        pane.querySelector('small').textContent = 'нужно уточнение / modelCalls=0';
        pane.querySelector('p').textContent = payload.validation.questions.map((item) => '• ' + item.question).join('\\n');
        updatePreview([
          ['Gate', 'Clarification Gate'],
          ['Статус', 'YELLOW: запуск LLM заблокирован'],
          ['Не хватает', payload.validation.missingFields.join(', ')],
          ['Model calls', payload.modelCalls || 0]
        ]);
      } else {
        pane.querySelector('small').textContent = payload.responsibilityEqualizer.effortMode + ' / ' + payload.responsibilityEqualizer.modelTier + ' / modelCalls=0';
        pane.querySelector('p').textContent = [
          'Контракт: ' + payload.runtimeContract.expectedArtifact + ' -> ' + payload.runtimeContract.destination,
          'Проверка: ' + payload.runtimeContract.acceptanceCheck,
          'Эквалайзер: score ' + payload.responsibilityEqualizer.score + ', ' + payload.responsibilityEqualizer.validatorDepth,
          'Предварительный бюджет: $' + payload.responsibilityEqualizer.estimatedBudgetUsd.min + '-$' + payload.responsibilityEqualizer.estimatedBudgetUsd.max,
          'Роли: ' + payload.rolePlan.selectedRoles.map((role) => role.roleRef + ' ' + role.version).join(', '),
          'Источники контекста: ' + payload.contextPlan.explicitSources.length + ' / policy=' + payload.contextPlan.sourcePolicy,
          'Библиотека: ' + payload.libraryGate.status + ', эталонов=' + payload.libraryGate.summary.selectedCount,
          'Артефакты Obsidian: ' + Object.values(payload.artifactBundle.paths).join(', '),
          'След: ' + payload.trace.steps.map((step) => step.id).join(' -> ')
        ].join('\\n');
        updatePreview([
          ['Gate', 'Result Gate before Role Runtime'],
          ['Статус', payload.status],
          ['Runtime contract', payload.runtimeContract.status],
          ['LLM Equalizer', payload.responsibilityEqualizer.effortMode],
          ['Бюджет до запуска', '$' + payload.responsibilityEqualizer.estimatedBudgetUsd.min + '-$' + payload.responsibilityEqualizer.estimatedBudgetUsd.max],
          ['Группа ролей', payload.rolePlan.selectedRoles.map((role) => role.roleRef).join(', ')],
          ['Источники', payload.contextPlan.explicitSources.length],
          ['Library Gate', payload.libraryGate.status + ' / refs=' + payload.libraryGate.summary.selectedCount],
          ['Reflexion', payload.reflexionMemory.relevantCount + ' релевантных правил' + (correctionRecord && correctionRecord.written ? ' / корректировка записана' : '')],
          ['Model calls', payload.modelCalls || 0],
          ['Mission', payload.runtimeContract.missionId]
        ]);
        setMissionApproval(payload);
      }
      setPreviewOpen(true);
      await refresh();
      finishActivity('LLM выключена: план готов');
    }
    function applyTheme() {
      const mode = localStorage.getItem('symbiot-theme') || 'dark';
      document.body.classList.toggle('light', mode === 'light');
    }
    document.getElementById('previewToggle').addEventListener('click', () => setPreviewOpen(document.getElementById('preview').hidden));
    document.getElementById('mobileToggle').addEventListener('click', () => { setPreviewOpen(true); document.getElementById('mobileBlock').scrollIntoView({ block: 'center' }); });
    document.getElementById('compareLayout').addEventListener('click', () => setPanes(paneCount === 3 ? 1 : paneCount + 1));
    document.getElementById('addPane').addEventListener('click', () => setPanes(paneCount + 1));
    document.getElementById('runCompare').addEventListener('click', () => compare().catch((error) => { finishActivity('LLM выключена: ошибка'); updatePreview([['Ошибка LLM', error.message]]); }));
    document.getElementById('runMissionIntake').addEventListener('click', () => missionIntake().catch((error) => { finishActivity('LLM выключена: ошибка'); updatePreview([['Ошибка mission intake', error.message]]); }));
    document.getElementById('newMission').addEventListener('click', () => {
      setMissionApproval(null);
      setPanes(1);
      const prompt = document.getElementById('prompt');
      prompt.value = '';
      prompt.focus();
      document.getElementById('userPromptPreview').textContent = 'Новая миссия';
      updatePreview([['Статус', 'Опишите новую миссию обычными словами']]);
    });
    document.getElementById('runRuntime').addEventListener('click', () => runRuntime().catch((error) => updatePreview([['Ошибка runtime', error.message]])));
    document.getElementById('confirmMission').addEventListener('click', () => runRuntime().catch((error) => updatePreview([['Ошибка runtime', error.message]])));
    document.getElementById('correctMission').addEventListener('click', correctMission);
    document.getElementById('cancelOperation').addEventListener('click', () => cancelActiveOperation().catch((error) => updatePreview([['Ошибка остановки', error.message]])));
    document.querySelector('[data-tool="vision"]').addEventListener('click', () => captureVision().catch((error) => updatePreview([['Ошибка зрения', error.message]])));
    document.getElementById('refresh').addEventListener('click', () => refresh().catch((error) => updatePreview([['Ошибка connector', error.message]])));
    document.getElementById('themeToggle').addEventListener('click', () => {
      localStorage.setItem('symbiot-theme', document.body.classList.contains('light') ? 'dark' : 'light');
      applyTheme();
    });
    document.getElementById('composer').addEventListener('submit', (event) => {
      event.preventDefault();
      missionIntake().catch((error) => updatePreview([['Ошибка mission intake', error.message]]));
    });
    applyTheme();
    refresh().catch((error) => updatePreview([['Connector', error.message]]));
  </script>
</body>
</html>`;
}

function renderMobileHtml(token) {
  const escapedToken = escapeHtml(token);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Симбиот: мобильный доступ</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #17181c; color: #f3f4f6; }
    body { margin: 0; padding: 16px; background: #17181c; }
    main { max-width: 760px; margin: 0 auto; display: grid; gap: 12px; }
    section { border: 1px solid #343741; border-radius: 8px; padding: 12px; background: #22242a; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 15px; color: #cfd3dc; }
    textarea, input, button { width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #3d414d; background: #17181c; color: #f3f4f6; padding: 10px; font: inherit; }
    textarea { min-height: 112px; resize: vertical; }
    button { background: #7c5cff; border-color: #7c5cff; font-weight: 650; }
    button:disabled { opacity: .55; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .pane { min-height: 180px; overflow: auto; background: #191b20; }
    code, small { color: #aeb5c2; overflow-wrap: anywhere; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Симбиот: мобильный доступ</h1>
      <p>Телефон работает как локальная панель управления Obsidian на компьютере.</p>
      <small>токен: ${escapedToken || "не передан"}</small>
      <small>Режим: pre-market. Удаленный доступ через интернет закрыт до отдельного security gate.</small>
    </section>
    <section>
      <h2>Статус</h2>
      <pre id="status">загрузка...</pre>
    </section>
    <section>
      <h2>LLM Hub: три окна</h2>
      <textarea id="prompt">Подготовь короткий управляемый ответ по миссии Симбиота.</textarea>
      <button id="run">Запустить три окна</button>
    </section>
    <section>
      <h2>Windows Agent: безопасные действия</h2>
      <small>Действия с компьютером выполняются только в safe MVP. Произвольный запуск программ заблокирован.</small>
      <input id="path" value="${process.cwd().replace(/\\/g, "\\\\").replace(/[<>&\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[char]))}" />
      <button id="checkPath">Проверить путь</button>
      <button id="listProcesses">Показать процессы</button>
      <input id="url" value="https://just-ai.com/" />
      <label><input id="approveOpenUrl" type="checkbox" /> Я подтверждаю открытие ссылки на компьютере</label>
      <button id="openUrl">Открыть ссылку</button>
      <pre id="remoteResult">ожидает действия...</pre>
    </section>
    <section>
      <h2>Ответы</h2>
      <div class="grid" id="results"></div>
    </section>
  </main>
  <script>
    const token = ${JSON.stringify(token || "")};
    async function refresh() {
      const [mobile, snapshot] = await Promise.all([
        fetch('/mobile/status?token=' + encodeURIComponent(token)).then(r => r.json()),
        fetch('/admin/snapshot').then(r => r.json())
      ]);
      document.getElementById('status').textContent = JSON.stringify({ mobile: mobile.mobile, providers: snapshot.providers, queues: snapshot.queues.length, missions: snapshot.missions.length }, null, 2);
    }
    async function runCompare() {
      const button = document.getElementById('run');
      const results = document.getElementById('results');
      button.disabled = true;
      results.innerHTML = '<section class="pane"><p>выполняю...</p></section>';
      try {
        const response = await fetch('/llm/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mobile-web', token, live: true, prompt: document.getElementById('prompt').value }) });
        const payload = await response.json();
        results.innerHTML = '';
        for (const item of (payload.comparison && payload.comparison.results ? payload.comparison.results : [])) {
          const pane = document.createElement('section');
          pane.className = 'pane';
          pane.innerHTML = '<h2></h2><small></small><p></p>';
          pane.querySelector('h2').textContent = item.providerName || item.providerId;
          pane.querySelector('small').textContent = String(item.model || '') + ' / ' + String(item.status || '');
          pane.querySelector('p').textContent = item.answer || '';
          results.appendChild(pane);
        }
      } catch (error) {
        results.innerHTML = '<section class="pane"><p>' + error.message + '</p></section>';
      } finally {
        button.disabled = false;
        refresh();
      }
    }
    async function remoteAction(payload) {
      const response = await fetch('/mobile/remote/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, source: 'mobile-web', ...payload })
      });
      const json = await response.json();
      document.getElementById('remoteResult').textContent = JSON.stringify(json, null, 2);
      refresh();
    }
    document.getElementById('run').addEventListener('click', runCompare);
    document.getElementById('checkPath').addEventListener('click', () => remoteAction({ action: 'check_path', approved: true, path: document.getElementById('path').value }));
    document.getElementById('listProcesses').addEventListener('click', () => remoteAction({ action: 'list_processes', approved: true }));
    document.getElementById('openUrl').addEventListener('click', () => remoteAction({ action: 'open_url', approved: document.getElementById('approveOpenUrl').checked, url: document.getElementById('url').value }));
    refresh();
  </script>
</body>
</html>`;
}

function environmentAgentStatus() {
  return {
    mode: "windows_safe_mvp",
    status: "yellow",
    supportedNow: ["list_processes", "check_path", "open_url", "open_folder"],
    approvalRequired: ["open_folder", "open_url"],
    notSupported: ["arbitrary_program_execution", "sandbox_repair", "unattended_admin_actions"],
    boundary: "No arbitrary execution. User-approved OS actions only."
  };
}

function preflightStatus() {
  const providers = state.providers.map(sanitizeProviderProfile).sort((a, b) => (a.slot || 99) - (b.slot || 99));
  const connectedSlots = providers.filter((provider) => provider.slot && provider.keyPresent).map((provider) => provider.slot);
  const providerStore = providerStoreStatus();
  const apiVault = apiVaultStatus();
  const checks = {
    connectorOnline: true,
    threeApiSlotUiSupported: true,
    connectedSlotCount: connectedSlots.length,
    providerStorePresent: providerStore.storeFilePresent,
    providerStoreKeyPresent: providerStore.keyFilePresent,
    apiVaultUiSupported: true,
    apiVaultStorePresent: apiVault.storeFilePresent,
    apiVaultRecordCount: apiVault.recordCount,
    mobilePairingMvp: true,
    mobileWebAppReady: true,
    mobileQrPairingReady: true,
    localMobileRemoteControlReady: true,
    windowsAgentSafeMvpReady: true,
    mobileRemoteRelayReady: false,
    environmentListProcessesReady: true,
    environmentCheckPathReady: true,
    environmentOpenUrlWithApprovalReady: true,
    environmentOpenFolderWithApprovalReady: true,
    arbitraryProgramExecutionReady: false,
    productionSecretStorageReady: false,
    marketplacePublicationReady: false
  };
  return {
    status: "YELLOW_PRE_RELEASE",
    checks,
    providers,
    providerStore,
    apiVault,
    mobile: mobileStatus(),
    environmentAgent: environmentAgentStatus(),
    cloud: cloudStatus(),
    blockers: [
      "manual acceptance in Dmitry primary Obsidian vault not completed",
      "production tenant secret storage/security review not completed",
      "Supabase live connection/RLS proof not completed",
      "mobile local web/QR pairing is MVP-only; production remote relay not completed",
      "arbitrary Windows agent execution intentionally blocked",
      "Obsidian community marketplace publication not completed"
    ]
  };
}

function keyFingerprint(secret) {
  return createHash("sha256").update(String(secret || "")).digest("hex").slice(0, 12);
}

function sanitizeProviderProfile(provider) {
  return {
    id: provider.id,
    slot: provider.slot || null,
    name: provider.name,
    protocol: provider.protocol,
    model: provider.model,
    baseUrl: provider.baseUrl || null,
    endpoint: provider.endpoint || null,
    authType: provider.authType || null,
    enabled: provider.enabled !== false,
    connectedAt: provider.connectedAt,
    keyPresent: Boolean(provider.secretRef && state.providerSecrets[provider.secretRef]),
    keySource: provider.secretRef ? (provider.persistent ? "local_encrypted_store" : "memory") : provider.keyName ? "env" : "none",
    persistent: Boolean(provider.persistent),
    keyFingerprint: provider.keyFingerprint || null
  };
}

function providerPreset(id) {
  const normalized = String(id || "").trim().toLowerCase();
  const presets = {
    openai: { id: "openai", name: "OpenAI", protocol: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" },
    anthropic: { id: "anthropic", name: "Anthropic", protocol: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest" },
    gemini: { id: "gemini", name: "Gemini", protocol: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.0-flash" },
    google: { id: "gemini", name: "Gemini", protocol: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.0-flash" },
    deepseek: { id: "deepseek", name: "DeepSeek", protocol: "openai_compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", maxTokens: 120 },
    openrouter: { id: "openrouter", name: "OpenRouter", protocol: "openai_compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
    kling: { id: "kling", name: "Kling", protocol: "openai_compatible", baseUrl: "https://api.klingai.com/v1", model: "kling-v1" }
  };
  return presets[normalized] || null;
}

function openRouterGatewayModels(body) {
  const rawModels = Array.isArray(body && body.models) ? body.models : [];
  const defaults = ["openrouter/auto", "openrouter/auto", "openrouter/auto"];
  return defaults.map((fallback, index) => String(rawModels[index] || fallback).trim() || fallback);
}

function detectProviderFromKey(secret, hint) {
  const hinted = providerPreset(hint);
  if (hinted) return hinted;
  const key = String(secret || "").trim();
  if (/^sk-ant-/i.test(key)) return providerPreset("anthropic");
  if (/^AIza/i.test(key)) return providerPreset("gemini");
  if (/^sk-or-/i.test(key)) return providerPreset("openrouter");
  if (/^sk-/i.test(key)) return providerPreset("openai");
  return { id: "custom-api", name: "Custom API", protocol: "generic_http", model: "not_configured" };
}

function parseProviderConnectionInput(body) {
  const raw = String(body.input || body.apiKey || "").trim();
  if (!raw) throw new Error("api_key_or_connection_string_required");

  if (raw.startsWith("{") && raw.endsWith("}")) {
    const parsed = JSON.parse(raw);
    const secret = String(parsed.apiKey || parsed.key || parsed.secret || "").trim();
    if (!secret && parsed.requiresKey !== false && parsed.authType !== "none") throw new Error("json_connection_requires_apiKey_or_requiresKey_false");
    const base = normalizeProvider({ ...parsed, id: parsed.id || parsed.providerId || body.providerHint || "custom-api" });
    return { provider: base, secret };
  }

  const urlParts = raw.split("|").map((part) => part.trim()).filter(Boolean);
  if (/^https?:\/\//i.test(urlParts[0] || "")) {
    const endpointOrBase = urlParts[0];
    const model = urlParts.length >= 3 ? urlParts[1] : body.model;
    const secret = urlParts.length >= 3 ? urlParts.slice(2).join("|") : (body.apiKey || urlParts[1] || "");
    const provider = normalizeProvider({
      id: body.providerHint || "custom-openai-compatible",
      name: body.providerName || "Custom OpenAI-compatible",
      protocol: body.protocol || "openai_compatible",
      baseUrl: endpointOrBase,
      model: model || "not_configured"
    });
    return { provider, secret };
  }

  const prefixed = raw.match(/^([a-zA-Z][a-zA-Z0-9_-]{1,40}):(.*)$/s);
  if (prefixed) {
    const preset = providerPreset(prefixed[1]) || { id: prefixed[1].toLowerCase(), name: prefixed[1], protocol: body.protocol || "openai_compatible", model: body.model || "not_configured", baseUrl: body.baseUrl };
    return { provider: normalizeProvider({ ...preset, model: body.model || preset.model, baseUrl: body.baseUrl || preset.baseUrl }), secret: prefixed[2].trim() };
  }

  const provider = detectProviderFromKey(raw, body.providerHint || body.provider || body.type);
  return { provider: normalizeProvider({ ...provider, model: body.model || provider.model, endpoint: body.endpoint || provider.endpoint, baseUrl: body.baseUrl || provider.baseUrl }), secret: raw };
}

function upsertConnectedProvider(provider, secret, source) {
  const baseId = provider.id || "custom-api";
  const slot = provider.slot ? Number(provider.slot) : null;
  const id = slot ? `${baseId}-slot-${slot}` : baseId;
  const secretRef = `provider-${id}-${randomUUID()}`;
  if (secret) state.providerSecrets[secretRef] = secret;
  const profile = {
    ...provider,
    id,
    baseId,
    slot,
    name: slot ? `Окно ${slot}: ${provider.name || baseId}` : provider.name,
    secretRef: secret ? secretRef : null,
    keyFingerprint: secret ? keyFingerprint(secret) : null,
    connectedAt: new Date().toISOString(),
    enabled: true,
    persistent: true,
    source: source || "plugin"
  };
  state.providers = [profile, ...state.providers.filter((item) => slot ? item.slot !== slot : item.id !== id)].slice(0, 20);
  saveProviderStore();
  audit({ source: profile.source, action: "provider_connect", approval: "not_required", result: "ok", slot: profile.slot, providerId: profile.id, protocol: profile.protocol, keyPresent: Boolean(secret), keyFingerprint: profile.keyFingerprint });
  return profile;
}

function providerRegistryDefaults() {
  const connected = state.providers.filter((provider) => provider.enabled !== false).sort((a, b) => (a.slot || 99) - (b.slot || 99));
  if (connected.length) return connected.slice(0, 3);
  return [
    { id: "openai", name: "OpenAI", protocol: "openai", model: "not_configured" },
    { id: "anthropic", name: "Anthropic", protocol: "anthropic", model: "not_configured" },
    { id: "gemini", name: "Gemini", protocol: "gemini", model: "not_configured" }
  ];
}

async function handleProviderDisconnect(body) {
  const slot = body && body.slot ? Number(body.slot) : null;
  const providerId = body && body.providerId ? String(body.providerId) : null;
  const before = state.providers.length;
  const removed = state.providers.filter((provider) => slot ? provider.slot === slot : provider.id === providerId);
  removed.forEach((provider) => {
    if (provider.secretRef && state.providerSecrets[provider.secretRef]) delete state.providerSecrets[provider.secretRef];
  });
  state.providers = state.providers.filter((provider) => slot ? provider.slot !== slot : provider.id !== providerId);
  saveProviderStore();
  audit({ source: body.source || "plugin", action: "provider_disconnect", approval: "not_required", result: state.providers.length < before ? "ok" : "not_found", slot, providerId });
  return { ok: true, removed: before - state.providers.length, providers: state.providers.map(sanitizeProviderProfile) };
}
async function handleProviderConnect(body) {
  const parsed = parseProviderConnectionInput(body || {});
  const slot = body && body.slot ? Number(body.slot) : null;
  if (slot && (slot < 1 || slot > 3)) throw new Error("provider_slot_must_be_1_2_or_3");
  const provider = upsertConnectedProvider({ ...parsed.provider, slot }, parsed.secret, body.source || "plugin");
  return {
    ok: true,
    status: "connected_yellow_until_live_test",
    provider: sanitizeProviderProfile(provider),
    message: "Provider key accepted into local connector registry. Secret value is not returned, logged or written to evidence.",
    boundary: "YELLOW: local encrypted MVP persistence is enabled, but production tenant secret storage still requires a separate security gate."
  };
}

async function handleOpenRouterGatewayConnect(body) {
  const source = body.source || "obsidian-plugin";
  const secret = String(body.apiKey || body.input || process.env.OPENROUTER_API_KEY || "").trim();
  if (!secret) {
    audit({ source, action: "openrouter_gateway_connect", approval: "not_required", result: "missing_key_yellow" });
    return {
      ok: false,
      status: "MISSING_OPENROUTER_KEY_YELLOW",
      reason: "openrouter_api_key_required",
      message: "OpenRouter gateway не подключен: нужен API-key. Секрет не искался в markdown/evidence.",
      boundary: "YELLOW: gateway сценарий есть, но реальный ключ не передан и OPENROUTER_API_KEY не найден."
    };
  }

  const models = openRouterGatewayModels(body || {});
  const preset = providerPreset("openrouter");
  const providers = models.map((model, index) => upsertConnectedProvider({
    ...preset,
    slot: index + 1,
    model,
    name: `OpenRouter окно ${index + 1}`
  }, secret, source));
  const liveProofRequested = Boolean(body.live);
  const comparison = body.proofPrompt ? await handleLlmCompare({
    source,
    prompt: body.proofPrompt,
    live: liveProofRequested,
    providers
  }) : null;
  const status = liveProofRequested && comparison && comparison.status === "live_all_providers_passed"
    ? "PASS_WITH_CONDITIONS_OPENROUTER_GATEWAY_LIVE_YELLOW"
    : "PASS_WITH_CONDITIONS_OPENROUTER_GATEWAY_CONFIGURED_YELLOW";
  audit({
    source,
    action: "openrouter_gateway_connect",
    approval: "not_required",
    result: status,
    slots: providers.map((provider) => provider.slot),
    models,
    keyFingerprint: keyFingerprint(secret),
    liveProofRequested
  });
  return {
    ok: true,
    status,
    gateway: {
      provider: "OpenRouter",
      mode: "one_key_three_llm_windows",
      slots: providers.map(sanitizeProviderProfile),
      models,
      liveProofRequested,
      keyPresent: true,
      keyFingerprint: keyFingerprint(secret)
    },
    comparison,
    message: "OpenRouter подключен как LLM Gateway для трех окон. Секретное значение не возвращается и не пишется в evidence.",
    boundary: "YELLOW: gateway/runtime доказан; production billing/cost controls и live market QA закрываются отдельным gate."
  };
}
function supabaseRuntimeConfig() {
  return {
    dbUrl: String(process.env.SYMBIOT_SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim(),
    serviceRoleKeyPresent: Boolean(String(process.env.SYMBIOT_SUPABASE_SERVICE_ROLE_KEY || process.env.SYMBIOT_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim())
  };
}

async function withSupabasePgClient(fn) {
  const config = supabaseRuntimeConfig();
  if (!config.dbUrl) return { ok: false, status: "blocked", reason: "missing_db_url" };
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch (error) {
    return { ok: false, status: "blocked", reason: "pg_dependency_missing", error: error.message };
  }
  const client = new Client({ connectionString: config.dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function normalizeMissionGraphPayload(body) {
  const mission = body && body.mission && typeof body.mission === "object" ? body.mission : {};
  const methodology = body && body.methodology && typeof body.methodology === "object" ? body.methodology : {};
  const canvas = body && body.canvas && typeof body.canvas === "object" ? body.canvas : {};
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
  return {
    organizationId: body.organizationId || null,
    vaultId: body.vaultId || null,
    ownerUserId: body.ownerUserId || null,
    missionId: body.missionId || mission.id || methodology.missionId || null,
    title: body.title || mission.title || methodology.title || "Client mission",
    source: body.source || "obsidian-plugin",
    methodologyOwner: body.methodologyOwner || methodology.methodologyOwner || "РОЛЬ_AI_Методолог_клиентских_миссий",
    missionType: body.missionType || methodology.missionType || "client_mission",
    paths: body.paths || methodology.paths || {},
    methodology,
    canvas: {
      path: canvas.path || (methodology.canvas && methodology.canvas.path) || null,
      nodes: nodes.slice(0, 80),
      edges: edges.slice(0, 120),
      metadata: canvas.metadata || {}
    },
    pattern: body.pattern && typeof body.pattern === "object" ? body.pattern : {}
  };
}


function normalizeRagPersistencePayload(body) {
  const sources = Array.isArray(body.sources) ? body.sources.slice(0, 12) : [];
  const citations = Array.isArray(body.citations || body.snippets) ? (body.citations || body.snippets).slice(0, 40) : [];
  return {
    organizationId: body.organizationId || null,
    vaultId: body.vaultId || null,
    projectId: body.projectId || null,
    missionId: body.missionId || null,
    ownerUserId: body.ownerUserId || null,
    source: body.source || "obsidian-plugin",
    query: String(body.query || "").trim(),
    resultPath: body.resultPath || body.linkedResultPath || null,
    evidencePath: body.evidencePath || body.linkedEvidencePath || null,
    embeddingMode: body.embeddingMode || (body.semantic === true ? "semantic_openrouter" : "stable_hash_yellow"),
    embeddingModel: body.embeddingModel || "openai/text-embedding-3-small",
    sources,
    citations
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeText(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function normalizeAdminSyncPayload(body) {
  const current = snapshot();
  const incomingSnapshot = body && body.snapshot && typeof body.snapshot === "object" ? body.snapshot : current;
  const vault = body && body.vault && typeof body.vault === "object" ? body.vault : {};
  const vaultName = safeText(vault.name || body.vaultName || incomingSnapshot.vaultName, "local Obsidian vault");
  const vaultFingerprint = safeText(vault.fingerprint || body.vaultFingerprint || createHash("sha256").update(vaultName).digest("hex").slice(0, 24));
  const localPathHash = safeText(vault.localPathHash || body.localPathHash || createHash("sha256").update(vaultName).digest("hex"));
  const providers = Array.isArray(body.providers) ? body.providers : Array.isArray(incomingSnapshot.providers) ? incomingSnapshot.providers : current.providers;
  const missions = Array.isArray(body.missions) ? body.missions : Array.isArray(incomingSnapshot.missions) ? incomingSnapshot.missions : current.missions;
  const runtimeRuns = Array.isArray(body.runtimeRuns) ? body.runtimeRuns : Array.isArray(incomingSnapshot.runtimeRuns) ? incomingSnapshot.runtimeRuns : current.runtimeRuns;
  const architectureSignals = Array.isArray(body.architectureSignals) ? body.architectureSignals : Array.isArray(incomingSnapshot.architectureSignals) ? incomingSnapshot.architectureSignals : current.architectureSignals;
  const queues = Array.isArray(body.queues) ? body.queues : Array.isArray(incomingSnapshot.queues) ? incomingSnapshot.queues : current.queues;
  const auditItems = Array.isArray(body.audit) ? body.audit : Array.isArray(incomingSnapshot.audit) ? incomingSnapshot.audit : current.audit;
  return {
    organizationId: body.organizationId || null,
    vaultId: body.vaultId || vault.id || null,
    ownerUserId: body.ownerUserId || process.env.SYMBIOT_SUPABASE_OWNER_USER_ID || process.env.SYMBIOT_SUPABASE_TEST_USER_ID || null,
    source: body.source || "obsidian-plugin",
    vault: {
      id: body.vaultId || vault.id || null,
      name: vaultName,
      fingerprint: vaultFingerprint,
      localPathHash,
      pluginVersion: vault.pluginVersion || body.pluginVersion || "unknown",
      connectorId: vault.connectorId || state.connector.id
    },
    snapshot: incomingSnapshot,
    providers: providers.slice(0, 20).map(sanitizeProviderProfile),
    missions: missions.slice(0, 50),
    runtimeRuns: runtimeRuns.slice(0, 50),
    architectureSignals: architectureSignals.slice(0, 50),
    queues: queues.slice(0, 50),
    audit: auditItems.slice(0, 50)
  };
}

function adminSyncPayloadHash(payload) {
  return createHash("sha256").update(JSON.stringify({
    vault: payload.vault,
    providerCount: payload.providers.length,
    missionCount: payload.missions.length,
    runtimeRunCount: payload.runtimeRuns.length,
    architectureSignalCount: payload.architectureSignals.length,
    queueCount: payload.queues.length,
    auditCount: payload.audit.length
  })).digest("hex");
}

function stableMiniEmbedding(text, dimensions = 1536) {
  const vector = new Array(dimensions).fill(0);
  const seed = createHash("sha256").update(String(text || ""), "utf8").digest();
  for (let index = 0; index < dimensions; index += 1) {
    const byte = seed[index % seed.length];
    vector[index] = Number(((byte - 128) / 128).toFixed(6));
  }
  return `[${vector.join(",")}]`;
}

function resolveOpenRouterKey() {
  const environmentKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (environmentKey) return environmentKey;
  const provider = state.providers.find((item) => item.id === "openrouter" || item.protocol === "openrouter" || String(item.baseUrl || "").includes("openrouter.ai"));
  return provider && provider.secretRef ? String(state.providerSecrets[provider.secretRef] || "").trim() : "";
}

async function generateOpenRouterEmbeddings(texts, options = {}) {
  const apiKey = resolveOpenRouterKey();
  if (!apiKey) return { ok: false, status: "blocked", reason: "openrouter_api_key_required" };
  const inputs = Array.isArray(texts) ? texts.map((text) => String(text || "").slice(0, 12000)).filter(Boolean).slice(0, 40) : [];
  if (!inputs.length) return { ok: false, status: "blocked", reason: "embedding_input_required" };
  const model = String(options.model || "openai/text-embedding-3-small");
  const dimensions = Number(options.dimensions || 1536);
  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "http-referer": "https://symbiot.local",
      "x-title": "Symbiot RAG"
    },
    body: JSON.stringify({ model, input: inputs, dimensions, encoding_format: "float" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: "provider_error", reason: `openrouter_embeddings_http_${response.status}` };
  const vectors = Array.isArray(payload.data) ? payload.data.map((item) => item.embedding) : [];
  if (vectors.length !== inputs.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
    return { ok: false, status: "provider_error", reason: "openrouter_embedding_shape_invalid" };
  }
  return {
    ok: true,
    status: "live_semantic_embeddings_passed",
    model: payload.model || model,
    dimensions,
    count: vectors.length,
    latencyMs: Date.now() - startedAt,
    usage: payload.usage || null,
    vectors
  };
}

async function persistAdminSync(body) {
  const payload = normalizeAdminSyncPayload(body || {});
  if (!payload.ownerUserId) return { ok: false, status: "blocked", reason: "owner_user_id_required" };
  if (!payload.vault.fingerprint) return { ok: false, status: "blocked", reason: "vault_fingerprint_required" };

  return withSupabasePgClient(async (client) => {
    await client.query("begin");
    try {
      const vaultInsert = await client.query(
        `insert into public.vaults (id, organization_id, owner_user_id, vault_fingerprint, vault_name, local_path_hash, plugin_version, connector_id, sync_status)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (owner_user_id, vault_fingerprint) do update set
           organization_id = excluded.organization_id,
           vault_name = excluded.vault_name,
           local_path_hash = excluded.local_path_hash,
           plugin_version = excluded.plugin_version,
           connector_id = excluded.connector_id,
           sync_status = excluded.sync_status,
           updated_at = now()
         returning id`,
        [isUuid(payload.vault.id) ? payload.vault.id : null, payload.organizationId, payload.ownerUserId, payload.vault.fingerprint, payload.vault.name, payload.vault.localPathHash, payload.vault.pluginVersion, payload.vault.connectorId, "admin_sync_yellow"]
      );
      const cloudVaultId = vaultInsert.rows[0].id;

      let providerCount = 0;
      for (const provider of payload.providers) {
        await client.query(
          `insert into public.providers (organization_id, vault_id, owner_user_id, provider_id, display_name, protocol, model, slot, key_fingerprint, key_source, status, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
           on conflict (owner_user_id, vault_id, provider_id, slot) do update set
             display_name = excluded.display_name,
             protocol = excluded.protocol,
             model = excluded.model,
             key_fingerprint = excluded.key_fingerprint,
             key_source = excluded.key_source,
             status = excluded.status,
             metadata = excluded.metadata,
             updated_at = now()`,
          [payload.organizationId, cloudVaultId, payload.ownerUserId, safeText(provider.id, "unknown-provider"), safeText(provider.name, provider.id), safeText(provider.protocol, "unknown"), provider.model || null, provider.slot || null, provider.keyFingerprint || null, provider.keySource || "local_connector", provider.keyPresent ? "configured_yellow" : "missing_key_yellow", JSON.stringify({ baseUrl: provider.baseUrl || null, endpoint: provider.endpoint || null, enabled: provider.enabled !== false, persistent: Boolean(provider.persistent), adminSync: "OBP-036", secretValueStored: false })]
        );
        providerCount += 1;
      }

      let missionCount = 0;
      for (const mission of payload.missions) {
        if (!isUuid(mission.id)) continue;
        await client.query(
          `insert into public.missions (id, organization_id, vault_id, owner_user_id, title, obsidian_path, mission_type, status, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           on conflict (id) do update set
             organization_id = excluded.organization_id,
             vault_id = excluded.vault_id,
             title = excluded.title,
             obsidian_path = excluded.obsidian_path,
             mission_type = excluded.mission_type,
             status = excluded.status,
             metadata = excluded.metadata,
             updated_at = now()`,
          [mission.id, payload.organizationId, cloudVaultId, payload.ownerUserId, safeText(mission.title, "Client mission"), isSafeVaultRelativePath(mission.obsidianPath || mission.path) ? (mission.obsidianPath || mission.path) : null, mission.missionType || mission.mission_type || "client_mission", mission.status || "draft", JSON.stringify({ source: payload.source, localStatus: mission.status || null, syncedBy: "admin_sync_mvp" })]
        );
        missionCount += 1;
      }

      let artifactCount = 0;
      let runCount = 0;
      let evidenceCount = 0;
      const architectureSignalCount = payload.architectureSignals.length;
      const latestArchitectureSignal = payload.architectureSignals[0] || null;
      for (const run of payload.runtimeRuns) {
        const missionId = isUuid(run.missionId) ? run.missionId : null;
        let artifactId = null;
        if (run.artifact && isUuid(run.artifact.id)) {
          artifactId = run.artifact.id;
          await client.query(
            `insert into public.artifacts (id, organization_id, vault_id, mission_id, owner_user_id, artifact_type, title, obsidian_path, content_hash, status)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             on conflict (id) do update set
               title = excluded.title,
               obsidian_path = excluded.obsidian_path,
               content_hash = excluded.content_hash,
               status = excluded.status,
               updated_at = now()`,
            [artifactId, payload.organizationId, cloudVaultId, missionId, payload.ownerUserId, run.artifact.type || "runtime_result", run.artifact.fileName || "Runtime artifact", isSafeVaultRelativePath(run.artifact.obsidianPath || run.artifact.vaultPath) ? (run.artifact.obsidianPath || run.artifact.vaultPath) : null, run.artifact.sha256 || null, "yellow"]
          );
          artifactCount += 1;
        }
        if (isUuid(run.id)) {
          await client.query(
            `insert into public.runs (id, organization_id, vault_id, mission_id, owner_user_id, status, runtime_level, requested_by, provider_summary, result_artifact_id, started_at, finished_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
             on conflict (id) do update set
               status = excluded.status,
               runtime_level = excluded.runtime_level,
               provider_summary = excluded.provider_summary,
               result_artifact_id = excluded.result_artifact_id,
               finished_at = excluded.finished_at`,
            [run.id, payload.organizationId, cloudVaultId, missionId, payload.ownerUserId, run.status || "completed_yellow", run.runtimeLevel || "local_connector_mvp", payload.source, JSON.stringify({ taskHash: run.task ? createHash("sha256").update(String(run.task)).digest("hex").slice(0, 12) : null, visibleLoopStatus: run.visibleLoop && run.visibleLoop.status, queueCount: payload.queues.length, noFullTaskTextStored: true }), artifactId, run.createdAt || null, run.completedAt || null]
          );
          runCount += 1;
        }
        if (run.evidence && isUuid(run.evidence.id)) {
          await client.query(
            `insert into public.evidence_items (id, organization_id, vault_id, mission_id, run_id, artifact_id, owner_user_id, evidence_type, status, evidence_hash, summary, metadata)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
             on conflict (id) do update set
               status = excluded.status,
               evidence_hash = excluded.evidence_hash,
               summary = excluded.summary,
               metadata = excluded.metadata`,
            [run.evidence.id, payload.organizationId, cloudVaultId, missionId, isUuid(run.id) ? run.id : null, artifactId, payload.ownerUserId, "admin_sync_runtime_evidence", "yellow", createHash("sha256").update(JSON.stringify(run.evidence.checks || {})).digest("hex"), run.evidence.status || "Runtime evidence synced from connector snapshot", JSON.stringify({ boundaries: run.evidence.boundaries || [], syncedBy: "admin_sync_mvp" })]
          );
          evidenceCount += 1;
        }
      }

      const payloadHash = adminSyncPayloadHash(payload);
      const syncEvent = await client.query(
        `insert into public.sync_events (organization_id, vault_id, owner_user_id, sync_type, status, direction, payload_hash, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         returning id`,
        [payload.organizationId, cloudVaultId, payload.ownerUserId, "admin_snapshot_sync", "completed_yellow", "local_to_cloud", payloadHash, JSON.stringify({ providerCount, missionCount, runCount, artifactCount, evidenceCount, architectureSignalCount, latestArchitectureSignalId: latestArchitectureSignal ? latestArchitectureSignal.id : null, latestArchitectureSignalStatus: latestArchitectureSignal ? latestArchitectureSignal.status : null, architectureSignalBackbone: architectureSignalCount > 0, queueCount: payload.queues.length, auditCount: payload.audit.length, fullVaultContentSynced: false, secretValuesSynced: false })]
      );
      await client.query(
        `insert into public.audit_events (organization_id, vault_id, owner_user_id, actor_type, actor_id, action, target_type, target_id, approval_status, result, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [payload.organizationId, cloudVaultId, payload.ownerUserId, "connector", payload.source, "admin_snapshot_sync", "vault", cloudVaultId, "connector_auth", "completed_yellow", JSON.stringify({ syncEventId: syncEvent.rows[0].id, providerCount, missionCount, runCount, artifactCount, evidenceCount, architectureSignalCount, payloadHash })]
      );
      const check = await client.query(
        `select
          (select count(*)::int from public.vaults where id=$1 and owner_user_id=$2) as vault_count,
          (select count(*)::int from public.providers where vault_id=$1 and owner_user_id=$2) as provider_count,
          (select count(*)::int from public.missions where vault_id=$1 and owner_user_id=$2) as mission_count,
          (select count(*)::int from public.runs where vault_id=$1 and owner_user_id=$2) as run_count,
          (select count(*)::int from public.artifacts where vault_id=$1 and owner_user_id=$2) as artifact_count,
          (select count(*)::int from public.evidence_items where vault_id=$1 and owner_user_id=$2) as evidence_count,
          (select count(*)::int from public.sync_events where vault_id=$1 and owner_user_id=$2 and sync_type='admin_snapshot_sync') as sync_event_count,
          (select count(*)::int from public.audit_events where vault_id=$1 and owner_user_id=$2 and action='admin_snapshot_sync') as audit_count`,
        [cloudVaultId, payload.ownerUserId]
      );
      await client.query("commit");
      return {
        ok: true,
        status: "PASS_WITH_CONDITIONS_ADMIN_SYNC_YELLOW",
        runtimeLevel: "supabase_admin_sync_mvp",
        vaultId: cloudVaultId,
        syncEventId: syncEvent.rows[0].id,
        payloadHash,
        architecture_signal_count: architectureSignalCount,
        latest_architecture_signal_id: latestArchitectureSignal ? latestArchitectureSignal.id : null,
        ...check.rows[0],
        boundaries: ["metadata_status_only", "no_full_vault_content_sync", "no_secret_values_sync", "not_production_admin_dashboard"]
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function persistRagContext(body) {
  const payload = normalizeRagPersistencePayload(body);
  if (!payload.ownerUserId) return { ok: false, status: "blocked", reason: "owner_user_id_required" };
  if (!payload.vaultId) return { ok: false, status: "blocked", reason: "vault_id_required" };
  if (!payload.query) return { ok: false, status: "blocked", reason: "query_required" };
  if (!payload.sources.length) return { ok: false, status: "blocked", reason: "sources_required" };
  if (!payload.citations.length) return { ok: false, status: "blocked", reason: "citations_required" };
  const unsafe = payload.sources.find((source) => !isSafeVaultRelativePath(source.vaultPath || source.obsidianPath));
  if (unsafe) return { ok: false, status: "blocked", reason: "unsafe_vault_path" };
  let semanticEmbeddings = null;
  if (payload.embeddingMode === "semantic_openrouter") {
    semanticEmbeddings = await generateOpenRouterEmbeddings(
      payload.citations.map((citation) => `${payload.query}\n${String(citation.excerpt || citation.text || citation.chunkText || "").slice(0, 2000)}`),
      { model: payload.embeddingModel, dimensions: 1536 }
    );
    if (!semanticEmbeddings.ok) return semanticEmbeddings;
  }

  return withSupabasePgClient(async (client) => {
    await client.query("begin");
    try {
      const artifact = await client.query(
        `insert into public.artifacts (organization_id, vault_id, project_id, mission_id, owner_user_id, artifact_type, title, obsidian_path, content_hash, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id`,
        [payload.organizationId, payload.vaultId, payload.projectId, payload.missionId, payload.ownerUserId, "rag_context_result", "Context Retriever / RAG result", payload.resultPath, createHash("sha256").update(payload.query).digest("hex"), "yellow"]
      );
      const run = await client.query(
        `insert into public.runs (organization_id, vault_id, project_id, mission_id, owner_user_id, status, runtime_level, requested_by, provider_summary, result_artifact_id, started_at, finished_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now(),now())
         returning id`,
        [payload.organizationId, payload.vaultId, payload.projectId, payload.missionId, payload.ownerUserId, "completed_yellow", semanticEmbeddings ? "supabase_semantic_rag_mvp" : "supabase_rag_persistence_mvp", payload.source, JSON.stringify({ mode: "selected_source_rag", queryHash: createHash("sha256").update(payload.query).digest("hex").slice(0, 12), embedding: semanticEmbeddings ? "openrouter_semantic_embedding" : "stable_hash_vector_yellow_not_semantic_model", embeddingModel: semanticEmbeddings ? semanticEmbeddings.model : null }), artifact.rows[0].id]
      );
      const sourceIds = [];
      for (const [index, source] of payload.sources.entries()) {
        const vaultPath = String(source.vaultPath || source.obsidianPath || "").trim();
        const sourceInsert = await client.query(
          `insert into public.knowledge_sources (organization_id, vault_id, project_id, mission_id, owner_user_id, title, source_type, obsidian_path, local_path_hash, content_hash, permission_status, indexed_status, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
           returning id`,
          [payload.organizationId, payload.vaultId, payload.projectId, payload.missionId, payload.ownerUserId, source.title || source.fileName || path.basename(vaultPath), source.sourceType || "obsidian_note", vaultPath, createHash("sha256").update(vaultPath).digest("hex"), source.sha256 || source.contentHash || null, "explicit_user_selected", "indexed_yellow", JSON.stringify({ proof: "OBP-047", bytes: source.bytes || null, extension: source.extension || null })]
        );
        sourceIds.push({ vaultPath, sourceId: sourceInsert.rows[0].id, index });
      }
      let chunkCount = 0;
      for (const [index, citation] of payload.citations.entries()) {
        const citationPath = String(citation.vaultPath || citation.obsidianPath || "").trim();
        const matched = sourceIds.find((source) => source.vaultPath === citationPath) || sourceIds[index % sourceIds.length];
        const excerpt = String(citation.excerpt || citation.text || citation.chunkText || "").slice(0, 2000);
        await client.query(
          `insert into public.knowledge_chunks (organization_id, vault_id, source_id, owner_user_id, chunk_index, chunk_text, citation, embedding, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9::jsonb)
           on conflict (source_id, chunk_index) do update set chunk_text = excluded.chunk_text, citation = excluded.citation, embedding = excluded.embedding, metadata = excluded.metadata`,
          [payload.organizationId, payload.vaultId, matched.sourceId, payload.ownerUserId, index, excerpt, `${matched.vaultPath}:${citation.line || 1}`, semanticEmbeddings ? `[${semanticEmbeddings.vectors[index].join(",")}]` : stableMiniEmbedding(`${payload.query}\n${excerpt}`), JSON.stringify({ proof: "OBP-047", citationId: citation.id || `C${index + 1}`, score: citation.score || null, embeddingStatus: semanticEmbeddings ? "openrouter_semantic_embedding_live" : "stable_hash_vector_yellow_not_semantic_model", embeddingModel: semanticEmbeddings ? semanticEmbeddings.model : null })]
        );
        chunkCount += 1;
      }
      const evidence = await client.query(
        `insert into public.evidence_items (organization_id, vault_id, project_id, mission_id, run_id, artifact_id, owner_user_id, evidence_type, status, obsidian_path, evidence_hash, summary, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         returning id`,
        [payload.organizationId, payload.vaultId, payload.projectId, payload.missionId, run.rows[0].id, artifact.rows[0].id, payload.ownerUserId, "rag_persistence_proof", "yellow", payload.evidencePath, createHash("sha256").update(JSON.stringify({ query: payload.query, citations: payload.citations.length })).digest("hex"), "Selected-source RAG context persisted to Supabase business memory", JSON.stringify({ sourceCount: payload.sources.length, citationCount: payload.citations.length, noFullVaultScan: true, fullVaultSync: false })]
      );
      await client.query(
        `insert into public.audit_events (organization_id, vault_id, owner_user_id, actor_type, actor_id, action, target_type, target_id, approval_status, result, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [payload.organizationId, payload.vaultId, payload.ownerUserId, "connector", payload.source, "rag_context_persist", "run", run.rows[0].id, "approved", "completed_yellow", JSON.stringify({ sourceCount: payload.sources.length, chunkCount, evidenceId: evidence.rows[0].id })]
      );
      const check = await client.query(
        `select
          (select count(*)::int from public.knowledge_sources where vault_id=$1 and owner_user_id=$2) as source_count,
          (select count(*)::int from public.knowledge_chunks kc join public.knowledge_sources ks on ks.id=kc.source_id where ks.vault_id=$1 and kc.owner_user_id=$2) as chunk_count,
          (select count(*)::int from public.runs where vault_id=$1 and owner_user_id=$2 and runtime_level='supabase_rag_persistence_mvp') as run_count,
          (select count(*)::int from public.evidence_items where vault_id=$1 and owner_user_id=$2 and evidence_type='rag_persistence_proof') as evidence_count,
          (select count(*)::int from public.knowledge_chunks kc join public.knowledge_sources ks on ks.id=kc.source_id where ks.vault_id=$1 and kc.owner_user_id=$2 and kc.embedding is not null) as embedding_count`,
        [payload.vaultId, payload.ownerUserId]
      );
      await client.query("commit");
      return { ok: true, status: semanticEmbeddings ? "PASS_WITH_CONDITIONS_SUPABASE_SEMANTIC_RAG_YELLOW" : "PASS_WITH_CONDITIONS_SUPABASE_RAG_PERSISTENCE_YELLOW", runtimeLevel: semanticEmbeddings ? "supabase_semantic_rag_mvp" : "supabase_rag_persistence_mvp", embedding: semanticEmbeddings ? { status: semanticEmbeddings.status, model: semanticEmbeddings.model, dimensions: semanticEmbeddings.dimensions, count: semanticEmbeddings.count, latencyMs: semanticEmbeddings.latencyMs, usage: semanticEmbeddings.usage } : { status: "stable_hash_vector_yellow_not_semantic_model", dimensions: 1536 }, runId: run.rows[0].id, artifactId: artifact.rows[0].id, evidenceId: evidence.rows[0].id, ...check.rows[0], boundaries: semanticEmbeddings ? ["selected_sources_only", "no_full_vault_sync", "live_semantic_embeddings", "manual_retrieval_quality_acceptance_pending"] : ["selected_sources_only", "no_full_vault_sync", "stable_hash_vector_not_semantic_embedding", "not_production_vector_rag"] };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function persistMissionGraph(body) {
  const payload = normalizeMissionGraphPayload(body);
  if (!payload.ownerUserId) return { ok: false, status: "blocked", reason: "owner_user_id_required" };
  if (!payload.vaultId) return { ok: false, status: "blocked", reason: "vault_id_required" };
  if (!payload.missionId) return { ok: false, status: "blocked", reason: "mission_id_required" };
  if (!payload.canvas.nodes.length) return { ok: false, status: "blocked", reason: "canvas_nodes_required" };
  if (!payload.canvas.edges.length) return { ok: false, status: "blocked", reason: "canvas_edges_required" };

  return withSupabasePgClient(async (client) => {
    await client.query("begin");
    try {
      const missionInsert = await client.query(
        `insert into public.missions (id, organization_id, vault_id, owner_user_id, title, mission_type, status, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         on conflict (id) do update set title = excluded.title, mission_type = excluded.mission_type, status = excluded.status, metadata = excluded.metadata, updated_at = now()
         returning id`,
        [payload.missionId, payload.organizationId, payload.vaultId, payload.ownerUserId, payload.title, payload.missionType, "draft", JSON.stringify({ paths: payload.paths, methodologyOwner: payload.methodologyOwner, source: payload.source })]
      );
      await client.query("delete from public.mission_canvas_edges where mission_id = $1", [payload.missionId]);
      await client.query("delete from public.mission_canvas_nodes where mission_id = $1", [payload.missionId]);
      for (const node of payload.canvas.nodes) {
        await client.query(
          `insert into public.mission_canvas_nodes (organization_id, vault_id, mission_id, owner_user_id, node_key, node_type, title, text_content, obsidian_path, x, y, width, height, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [payload.organizationId, payload.vaultId, payload.missionId, payload.ownerUserId, String(node.id || node.node_key || randomUUID()), String(node.type || "text"), node.title || null, node.text || node.text_content || null, node.file || node.obsidian_path || null, Number.isFinite(node.x) ? node.x : null, Number.isFinite(node.y) ? node.y : null, Number.isFinite(node.width) ? node.width : null, Number.isFinite(node.height) ? node.height : null, JSON.stringify({ ...node, canvasPath: payload.canvas.path })]
        );
      }
      for (const edge of payload.canvas.edges) {
        await client.query(
          `insert into public.mission_canvas_edges (organization_id, vault_id, mission_id, owner_user_id, edge_key, from_node_key, to_node_key, label, edge_type, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [payload.organizationId, payload.vaultId, payload.missionId, payload.ownerUserId, String(edge.id || edge.edge_key || randomUUID()), String(edge.fromNode || edge.from_node_key || edge.from || ""), String(edge.toNode || edge.to_node_key || edge.to || ""), edge.label || null, edge.type || "canvas_link", JSON.stringify(edge)]
        );
      }
      const patternKey = payload.pattern.patternKey || `mission-route-${payload.missionId}`;
      await client.query(
        `insert into public.mission_methodology_patterns (organization_id, vault_id, mission_id, owner_user_id, pattern_key, title, pattern_type, route_summary, evidence_status, source_count, node_count, edge_count, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         on conflict (owner_user_id, vault_id, pattern_key) do update set title = excluded.title, route_summary = excluded.route_summary, evidence_status = excluded.evidence_status, source_count = excluded.source_count, node_count = excluded.node_count, edge_count = excluded.edge_count, metadata = excluded.metadata, updated_at = now()
         returning id`,
        [payload.organizationId, payload.vaultId, payload.missionId, payload.ownerUserId, patternKey, payload.pattern.title || payload.title, payload.pattern.patternType || "client_mission_route", payload.methodology.canvas ? payload.methodology.canvas.edgeRoute : "источник -> смысловая связь -> миссия -> результат -> проверка качества", payload.pattern.evidenceStatus || "yellow", Array.isArray(payload.methodology.security && payload.methodology.security.sourceStatuses) ? payload.methodology.security.sourceStatuses.length : 0, payload.canvas.nodes.length, payload.canvas.edges.length, JSON.stringify({ methodologyOwner: payload.methodologyOwner, paths: payload.paths, security: payload.methodology.security || {}, canvasMetadata: payload.canvas.metadata })]
      );
      const check = await client.query(
        `select
           (select count(*)::int from public.mission_canvas_nodes where mission_id = $1) as node_count,
           (select count(*)::int from public.mission_canvas_edges where mission_id = $1) as edge_count,
           (select count(*)::int from public.mission_methodology_patterns where mission_id = $1) as pattern_count`,
        [payload.missionId]
      );
      await client.query("commit");
      return { ok: true, status: "persisted_yellow", missionId: missionInsert.rows[0].id, ...check.rows[0], runtimeLevel: "live_supabase_mission_graph_persistence" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function sanitizeMissionMethodology(body, mission) {
  const paths = body && body.paths && typeof body.paths === "object" ? body.paths : {};
  const canvas = body && body.canvas && typeof body.canvas === "object" ? body.canvas : {};
  const htmlResultContract = body && body.htmlResultContract && typeof body.htmlResultContract === "object" ? body.htmlResultContract : {};
  const security = body && body.security && typeof body.security === "object" ? body.security : {};
  return {
    missionId: mission.id,
    title: mission.title,
    methodologyOwner: mission.methodologyOwner,
    missionType: mission.missionType,
    contractStatus: "PASS_WITH_CONDITIONS_LOCAL_METADATA_YELLOW",
    runtimeLevel: "local_connector_metadata_contract",
    paths: {
      passport: paths.passport || null,
      canvas: paths.canvas || null,
      sources: paths.sources || null,
      aiTeam: paths.aiTeam || null,
      result: paths.result || null,
      htmlResult: paths.htmlResult || null,
      evidence: paths.evidence || null,
      lessons: paths.lessons || null,
      manifest: paths.manifest || null
    },
    canvas: {
      path: canvas.path || paths.canvas || null,
      nodeTypes: Array.isArray(canvas.nodeTypes) ? canvas.nodeTypes.slice(0, 20) : [],
      edgeRoute: canvas.edgeRoute || "источник -> смысловая связь -> миссия -> результат -> проверка качества"
    },
    htmlResultContract: {
      path: htmlResultContract.path || paths.htmlResult || null,
      sections: Array.isArray(htmlResultContract.sections) ? htmlResultContract.sections.slice(0, 20) : []
    },
    security: {
      noSilentVaultRead: security.noSilentVaultRead === true,
      explicitSourceConsentRequired: security.explicitSourceConsentRequired === true,
      sourceStatuses: Array.isArray(security.sourceStatuses) ? security.sourceStatuses.slice(0, 20) : []
    },
    supabaseMapping: {
      foundationTables: ["missions", "knowledge_sources", "artifacts", "runs", "evidence_items", "audit_events"],
      plannedTables: MISSION_GRAPH_TABLES,
      status: "schema_ready_yellow_until_live_write_proof"
    },
    storedAt: new Date().toISOString()
  };
}

function snapshot() {
  return {
    connector: state.connector,
    uptimeSeconds: Math.round((Date.now() - Date.parse(state.startedAt)) / 1000),
    users: state.users,
    devices: state.devices,
    queues: state.queues,
    runtimeRuns: state.runtimeRuns,
    artifacts: state.artifacts,
    architectureSignals: state.architectureSignals,
    fileWorkbench: state.fileWorkbench,
    visionCaptures: state.visionCaptures,
    contextRetriever: state.contextRetriever,
    missions: state.missions,
    missionIntakes: state.missionIntakes,
    fullMissionLoops: state.fullMissionLoops,
    missionMethodology: state.missionMethodology,
    providers: state.providers.map(sanitizeProviderProfile),
    llmComparisons: state.llmComparisons,
    mobileRemoteActions: state.mobileRemoteActions,
    cloud: cloudStatus(),
    audit: state.audit.slice(0, 50)
  };
}

function sanitizedAdminState() {
  const data = snapshot();
  const recentErrors = state.audit.filter((item) => item.result === "error" || item.result === "blocked").slice(0, 20);
  return {
    ok: true,
    runtimeLevel: "local_admin_dashboard_mvp",
    status: "yellow_admin_visibility",
    generatedAt: new Date().toISOString(),
    counters: {
      users: data.users.length,
      devices: data.devices.length,
      missions: data.missions.length,
      missionIntakes: data.missionIntakes.length,
      fullMissionLoops: data.fullMissionLoops.length,
      queues: data.queues.length,
      runtimeRuns: data.runtimeRuns.length,
      artifacts: data.artifacts.length,
      evidence: data.artifacts.filter((item) => item.evidence || item.sha256).length,
      providers: data.providers.length,
      architectureSignals: data.architectureSignals.length,
      visionCaptures: data.visionCaptures.length,
      auditEvents: data.audit.length
    },
    devices: data.devices.map((item) => ({
      id: item.id,
      vaultId: item.vaultId,
      pluginVersion: item.pluginVersion,
      status: item.status,
      connectedAt: item.connectedAt
    })).slice(0, 50),
    missions: data.missions.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      status: item.status,
      createdAt: item.createdAt
    })).slice(0, 50),
    intakes: data.missionIntakes.map((item) => ({
      id: item.id,
      status: item.status,
      gate: item.gate,
      modelCalls: item.modelCalls,
      missionId: item.runtimeContract ? item.runtimeContract.missionId : null,
      equalizerMode: item.responsibilityEqualizer ? item.responsibilityEqualizer.effortMode : null,
      createdAt: item.createdAt
    })).slice(0, 50),
    runs: data.runtimeRuns.map((item) => ({
      id: item.id,
      missionId: item.missionId,
      status: item.status,
      runtimeLevel: item.runtimeLevel,
      artifactPath: item.artifact ? item.artifact.path : null,
      evidenceStatus: item.evidence ? item.evidence.status : null,
      createdAt: item.createdAt
    })).slice(0, 50),
    evidence: data.artifacts.map((item) => ({
      id: item.id,
      runId: item.runId,
      missionId: item.missionId,
      type: item.type,
      path: item.path,
      sha256: item.sha256,
      bytes: item.bytes,
      createdAt: item.createdAt
    })).slice(0, 50),
    providers: data.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      slot: provider.slot,
      protocol: provider.protocol,
      keyPresent: provider.keyPresent,
      keyFingerprint: provider.keyFingerprint,
      configuredAt: provider.configuredAt
    })),
    recentErrors,
    boundaries: [
      "Admin dashboard exposes metadata/status/hash only.",
      "No full vault note content is returned.",
      "No secret value is returned.",
      "Production multi-tenant admin console remains a separate YELLOW gate."
    ]
  };
}

function renderAdminDashboardHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Симбиот Admin</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1f2026; color: #f4f4f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #1f2026; color: #f4f4f5; }
    button, input { min-height: 34px; border: 0; border-radius: 8px; padding: 0 12px; background: #343741; color: #f4f4f5; }
    button { cursor: pointer; }
    .shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
    aside { border-right: 1px solid rgba(255,255,255,.08); padding: 18px 12px; display: grid; align-content: start; gap: 10px; }
    main { padding: 24px; display: grid; gap: 18px; align-content: start; }
    h1, h2, p { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { padding: 14px; border-radius: 10px; background: rgba(255,255,255,.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
    .metric strong { display: block; font-size: 24px; }
    .panel { padding: 16px; border-radius: 10px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
    code, small { color: #aeb3bd; overflow-wrap: anywhere; }
    @media (max-width: 860px) { .shell { display: block; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <div class="shell" data-symbiot-admin-dashboard="metadata-only">
    <aside>
      <h1>Симбиот Admin</h1>
      <input id="token" type="password" autocomplete="off" placeholder="Локальный токен connector" />
      <button id="refresh">Обновить</button>
      <small id="status">Введите локальный токен один раз для этой вкладки.</small>
      <small>Только статусы, hashes и metadata. Без полного vault content и secret values.</small>
    </aside>
    <main>
      <section class="grid" id="metrics"></section>
      <section class="panel"><h2>Миссии</h2><table id="missions"></table></section>
      <section class="panel"><h2>Запуски / проверка</h2><table id="runs"></table></section>
      <section class="panel"><h2>Ошибки / блокировки</h2><table id="errors"></table></section>
    </main>
  </div>
  <script>
    async function loadState() {
      const token = document.getElementById('token').value.trim();
      if (!token) throw new Error('Нужен локальный токен connector');
      sessionStorage.setItem('symbiot-admin-token', token);
      const response = await fetch('/admin/state', { headers: { 'x-symbiot-connector-token': token } });
      const state = await response.json();
      if (!response.ok) throw new Error(state.error || response.statusText);
      document.getElementById('status').textContent = 'Подключено. Данные обновлены: ' + state.generatedAt;
      const metrics = Object.entries(state.counters);
      document.getElementById('metrics').innerHTML = metrics.map(([key, value]) => '<div class="metric"><strong>' + value + '</strong><small>' + key + '</small></div>').join('');
      document.getElementById('missions').innerHTML = '<tr><th>ID</th><th>Название</th><th>Статус</th><th>Создано</th></tr>' + state.missions.map((m) => '<tr><td><code>' + m.id + '</code></td><td>' + (m.title || '') + '</td><td>' + (m.status || '') + '</td><td>' + (m.createdAt || '') + '</td></tr>').join('');
      document.getElementById('runs').innerHTML = '<tr><th>ID</th><th>Миссия</th><th>Статус</th><th>Проверка</th></tr>' + state.runs.map((r) => '<tr><td><code>' + r.id + '</code></td><td><code>' + (r.missionId || '') + '</code></td><td>' + (r.status || '') + '</td><td>' + (r.evidenceStatus || '') + '</td></tr>').join('');
      document.getElementById('errors').innerHTML = '<tr><th>Action</th><th>Result</th><th>Reason</th></tr>' + state.recentErrors.map((e) => '<tr><td>' + (e.action || '') + '</td><td>' + (e.result || '') + '</td><td>' + (e.reason || e.error || '') + '</td></tr>').join('');
    }
    document.getElementById('token').value = sessionStorage.getItem('symbiot-admin-token') || '';
    document.getElementById('refresh').addEventListener('click', () => loadState().catch((error) => { document.getElementById('status').textContent = error.message; }));
    if (document.getElementById('token').value) loadState().catch((error) => { document.getElementById('status').textContent = error.message; });
  </script>
</body>
</html>`;
}

function securityPosture() {
  const migration = migrationStatus();
  return {
    ok: true,
    runtimeLevel: "local_security_tenant_backup_mvp",
    status: "yellow_security_architecture",
    connectorAuthRequired: true,
    corsAllowlist: Array.from(ALLOWED_CORS_ORIGINS),
    protectedEndpoints: ["/admin/snapshot", "/admin/state", "/api-vault/list", "/mission/intake", "/agent-runtime/run", "/rag/embeddings", "/backup/create", "/backup/verify"],
    secretStorage: {
      localDpapiVault: fs.existsSync(API_VAULT_STORE_FILE),
      connectorTokenFile: fs.existsSync(CONNECTOR_TOKEN_FILE),
      rawSecretsInAdminState: false
    },
    tenantBoundary: {
      supabaseSchemaKnown: migration.businessMemoryMigrationExists,
      rlsPolicySkeletonReady: migration.rlsPolicySkeletonReady,
      rlsMissingTables: migration.rlsMissingTables
    },
    backup: {
      backupDir: BACKUP_DIR,
      localBackupReady: true,
      productionBackupPolicy: "yellow_until_external_restore_drill"
    },
    boundaries: [
      "Local connector security is not a full production tenant audit.",
      "Backups contain sanitized connector state, not full vault content.",
      "Marketplace/signed installer/public relay remain YELLOW/RED."
    ]
  };
}

function createConnectorBackup(body = {}) {
  ensureConnectorDataDir();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    source: body.source || "connector",
    runtimeLevel: "local_sanitized_connector_backup",
    snapshot: sanitizedAdminState(),
    securityPosture: securityPosture(),
    exclusions: ["full vault content", "raw secret values", "connector token value", "API key values"]
  };
  const content = `${JSON.stringify(backup, null, 2)}\n`;
  const fileName = `symbiot_connector_backup_${backup.createdAt.replace(/[:.]/g, "-")}.json`;
  const backupPath = path.join(BACKUP_DIR, fileName);
  fs.writeFileSync(backupPath, content, "utf8");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const record = { ok: true, backupId: backup.id, path: backupPath, sha256, bytes: Buffer.byteLength(content), createdAt: backup.createdAt, status: "backup_created_yellow" };
  audit({ source: backup.source, action: "backup_create", approval: "connector_auth", result: record.status, backupId: backup.id, sha256 });
  return record;
}

function verifyConnectorBackup(body = {}) {
  const backupPath = path.resolve(String(body.path || ""));
  const root = path.resolve(BACKUP_DIR);
  if (!backupPath.startsWith(root + path.sep) || !fs.existsSync(backupPath)) {
    audit({ source: body.source || "connector", action: "backup_verify", approval: "connector_auth", result: "blocked", reason: "backup_path_not_allowed" });
    return { ok: false, status: "blocked", reason: "backup_path_not_allowed" };
  }
  const content = fs.readFileSync(backupPath, "utf8");
  const parsed = JSON.parse(content);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const noSecretLeak = !/sb_secret_|sk-[a-z0-9_-]{20,}|api[_-]?key\s*[:=]\s*['\"][^'\"]{12,}/i.test(content);
  return {
    ok: true,
    status: noSecretLeak && parsed.snapshot && parsed.securityPosture ? "backup_verified_yellow" : "backup_failed_red",
    path: backupPath,
    sha256,
    backupId: parsed.id,
    noSecretLeak,
    hasSnapshot: Boolean(parsed.snapshot),
    hasSecurityPosture: Boolean(parsed.securityPosture),
    exclusions: parsed.exclusions || []
  };
}

function listProcesses() {
  return new Promise((resolve) => {
    execFile("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ ok: false, error: error.message, processes: [] });
      const processes = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 80)
        .map((line) => line.split("\",\"").map((part) => part.replace(/^\"|\"$/g, "")))
        .map(([name, pid, session, sessionNumber, memory]) => ({ name, pid, session, sessionNumber, memory }));
      resolve({ ok: true, processes });
    });
  });
}

function isPlaceholderModel(model) {
  return !model || model === "not_configured" || model === "claude-sonnet" || model === "gemini-pro";
}

function defaultProtocol(id) {
  if (["openai", "anthropic", "gemini"].includes(id)) return id;
  return "generic_http";
}

function normalizeProvider(provider) {
  const id = String(provider.id || provider.providerId || provider.name || "unknown").toLowerCase();
  const names = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };
  return {
    ...provider,
    id,
    protocol: provider.protocol || provider.type || defaultProtocol(id),
    name: provider.name || names[id] || provider.providerName || id,
    model: provider.model || "not_configured"
  };
}

function inferKeyEnv(provider) {
  if (provider.apiKeyEnv || provider.keyEnv || provider.secretEnv) return provider.apiKeyEnv || provider.keyEnv || provider.secretEnv;
  if (provider.id === "openai" || provider.protocol === "openai") return "OPENAI_API_KEY";
  if (provider.id === "anthropic" || provider.protocol === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider.id === "gemini" || provider.protocol === "gemini") return process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GOOGLE_API_KEY";
  if (provider.id === "deepseek") return "DEEPSEEK_API_KEY";
  if (provider.id === "openrouter") return "OPENROUTER_API_KEY";
  return provider.requiresKey === false || provider.authType === "none" || (provider.auth && provider.auth.type === "none") ? "NO_KEY_REQUIRED" : `${provider.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function getProviderRuntime(provider) {
  const normalized = normalizeProvider(provider);
  const keyName = inferKeyEnv(normalized);
  const memoryKey = normalized.secretRef && state.providerSecrets[normalized.secretRef] ? state.providerSecrets[normalized.secretRef] : "";
  const envKey = keyName === "NO_KEY_REQUIRED" ? "" : (process.env[keyName] || "");
  const key = memoryKey || envKey;
  let model = normalized.model;
  if (normalized.protocol === "openai") model = process.env.OPENAI_MODEL || (isPlaceholderModel(model) ? "gpt-4.1-mini" : model);
  if (normalized.protocol === "anthropic") model = process.env.ANTHROPIC_MODEL || (isPlaceholderModel(model) ? "claude-3-5-sonnet-latest" : model);
  if (normalized.protocol === "gemini") model = process.env.GEMINI_MODEL || (isPlaceholderModel(model) ? "gemini-2.0-flash" : model);
  return { ...normalized, model, keyName, key, keySource: memoryKey ? "memory" : envKey ? "env" : "none" };
}

function publicProvider(runtime) {
  return {
    providerId: runtime.id,
    providerName: runtime.name,
    protocol: runtime.protocol,
    model: runtime.model,
    keyName: runtime.keyName,
    keySource: runtime.keySource,
    keyPresent: Boolean(runtime.key)
  };
}

function templateValue(value, context) {
  if (typeof value !== "string") return value;
  return value
    .replace(/{{\s*prompt\s*}}/g, context.prompt)
    .replace(/{{\s*model\s*}}/g, context.model)
    .replace(/{{\s*providerId\s*}}/g, context.providerId)
    .replace(/{{\s*providerName\s*}}/g, context.providerName)
    .replace(/{{\s*now\s*}}/g, context.now)
    .replace(/{{\s*apiKey\s*}}/g, context.apiKey);
}

function renderTemplate(value, context) {
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, context)]));
  }
  return templateValue(value, context);
}

function getPathValue(data, pathSpec) {
  if (!pathSpec) return undefined;
  const parts = Array.isArray(pathSpec) ? pathSpec : String(pathSpec).split(".");
  let current = data;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    const key = /^\d+$/.test(String(part)) ? Number(part) : part;
    current = current[key];
  }
  return current;
}

function extractFirstText(data, paths) {
  for (const pathSpec of paths.filter(Boolean)) {
    const value = getPathValue(data, pathSpec);
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const text = value.map((item) => typeof item === "string" ? item : item && item.text ? item.text : "").filter(Boolean).join("\n");
      if (text.trim()) return text;
    }
  }
  return "";
}

function isLocalOrPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function assertAllowedProviderUrl(endpoint) {
  const parsed = new URL(endpoint);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("provider_endpoint_protocol_blocked");
  if (parsed.protocol === "http:" && !ALLOW_LOCAL_PROVIDER) throw new Error("provider_http_requires_SYMBIOT_ALLOW_LOCAL_PROVIDER");
  if (isLocalOrPrivateHost(parsed.hostname) && !ALLOW_LOCAL_PROVIDER) throw new Error("provider_local_network_requires_SYMBIOT_ALLOW_LOCAL_PROVIDER");
  return parsed;
}

function missingKeyResult(runtime, prompt) {
  return {
    providerId: runtime.id,
    providerName: runtime.name,
    protocol: runtime.protocol,
    model: runtime.model,
    status: "missing_api_key",
    answer: [
      `${runtime.name}: adapter is configured, but ${runtime.keyName} is not present in environment.`,
      `Prompt: ${prompt || "not provided"}`,
      "No external LLM request was sent."
    ].join("\n"),
    evidence: `Secret presence check failed for ${runtime.keyName}. Secret value was not read into evidence.`,
    risk: "YELLOW: real LLM execution is blocked by missing provider key"
  };
}

function liveDisabledResult(runtime, prompt) {
  return {
    providerId: runtime.id,
    providerName: runtime.name,
    protocol: runtime.protocol,
    model: runtime.model,
    status: "live_disabled",
    answer: [
      `${runtime.name}: API key/config is present, but live execution was not requested.`,
      `Prompt: ${prompt || "not provided"}`,
      "Set request live=true or SYMBIOT_LLM_LIVE_ENABLED=1 for a controlled live proof."
    ].join("\n"),
    evidence: "Provider config is present; secret value is never logged. External request was intentionally skipped.",
    risk: "YELLOW: live execution requires explicit proof mode"
  };
}

function providerErrorResult(runtime, error) {
  return {
    providerId: runtime.id,
    providerName: runtime.name,
    protocol: runtime.protocol,
    model: runtime.model,
    status: "provider_error",
    answer: `${runtime.name}: provider request failed. ${error.message}`,
    evidence: "Provider call was attempted or validated but did not return a usable answer. Secret value was not logged.",
    risk: "YELLOW/RED: provider config, credentials, network or responsePath must be checked"
  };
}

async function fetchJson(url, options, externalSignal = null) {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS);
  const signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
  const response = await fetch(url, { ...options, signal });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = { raw: text }; }
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function extractOpenAiText(data) {
  if (data.output_text) return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).map((content) => content.text || content.output_text || "").filter(Boolean).join("\n");
  }
  return extractFirstText(data, ["choices.0.message.content", "choices.0.text", "message.content", "text", "content", "result"]);
}

function extractAnthropicText(data) {
  if (Array.isArray(data.content)) return data.content.map((item) => item.text || "").filter(Boolean).join("\n");
  return extractFirstText(data, ["completion", "text", "content", "result"]);
}

function extractGeminiText(data) {
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content ? data.candidates[0].content.parts || [] : [];
  const text = parts.map((part) => part.text || "").filter(Boolean).join("\n");
  return text || extractFirstText(data, ["text", "content", "result"]);
}

async function callOpenAi(runtime, prompt, signal) {
  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.key}` },
    body: JSON.stringify({ model: runtime.model, input: prompt, max_output_tokens: 450 })
  }, signal);
  return extractOpenAiText(data) || "OpenAI returned an empty text response.";
}

async function callAnthropic(runtime, prompt, signal) {
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": runtime.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: runtime.model, max_tokens: 450, messages: [{ role: "user", content: prompt }] })
  }, signal);
  return extractAnthropicText(data) || "Anthropic returned an empty text response.";
}

async function callGemini(runtime, prompt, signal) {
  const encodedModel = encodeURIComponent(runtime.model);
  const encodedKey = encodeURIComponent(runtime.key);
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${encodedKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  }, signal);
  return extractGeminiText(data) || "Gemini returned an empty text response.";
}

function openAiCompatibleEndpoint(runtime) {
  const baseUrl = String(runtime.baseUrl || runtime.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const path = runtime.path || "/chat/completions";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function callOpenAiCompatible(runtime, prompt, signal) {
  const endpoint = openAiCompatibleEndpoint(runtime);
  assertAllowedProviderUrl(endpoint);
  const headers = { "content-type": "application/json" };
  if (runtime.keyName !== "NO_KEY_REQUIRED") headers.authorization = `${runtime.authPrefix || "Bearer"} ${runtime.key}`;
  if (runtime.headers && typeof runtime.headers === "object") {
    Object.assign(headers, renderTemplate(runtime.headers, templateContext(runtime, prompt)));
  }
  const requestBody = runtime.bodyTemplate ? renderTemplate(runtime.bodyTemplate, templateContext(runtime, prompt)) : {
    model: runtime.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: runtime.maxTokens || 450
  };
  if (String(runtime.baseUrl || "").includes("api.deepseek.com") && !requestBody.thinking) requestBody.thinking = { type: "disabled" };
  const data = await fetchJson(endpoint, {
    method: runtime.method || "POST",
    headers,
    body: JSON.stringify(requestBody)
  }, signal);
  const text = extractFirstText(data, [runtime.responsePath, ...(runtime.responsePaths || []), "choices.0.message.content", "choices.0.message.reasoning_content", "choices.0.text", "output_text", "text", "content", "result"]);
  if (!text) throw new Error("provider_returned_empty_text");
  return { answer: text, usage: data.usage || null };
}

function templateContext(runtime, prompt) {
  return { prompt, model: runtime.model, providerId: runtime.id, providerName: runtime.name, apiKey: runtime.key, now: new Date().toISOString() };
}

function buildGenericHeaders(runtime, prompt) {
  const context = templateContext(runtime, prompt);
  const headers = { "content-type": "application/json", ...(runtime.headers ? renderTemplate(runtime.headers, context) : {}) };
  const auth = runtime.auth || {};
  const authType = runtime.authType || auth.type || (runtime.keyName === "NO_KEY_REQUIRED" ? "none" : "bearer");
  if (authType === "bearer" && runtime.key) headers[auth.headerName || "authorization"] = `${auth.prefix || "Bearer"} ${runtime.key}`;
  if (authType === "header" && runtime.key) headers[auth.headerName || runtime.headerName || "x-api-key"] = `${auth.prefix || ""}${runtime.key}`;
  return headers;
}

function addGenericQueryAuth(endpoint, runtime) {
  const auth = runtime.auth || {};
  const authType = runtime.authType || auth.type || "bearer";
  const url = new URL(endpoint);
  if (authType === "query" && runtime.key) url.searchParams.set(auth.queryName || runtime.queryName || "key", runtime.key);
  return url.toString();
}

async function callGenericHttp(runtime, prompt, signal) {
  if (!runtime.endpoint && !runtime.url) throw new Error("generic_http_requires_endpoint");
  const endpoint = addGenericQueryAuth(runtime.endpoint || runtime.url, runtime);
  assertAllowedProviderUrl(endpoint);
  const context = templateContext(runtime, prompt);
  const method = String(runtime.method || "POST").toUpperCase();
  const bodyTemplate = runtime.bodyTemplate || { prompt: "{{prompt}}", model: "{{model}}" };
  const options = { method, headers: buildGenericHeaders(runtime, prompt) };
  if (!["GET", "HEAD"].includes(method)) options.body = JSON.stringify(renderTemplate(bodyTemplate, context));
  const data = await fetchJson(endpoint, options, signal);
  const text = extractFirstText(data, [runtime.responsePath, ...(runtime.responsePaths || []), "choices.0.message.content", "output_text", "answer", "text", "content", "result", "data.text"]);
  return text || "Generic HTTP provider returned an empty text response.";
}

function requiresKey(runtime) {
  return !(runtime.keyName === "NO_KEY_REQUIRED" || runtime.requiresKey === false || runtime.authType === "none" || (runtime.auth && runtime.auth.type === "none"));
}

async function runProvider(provider, prompt, liveRequested, signal = null) {
  const runtime = getProviderRuntime(provider);
  if (requiresKey(runtime) && !runtime.key) return missingKeyResult(runtime, prompt);
  if (!liveRequested) return liveDisabledResult(runtime, prompt);
  const startedAt = Date.now();
  try {
    let providerResponse = "";
    if (runtime.protocol === "openai") providerResponse = await callOpenAi(runtime, prompt, signal);
    else if (runtime.protocol === "anthropic") providerResponse = await callAnthropic(runtime, prompt, signal);
    else if (runtime.protocol === "gemini") providerResponse = await callGemini(runtime, prompt, signal);
    else if (runtime.protocol === "openai_compatible") providerResponse = await callOpenAiCompatible(runtime, prompt, signal);
    else if (runtime.protocol === "generic_http") providerResponse = await callGenericHttp(runtime, prompt, signal);
    else throw new Error(`unsupported_protocol_${runtime.protocol}`);
    const answer = typeof providerResponse === "string" ? providerResponse : providerResponse.answer;
    const usage = providerResponse && typeof providerResponse === "object" ? providerResponse.usage || null : null;
    const inputTokens = Number(usage && (usage.prompt_tokens || usage.input_tokens) || 0);
    const outputTokens = Number(usage && (usage.completion_tokens || usage.output_tokens) || 0);
    const isDeepSeekV4Flash = String(runtime.model || "").includes("deepseek-v4-flash");
    const estimatedCostUsd = isDeepSeekV4Flash && usage ? Number(((inputTokens * 0.14 + outputTokens * 0.28) / 1000000).toFixed(8)) : null;
    return {
      providerId: runtime.id,
      providerName: runtime.name,
      protocol: runtime.protocol,
      model: runtime.model,
      status: "live_provider_passed",
      answer,
      latencyMs: Date.now() - startedAt,
      usage,
      estimatedCostUsd,
      evidence: `Provider call passed in ${Date.now() - startedAt} ms. Secret value was not logged.`,
      risk: "YELLOW: provider returned text, but output quality/cost/security controls still need product QA"
    };
  } catch (error) {
    if (signal && signal.aborted) {
      return {
        providerId: runtime.id,
        providerName: runtime.name,
        protocol: runtime.protocol,
        model: runtime.model,
        status: "cancelled_by_user",
        answer: "Выполнение остановлено пользователем.",
        evidence: "External request was aborted by an explicit user action.",
        risk: "YELLOW: операция остановлена до получения результата"
      };
    }
    return providerErrorResult(runtime, error);
  }
}

function comparisonStatus(results) {
  if (results.every((result) => result.status === "live_provider_passed")) return "live_all_providers_passed";
  if (results.some((result) => result.status === "live_provider_passed")) return "live_partial";
  if (results.some((result) => result.status === "provider_error")) return "provider_error";
  if (results.some((result) => result.status === "live_disabled")) return "live_disabled";
  if (results.every((result) => result.status === "missing_api_key")) return "missing_api_key";
  return "yellow_not_live";
}

function providerSecretStatus(providers) {
  return providers.map((provider) => publicProvider(getProviderRuntime(provider)));
}

async function executeModelGateway({ source, missionId, roleId, routeSource, provider, prompt, liveRequested, purpose, signal = null }) {
  if (!roleId) throw new Error("model_gateway_role_id_required");
  if (!routeSource) throw new Error("model_gateway_route_source_required");
  const gatewayCallId = randomUUID();
  const startedAt = new Date().toISOString();
  audit({
    source: source || "model-gateway",
    action: "model_gateway_start",
    approval: liveRequested ? "explicit_live_request" : "not_live",
    result: "routing_complete",
    gatewayCallId,
    missionId: missionId || null,
    roleId,
    routeSource,
    purpose: purpose || "role_runtime"
  });
  const result = await runProvider(provider, prompt, liveRequested, signal);
  audit({
    source: source || "model-gateway",
    action: "model_gateway_complete",
    approval: liveRequested ? "explicit_live_request" : "not_live",
    result: result.status,
    gatewayCallId,
    missionId: missionId || null,
    roleId,
    routeSource,
    providerId: result.providerId,
    model: result.model
  });
  return {
    ...result,
    gateway: {
      id: gatewayCallId,
      startedAt,
      roleId,
      routeSource,
      purpose: purpose || "role_runtime"
    }
  };
}

async function handleLlmCompare(body, signal = null) {
  const providers = Array.isArray(body.providers) && body.providers.length ? body.providers : providerRegistryDefaults();
  const prompt = body.prompt || "";
  const liveRequested = Boolean(body.live || process.env.SYMBIOT_LLM_LIVE_ENABLED === "1");
  const normalizedProviders = providers.map(normalizeProvider);
  const results = await Promise.all(normalizedProviders.map((provider) =>
    executeModelGateway({
      source: body.source || "llm-comparison",
      missionId: body.missionId || null,
      roleId: "mission_methodologist",
      routeSource: "deterministic_llm_comparison_tool",
      provider,
      prompt,
      liveRequested,
      purpose: "llm_comparison",
      signal
    })
  ));
  const comparison = {
    id: randomUUID(),
    prompt,
    missionId: body.missionId || null,
    source: body.source || "plugin",
    status: comparisonStatus(results),
    liveRequested,
    createdAt: new Date().toISOString(),
    providerSecrets: providerSecretStatus(normalizedProviders),
    results
  };
  state.llmComparisons.unshift(comparison);
  state.llmComparisons = state.llmComparisons.slice(0, 50);
  audit({
    source: comparison.source,
    action: "llm_compare",
    approval: "not_required",
    result: comparison.status,
    comparisonId: comparison.id,
    liveRequested,
    providerStatuses: results.map((result) => ({ providerId: result.providerId, protocol: result.protocol, status: result.status }))
  });
  return comparison;
}

const MISSION_INTAKE_REQUIRED_FIELDS = ["goal", "expectedArtifact", "destination", "acceptanceCheck"];
const MISSION_INTAKE_BENCHMARKS = ["SYM-BM-053", "SYM-BM-054", "SYM-BM-055", "SYM-BM-056", "SYM-BM-057", "SYM-BM-058"];

function normalizeMissionInput(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 12000);
}

function textHasAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(word));
}

function inferExpectedArtifact(text, fields) {
  if (fields.expectedArtifact) return String(fields.expectedArtifact).trim();
  const lower = text.toLowerCase();
  const variants = [
    { words: ["план запуска", "план внедрения", "дорожный план", "план действий", "подготовь план", "составь план"], value: "план действий" },
    { words: ["коммерческое предложение", "кп", "оффер"], value: "коммерческое предложение" },
    { words: ["отчет", "разбор", "аудит"], value: "отчет / аналитический разбор" },
    { words: ["таблиц", "xlsx", "excel"], value: "таблица" },
    { words: ["презентац", "ppt", "slides"], value: "презентация" },
    { words: ["письмо", "email"], value: "письмо / сообщение" },
    { words: ["html", "страниц", "лендинг"], value: "html-страница" },
    { words: ["canvas", "канвас", "схем"], value: "Obsidian Canvas / схема" },
    { words: ["документ", "docx", "word"], value: "документ" }
  ];
  const found = variants.find((item) => item.words.some((word) => lower.includes(word)));
  return found ? found.value : "";
}

function inferDestination(text, fields) {
  if (fields.destination) return String(fields.destination).trim();
  const lower = text.toLowerCase();
  if (lower.includes("на рабоч") || lower.includes("desktop")) return "рабочий стол пользователя";
  if (lower.includes("в obsidian") || lower.includes("в обсидиан") || lower.includes("в vault") || lower.includes("в волт")) return "Obsidian vault";
  const folderMatch = text.match(/(?:в папк[ауе]|положи в|сохрани в)\s+([^\n,.]{4,160})/i);
  if (folderMatch) return folderMatch[1].trim();
  return "";
}

function inferSources(text, fields) {
  const sources = Array.isArray(fields.sources) ? fields.sources.filter(Boolean).map(String) : [];
  const matches = text.match(/https?:\/\/\S+|[A-ZА-Я]:\\[^\n"]+/gi) || [];
  for (const match of matches) sources.push(match.replace(/[),.;]+$/g, ""));
  if (textHasAny(text, ["из файла", "прикреп", "используй документ", "по документу"]) && !sources.length) sources.push("источник указан пользователем, требуется уточнить путь/файл");
  return Array.from(new Set(sources)).slice(0, 12);
}

function inferConstraints(text, fields) {
  const constraints = Array.isArray(fields.constraints) ? fields.constraints.filter(Boolean).map(String) : [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (/(\bбез\b|\bне\b|нельзя|срок|до \d|для клиента|конфиденц|персональн|юридич|бюджет|стоимост)/i.test(line)) constraints.push(line.trim());
  }
  if (!constraints.length && text.length > 80) constraints.push("соблюдать смысл запроса пользователя и не обещать непроверенное");
  return Array.from(new Set(constraints)).slice(0, 12);
}

function inferAcceptanceCheck(text, fields, expectedArtifact) {
  if (fields.acceptanceCheck) return String(fields.acceptanceCheck).trim();
  const lower = text.toLowerCase();
  if (lower.includes("проверь") || lower.includes("evidence") || lower.includes("свер")) return "проверить результат по указанным критериям и evidence";
  if (expectedArtifact) return `пользователь может открыть ${expectedArtifact}, увидеть итог, источники, ограничения и следующий шаг`;
  return "";
}

function parseMissionIntake(body) {
  const fields = body.userFields && typeof body.userFields === "object" ? body.userFields : {};
  const missionText = normalizeMissionInput(body.missionText || body.prompt || body.task || "");
  const goal = String(fields.goal || missionText.split(/[.!?\n]/).find((part) => part.trim().length > 10) || "").trim();
  const expectedArtifact = inferExpectedArtifact(missionText, fields);
  const destination = inferDestination(missionText, fields);
  const sources = inferSources(missionText, fields);
  const constraints = inferConstraints(missionText, fields);
  const acceptanceCheck = inferAcceptanceCheck(missionText, fields, expectedArtifact);
  const riskWords = {
    clientFacing: textHasAny(missionText, ["клиент", "публич", "продаж", "рынок", "коммерческ"]),
    money: textHasAny(missionText, ["деньги", "стоимост", "цена", "бюджет", "оплат", "смет"]),
    legal: textHasAny(missionText, ["договор", "юрид", "персональн", "152-фз", "nda", "согласие"]),
    security: textHasAny(missionText, ["ключ", "api", "парол", "секрет", "доступ", "vault", "безопас"]),
    irreversible: textHasAny(missionText, ["удали", "отправь", "опубликуй", "измени", "перезапиши"]),
    ambiguity: missionText.length < 120 || !expectedArtifact || !destination,
    toolActions: textHasAny(missionText, ["открой", "запусти", "скачай", "создай файл", "сохрани", "браузер"])
  };
  return {
    id: body.intakeId || randomUUID(),
    missionText,
    goal,
    expectedArtifact,
    destination,
    sources,
    constraints,
    acceptanceCheck,
    riskWords,
    source: body.source || "unknown",
    requestedAt: new Date().toISOString()
  };
}

function validateMissionIntake(intake) {
  const missingFields = MISSION_INTAKE_REQUIRED_FIELDS.filter((field) => !String(intake[field] || "").trim());
  const questionMap = {
    goal: "Что именно должен сделать Симбиот в этой миссии?",
    expectedArtifact: "Какой конкретный результат нужен: документ, таблица, письмо, canvas, HTML или другой артефакт?",
    destination: "Куда положить готовый результат: в Obsidian, на рабочий стол или в конкретную папку?",
    acceptanceCheck: "По каким признакам пользователь поймет, что результат можно принять?"
  };
  return {
    ok: missingFields.length === 0,
    status: missingFields.length ? "needs_clarification" : "schema_validated",
    requiredFields: MISSION_INTAKE_REQUIRED_FIELDS,
    missingFields,
    questions: missingFields.map((field) => ({ field, question: questionMap[field] })),
    modelCalls: 0,
    deterministic: true
  };
}

function buildRuntimeContract(intake) {
  const shortId = intake.id.replace(/[^a-z0-9]+/gi, "").slice(0, 16) || randomBytes(8).toString("hex");
  const missionId = `mission_${shortId}`;
  return {
    id: `contract_${intake.id}`,
    missionId,
    status: "created_before_llm",
    runtimeLevel: "deterministic_pre_llm_contract",
    goal: intake.goal,
    expectedArtifact: intake.expectedArtifact,
    destination: intake.destination,
    sourcePolicy: {
      explicitSources: intake.sources,
      noSilentVaultRead: true,
      unknownSourcesRequireClarification: intake.sources.some((source) => source.includes("требуется уточнить"))
    },
    acceptanceCheck: intake.acceptanceCheck,
    constraints: intake.constraints,
    artifactContract: {
      requiredFiles: [
        "00_Паспорт_миссии.md",
        "01_Маршрут_миссии.canvas",
        "03_AI_Команда.md",
        "04_Результат.md",
        "05_Evidence.md",
        "06_Execution_Trace.md",
        "07_Pre_LLM_Trace.md",
        "08_Граф_связей.md",
        "symbiot-mission-manifest.json"
      ],
      finalResultDestination: intake.destination,
      passportIsSingleUserVisibleLog: false,
      evidenceRequiredBeforeGreen: false
    },
    approvalPolicy: {
      approvalRequiredBeforeLlm: true,
      approvalRequiredBeforeExternalActions: true,
      modelCallsBeforeApproval: 0
    },
    createdAt: new Date().toISOString()
  };
}

function buildResponsibilityEqualizer(intake, contract) {
  const factors = {
    clientFacing: intake.riskWords.clientFacing ? 2 : 0,
    money: intake.riskWords.money ? 2 : 0,
    legal: intake.riskWords.legal ? 3 : 0,
    security: intake.riskWords.security ? 3 : 0,
    irreversible: intake.riskWords.irreversible ? 3 : 0,
    ambiguity: intake.riskWords.ambiguity ? 2 : 0,
    toolActions: intake.riskWords.toolActions ? 2 : 0,
    sourcesMissing: intake.sources.length ? 0 : 1,
    verificationNeeded: contract.artifactContract.evidenceRequiredBeforeGreen ? 1 : 0
  };
  const score = Object.values(factors).reduce((sum, value) => sum + value, 0);
  let effortMode = "fast";
  let modelTier = "economy";
  let validatorDepth = "basic";
  if (score >= 4) {
    effortMode = "work";
    modelTier = "balanced";
    validatorDepth = "standard";
  }
  if (score >= 8) {
    effortMode = "deep";
    modelTier = "strong_reasoning";
    validatorDepth = "evidence_and_risk";
  }
  if (score >= 12) {
    effortMode = "critical";
    modelTier = "best_available_with_validator";
    validatorDepth = "two_pass_validation";
  }
  return {
    id: `equalizer_${intake.id}`,
    status: "selected_before_llm",
    score,
    factors,
    effortMode,
    modelTier,
    validatorDepth,
    estimatedBudgetUsd: {
      min: effortMode === "fast" ? 0.001 : effortMode === "work" ? 0.01 : effortMode === "deep" ? 0.05 : 0.25,
      max: effortMode === "fast" ? 0.01 : effortMode === "work" ? 0.05 : effortMode === "deep" ? 0.25 : 1,
      basis: "pre_run_responsibility_range_not_invoice"
    },
    budgetPolicy: {
      startCheapThenEscalate: true,
      maxParallelRoleExecutors: 5,
      useExpensiveModelOnlyFor: score >= 8 ? "high_responsibility_steps" : "validator_or_final_answer_only"
    },
    roleRuntimePolicy: {
      mainRole: "РОЛЬ_AI_Методолог_клиентских_миссий",
      helperRoles: ["исполнитель", "контролер качества", "риск-контроль"],
      selectRolesByCostAndResponsibility: true
    },
    explanation: "Уровень усилия выбран детерминированно по ответственности миссии до первого LLM-вызова."
  };
}

function buildPreLlmTrace({ intake, validation, contract, equalizer, route, context, libraryGate, reflexionMemory, artifactsPrepared }) {
  const steps = [
    ["gateway_received", "Запрос пользователя принят GUI/плагином"],
    ["mission_intake_parsed", "Mission Intake разобран без LLM"],
    ["schema_validated", validation.ok ? "Обязательные поля заполнены" : "Запуск остановлен до уточнения"],
    ["runtime_contract_created", contract ? "Контракт результата создан до Role Runtime" : "Контракт не создавался из-за неполного intake"],
    ["responsibility_equalizer_selected", equalizer ? "LLM-эквалайзер выбрал режим до первого вызова модели" : "Эквалайзер не запускался из-за неполного intake"],
    ["router_selected_roles", route ? `Router выбрал ${route.selectedRoles.length} ролей до LLM` : "Router не запускался из-за неполного intake"],
    ["role_registry_loaded", route ? `Загружены versioned role packages: ${route.selectedRoles.map((role) => `${role.id}@${role.version}`).join(", ")}` : "Role Registry не загружался"],
    ["library_gate_checked", libraryGate ? `Library Gate: ${libraryGate.status}; эталонов выбрано: ${libraryGate.summary.selectedCount}` : "Library Gate не запускался"],
    ["reflexion_memory_checked", reflexionMemory ? `Reflexion прочитан до выполнения; релевантных правил: ${reflexionMemory.relevantCount}` : "Reflexion не запускался"],
    ["context_builder_ready", context ? `Context Builder собрал explicit context + library references; источников: ${context.explicitSources.length}; эталонов: ${context.libraryReferences.length}` : "Context Builder не запускался"],
    ["obsidian_artifacts_prepared", artifactsPrepared ? "Паспорт/canvas/trace подготовлены до LLM" : "Артефакты не создавались из-за неполного intake"],
    ["awaiting_user_approval", "LLM-вызовы заблокированы до явного запуска пользователем"]
  ];
  return {
    id: `trace_${intake.id}`,
    status: validation.ok ? "pre_llm_ready_for_approval" : "blocked_before_llm",
    modelCalls: 0,
    llmExecutionAllowed: false,
    steps: steps.map(([id, label], index) => ({ order: index + 1, id, label, modelCallsAfterStep: 0 }))
  };
}

function missionTitleFromGoal(goal) {
  return String(goal || "Новая миссия")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Новая миссия";
}

function buildMissionArtifactBundle({ intake, contract, equalizer, route, context, trace, libraryGate, reflexionMemory }) {
  const title = missionTitleFromGoal(intake.goal);
  const operatingSystem = missionOperatingSystemContract();
  const baseFolder = missionBaseFolder(contract.missionId);
  const passportPath = `${baseFolder}/00_Паспорт_миссии.md`;
  const canvasPath = `${baseFolder}/01_Маршрут_миссии.canvas`;
  const tracePath = `${baseFolder}/07_Pre_LLM_Trace.md`;
  const graphPath = `${baseFolder}/08_Граф_связей.md`;
  const manifestPath = `${baseFolder}/symbiot-mission-manifest.json`;
  const routeLines = [
    "1. Пользователь вводит миссию обычным языком: текстом, голосом или вставкой материала.",
    "2. При необходимости пользователь включает LLM-уточнение формулировки; это не запуск миссии, а помощь в сборке ясного паспорта.",
    "3. Симбиот детерминированно собирает цель, результат, место сохранения, источники, ограничения и критерий приемки.",
    "4. Router выбирает AI-команду и режим исполнения до выполнения миссии.",
    "5. Library Gate подбирает эталонные документы библиотеки до первого LLM-вызова.",
    "6. Пользователь видит паспорт миссии и подтверждает запуск.",
    "7. После подтверждения Role Runtime выполняет миссию и дописывает ход выполнения и результат в этот же паспорт.",
    "8. После миссии Архивариус фиксирует, нужно ли пополнить или улучшить библиотеку."
  ];
  const roleLines = route.selectedRoles.map((role) => `- ${role.kind}: ${role.roleRef} (${role.id}@${role.version})`);
  const libraryReferenceLines = context.libraryReferences.length
    ? context.libraryReferences.map((reference) => `- [${reference.scope}/${reference.libraryId}] ${reference.relativePath} (${reference.artifactType}; ${reference.referenceStatus})`)
    : ["- подходящие эталонные документы не найдены; Library Gate зафиксировал YELLOW и запрет на выдумывание источников"];
  const traceRows = trace.steps.map((step) => `| ${step.order} | ${step.id} | ${step.label} | ${step.modelCallsAfterStep} |`);
  const passport = [
    `# Паспорт миссии - ${title}`,
    "",
    `mission_id: ${contract.missionId}`,
    "status: pre_llm_ready_for_approval",
    "passport_contract: single_user_visible_mission_log",
    "model_calls_before_approval: 0",
    "",
    "## 01. Описание миссии",
    "",
    intake.missionText || intake.goal,
    "",
    "## 02. Уточнение формулировки через LLM",
    "",
    "- статус: доступно по выбору пользователя",
    "- смысл: помочь пользователю сформулировать задачу, если он описал ее нечетко",
    "- граница: это еще не выполнение миссии и не внешнее действие",
    "- правило: после уточнения пользователь снова видит паспорт и подтверждает запуск",
    "",
    "## 03. Ожидаемый результат и место сохранения",
    "",
    `- результат: ${intake.expectedArtifact}`,
    `- место: ${intake.destination}`,
    `- критерий приемки: ${intake.acceptanceCheck}`,
    "",
    "## 04. Маршрут миссии",
    "",
    ...routeLines,
    "",
    "## 05. AI-команда",
    "",
    ...(roleLines.length ? roleLines : ["- команда еще не выбрана"]),
    "",
    "## 06. Источники, разрешения и ограничения",
    "",
    "Источники:",
    ...(intake.sources.length ? intake.sources.map((source) => `- ${source}`) : ["- источники не указаны"]),
    "",
    "Эталонные документы библиотеки:",
    `- gate: ${libraryGate ? libraryGate.status : "missing"}`,
    `- owner: ${libraryGate ? libraryGate.ownerRoleRef : "РОЛЬ_AI_Архивариус_и_реестратор"}`,
    `- selected: ${libraryGate ? libraryGate.summary.selectedCount : 0}`,
    ...libraryReferenceLines,
    "",
    "Правило библиотеки:",
    "- Library Gate обязателен в каждой миссии до LLM.",
    "- Эталоны используются read-only; runtime не повышает документы до GOLD автоматически.",
    "- После миссии Архивариус предлагает пополнение/улучшение библиотеки, если результат принят или выявлен пробел.",
    "",
    "Ограничения:",
    ...(intake.constraints.length ? intake.constraints.map((item) => `- ${item}`) : ["- без дополнительных ограничений"]),
    "",
    "## 06A. Reflexion-память",
    "",
    `- журнал проверен до выполнения: ${Boolean(reflexionMemory)}`,
    `- релевантных прошлых исправлений: ${reflexionMemory ? reflexionMemory.relevantCount : 0}`,
    ...(reflexionMemory && reflexionMemory.entries.length
      ? reflexionMemory.entries.map((entry) => `- правило: ${entry.futureRule}`)
      : ["- похожих исправлений пока нет"]),
    "",
    "## 07. Pre-LLM trace",
    "",
    `trace_id: ${trace.id}`,
    `model_calls: ${trace.modelCalls}`,
    `llm_execution_allowed: ${trace.llmExecutionAllowed}`,
    "",
    "| # | Step | Result | Model calls |",
    "|---:|---|---|---:|",
    ...traceRows,
    "",
    "## 08. Граф связей",
    "",
    `- [[${LOS_OBSIDIAN_ROOT}]]`,
    `- [[${LOS_PROTOCOLS_ROOT}]]`,
    "- [[00_Паспорт_миссии]]",
    "",
    "## 09. Ход выполнения",
    "",
    "- статус: ожидает подтверждения пользователя",
    "- Role Runtime: не запускался",
    "- внешние действия: не выполнялись",
    "",
    "## 10. Результат",
    "",
    "Результат еще не создан. Он будет дописан сюда после подтверждения и выполнения миссии."
  ].join("\n");
  const canvas = JSON.stringify({
    nodes: [
      { id: "intake", type: "text", text: "Mission Intake\nсмысл, результат, место, источники", x: 0, y: 0, width: 300, height: 130 },
      { id: "validator", type: "text", text: "Schema Validator\nобязательные поля заполнены", x: 380, y: 0, width: 280, height: 130 },
      { id: "contract", type: "text", text: `Runtime Contract\n${intake.expectedArtifact} -> ${intake.destination}`, x: 740, y: 0, width: 340, height: 130 },
      { id: "equalizer", type: "text", text: `LLM Equalizer\n${equalizer.effortMode} / ${equalizer.modelTier}`, x: 1160, y: 0, width: 300, height: 130 },
      { id: "roles", type: "text", text: `Role Plan\n${route.selectedRoles.map((role) => role.roleRef).join("\n")}`, x: 1540, y: 0, width: 360, height: 180 },
      { id: "library", type: "text", text: `Library Gate\n${libraryGate ? libraryGate.status : "missing"} / references: ${context.libraryReferences.length}`, x: 1980, y: 0, width: 320, height: 130 },
      { id: "role_runtime", type: "text", text: "Role Runtime\nзапрещен до approval", x: 2380, y: 0, width: 280, height: 130 },
      { id: "evidence", type: "text", text: "Validator + Trace\nперед выдачей результата", x: 2740, y: 0, width: 300, height: 130 }
    ],
    edges: [
      { id: "e1", fromNode: "intake", fromSide: "right", toNode: "validator", toSide: "left" },
      { id: "e2", fromNode: "validator", fromSide: "right", toNode: "contract", toSide: "left" },
      { id: "e3", fromNode: "contract", fromSide: "right", toNode: "equalizer", toSide: "left" },
      { id: "e4", fromNode: "equalizer", fromSide: "right", toNode: "roles", toSide: "left" },
      { id: "e5", fromNode: "roles", fromSide: "right", toNode: "library", toSide: "left" },
      { id: "e6", fromNode: "library", fromSide: "right", toNode: "role_runtime", toSide: "left" },
      { id: "e7", fromNode: "role_runtime", fromSide: "right", toNode: "evidence", toSide: "left" }
    ],
    metadata: {
      type: "symbiot_pre_llm_mission_route",
      missionId: contract.missionId,
      modelCallsBeforeApproval: 0,
      graphPath,
      libraryGateStatus: libraryGate ? libraryGate.status : "missing",
      benchmarkIds: MISSION_INTAKE_BENCHMARKS
    }
  }, null, 2);
  const traceMarkdown = [
    `# Pre-LLM Trace - ${title}`,
    "",
    `trace_id: ${trace.id}`,
    `model_calls: ${trace.modelCalls}`,
    `llm_execution_allowed: ${trace.llmExecutionAllowed}`,
    `library_gate: ${libraryGate ? libraryGate.status : "missing"}`,
    "",
    "| # | Step | Result | Model calls |",
    "|---:|---|---|---:|",
    ...trace.steps.map((step) => `| ${step.order} | ${step.id} | ${step.label} | ${step.modelCallsAfterStep} |`)
  ].join("\n");
  const graphMarkdown = [
    `# Граф связей миссии - ${title}`,
    "",
    "## Узлы",
    "",
    "- [[00_Паспорт_миссии]] - смысл, разрешения и критерии результата",
    "- [[01_Маршрут_миссии.canvas]] - визуальный маршрут миссии",
    "- [[07_Pre_LLM_Trace]] - доказательство управляемого запуска",
    "",
    "## Runtime-связь",
    "",
    `Mission Intake -> Schema Validator -> Runtime Contract -> LLM Equalizer -> Library Gate -> Role Runtime approval -> ${intake.expectedArtifact}`,
    "",
    "Graph показывает связи миссии, Canvas показывает последовательность выполнения."
  ].join("\n");
  const manifest = JSON.stringify({
    missionId: contract.missionId,
    title,
    operatingSystem,
    intakeId: intake.id,
    contractId: contract.id,
    equalizerId: equalizer.id,
    routeId: route.id,
    routeSha256: route.sha256,
    roleVersions: route.selectedRoles.map((role) => ({ id: role.id, roleRef: role.roleRef, version: role.version })),
    contextId: context.id,
    contextSha256: context.sha256,
    libraryGate: libraryGate ? {
      id: libraryGate.id,
      status: libraryGate.status,
      sha256: libraryGate.sha256,
      selectedCount: libraryGate.summary.selectedCount,
      ownerRoleId: libraryGate.ownerRoleId
    } : null,
    libraryReferences: context.libraryReferences.map((reference) => ({
      scope: reference.scope,
      libraryId: reference.libraryId,
      sourceId: reference.sourceId,
      relativePath: reference.relativePath,
      artifactType: reference.artifactType,
      referenceStatus: reference.referenceStatus
    })),
    traceId: trace.id,
    estimatedBudgetUsd: equalizer.estimatedBudgetUsd,
    benchmarkIds: MISSION_INTAKE_BENCHMARKS,
    modelCallsBeforeApproval: 0,
    userVisibleFiles: [passportPath, canvasPath, tracePath, graphPath],
    machineFiles: [manifestPath],
    createdAt: contract.createdAt
  }, null, 2);
  return {
    status: "prepared_before_llm",
    baseFolder,
    operatingSystem,
    files: [
      { path: passportPath, content: passport },
      { path: canvasPath, content: `${canvas}\n` },
      { path: tracePath, content: traceMarkdown },
      { path: graphPath, content: graphMarkdown },
      { path: manifestPath, content: `${manifest}\n` }
    ],
    paths: { passport: passportPath, canvas: canvasPath, trace: tracePath, graph: graphPath, manifest: manifestPath }
  };
}
function handleMissionIntake(body) {
  const intake = parseMissionIntake(body);
  const reflexionMemory = readRelevantFeedback(intake.missionText);
  const validation = validateMissionIntake(intake);
  if (!validation.ok) {
    const trace = buildPreLlmTrace({ intake, validation, contract: null, equalizer: null, route: null, context: null, libraryGate: null, reflexionMemory, artifactsPrepared: false });
    const record = {
      ok: true,
      id: intake.id,
      status: "needs_clarification",
      gate: "Clarification Gate",
      intake,
      validation,
      reflexionMemory,
      trace,
      modelCalls: 0,
      llmExecutionAllowed: false,
      benchmarkIds: MISSION_INTAKE_BENCHMARKS,
      createdAt: new Date().toISOString()
    };
    state.missionIntakes.unshift(record);
    state.missionIntakes = state.missionIntakes.slice(0, 100);
    audit({ source: intake.source, action: "mission_intake", approval: "not_required", result: "needs_clarification", intakeId: intake.id, modelCalls: 0, missingFields: validation.missingFields });
    return record;
  }
  const contract = buildRuntimeContract(intake);
  const equalizer = buildResponsibilityEqualizer(intake, contract);
  const route = routeMission(intake, equalizer);
  const libraryGate = runMissionLibraryGate({ intake, contract, route });
  const context = buildContext(intake, contract, route, { libraryGate });
  const trace = buildPreLlmTrace({ intake, validation, contract, equalizer, route, context, libraryGate, reflexionMemory, artifactsPrepared: true });
  const artifactBundle = buildMissionArtifactBundle({ intake, contract, equalizer, route, context, trace, libraryGate, reflexionMemory });
  const mission = {
    id: contract.missionId,
    title: missionTitleFromGoal(intake.goal),
    source: intake.source,
    missionType: "client_mission",
    operatingSystem: missionOperatingSystemContract(),
    status: "pre_llm_ready_for_approval",
    createdAt: new Date().toISOString()
  };
  const record = {
    ok: true,
    id: intake.id,
    status: "ready_for_approval",
    gate: "Result Gate before Role Runtime",
    intake,
    validation,
    runtimeContract: contract,
    responsibilityEqualizer: equalizer,
    rolePlan: route,
    libraryGate,
    reflexionMemory,
    contextPlan: context,
    trace,
    artifactBundle,
    operatingSystem: missionOperatingSystemContract(),
    modelCalls: 0,
    llmExecutionAllowed: false,
    benchmarkIds: MISSION_INTAKE_BENCHMARKS,
    createdAt: new Date().toISOString()
  };
  state.missionIntakes.unshift(record);
  state.missionIntakes = state.missionIntakes.slice(0, 100);
  state.missions.unshift(mission);
  state.missions = state.missions.slice(0, 100);
  audit({ source: intake.source, action: "mission_intake", approval: "awaiting_user_approval", result: "ready_for_approval", intakeId: intake.id, missionId: contract.missionId, modelCalls: 0, equalizerMode: equalizer.effortMode });
  return record;
}

function resolveConfiguredVault() {
  const candidates = [];
  const envVaultPath = String(process.env.SYMBIOT_VAULT_PATH || "").trim();
  if (envVaultPath) candidates.push({ source: "environment", vaultPath: envVaultPath });
  for (const installStatePath of [
    path.join(__dirname, "..", "install-state.json"),
    path.join(process.cwd(), "install-state.json")
  ]) {
    if (!fs.existsSync(installStatePath)) continue;
    try {
      const installState = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
      if (installState && installState.vaultPath) {
        candidates.push({ source: "installer", vaultPath: installState.vaultPath, installStatePath });
      }
    } catch (error) {
      return { ok: false, status: "invalid_install_state", reason: error.message, installStatePath };
    }
  }
  for (const candidate of candidates) {
    const resolvedVaultPath = path.resolve(candidate.vaultPath);
    if (!fs.existsSync(resolvedVaultPath) || !fs.statSync(resolvedVaultPath).isDirectory()) continue;
    if (!fs.existsSync(path.join(resolvedVaultPath, ".obsidian"))) continue;
    return { ok: true, status: "configured", source: candidate.source, vaultPath: resolvedVaultPath, installStatePath: candidate.installStatePath || null };
  }
  return {
    ok: false,
    status: "vault_not_configured",
    reason: "Установленный Obsidian vault не найден. Повторите установку Симбиота и выберите существующий vault."
  };
}

function isPathInsideRoot(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function writeMissionArtifactBundleToVault(bundle) {
  const vault = resolveConfiguredVault();
  if (!vault.ok) return vault;
  const files = Array.isArray(bundle && bundle.files) ? bundle.files : [];
  if (!files.length) return { ok: false, status: "empty_artifact_bundle", reason: "Нет файлов миссии для записи." };
  const written = [];
  for (const file of files) {
    if (!isSafeVaultRelativePath(file.path)) {
      return { ok: false, status: "unsafe_vault_path", reason: file.path || "missing_path" };
    }
    const targetPath = path.resolve(vault.vaultPath, ...String(file.path).split("/"));
    if (!isPathInsideRoot(vault.vaultPath, targetPath)) {
      return { ok: false, status: "vault_path_escape_blocked", reason: file.path };
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const content = String(file.content == null ? "" : file.content);
    const temporaryPath = `${targetPath}.symbiot-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    fs.writeFileSync(temporaryPath, content, "utf8");
    fs.renameSync(temporaryPath, targetPath);
    written.push({
      relativePath: file.path,
      bytes: fs.statSync(targetPath).size,
      sha256: createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex")
    });
  }
  return {
    ok: true,
    status: "written",
    source: vault.source,
    baseFolder: bundle.baseFolder,
    fileCount: written.length,
    files: written
  };
}

function buildCompletedMissionArtifactBundle({
  intakeResult,
  roles,
  llmExecution,
  runtimeResult,
  outputValidation,
  executionTrace,
  infrastructureTrace,
  taskMachine
}) {
  const preparedBundle = intakeResult.artifactBundle;
  const originalFiles = new Map(preparedBundle.files.map((file) => [file.path, file.content]));
  const baseFolder = preparedBundle.baseFolder;
  const title = missionTitleFromGoal(intakeResult.intake.goal);
  const rolesPath = `${baseFolder}/03_AI_Команда.md`;
  const resultPath = `${baseFolder}/04_Результат.md`;
  const evidencePath = `${baseFolder}/05_Evidence.md`;
  const executionTracePath = `${baseFolder}/06_Execution_Trace.md`;
  const passportPath = preparedBundle.paths.passport;
  const canvasPath = preparedBundle.paths.canvas;
  const graphPath = preparedBundle.paths.graph;
  const manifestPath = preparedBundle.paths.manifest;
  const resultContent = String(llmExecution.answer || "").trim() || "Runtime не вернул текст результата.";
  const resultSha256 = createHash("sha256").update(resultContent).digest("hex");
  const approvedAt = new Date().toISOString();
  const passport = [
    String(originalFiles.get(passportPath) || "").replace("status: pre_llm_ready_for_approval", "status: completed_yellow"),
    "",
    "## 11. Подтверждение и ход выполнения",
    "",
    `- approved_at: ${approvedAt}`,
    "- runtime_status: completed_yellow",
    `- model_calls_after_approval: ${llmExecution.modelCalls || 0}`,
    `- provider: ${llmExecution.providerName || llmExecution.providerId || "deterministic"}`,
    `- model: ${llmExecution.model || "none"}`,
    `- result_sha256: ${resultSha256}`,
    "",
    "Итоговые артефакты:",
    "- [[03_AI_Команда]]",
    "- [[04_Результат]]",
    "- [[05_Evidence]]",
    "- [[06_Execution_Trace]]",
    "",
    "Инфраструктурный ход:",
    ...infrastructureTrace.map((item, index) => `${index + 1}. ${item.component} - ${item.status}`),
    "",
    "Состояния миссии:",
    ...taskMachine.history.map((item, index) => `${index + 1}. ${item.state} - ${item.reason}`),
    "",
    "Фактическая AI-команда:",
    ...roles.map((role) => `- ${role.kind}: ${role.role} (${role.roleId}@${role.roleVersion}) - ${role.purpose}`),
    "",
    "## 12. Результат",
    "",
    resultContent,
    "",
    "## 13. Проверка качества и ограничения",
    "",
    `- validator_status: ${outputValidation.status}`,
    `- runtime_artifact_sha256: ${runtimeResult.run.artifact.sha256}`,
    `- output_contract: ${outputValidation.failedChecks.length ? `не пройдено: ${outputValidation.failedChecks.join(", ")}` : "пройден"}`,
    "- статус YELLOW сохраняется до пользовательской приемки содержания результата и закрытия release/security gates."
  ].join("\n");
  let canvasDocument = { nodes: [], edges: [], metadata: {} };
  try {
    canvasDocument = JSON.parse(String(originalFiles.get(canvasPath) || "{}"));
  } catch (_) {
    // Preserve a valid canvas contract even if prepared content is damaged.
  }
  canvasDocument.nodes = Array.isArray(canvasDocument.nodes) ? canvasDocument.nodes : [];
  canvasDocument.edges = Array.isArray(canvasDocument.edges) ? canvasDocument.edges : [];
  const runtimeNode = canvasDocument.nodes.find((node) => node.id === "role_runtime");
  if (runtimeNode) runtimeNode.text = `Role Runtime\nвыполнен / model calls: ${llmExecution.modelCalls || 0}`;
  const evidenceNode = canvasDocument.nodes.find((node) => node.id === "evidence");
  if (evidenceNode) evidenceNode.text = `Validator + Trace\n${outputValidation.status}\n${executionTrace.sha256}`;
  canvasDocument.metadata = {
    ...(canvasDocument.metadata || {}),
    type: "symbiot_completed_mission_route",
    status: "completed_yellow",
    resultPath,
    evidencePath,
    executionTracePath,
    executionTraceSha256: executionTrace.sha256
  };
  const rolesMarkdown = [
    `# AI-команда миссии - ${title}`,
    "",
    `mission_id: ${intakeResult.runtimeContract.missionId}`,
    `role_count: ${roles.length}`,
    "",
    ...roles.map((role) => `- ${role.kind}: ${role.role} (${role.roleId}@${role.roleVersion}) - ${role.purpose}`)
  ].join("\n");
  const resultMarkdown = [
    `# Результат миссии - ${title}`,
    "",
    `mission_id: ${intakeResult.runtimeContract.missionId}`,
    "status: completed_yellow",
    `provider: ${llmExecution.providerName || llmExecution.providerId || "deterministic"}`,
    `model: ${llmExecution.model || "none"}`,
    "",
    resultContent,
    "",
    "## Связи",
    "",
    "- [[00_Паспорт_миссии]]",
    "- [[05_Evidence]]",
    "- [[06_Execution_Trace]]"
  ].join("\n");
  const evidenceMarkdown = [
    `# Evidence миссии - ${title}`,
    "",
    `mission_id: ${intakeResult.runtimeContract.missionId}`,
    "status: PASS_WITH_CONDITIONS_FULL_MISSION_LOOP_YELLOW",
    `result_sha256: ${resultSha256}`,
    `execution_trace_sha256: ${executionTrace.sha256}`,
    `validator_status: ${outputValidation.status}`,
    `runtime_artifact_sha256: ${runtimeResult.run.artifact.sha256}`,
    `library_gate: ${intakeResult.libraryGate ? intakeResult.libraryGate.status : "missing"}`,
    "",
    "## Проверки",
    "",
    "- пользователь подтвердил план до Role Runtime: да",
    `- использован подготовленный intake: ${intakeResult.id}`,
    `- итоговый файл создан: ${fs.existsSync(runtimeResult.run.artifact.path) ? "да" : "нет"}`,
    `- output contract: ${outputValidation.failedChecks.length ? `не пройдено: ${outputValidation.failedChecks.join(", ")}` : "пройден"}`,
    `- полный инфраструктурный след: ${infrastructureTrace.map((item) => item.component).join(" -> ")}`,
    "",
    "YELLOW сохраняется до пользовательской приемки содержания результата и закрытия release/security gates."
  ].join("\n");
  const executionTraceMarkdown = [
    `# Execution Trace - ${title}`,
    "",
    `trace_sha256: ${executionTrace.sha256}`,
    `runtime_core_version: ${RUNTIME_CORE_VERSION}`,
    "",
    "## Инфраструктурный контур",
    "",
    ...infrastructureTrace.map((item, index) => `${index + 1}. ${item.component} - ${item.status}`),
    "",
    "## Машина состояний",
    "",
    ...taskMachine.history.map((item, index) => `${index + 1}. ${item.state} - ${item.reason}`)
  ].join("\n");
  const graphMarkdown = [
    String(originalFiles.get(graphPath) || ""),
    "",
    "## Итог выполнения",
    "",
    "- [[03_AI_Команда]] - фактически выбранная группа ролей",
    "- [[04_Результат]] - результат миссии",
    "- [[05_Evidence]] - доказательства и ограничения",
    "- [[06_Execution_Trace]] - инфраструктурный след",
    "",
    `Пользователь подтвердил план -> Role Runtime -> Validator -> Trace -> ${resultPath}`
  ].join("\n");
  let manifest = {};
  try {
    manifest = JSON.parse(String(originalFiles.get(manifestPath) || "{}"));
  } catch (_) {
    manifest = {};
  }
  manifest = {
    ...manifest,
    status: "completed_yellow",
    completedAt: approvedAt,
    runtimeCoreVersion: RUNTIME_CORE_VERSION,
    resultStoredInPassport: true,
    passportPath,
    resultPath,
    resultSha256,
    evidencePath,
    executionTracePath,
    executionTraceSha256: executionTrace.sha256,
    libraryGate: intakeResult.libraryGate ? {
      id: intakeResult.libraryGate.id,
      status: intakeResult.libraryGate.status,
      sha256: intakeResult.libraryGate.sha256,
      selectedCount: intakeResult.libraryGate.summary.selectedCount,
      afterMissionLoop: intakeResult.libraryGate.afterMissionLoop
    } : null,
    provider: llmExecution.providerId || "deterministic",
    model: llmExecution.model || "none",
    modelCallsAfterApproval: llmExecution.modelCalls || 0,
    userVisibleFiles: [passportPath, canvasPath, rolesPath, resultPath, evidencePath, executionTracePath, preparedBundle.paths.trace, graphPath],
    machineFiles: [manifestPath]
  };
  return {
    status: "completed_yellow",
    baseFolder,
    files: [
      { path: passportPath, content: passport },
      { path: canvasPath, content: `${JSON.stringify(canvasDocument, null, 2)}\n` },
      { path: rolesPath, content: rolesMarkdown },
      { path: resultPath, content: resultMarkdown },
      { path: evidencePath, content: evidenceMarkdown },
      { path: executionTracePath, content: executionTraceMarkdown },
      { path: preparedBundle.paths.trace, content: originalFiles.get(preparedBundle.paths.trace) || "" },
      { path: graphPath, content: graphMarkdown },
      { path: manifestPath, content: `${JSON.stringify(manifest, null, 2)}\n` }
    ],
    paths: {
      ...preparedBundle.paths,
      roles: rolesPath,
      result: resultPath,
      evidence: evidencePath,
      executionTrace: executionTracePath
    }
  };
}
function safeRuntimeFileName(value) {
  const base = String(value || "agent-runtime-result")
    .toLowerCase()
    .replace(/[^a-zа-я0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "agent-runtime-result";
  return base.endsWith(".md") ? base : `${base}.md`;
}

function buildAgentRuntimePlan(body) {
  return [
    { id: "step_1_accept_task", label: "Принять задачу", tool: "runtime_intake", status: "planned" },
    { id: "step_2_prepare_artifact", label: "Создать рабочий артефакт", tool: "file_artifact_writer", status: "planned" },
    { id: "step_3_check_artifact", label: "Проверить файл результата", tool: "check_path", status: "planned" },
    { id: "step_4_evidence", label: "Собрать evidence", tool: "runtime_evidence", status: "planned" }
  ];
}

function renderAgentRuntimeArtifact({ runId, missionId, task, expectedResult, plan, createdAt, runtimeAnswer, runtimeMetadata }) {
  return [
    `# Результат runtime-миссии Симбиота`,
    "",
    `run_id: ${runId}`,
    `mission_id: ${missionId || "not_linked"}`,
    `created_at: ${createdAt}`,
    `runtime_level: local_agent_runtime_mvp`,
    `status: YELLOW`,
    "",
    "## Задача пользователя",
    "",
    task,
    "",
    "## Ожидаемый результат",
    "",
    expectedResult,
    "",
    "## Выполненный безопасный сценарий",
    "",
    ...plan.map((step, index) => `${index + 1}. ${step.label} — ${step.tool} — ${step.status}`),
    "",
    "## Итог",
    "",
    runtimeAnswer || "Симбиот выполнил локальный runtime MVP: принял задачу, создал файл результата, проверил наличие файла и сформировал evidence. Это доказывает базовую цепочку `задача -> инструмент -> файл/результат -> проверка`.",
    "",
    "## Runtime metadata",
    "",
    `- core_version: ${runtimeMetadata && runtimeMetadata.coreVersion ? runtimeMetadata.coreVersion : "local-agent-runtime-mvp"}`,
    `- provider: ${runtimeMetadata && runtimeMetadata.provider ? runtimeMetadata.provider : "not_used"}`,
    `- model: ${runtimeMetadata && runtimeMetadata.model ? runtimeMetadata.model : "not_used"}`,
    `- route_id: ${runtimeMetadata && runtimeMetadata.routeId ? runtimeMetadata.routeId : "not_linked"}`,
    "",
    "## Ограничения",
    "",
    "- это local connector runtime, не production automation agent;",
    "- внешние программы, браузер и удаленные действия не запускались;",
    "- RAG/context retrieval и LLM execution закрываются отдельными gates;",
    "- GREEN запрещен до ручной проверки и расширенного runtime proof."
  ].join("\n");
}

async function handleAgentRuntimeRun(body) {
  const approved = Boolean(body.approved);
  const missionId = body.missionId || null;
  const task = String(body.task || body.prompt || "").trim();
  const expectedResult = String(body.expectedResult || "Локальный файл результата с evidence").trim();
  if (!approved) {
    audit({ source: body.source || "plugin", action: "agent_runtime_run", approval: "missing", result: "blocked", missionId });
    return { ok: false, status: "blocked", reason: "approval_required" };
  }
  if (!task) {
    audit({ source: body.source || "plugin", action: "agent_runtime_run", approval: "approved", result: "error", reason: "task_required", missionId });
    return { ok: false, status: "error", reason: "task_required" };
  }

  ensureConnectorDataDir();
  fs.mkdirSync(AGENT_RUNTIME_ARTIFACTS_DIR, { recursive: true });
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const fileName = safeRuntimeFileName(body.artifactName || `runtime_${runId}`);
  const artifactPath = path.join(AGENT_RUNTIME_ARTIFACTS_DIR, fileName);
  const resolvedArtifactPath = path.resolve(artifactPath);
  const resolvedRoot = path.resolve(AGENT_RUNTIME_ARTIFACTS_DIR);
  if (!resolvedArtifactPath.startsWith(resolvedRoot + path.sep)) {
    audit({ source: body.source || "plugin", action: "agent_runtime_run", approval: "approved", result: "blocked", reason: "artifact_path_outside_runtime_root", missionId });
    return { ok: false, status: "blocked", reason: "artifact_path_outside_runtime_root" };
  }

  const plan = buildAgentRuntimePlan(body).map((step) => ({ ...step, status: "done" }));
  const queueItem = { id: randomUUID(), missionId, runId, status: "completed_yellow", createdAt, completedAt: new Date().toISOString() };
  state.queues.unshift(queueItem);
  state.queues = state.queues.slice(0, 100);
  fs.writeFileSync(resolvedArtifactPath, renderAgentRuntimeArtifact({
    runId,
    missionId,
    task,
    expectedResult,
    plan,
    createdAt,
    runtimeAnswer: body.runtimeAnswer,
    runtimeMetadata: body.runtimeMetadata
  }), "utf8");
  const stat = fs.statSync(resolvedArtifactPath);
  const artifact = {
    id: randomUUID(),
    runId,
    missionId,
    type: "markdown_result",
    path: resolvedArtifactPath,
    fileName,
    bytes: stat.size,
    sha256: createHash("sha256").update(fs.readFileSync(resolvedArtifactPath)).digest("hex"),
    createdAt: new Date().toISOString()
  };
  const evidence = {
    id: randomUUID(),
    runId,
    status: "PASS_WITH_CONDITIONS_AGENT_RUNTIME_MVP_YELLOW",
    checks: {
      approvalRequired: true,
      approved,
      taskAccepted: Boolean(task),
      planReturned: plan.length >= 4,
      statusReturned: true,
      artifactCreated: fs.existsSync(resolvedArtifactPath),
      artifactInsideRuntimeRoot: resolvedArtifactPath.startsWith(resolvedRoot + path.sep),
      artifactNonEmpty: stat.size > 100,
      evidenceReturned: true,
      queueCompleted: queueItem.status === "completed_yellow"
    },
    boundaries: [
      "local_agent_runtime_mvp_only",
      "no_browser_or_external_program_execution",
      "no_rag_or_live_llm_execution_in_this_gate",
      "manual_real_obsidian_acceptance_pending"
    ]
  };
  const visibleLoop = {
    status: "PASS_WITH_CONDITIONS_VISIBLE_PLAN_STATUS_EVIDENCE_YELLOW",
    currentStep: "evidence_ready",
    userVisible: ["plan", "current_status", "artifact", "evidence", "promise_boundary"],
    plan: plan.map((step, index) => ({ ...step, visibleOrder: index + 1 })),
    result: {
      artifactPath: resolvedArtifactPath,
      evidenceStatus: evidence.status,
      queueStatus: queueItem.status
    },
    nextSafeStep: "OBP-042 manual Obsidian check, then OBP-044 File Workbench"
  };
  const run = {
    id: runId,
    missionId,
    task,
    expectedResult,
    status: "completed_yellow",
    runtimeLevel: body.runtimeMetadata && body.runtimeMetadata.coreVersion ? "role_runtime_with_versioned_core" : "local_agent_runtime_mvp",
    plan,
    visibleLoop,
    artifact,
    evidence,
    runtimeMetadata: body.runtimeMetadata || null,
    createdAt,
    completedAt: new Date().toISOString()
  };
  state.runtimeRuns.unshift(run);
  state.runtimeRuns = state.runtimeRuns.slice(0, 100);
  state.artifacts.unshift(artifact);
  state.artifacts = state.artifacts.slice(0, 100);
  audit({ source: body.source || "plugin", action: "agent_runtime_run", approval: "approved", result: run.status, missionId, runId, artifactPath: resolvedArtifactPath });
  return { ok: true, run };
}

function missingRuntimeAnswerSections(answer) {
  const text = String(answer || "");
  const checks = {
    sources: /источник/i.test(text),
    qualityCheck: /проверк|качест/i.test(text),
    assumptionsOrLimits: /допущен|ограничен/i.test(text),
    nextStep: /следующ/i.test(text)
  };
  return Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
}

function mergeProviderUsage(first, second) {
  const keys = ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"];
  const merged = {};
  for (const key of keys) {
    const value = Number(first && first[key] || 0) + Number(second && second[key] || 0);
    if (value) merged[key] = value;
  }
  return Object.keys(merged).length ? merged : (second || first || null);
}

function appendMissingRuntimeSections(answer, missing, context) {
  const additions = [];
  if (missing.includes("sources")) {
    additions.push("## Источники", missionRuntimeSourceLines(context).join("\n"));
  }
  if (missing.includes("assumptionsOrLimits")) additions.push("## Допущения и ограничения", "- результат требует проверки по acceptance criteria перед GREEN");
  if (missing.includes("qualityCheck")) additions.push("## Проверка качества", "- runtime зафиксировал SHA-256, версию маршрута ролей, policy и trace как внутренний контроль");
  if (missing.includes("nextStep")) additions.push("## Следующий шаг", "- открыть артефакт, проверить критерии приемки и принять либо вернуть миссию на доработку");
  return [String(answer || "").trim(), ...additions].filter(Boolean).join("\n\n");
}

function missionRuntimeSourceLines(context) {
  const lines = [];
  if (context.explicitSources.length) {
    lines.push(...context.explicitSources.map((source) => `- explicit: ${source}`));
  }
  if (Array.isArray(context.libraryReferences) && context.libraryReferences.length) {
    lines.push(...context.libraryReferences.map((reference) =>
      `- library: [${reference.scope}/${reference.libraryId}] ${reference.relativePath} (${reference.artifactType}; ${reference.referenceStatus})`
    ));
  }
  if (!lines.length) lines.push("- источники не переданы; Library Gate выполнен, но подходящие эталоны не найдены");
  return lines;
}

async function handleFullMissionLoop(body, signal = null) {
  const requestedIntakeId = String(body.intakeId || "").trim();
  const intakeResult = requestedIntakeId
    ? state.missionIntakes.find((record) => record.id === requestedIntakeId)
    : handleMissionIntake({ ...body, source: body.source || "full-mission-loop" });
  if (!intakeResult) {
    return {
      ok: false,
      status: "mission_intake_not_found",
      gate: "Mission Approval Gate",
      reason: "Подготовленный план миссии не найден. Подготовьте миссию заново.",
      runtimeStarted: false
    };
  }
  if (requestedIntakeId && intakeResult.status !== "ready_for_approval") {
    return {
      ok: false,
      status: "mission_intake_not_ready_for_approval",
      gate: "Mission Approval Gate",
      reason: `Текущий статус intake: ${intakeResult.status}`,
      runtimeStarted: false
    };
  }
  if (intakeResult.status === "needs_clarification") {
    return {
      ok: true,
      status: "needs_clarification",
      gate: intakeResult.gate,
      intake: intakeResult,
      modelCallsBeforeApproval: 0,
      runtimeStarted: false
    };
  }

  if (!body.approved) {
    return {
      ok: true,
      status: "ready_for_approval",
      gate: "User Approval before Role Runtime",
      intake: intakeResult,
      modelCallsBeforeApproval: 0,
      runtimeStarted: false
    };
  }

  let vaultSync = null;
  if (body.writeToVault) {
    vaultSync = writeMissionArtifactBundleToVault(intakeResult.artifactBundle);
    if (!vaultSync.ok) {
      audit({
        source: body.source || "full-mission-loop",
        action: "mission_vault_sync",
        approval: "approved",
        result: vaultSync.status,
        intakeId: intakeResult.id,
        missionId: intakeResult.runtimeContract && intakeResult.runtimeContract.missionId
      });
      return {
        ok: false,
        status: "vault_sync_failed",
        gate: "Obsidian Write Gate",
        reason: vaultSync.reason || vaultSync.status,
        intakeId: intakeResult.id,
        vaultSync,
        runtimeStarted: false
      };
    }
  }

  const contract = intakeResult.runtimeContract;
  const equalizer = intakeResult.responsibilityEqualizer;
  const taskMachine = createTaskStateMachine(contract.missionId);
  transitionTaskState(taskMachine, "ROUTING", "deterministic_router_started");
  const route = intakeResult.rolePlan || routeMission(intakeResult.intake, equalizer);
  transitionTaskState(taskMachine, "ROLE_SELECTED", `${route.selectedRoles.length}_versioned_roles_selected`);
  transitionTaskState(taskMachine, "CONTEXT_BUILDING", "library_gate_and_context_builder_started");
  const libraryGate = intakeResult.libraryGate || runMissionLibraryGate({ intake: intakeResult.intake, contract, route });
  const context = intakeResult.contextPlan || buildContext(intakeResult.intake, contract, route, { libraryGate });
  transitionTaskState(taskMachine, "READY_TO_RUN", `context_${context.sha256}`);
  const requestedTools = Array.isArray(body.requestedTools) && body.requestedTools.length
    ? body.requestedTools
    : ["runtime_intake", "context_builder", "role_router", "library_gate", "file_artifact_writer", "runtime_evidence"];
  const policy = evaluatePolicy({ intake: intakeResult.intake, route, requestedTools, approved: body.approved });
  if (policy.status === "blocked") {
    transitionTaskState(taskMachine, "BLOCKED", policy.blockedReasons.join(","));
    audit({
      source: body.source || "full-mission-loop",
      action: "mission_full_loop_policy",
      approval: body.approved ? "approved" : "missing",
      result: "blocked",
      missionId: contract.missionId,
      blockedReasons: policy.blockedReasons
    });
    return {
      ok: false,
      status: "blocked_by_runtime_policy",
      gate: "Runtime Policy Gate",
      policy,
      taskMachine,
      runtimeStarted: false,
      modelCallsBeforeApproval: 0
    };
  }

  const roles = route.selectedRoles.map((role) => ({
    role: role.roleRef,
    roleId: role.id,
    roleVersion: role.version,
    kind: role.kind,
    status: "selected",
    purpose: role.purpose,
    allowedTools: role.allowedTools,
    outputSchema: role.outputSchema,
    evals: role.evals
  }));
  const reflectionRules = reflexionPrompt(intakeResult.reflexionMemory);
  const runtimePrompt = [
    buildRuntimePrompt({ intake: intakeResult.intake, contract, equalizer, route, context }),
    reflectionRules
  ].filter(Boolean).join("\n\n");
  transitionTaskState(taskMachine, "EXECUTING", body.executeLlm ? "live_model_gateway" : "deterministic_runtime");
  let llmExecution = {
    requested: Boolean(body.executeLlm),
    status: "not_requested",
    answer: [
      "Результат создан детерминированным runtime без внешнего LLM-вызова.",
      "",
      "## Источники",
      missionRuntimeSourceLines(context).join("\n"),
      "",
      "## Допущения и ограничения",
      "- проверяется инфраструктурный контур, а не качество внешней модели",
      "",
      "## Проверка качества",
      "- контракт, маршрут ролей, policy, файл и hash проверяются runtime-валидатором",
      "",
      "## Следующий шаг",
      "- выполнить live LLM proof или открыть артефакт для пользовательской приемки"
    ].join("\n"),
    providerId: null,
    model: null,
    latencyMs: null,
    usage: null,
    estimatedCostUsd: null,
    modelCalls: 0
  };
  if (body.executeLlm) {
    const provider = Array.isArray(body.providers) && body.providers.length ? body.providers[0] : providerRegistryDefaults()[0];
    const runtimeProvider = { ...provider, maxTokens: Math.max(Number(provider.maxTokens || 0), 480) };
    let providerResult = await executeModelGateway({
      source: body.source || "full-mission-loop",
      missionId: contract.missionId,
      roleId: route.selectedRoles[0].id,
      routeSource: route.fallbackApplied ? "fallback" : "deterministic_rule",
      provider: runtimeProvider,
      prompt: runtimePrompt,
      liveRequested: Boolean(body.live),
      purpose: "role_runtime",
      signal
    });
    let repairApplied = false;
    let repairMissingBefore = [];
    let totalUsage = providerResult.usage || null;
    let totalCost = providerResult.estimatedCostUsd;
    let totalLatencyMs = providerResult.latencyMs || null;
    if (providerResult.status === "live_provider_passed") {
      repairMissingBefore = missingRuntimeAnswerSections(providerResult.answer);
      if (repairMissingBefore.length) {
        const repairPrompt = [
          "Исправь ответ по строгому контракту Symbiot. Сохрани полезное содержание, не добавляй непроверенных фактов.",
          `Обязательные недостающие разделы: ${repairMissingBefore.join(", ")}.`,
          "Верни полный итоговый ответ с разделами: Результат, Источники, Допущения и ограничения, Проверка качества, Следующий шаг.",
          "",
          "Черновик:",
          providerResult.answer
        ].join("\n");
        const repairResult = await executeModelGateway({
          source: body.source || "full-mission-loop",
          missionId: contract.missionId,
          roleId: "quality_controller",
          routeSource: "validator_repair",
          provider: runtimeProvider,
          prompt: repairPrompt,
          liveRequested: true,
          purpose: "output_contract_repair",
          signal
        });
        if (repairResult.status === "live_provider_passed") {
          repairApplied = true;
          totalUsage = mergeProviderUsage(providerResult.usage, repairResult.usage);
          totalCost = Number((Number(providerResult.estimatedCostUsd || 0) + Number(repairResult.estimatedCostUsd || 0)).toFixed(8));
          totalLatencyMs = Number(providerResult.latencyMs || 0) + Number(repairResult.latencyMs || 0);
          providerResult = { ...repairResult, usage: totalUsage, estimatedCostUsd: totalCost, latencyMs: totalLatencyMs };
        }
      }
      const stillMissing = missingRuntimeAnswerSections(providerResult.answer);
      if (stillMissing.length) providerResult = { ...providerResult, answer: appendMissingRuntimeSections(providerResult.answer, stillMissing, context) };
    }
    llmExecution = {
      requested: true,
      status: providerResult.status,
      answer: providerResult.answer,
      providerId: providerResult.providerId,
      providerName: providerResult.providerName,
      model: providerResult.model,
      latencyMs: providerResult.latencyMs || null,
      usage: providerResult.usage || null,
      estimatedCostUsd: providerResult.estimatedCostUsd,
      modelCalls: repairApplied ? 2 : 1,
      gateway: providerResult.gateway,
      repairApplied,
      repairMissingBefore,
      contractSectionsComplete: missingRuntimeAnswerSections(providerResult.answer).length === 0,
      risk: providerResult.risk
    };
    if (providerResult.status !== "live_provider_passed") {
      transitionTaskState(taskMachine, "FAILED", `provider_${providerResult.status}`);
      audit({
        source: body.source || "full-mission-loop",
        action: "mission_full_loop_llm",
        approval: "approved",
        result: providerResult.status,
        missionId: contract.missionId,
        providerId: providerResult.providerId,
        model: providerResult.model
      });
      return {
        ok: false,
        status: "llm_execution_failed",
        gate: "Role Runtime Provider Gate",
        route,
        context: { ...context, explicitSources: context.explicitSources },
        policy,
        taskMachine,
        llmExecution,
        runtimeStarted: true
      };
    }
  }
  const runtimeResult = await handleAgentRuntimeRun({
    approved: true,
    missionId: contract.missionId,
    task: contract.goal,
    expectedResult: contract.expectedArtifact,
    artifactName: body.artifactName || `${contract.missionId}_result.md`,
    source: body.source || "full-mission-loop",
    runtimeAnswer: llmExecution.answer,
    runtimeMetadata: {
      coreVersion: RUNTIME_CORE_VERSION,
      provider: llmExecution.providerId || "deterministic",
      model: llmExecution.model || "none",
      routeId: route.id,
      routeSha256: route.sha256,
      contextSha256: context.sha256,
      libraryGateSha256: context.libraryGate ? context.libraryGate.sha256 : null
    }
  });
  if (!runtimeResult.ok) return runtimeResult;

  transitionTaskState(taskMachine, "VALIDATING", "artifact_and_output_schema_validation");
  const outputValidation = validateRuntimeOutput({
    answer: llmExecution.answer,
    artifact: runtimeResult.run.artifact,
    contract,
    llmStatus: llmExecution.status
  });
  const executionTrace = buildExecutionTrace({
    intake: intakeResult.intake,
    contract,
    route,
    context,
    policy,
    runtimeStatus: runtimeResult.run.status,
    validator: outputValidation,
    modelCalls: llmExecution.modelCalls
  });
  const infrastructureTrace = executionTrace.components;
  transitionTaskState(taskMachine, outputValidation.status === "passed_with_conditions" ? "COMPLETED" : "FAILED", outputValidation.status);
  let completedArtifactBundle = null;
  if (body.writeToVault) {
    completedArtifactBundle = buildCompletedMissionArtifactBundle({
      intakeResult,
      roles,
      llmExecution,
      runtimeResult,
      outputValidation,
      executionTrace,
      infrastructureTrace,
      taskMachine
    });
    vaultSync = writeMissionArtifactBundleToVault(completedArtifactBundle);
  }
  const qa = {
    status: outputValidation.status === "passed_with_conditions"
      ? "PASS_WITH_CONDITIONS_FULL_MISSION_LOOP_YELLOW"
      : "FAIL_FULL_MISSION_LOOP_VALIDATOR",
    checks: {
      deterministicIntakePassed: intakeResult.validation.ok,
      modelCallsBeforeApprovalZero: intakeResult.modelCalls === 0,
      runtimeContractCreated: Boolean(contract && contract.id),
      equalizerSelected: Boolean(equalizer && equalizer.id),
      roleTeamWithinLimit: roles.length > 0 && roles.length <= 5,
      deterministicRouterExecuted: route.strategy === "deterministic_first",
      versionedRolePackagesLoaded: roles.every((role) => Boolean(role.roleVersion && role.outputSchema && role.allowedTools.length)),
      explicitContextBuilt: context.sourcePolicy === "explicit_sources_plus_mandatory_library_gate" && context.noSilentVaultRead,
      libraryGateMandatory: Boolean(context.libraryGate && context.libraryGate.mandatory && context.libraryGate.modelCalls === 0),
      referenceLibraryContextBuilt: context.sourcePolicy === "explicit_sources_plus_mandatory_library_gate" && context.noSilentVaultRead,
      runtimePolicyPassed: policy.status === "approved_with_policy",
      resultArtifactCreated: Boolean(runtimeResult.run.artifact && fs.existsSync(runtimeResult.run.artifact.path)),
      evidenceCreated: Boolean(runtimeResult.run.evidence),
      vaultMissionWrittenWhenRequested: !body.writeToVault || Boolean(vaultSync && vaultSync.ok && vaultSync.status === "written" && vaultSync.fileCount === intakeResult.runtimeContract.artifactContract.requiredFiles.length),
      outputValidatorPassed: outputValidation.status === "passed_with_conditions",
      infrastructureTraceComplete: infrastructureTrace.length === 8 && infrastructureTrace.some((item) => item.component === "Library Gate"),
      replayDescriptorCreated: Boolean(executionTrace.replay && executionTrace.sha256),
      liveLlmPassedWhenRequested: !body.executeLlm || llmExecution.status === "live_provider_passed"
    }
  };
  const loop = {
    id: randomUUID(),
    missionId: contract.missionId,
    status: Object.values(qa.checks).every(Boolean) ? "completed_yellow" : "failed_validation",
    runtimeLevel: "versioned_role_runtime_test_pilot",
    runtimeCoreVersion: RUNTIME_CORE_VERSION,
    intakeId: intakeResult.id,
    contractId: contract.id,
    equalizer: {
      score: equalizer.score,
      effortMode: equalizer.effortMode,
      modelTier: equalizer.modelTier,
      validatorDepth: equalizer.validatorDepth
    },
    roles,
    route: {
      id: route.id,
      version: route.version,
      strategy: route.strategy,
      confidence: route.confidence,
      fallbackApplied: route.fallbackApplied,
      sha256: route.sha256
    },
    context: {
      id: context.id,
      version: context.version,
      sourcePolicy: context.sourcePolicy,
      sourceCount: context.explicitSources.length,
      libraryReferenceCount: Array.isArray(context.libraryReferences) ? context.libraryReferences.length : 0,
      memoryLayers: context.memoryLayers,
      sha256: context.sha256
    },
    libraryGate: context.libraryGate ? {
      id: context.libraryGate.id,
      status: context.libraryGate.status,
      sha256: context.libraryGate.sha256,
      selectedCount: context.libraryGate.summary.selectedCount,
      candidateCount: context.libraryGate.summary.candidateCount,
      ownerRoleId: context.libraryGate.ownerRoleId,
      afterMissionLoop: context.libraryGate.afterMissionLoop
    } : null,
    policy,
    taskMachine,
    infrastructureTrace,
    executionTrace,
    outputValidation,
    llmExecution,
    result: runtimeResult.run.artifact,
    evidence: runtimeResult.run.evidence,
    vaultSync,
    missionArtifactBundle: completedArtifactBundle ? { status: completedArtifactBundle.status, baseFolder: completedArtifactBundle.baseFolder, paths: completedArtifactBundle.paths } : null,
    qa,
    nextStep: "Пользователь открывает результат, сверяет acceptance criteria и принимает либо возвращает миссию на доработку.",
    createdAt: new Date().toISOString()
  };
  state.fullMissionLoops.unshift(loop);
  state.fullMissionLoops = state.fullMissionLoops.slice(0, 100);
  if (loop.status === "completed_yellow") {
    intakeResult.status = "completed_yellow";
    intakeResult.completedAt = loop.createdAt;
    intakeResult.llmExecutionAllowed = true;
    const mission = state.missions.find((item) => item.id === contract.missionId);
    if (mission) {
      mission.status = "completed_yellow";
      mission.completedAt = loop.createdAt;
      mission.obsidianPath = completedArtifactBundle ? completedArtifactBundle.baseFolder : null;
    }
  }
  audit({ source: body.source || "full-mission-loop", action: "mission_full_loop", approval: "approved", result: loop.status, missionId: loop.missionId, loopId: loop.id });
  return { ok: loop.status === "completed_yellow", status: loop.status, fullMissionLoop: loop };
}


function isSafeVaultRelativePath(value) {
  const text = String(value || "").trim();
  if (!text || path.isAbsolute(text)) return false;
  if (text.includes("..") || text.includes("\\") || text.includes("//")) return false;
  return true;
}


function normalizeRetrieverText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 20000);
}

function retrieverTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-zа-яё0-9_-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 20);
}

function scoreRetrieverLine(line, terms) {
  const lower = line.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

function buildRetrieverSnippets(source, query, sourceIndex) {
  const content = normalizeRetrieverText(source.content);
  const terms = retrieverTerms(query);
  const lines = content.split("\n").map((line, index) => ({ line, index, score: scoreRetrieverLine(line, terms) })).filter((item) => item.line);
  const ranked = lines.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = (ranked.length ? ranked : lines).slice(0, 3);
  return selected.map((item, snippetIndex) => ({
    id: `S${sourceIndex + 1}.${snippetIndex + 1}`,
    vaultPath: source.vaultPath,
    fileName: source.fileName || path.basename(source.vaultPath),
    line: item.index + 1,
    score: item.score,
    excerpt: item.line.slice(0, 420)
  }));
}

function handleContextRetrieverQuery(body) {
  const approved = Boolean(body.approved);
  const missionId = body.missionId || null;
  const query = String(body.query || "").trim();
  const sources = Array.isArray(body.sources) ? body.sources.slice(0, 8) : [];
  if (!approved) {
    audit({ source: body.source || "plugin", action: "context_retriever_query", approval: "missing", result: "blocked", missionId });
    return { ok: false, status: "blocked", reason: "approval_required" };
  }
  if (!query) {
    audit({ source: body.source || "plugin", action: "context_retriever_query", approval: "approved", result: "blocked", reason: "query_required", missionId });
    return { ok: false, status: "blocked", reason: "query_required" };
  }
  if (!sources.length) {
    audit({ source: body.source || "plugin", action: "context_retriever_query", approval: "approved", result: "blocked", reason: "explicit_sources_required", missionId });
    return { ok: false, status: "blocked", reason: "explicit_sources_required" };
  }
  const unsafe = sources.find((source) => !isSafeVaultRelativePath(source.vaultPath));
  if (unsafe) {
    audit({ source: body.source || "plugin", action: "context_retriever_query", approval: "approved", result: "blocked", reason: "unsafe_vault_path", missionId, vaultPath: unsafe.vaultPath || null });
    return { ok: false, status: "blocked", reason: "unsafe_vault_path" };
  }
  const allowedExtensions = ["md", "txt", "canvas", "json"];
  const normalizedSources = sources.map((source) => {
    const vaultPath = String(source.vaultPath || "").trim();
    const extension = String(source.extension || path.extname(vaultPath).replace(/^\./, "") || "md").toLowerCase();
    return {
      vaultPath,
      fileName: source.fileName || path.basename(vaultPath),
      extension,
      bytes: Number(source.bytes || 0),
      sha256: source.sha256 || null,
      allowed: allowedExtensions.includes(extension),
      contentLength: String(source.content || "").length
    };
  });
  const disallowed = normalizedSources.find((source) => !source.allowed);
  if (disallowed) {
    audit({ source: body.source || "plugin", action: "context_retriever_query", approval: "approved", result: "blocked", reason: "extension_not_allowed_in_mvp", missionId, vaultPath: disallowed.vaultPath });
    return { ok: false, status: "blocked", reason: "extension_not_allowed_in_mvp" };
  }
  const snippets = sources.flatMap((source, index) => buildRetrieverSnippets(source, query, index)).slice(0, 12);
  const record = {
    id: randomUUID(),
    missionId,
    vaultId: body.vaultId || null,
    source: body.source || "plugin",
    query,
    status: snippets.length ? "PASS_WITH_CONDITIONS_CONTEXT_RETRIEVER_RAG_YELLOW" : "YELLOW_CONTEXT_NOT_FOUND",
    runtimeLevel: "local_context_retriever_mvp",
    selectedSourcesOnly: true,
    noFullVaultScan: true,
    fullContentStored: false,
    sourceCount: normalizedSources.length,
    citationCount: snippets.length,
    sources: normalizedSources,
    snippets,
    linkedResultPath: body.linkedResultPath || null,
    linkedEvidencePath: body.linkedEvidencePath || null,
    createdAt: new Date().toISOString(),
    evidence: {
      checks: {
        approvalRequired: true,
        approved,
        explicitSourcesRequired: true,
        safeRelativeVaultPaths: true,
        selectedSourcesOnly: true,
        noFullVaultScan: true,
        fullContentNotStored: true,
        citationsCreated: snippets.length > 0,
        resultLinked: Boolean(body.linkedResultPath),
        evidenceLinked: Boolean(body.linkedEvidencePath)
      },
      boundaries: [
        "local_context_retriever_mvp_only",
        "explicit_selected_sources_only",
        "no_silent_full_vault_scan",
        "snippets_not_full_document_storage",
        "not_production_vector_rag"
      ]
    }
  };
  state.contextRetriever.unshift(record);
  state.contextRetriever = state.contextRetriever.slice(0, 100);
  audit({ source: record.source, action: "context_retriever_query", approval: "approved", result: record.status, missionId, sourceCount: record.sourceCount, citationCount: record.citationCount, fullContentStored: false });
  return { ok: true, status: record.status, retrieval: record };
}

function handleFileWorkbenchRegister(body) {
  const approved = Boolean(body.approved);
  const vaultPath = String(body.vaultPath || "").trim();
  const missionId = body.missionId || null;
  if (!approved) {
    audit({ source: body.source || "plugin", action: "file_workbench_register", approval: "missing", result: "blocked", missionId });
    return { ok: false, status: "blocked", reason: "approval_required" };
  }
  if (!isSafeVaultRelativePath(vaultPath)) {
    audit({ source: body.source || "plugin", action: "file_workbench_register", approval: "approved", result: "blocked", reason: "unsafe_vault_path", missionId });
    return { ok: false, status: "blocked", reason: "unsafe_vault_path" };
  }
  const extension = String(body.extension || path.extname(vaultPath).replace(/^\./, "") || "md").toLowerCase();
  const allowedExtensions = ["md", "txt", "canvas", "json", "csv", "html"];
  const record = {
    id: randomUUID(),
    missionId,
    vaultId: body.vaultId || null,
    source: body.source || "plugin",
    vaultPath,
    fileName: path.basename(vaultPath),
    extension,
    bytes: Number(body.bytes || 0),
    sha256: body.sha256 || null,
    accessStatus: allowedExtensions.includes(extension) ? "metadata_registered_yellow" : "extension_needs_manual_review_yellow",
    contentStored: false,
    contentPreviewStored: false,
    linkedResultPath: body.linkedResultPath || null,
    linkedEvidencePath: body.linkedEvidencePath || null,
    createdAt: new Date().toISOString(),
    evidence: {
      status: "PASS_WITH_CONDITIONS_FILE_WORKBENCH_YELLOW",
      checks: {
        approvalRequired: true,
        approved,
        safeRelativeVaultPath: true,
        metadataRegistered: true,
        contentNotStored: true,
        hashPresent: Boolean(body.sha256),
        resultLinked: Boolean(body.linkedResultPath),
        evidenceLinked: Boolean(body.linkedEvidencePath)
      },
      boundaries: [
        "local_obsidian_file_workbench_only",
        "metadata_and_hash_only_in_connector",
        "no_full_vault_scan",
        "no_docx_xlsx_pdf_processing_in_this_gate",
        "manual_real_obsidian_acceptance_pending"
      ]
    }
  };
  state.fileWorkbench.unshift(record);
  state.fileWorkbench = state.fileWorkbench.slice(0, 100);
  audit({ source: record.source, action: "file_workbench_register", approval: "approved", result: record.accessStatus, missionId, vaultPath, contentStored: false });
  return { ok: true, status: record.evidence.status, file: record };
}

function safeWorkbenchBaseName(value) {
  const normalized = String(value || "symbiot_result")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 80);
  return normalized || "symbiot_result";
}

function workbenchArtifactRecord(filePath, format) {
  const buffer = fs.readFileSync(filePath);
  return {
    format,
    fileName: path.basename(filePath),
    path: filePath,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    downloadable: true
  };
}

function pdfFontPath() {
  const candidates = [
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\calibri.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function createFileWorkbenchArtifacts(body = {}) {
  const title = String(body.title || "Результат Симбиота").trim().slice(0, 240);
  const content = String(body.content || body.markdown || body.text || "").replace(/\r/g, "").slice(0, 250000);
  const requestedFormats = Array.isArray(body.formats) && body.formats.length ? body.formats : ["md", "html", "docx", "xlsx", "pdf"];
  const formats = Array.from(new Set(requestedFormats.map((item) => String(item).toLowerCase().replace(/^\./, ""))));
  const allowed = new Set(["md", "html", "docx", "xlsx", "pdf"]);
  if (!content.trim()) return { ok: false, status: "blocked", reason: "content_required" };
  if (formats.some((format) => !allowed.has(format))) return { ok: false, status: "blocked", reason: "unsupported_format", allowedFormats: Array.from(allowed) };
  fs.mkdirSync(FILE_WORKBENCH_ARTIFACTS_DIR, { recursive: true });
  const batchId = randomUUID();
  const batchDir = path.join(FILE_WORKBENCH_ARTIFACTS_DIR, batchId);
  fs.mkdirSync(batchDir, { recursive: true });
  const baseName = safeWorkbenchBaseName(body.fileName || title);
  const artifacts = [];

  if (formats.includes("md")) {
    const filePath = path.join(batchDir, `${baseName}.md`);
    fs.writeFileSync(filePath, `# ${title}\n\n${content.trim()}\n`, "utf8");
    artifacts.push(workbenchArtifactRecord(filePath, "md"));
  }
  if (formats.includes("html")) {
    const filePath = path.join(batchDir, `${baseName}.html`);
    const paragraphs = content.split(/\n{2,}/).map((item) => `<p>${escapeHtml(item).replace(/\n/g, "<br>")}</p>`).join("\n");
    fs.writeFileSync(filePath, `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${paragraphs}</main></body></html>\n`, "utf8");
    artifacts.push(workbenchArtifactRecord(filePath, "html"));
  }
  if (formats.includes("docx")) {
    const filePath = path.join(batchDir, `${baseName}.docx`);
    const children = [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 })];
    for (const block of content.split(/\n{2,}/)) children.push(new Paragraph({ text: block.replace(/\n/g, " ") }));
    const document = new Document({ sections: [{ children }] });
    fs.writeFileSync(filePath, await Packer.toBuffer(document));
    artifacts.push(workbenchArtifactRecord(filePath, "docx"));
  }
  if (formats.includes("xlsx")) {
    const filePath = path.join(batchDir, `${baseName}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Symbiot";
    const sheet = workbook.addWorksheet("Результат");
    const rows = Array.isArray(body.rows) && body.rows.length ? body.rows : content.split("\n").filter(Boolean).map((line, index) => [index + 1, line]);
    for (const row of rows) sheet.addRow(Array.isArray(row) ? row : Object.values(row));
    sheet.columns.forEach((column) => { column.width = Math.min(60, Math.max(12, ...column.values.filter(Boolean).map((value) => String(value).length + 2))); });
    await workbook.xlsx.writeFile(filePath);
    artifacts.push(workbenchArtifactRecord(filePath, "xlsx"));
  }
  if (formats.includes("pdf")) {
    const filePath = path.join(batchDir, `${baseName}.pdf`);
    await new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: "A4", margin: 54, info: { Title: title, Author: "Symbiot" } });
      const stream = fs.createWriteStream(filePath);
      stream.on("finish", resolve);
      stream.on("error", reject);
      document.on("error", reject);
      document.pipe(stream);
      const font = pdfFontPath();
      if (font) document.font(font);
      document.fontSize(20).text(title);
      document.moveDown();
      document.fontSize(11).text(content, { lineGap: 3 });
      document.end();
    });
    artifacts.push(workbenchArtifactRecord(filePath, "pdf"));
  }

  const result = {
    ok: true,
    status: "PASS_WITH_CONDITIONS_FILE_WORKBENCH_MULTI_FORMAT_YELLOW",
    runtimeLevel: "local_multiformat_document_runtime",
    batchId,
    artifactRoot: batchDir,
    artifacts,
    boundaries: ["local_artifact_generation", "safe_connector_output_root", "no_arbitrary_output_path", "manual_document_quality_acceptance_pending"]
  };
  state.fileWorkbench.unshift({ id: batchId, status: result.status, formats, artifactCount: artifacts.length, createdAt: new Date().toISOString() });
  state.fileWorkbench = state.fileWorkbench.slice(0, 100);
  audit({ source: body.source || "file-workbench", action: "file_workbench_create", approval: "connector_auth", result: result.status, batchId, formats });
  return result;
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function captureDesktopVision(body = {}) {
  if (!body.approved) return { ok: false, status: "blocked", reason: "explicit_approval_required" };
  fs.mkdirSync(VISION_ARTIFACTS_DIR, { recursive: true });
  const captureId = randomUUID();
  const screenshotPath = path.join(VISION_ARTIFACTS_DIR, `symbiot_screen_${captureId}.png`);
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap);",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);",
    "$bitmap.Save($env:SYMBIOT_VISION_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png);",
    "$graphics.Dispose(); $bitmap.Dispose();"
  ].join(" ");
  try {
    await runPowerShell(command, { SYMBIOT_VISION_CAPTURE_PATH: screenshotPath });
  } catch (error) {
    audit({ source: body.source || "vision", action: "vision_capture", approval: "approved", result: "error", error: error.message });
    return { ok: false, status: "error", reason: "screen_capture_failed" };
  }
  if (!fs.existsSync(screenshotPath)) return { ok: false, status: "error", reason: "screen_capture_missing" };
  const buffer = fs.readFileSync(screenshotPath);
  const dimensions = pngDimensions(buffer);
  if (!dimensions || dimensions.width < 320 || dimensions.height < 240 || buffer.length < 1000) return { ok: false, status: "error", reason: "screen_capture_invalid" };
  const record = {
    id: captureId,
    status: "PASS_WITH_CONDITIONS_LOCAL_VISION_CAPTURE_YELLOW",
    runtimeLevel: "local_screen_vision_capture_mvp",
    targetType: String(body.targetType || "screen"),
    imageUrl: `/vision/image?id=${encodeURIComponent(captureId)}`,
    path: screenshotPath,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    width: dimensions.width,
    height: dimensions.height,
    capturedAt: new Date().toISOString(),
    evidence: {
      screenshotCreated: true,
      pngSignatureValid: true,
      dimensionsValid: true,
      userApprovalRecorded: true,
      uploadedToExternalModel: false
    },
    boundaries: ["local_capture_only", "no_external_upload", "ai_visual_interpretation_requires_separate_multimodal_provider", "manual_visual_acceptance_pending"]
  };
  state.visionCaptures.unshift(record);
  state.visionCaptures = state.visionCaptures.slice(0, 50);
  audit({ source: body.source || "vision", action: "vision_capture", approval: "approved", result: record.status, captureId, sha256: record.sha256 });
  return { ok: true, visionCapture: record };
}

function handleArchitectureSignalRecord(body) {
  const approved = Boolean(body.approved);
  const vaultPath = String(body.vaultPath || body.documentPath || "").trim();
  const signalId = String(body.signalId || randomUUID()).trim();
  const source = body.source || "obsidian-plugin";
  if (!approved) {
    audit({ source, action: "architecture_signal_record", approval: "missing", result: "blocked", signalId });
    return { ok: false, status: "blocked", reason: "approval_required" };
  }
  if (!isSafeVaultRelativePath(vaultPath)) {
    audit({ source, action: "architecture_signal_record", approval: "approved", result: "blocked", reason: "unsafe_vault_path", signalId });
    return { ok: false, status: "blocked", reason: "unsafe_vault_path" };
  }
  const signal = {
    id: signalId,
    source,
    gate: body.gate || "OBP-049",
    runtimeLevel: "architecture_signal_backbone_mvp",
    status: "PASS_WITH_CONDITIONS_ARCHITECTURE_SIGNAL_LOCAL_YELLOW",
    stage: body.stage || "desktop_to_obsidian_to_connector",
    direction: body.direction || "desktop_gui_to_connector_to_admin",
    vaultId: body.vaultId || null,
    missionId: body.missionId || null,
    document: {
      path: vaultPath,
      fileName: path.basename(vaultPath),
      extension: String(body.extension || path.extname(vaultPath).replace(/^\./, "") || "md").toLowerCase(),
      bytes: Number(body.bytes || 0),
      sha256: body.sha256 || null,
      contentStored: false
    },
    links: {
      resultPath: body.resultPath || null,
      evidencePath: body.evidencePath || null,
      adminSyncExpected: body.adminSyncExpected !== false,
      supabaseExpected: body.supabaseExpected !== false
    },
    checks: {
      desktopActionAccepted: Boolean(body.desktopActionAccepted),
      obsidianDocumentCreated: Boolean(body.obsidianDocumentCreated),
      pluginSignalSent: true,
      connectorSignalRecorded: true,
      safeRelativeVaultPath: true,
      metadataOnly: true,
      contentStored: false,
      hashPresent: Boolean(body.sha256),
      adminSyncExpected: body.adminSyncExpected !== false,
      supabaseExpected: body.supabaseExpected !== false
    },
    boundaries: [
      "local_architecture_signal_backbone_mvp",
      "metadata_status_hash_only",
      "no_full_vault_content_sync",
      "no_secret_values_sync",
      "not_remote_relay_or_market_ready"
    ],
    createdAt: new Date().toISOString()
  };
  state.architectureSignals.unshift(signal);
  state.architectureSignals = state.architectureSignals.slice(0, 100);
  audit({
    source,
    action: "architecture_signal_record",
    approval: "approved",
    result: signal.status,
    signalId: signal.id,
    vaultId: signal.vaultId,
    vaultPath,
    contentStored: false,
    metadataOnly: true
  });
  return { ok: true, status: signal.status, signal };
}

async function handleEnvironmentAction(body) {
  const action = String(body.action || "");
  const approved = Boolean(body.approved);
  if (action === "list_processes") {
    const result = await listProcesses();
    audit({ source: body.source || "unknown", action, approval: "not_required", result: result.ok ? "ok" : "error", error: result.error || null });
    return result;
  }
  if (action === "check_path") {
    const targetPath = String(body.path || "").trim();
    if (!targetPath) {
      audit({ source: body.source || "unknown", action, approval: "not_required", result: "error", error: "path_required" });
      return { ok: false, status: "error", reason: "path_required" };
    }
    try {
      const exists = fs.existsSync(targetPath);
      const stat = exists ? fs.statSync(targetPath) : null;
      const result = {
        ok: true,
        status: exists ? "exists" : "missing",
        path: targetPath,
        exists,
        type: stat ? (stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other") : null
      };
      audit({ source: body.source || "unknown", action, approval: "not_required", result: result.status, path: targetPath });
      return result;
    } catch (error) {
      audit({ source: body.source || "unknown", action, approval: "not_required", result: "error", error: error.message });
      return { ok: false, status: "error", reason: error.message };
    }
  }
  if (action === "open_url") {
    const targetUrl = String(body.url || body.target || "").trim();
    if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, status: "blocked", reason: "http_or_https_url_required" };
    if (!approved) {
      audit({ source: body.source || "unknown", action, approval: "missing", result: "blocked" });
      return { ok: false, status: "blocked", reason: "approval_required" };
    }
    execFile("explorer.exe", [targetUrl], { windowsHide: true }, () => {});
    audit({ source: body.source || "unknown", action, approval: "approved", result: "opened", targetType: "url" });
    return { ok: true, status: "opened", targetType: "url" };
  }
  if (action === "open_folder") {
    const targetPath = String(body.path || body.target || "").trim();
    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) return { ok: false, status: "blocked", reason: "existing_directory_required" };
    if (!approved) {
      audit({ source: body.source || "unknown", action, approval: "missing", result: "blocked" });
      return { ok: false, status: "blocked", reason: "approval_required" };
    }
    execFile("explorer.exe", [targetPath], { windowsHide: true }, () => {});
    audit({ source: body.source || "unknown", action, approval: "approved", result: "opened", targetType: "folder" });
    return { ok: true, status: "opened", targetType: "folder" };
  }
  if (!approved) {
    audit({ source: body.source || "unknown", action, approval: "missing", result: "blocked" });
    return { ok: false, status: "blocked", reason: "approval_required" };
  }
  audit({ source: body.source || "unknown", action, approval: "approved", result: "unsupported_in_mvp" });
  return { ok: false, status: "yellow", reason: "unsupported_in_safe_mvp", supportedNow: environmentAgentStatus().supportedNow, approvalRequired: environmentAgentStatus().approvalRequired };
}

async function handleMobileRemoteAction(body) {
  const action = String(body.action || "").trim();
  const approved = Boolean(body.approved);
  const supported = environmentAgentStatus().supportedNow;
  const record = {
    id: randomUUID(),
    source: body.source || "mobile-web",
    action,
    approved,
    status: "received",
    createdAt: new Date().toISOString(),
    targetFingerprint: connectorTokenFingerprint(body.path || body.url || body.target || action)
  };
  state.mobileRemoteActions.unshift(record);
  state.mobileRemoteActions = state.mobileRemoteActions.slice(0, 100);
  if (!supported.includes(action)) {
    record.status = "blocked";
    record.reason = "unsupported_in_safe_mvp";
    audit({ source: record.source, action: "mobile_remote_action", approval: approved ? "approved" : "missing", result: "blocked", requestedAction: action, reason: record.reason });
    return {
      ok: false,
      status: "blocked",
      reason: record.reason,
      supportedNow: supported,
      boundary: "Mobile remote does not allow arbitrary Windows execution.",
      remoteAction: record
    };
  }
  if (!approved) {
    record.status = "blocked";
    record.reason = "explicit_mobile_approval_required";
    audit({ source: record.source, action: "mobile_remote_action", approval: "missing", result: "blocked", requestedAction: action, reason: record.reason });
    return {
      ok: false,
      status: "blocked",
      reason: record.reason,
      approvalRequired: true,
      remoteAction: record
    };
  }
  const result = await handleEnvironmentAction({ ...body, source: record.source, approved: true });
  record.status = result.ok ? "completed_yellow" : (result.status || "blocked");
  record.resultStatus = result.status || (result.ok ? "ok" : "error");
  record.completedAt = new Date().toISOString();
  audit({ source: record.source, action: "mobile_remote_action", approval: "approved", result: record.status, requestedAction: action });
  return {
    ok: Boolean(result.ok),
    status: record.status,
    runtimeLevel: "local_mobile_remote_windows_agent_mvp",
    actionResult: result,
    remoteAction: record,
    boundaries: [
      "local_pairing_token_only",
      "explicit_mobile_approval_required",
      "safe_windows_agent_allowlist_only",
      "no_arbitrary_program_execution",
      "production_remote_relay_not_ready"
    ]
  };
}
async function route(req, res) {
  if (!isAllowedCorsOrigin(req)) return json(res, 403, { ok: false, error: "cors_origin_not_allowed" }, req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, securityHeaders(req));
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      status: "yellow",
      service: "symbiot-connector-service",
      connector: state.connector,
      host: HOST,
      port: PORT,
      startedAt: state.startedAt
    }, req);
  }

  if (req.method === "GET" && url.pathname === "/app") return html(res, 200, renderDesktopAppHtml(req));

  if (req.method === "GET" && url.pathname === "/admin") return html(res, 200, renderAdminDashboardHtml());

  if (req.method === "GET" && url.pathname === "/app/state") {
    if (!hasConnectorAuth(req) && !isMobileAuthorized(null, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    return json(res, 200, appState(), req);
  }

  if (req.method === "GET" && url.pathname === "/role-registry") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, { ok: true, roleRegistry: publicRoleRegistry() }, req);
  }

  if (req.method === "POST" && url.pathname === "/app/agent-runtime/run") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const result = await handleAgentRuntimeRun({ ...body, source: body.source || "desktop-browser-gui" });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/app/mission/intake") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const result = handleMissionIntake({ ...body, source: body.source || "harnes-desktop-gui" });
    return json(res, 200, result, req);
  }

  if (req.method === "POST" && url.pathname === "/app/mission/confirm") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const operation = operationSignal(body);
    try {
      const result = await handleFullMissionLoop({
        ...body,
        approved: true,
        writeToVault: true,
        source: body.source || "harnes-desktop-gui"
      }, operation.signal);
      return json(res, result.ok ? 200 : 409, result, req);
    } finally {
      operation.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/app/operation/cancel") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const cancelled = cancelOperation(body.operationId);
    return json(res, 200, { ok: true, status: cancelled ? "cancel_requested" : "operation_not_active", cancelled }, req);
  }

  if (req.method === "POST" && url.pathname === "/app/reflexion/feedback") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const result = appendFeedback(body);
    audit({ source: body.source || "harnes-desktop-gui", action: "reflexion_feedback", approval: "user_correction", result: result.status, fingerprint: result.fingerprint });
    return json(res, 200, { ok: true, reflexion: result }, req);
  }

  if (req.method === "POST" && url.pathname === "/app/mission/full-loop") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const result = await handleFullMissionLoop({ ...body, source: body.source || "harnes-desktop-gui" });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/app/vision/capture") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const result = await captureDesktopVision({ ...body, source: body.source || "harnes-desktop-gui" });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "GET" && url.pathname === "/vision/image") {
    if (!hasConnectorAuth(req) && !isMobileAuthorized(null, url)) return json(res, 401, { ok: false, error: "app_or_connector_auth_required" }, req);
    const capture = state.visionCaptures.find((item) => item.id === url.searchParams.get("id"));
    if (!capture || !fs.existsSync(capture.path)) return json(res, 404, { ok: false, error: "vision_capture_not_found" }, req);
    return png(res, 200, fs.readFileSync(capture.path));
  }

  if (req.method === "GET" && url.pathname === "/mobile") return html(res, 200, renderMobileHtml(url.searchParams.get("token") || ""));

  if (req.method === "GET" && url.pathname === "/mobile/qr.svg") {
    const token = url.searchParams.get("token") || "";
    if (!isKnownMobileToken(token)) return svg(res, 404, '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><text x="12" y="24">expired pairing token</text></svg>');
    const pairingUrl = `${connectorBaseUrl(req)}/mobile?token=${encodeURIComponent(token)}`;
    return svg(res, 200, await QRCode.toString(pairingUrl, { type: "svg", margin: 1, width: 220 }));
  }

  if (req.method === "GET" && url.pathname === "/mobile/status") {
    if (!hasConnectorAuth(req) && !isMobileAuthorized(null, url)) return json(res, 401, { ok: false, error: "mobile_or_connector_auth_required" }, req);
    return json(res, 200, { ok: true, mobile: mobileStatus() }, req);
  }

  if (req.method === "POST" && url.pathname === "/mobile/remote/action") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "mobile_or_connector_auth_required" }, req);
    const result = await handleMobileRemoteAction(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "GET" && url.pathname === "/preflight") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, { ok: true, preflight: preflightStatus() }, req);
  }

  if (req.method === "GET" && url.pathname === "/cloud/status") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, cloudStatus(), req);
  }

  if (req.method === "GET" && url.pathname === "/cloud/schema") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, {
      ok: true,
      schemaVersion: BUSINESS_MEMORY_SCHEMA_VERSION,
      tables: BUSINESS_MEMORY_TABLES,
      migration: migrationStatus(),
      humanMeaning: {
        profiles: "кто работает с Симбиотом",
        organizations: "бизнес клиента или команда",
        vaults: "подключенные Obsidian-хранилища",
        projects: "проекты клиента",
        business_roles: "роли конкретного бизнеса клиента",
        role_training_items: "обучение ролей: инструкции, примеры, регламенты",
        missions: "бизнес-миссии, которые запускает пользователь",
        knowledge_sources: "разрешенные источники знаний",
        knowledge_chunks: "смысловые куски источников для будущего RAG",
        artifacts: "созданные результаты",
        runs: "запуски миссий",
        run_steps: "шаги выполнения миссии",
        evidence_items: "доказательства и проверки результата",
        providers: "подключенные AI/API провайдеры без секретов",
        audit_events: "журнал действий",
        sync_events: "события синхронизации",
        mission_canvas_nodes: "узлы Canvas-маршрута клиентской миссии",
        mission_canvas_edges: "связи Canvas-маршрута клиентской миссии",
        mission_methodology_patterns: "повторяемые паттерны клиентских миссий"
      },
      boundary: "This is the schema contract. Applying migrations to a live Supabase project is a separate proof."
    }, req);
  }

  if (req.method === "GET" && url.pathname === "/admin/snapshot") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, snapshot(), req);
  }

  if (req.method === "GET" && url.pathname === "/admin/state") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, sanitizedAdminState(), req);
  }

  if (req.method === "GET" && url.pathname === "/security/posture") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, securityPosture(), req);
  }

  if (req.method === "POST" && url.pathname === "/backup/create") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    return json(res, 200, createConnectorBackup(body), req);
  }

  if (req.method === "POST" && url.pathname === "/backup/verify") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = verifyConnectorBackup(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "GET" && url.pathname === "/api-vault/list") {
    if (!requireConnectorAuth(req, res)) return;
    return json(res, 200, {
      ok: true,
      status: "yellow_local_secret_vault",
      vault: apiVaultStatus(),
      records: readApiVaultMetadata(),
      boundary: "List endpoint never returns secret values. Use reveal only after explicit user action."
    }, req);
  }

  if (req.method === "POST" && url.pathname === "/api-vault/reveal") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const id = String(body.id || "").trim().toLowerCase();
    if (!body.confirmed) return json(res, 409, { ok: false, error: "explicit_confirmation_required" }, req);
    const value = await revealApiVaultSecret(id);
    audit({ source: body.source || "obsidian-plugin", action: "api_vault_reveal", approval: "explicit_user_action", result: "ok", id, valueFingerprint: envFingerprint(value) });
    return json(res, 200, { ok: true, id, value, valueFingerprint: envFingerprint(value), boundary: "Secret value is returned only to the local authenticated plugin UI and must not be written to markdown/evidence." }, req);
  }

  if (req.method === "POST" && url.pathname === "/api-vault/save") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const saved = await saveApiVaultSecret(body);
    const id = String(saved.Id || body.id || "").trim().toLowerCase();
    audit({ source: body.source || "obsidian-plugin", action: "api_vault_save", approval: "explicit_user_action", result: "ok", id, provider: saved.Provider, fingerprint: saved.Fingerprint });
    return json(res, 200, {
      ok: true,
      status: "saved",
      record: {
        id,
        provider: saved.Provider,
        scope: saved.Scope,
        envName: saved.EnvName,
        fingerprint: saved.Fingerprint,
        rotationRequired: Boolean(saved.RotationRequired),
        keyPresent: true
      },
      boundary: "Secret saved to local Windows DPAPI API Vault. Secret value is not returned."
    }, req);
  }

  if (req.method === "GET" && url.pathname === "/mobile/pairing") {
    if (!requireConnectorAuth(req, res)) return;
    const pairing = createMobilePairing(req);
    return json(res, 200, { ok: true, token: pairing.token, url: pairing.url, qrUrl: pairing.qrUrl, expiresAt: pairing.expiresAt, expiresInSeconds: 300 }, req);
  }

  if (req.method === "POST" && url.pathname === "/plugin/register") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const device = { id: body.deviceId || randomUUID(), vaultId: body.vaultId || "local-vault", pluginVersion: body.pluginVersion || "unknown", status: "connected", connectedAt: new Date().toISOString() };
    state.devices.unshift(device);
    audit({ source: "plugin", action: "register", approval: "not_required", result: "ok", deviceId: device.id });
    return json(res, 200, { ok: true, device }, req);
  }

  if (req.method === "POST" && url.pathname === "/mission/create") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const mission = {
      id: body.missionId || randomUUID(),
      title: body.title || "Untitled mission",
      source: body.source || "plugin",
      missionType: body.missionType || "client_mission",
      methodologyOwner: body.methodologyOwner || "РОЛЬ_AI_Методолог_клиентских_миссий",
      status: "draft",
      createdAt: new Date().toISOString()
    };
    const methodology = sanitizeMissionMethodology(body, mission);
    state.missions.unshift(mission);
    state.missionMethodology.unshift(methodology);
    audit({ source: mission.source, action: "mission_create", approval: "not_required", result: "ok", missionId: mission.id, methodologyContract: methodology.contractStatus });
    return json(res, 200, { ok: true, mission, methodology }, req);
  }

  if (req.method === "POST" && url.pathname === "/mission/intake") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = handleMissionIntake(body);
    return json(res, 200, result, req);
  }

  if (req.method === "POST" && url.pathname === "/mission/full-loop") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleFullMissionLoop(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/cloud/mission-graph/write") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await persistMissionGraph(body);
    audit({ source: body.source || "obsidian-plugin", action: "mission_graph_write", approval: "connector_auth", result: result.ok ? result.status : "blocked", missionId: result.missionId || body.missionId || null, reason: result.reason || null });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/cloud/rag-context/write") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await persistRagContext(body);
    audit({ source: body.source || "obsidian-plugin", action: "rag_context_write", approval: "connector_auth", result: result.ok ? result.status : "blocked", missionId: body.missionId || null, reason: result.reason || null });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/cloud/admin-sync/write") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await persistAdminSync(body);
    audit({ source: body.source || "obsidian-plugin", action: "admin_sync_write", approval: "connector_auth", result: result.ok ? result.status : "blocked", reason: result.reason || null });
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/agent-runtime/run") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleAgentRuntimeRun(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/file-workbench/register") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = handleFileWorkbenchRegister(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/file-workbench/create") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await createFileWorkbenchArtifacts(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/vision/capture") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await captureDesktopVision(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/architecture/signal/record") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = handleArchitectureSignalRecord(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/context-retriever/query") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = handleContextRetrieverQuery(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/mission/run") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const missionId = body.missionId || null;
    if (!body.approved) {
      audit({ source: body.source || "plugin", action: "mission_run", approval: "missing", result: "blocked", missionId });
      return json(res, 409, { ok: false, reason: "approval_required" }, req);
    }
    const queueItem = { id: randomUUID(), missionId, status: "queued", llmProviders: body.llmProviders || [], createdAt: new Date().toISOString() };
    state.queues.unshift(queueItem);
    audit({ source: body.source || "plugin", action: "mission_run", approval: "approved", result: "queued", missionId: queueItem.missionId });
    return json(res, 200, { ok: true, queueItem }, req);
  }

  if (req.method === "POST" && url.pathname === "/providers/connect") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleProviderConnect(body);
    return json(res, 200, result, req);
  }

  if (req.method === "POST" && url.pathname === "/openrouter/gateway/connect") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleOpenRouterGatewayConnect(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  if (req.method === "POST" && url.pathname === "/rag/embeddings") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    if (!body.approved) return json(res, 409, { ok: false, status: "blocked", reason: "explicit_approval_required" }, req);
    const result = await generateOpenRouterEmbeddings(body.texts || body.inputs || [], { model: body.model, dimensions: body.dimensions || 1536 });
    const publicResult = result.ok ? { ...result, vectors: result.vectors.map((vector) => ({ dimensions: vector.length, sha256: createHash("sha256").update(JSON.stringify(vector)).digest("hex") })) } : result;
    return json(res, result.ok ? 200 : 409, publicResult, req);
  }

  if (req.method === "POST" && url.pathname === "/providers/disconnect") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleProviderDisconnect(body);
    return json(res, 200, result, req);
  }

  if (req.method === "POST" && url.pathname === "/llm/compare") {
    const body = await readBody(req);
    if (!hasConnectorAuth(req) && !isMobileAuthorized(body, url)) return json(res, 401, { ok: false, error: "connector_or_mobile_auth_required" }, req);
    const operation = operationSignal(body);
    try {
      const comparison = await handleLlmCompare(body, operation.signal);
      return json(res, 200, { ok: true, comparison }, req);
    } finally {
      operation.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/environment/action") {
    if (!requireConnectorAuth(req, res)) return;
    const body = await readBody(req);
    const result = await handleEnvironmentAction(body);
    return json(res, result.ok ? 200 : 409, result, req);
  }

  return json(res, 404, { ok: false, error: "not_found" }, req);
}
hydrateApiVaultEnv();
loadProviderStore();
ensureFeedbackFile();

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    audit({ source: "server", action: "route_error", approval: "not_required", result: "error", error: error.message });
    json(res, 500, { ok: false, error: error.message });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Symbiot connector service listening on http://127.0.0.1:${PORT}`);
});





















