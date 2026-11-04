const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.SYMBIOT_PROOF_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_LOGS = path.resolve(ROOT, "runtime_logs");
const DATA_DIR = path.join(RUNTIME_LOGS, "obp010_provider_store");
const KEY_FILE = "D:\\СИСТЕМА\\01.Базы данных\\01_База № 3 (MAC)\\15.03_База № 3 (MAC)\\03_Цифровой_каркас_средства\\Цифровой каркас\\03_API_и_интеграции\\API\\API keys.md";
const PLUGIN_DIR = path.resolve(ROOT, "symbiot-obsidian-plugin");
const PLUGIN_MAIN = path.join(PLUGIN_DIR, "main.js");
const PLUGIN_CSS = path.join(PLUGIN_DIR, "styles.css");
const PLUGIN_MANIFEST = path.join(PLUGIN_DIR, "manifest.json");
const RELEASE_DIR = path.resolve(ROOT, "release", "SYM_OBSIDIAN_PLUGIN_PRE_RELEASE_2026-07-16");
const RELEASE_ZIP = path.resolve(ROOT, "release", "SYM_OBSIDIAN_PLUGIN_PRE_RELEASE_2026-07-16.zip");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findDeepSeekKey() {
  const lines = fs.readFileSync(KEY_FILE, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/deep\s*seek|deepseek|deepsig/i.test(lines[index])) {
      const window = lines.slice(index, index + 9).join("\n");
      const match = window.match(/sk-[A-Za-z0-9_\-]{20,}/);
      if (match) return match[0];
    }
  }
  throw new Error("deepseek_key_not_found");
}

async function request(method, route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: requestHeaders(body),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (error) { json = { parseError: error.message, raw: text }; }
  return { ok: response.ok, status: response.status, json };
}

async function startConnector() {
  const child = spawn(process.execPath, [path.resolve(__dirname, "server.js")], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(PORT), SYMBIOT_CONNECTOR_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await request("GET", "/health");
      if (health.ok && health.json && health.json.ok) return { child, stdoutRef: () => stdout, stderrRef: () => stderr };
    } catch (error) {
      // still starting
    }
    await wait(150);
  }
  child.kill();
  throw new Error("connector_health_timeout");
}

async function stopConnector(instance) {
  if (!instance || !instance.child) return;
  instance.child.kill();
  await wait(600);
}

function assertNoSecret(name, value, secret) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.includes(secret)) throw new Error(`${name}_leaks_secret_value`);
}

(async () => {
  fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const secret = findDeepSeekKey();
  const fingerprint = crypto.createHash("sha256").update(secret).digest("hex").slice(0, 12);
  let first = null;
  let second = null;
  try {
    first = await startConnector();
    const connects = [];
    for (const slot of [1, 2, 3]) {
      connects.push(await request("POST", "/providers/connect", {
        source: "proof-obp-010-pre-release-readiness",
        input: `deepseek:${secret}`,
        slot
      }));
    }
    const snapshotBeforeRestart = await request("GET", "/admin/snapshot");
    const storeFile = path.join(DATA_DIR, "provider-slots.json");
    const keyFile = path.join(DATA_DIR, "provider-slots.key");
    const storePayload = fs.existsSync(storeFile) ? fs.readFileSync(storeFile, "utf8") : "";
    assertNoSecret("connects", connects, secret);
    assertNoSecret("snapshotBeforeRestart", snapshotBeforeRestart, secret);
    assertNoSecret("providerStore", storePayload, secret);
    await stopConnector(first);
    first = null;

    second = await startConnector();
    const snapshotAfterRestart = await request("GET", "/admin/snapshot");
    const preflight = await request("GET", "/preflight");
    const mobile = await request("GET", "/mobile/status");
    const envCheck = await request("POST", "/environment/action", { source: "proof-obp-010-pre-release-readiness", action: "check_path", path: PLUGIN_DIR });
    const envBlocked = await request("POST", "/environment/action", { source: "proof-obp-010-pre-release-readiness", action: "open_url", url: "https://example.com" });
    const compare = await request("POST", "/llm/compare", {
      source: "proof-obp-010-pre-release-readiness",
      prompt: "OBP-010 proof. Ответь одной короткой фразой: pre-release готов к проверке.",
      live: true
    });

    const pluginMain = fs.readFileSync(PLUGIN_MAIN, "utf8");
    const pluginCss = fs.readFileSync(PLUGIN_CSS, "utf8");
    const pluginManifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, "utf8"));
    assertNoSecret("snapshotAfterRestart", snapshotAfterRestart, secret);
    assertNoSecret("preflight", preflight, secret);
    assertNoSecret("compare", compare, secret);

    const providers = snapshotAfterRestart.json && Array.isArray(snapshotAfterRestart.json.providers) ? snapshotAfterRestart.json.providers : [];
    const comparison = compare.json && compare.json.comparison;
    const results = comparison && Array.isArray(comparison.results) ? comparison.results : [];
    const checks = {
      threeConnectsOk: connects.every((item) => item.ok && item.json && item.json.provider && item.json.provider.keyPresent),
      storeFileCreated: fs.existsSync(storeFile),
      keyFileCreated: fs.existsSync(keyFile),
      noSecretInStore: true,
      providersPersistAfterRestart: [1, 2, 3].every((slot) => providers.some((provider) => provider.slot === slot && provider.keyPresent === true && provider.keySource === "local_encrypted_store")),
      preflightEndpointOk: preflight.ok && preflight.json && preflight.json.preflight && preflight.json.preflight.status === "YELLOW_PRE_RELEASE",
      mobileStatusOk: mobile.ok && mobile.json && mobile.json.mobile && mobile.json.mobile.status === "yellow",
      environmentCheckPathOk: envCheck.ok && envCheck.json && envCheck.json.exists === true,
      environmentOpenUrlBlockedWithoutApproval: envBlocked.status === 409 && envBlocked.json && envBlocked.json.reason === "approval_required",
      liveCompareAfterRestart: Boolean(comparison && comparison.status === "live_all_providers_passed" && results.length === 3 && results.every((result) => result.status === "live_provider_passed")),
      pluginHasPreflightCommand: pluginMain.includes("symbiot-pre-release-preflight") && pluginMain.includes("runPreReleasePreflight") && pluginMain.includes("/preflight"),
      pluginHasThreeSlotUi: pluginMain.includes("symbiot-api-slot-grid") && pluginCss.includes(".symbiot-api-slot-grid"),
      manifestPresent: pluginManifest.id === "symbiot-obsidian-plugin" && pluginManifest.isDesktopOnly === false,
      releasePackagePrepared: fs.existsSync(RELEASE_DIR) && fs.existsSync(path.join(RELEASE_DIR, "main.js")) && fs.existsSync(path.join(RELEASE_DIR, "styles.css")) && fs.existsSync(path.join(RELEASE_DIR, "manifest.json")) && fs.existsSync(path.join(RELEASE_DIR, "INSTALL_PRE_RELEASE.md")) && fs.existsSync(RELEASE_ZIP),
      noSecretLeak: true
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_PRE_RELEASE_READINESS_PROOF_2026-07-16",
      createdAt: new Date().toISOString(),
      status: passed ? "PASS_WITH_CONDITIONS_PRE_RELEASE_READINESS" : "YELLOW_FAILED_CHECK",
      boundary: "Proves local pre-release readiness only. Does not prove marketplace publication, tenant security, mobile remote relay, or manual primary-vault acceptance.",
      keyFingerprint: fingerprint,
      checks,
      preflightStatus: preflight.json && preflight.json.preflight ? preflight.json.preflight.status : null,
      providers: providers.map((provider) => ({ slot: provider.slot, id: provider.id, name: provider.name, protocol: provider.protocol, model: provider.model, keyPresent: provider.keyPresent, keySource: provider.keySource, persistent: provider.persistent, keyFingerprint: provider.keyFingerprint })),
      comparisonStatus: comparison ? comparison.status : null,
      resultStatuses: results.map((result) => ({ providerId: result.providerId, providerName: result.providerName, protocol: result.protocol, model: result.model, status: result.status, answerPreview: result.answer ? result.answer.slice(0, 180) : null })),
      environment: {
        checkPathStatus: envCheck.status,
        checkPathExists: envCheck.json ? envCheck.json.exists : null,
        openUrlBlockedStatus: envBlocked.status,
        openUrlBlockedReason: envBlocked.json ? envBlocked.json.reason : null
      },
      release: { releaseDir: RELEASE_DIR, releaseZip: RELEASE_ZIP },
      stdout: second.stdoutRef().slice(-1000),
      stderr: second.stderrRef().slice(-1000)
    };
    const evidencePath = path.join(RUNTIME_LOGS, "SYM_OBSIDIAN_PLUGIN_PRE_RELEASE_READINESS_PROOF_2026-07-16.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    if (!passed) {
      console.error(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: evidence.status, evidencePath, checks, resultStatuses: evidence.resultStatuses }, null, 2));
    }
  } finally {
    await stopConnector(first);
    await stopConnector(second);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

