const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { hydrateApiVaultEnv } = require("./api-vault-env");

const PORT = Number(process.env.SYMBIOT_PROOF_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const RUNTIME_LOGS = path.resolve(__dirname, "..", "runtime_logs");
const PLUGIN_DIR = fs.existsSync(path.resolve(__dirname, "..", "symbiot-obsidian-plugin"))
  ? path.resolve(__dirname, "..", "symbiot-obsidian-plugin")
  : path.resolve(__dirname, "..", "obsidian-plugin");
const PLUGIN_MAIN = path.join(PLUGIN_DIR, "main.js");
const PLUGIN_CSS = path.join(PLUGIN_DIR, "styles.css");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findDeepSeekKey() {
  hydrateApiVaultEnv({ records: [["sym-saas.deepseek.api-key", "DEEPSEEK_API_KEY"]] });
  if (String(process.env.DEEPSEEK_API_KEY || "").trim()) return String(process.env.DEEPSEEK_API_KEY).trim();
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

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const health = await request("GET", "/health");
      if (health.ok && health.json && health.json.ok) return health;
    } catch (error) {
      // service is still starting
    }
    await wait(150);
  }
  throw new Error("connector_health_timeout");
}

function assertNoSecret(name, value, secret) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(secret)) throw new Error(`${name}_leaks_secret_value`);
}

(async () => {
  fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
  const secret = findDeepSeekKey();
  const fingerprint = crypto.createHash("sha256").update(secret).digest("hex").slice(0, 12);
  const child = spawn(process.execPath, [path.resolve(__dirname, "server.js")], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForHealth();
    const connects = [];
    for (const slot of [1, 2, 3]) {
      connects.push(await request("POST", "/providers/connect", {
        source: "proof-obp-009-three-slot-live-flow",
        input: `deepseek:${secret}`,
        slot
      }));
    }
    const snapshot = await request("GET", "/admin/snapshot");
    const compare = await request("POST", "/llm/compare", {
      source: "proof-obp-009-three-slot-live-flow",
      prompt: "OBP-009 proof. Ответь одной короткой фразой: окно LLM работает.",
      live: true
    });

    const pluginMain = fs.readFileSync(PLUGIN_MAIN, "utf8");
    const pluginCss = fs.readFileSync(PLUGIN_CSS, "utf8");

    assertNoSecret("connects", connects, secret);
    assertNoSecret("snapshot", snapshot, secret);
    assertNoSecret("compare", compare, secret);

    const providers = snapshot.json && Array.isArray(snapshot.json.providers) ? snapshot.json.providers : [];
    const comparison = compare.json && compare.json.comparison;
    const results = comparison && Array.isArray(comparison.results) ? comparison.results : [];
    const checks = {
      threeConnectsOk: connects.every((item) => item.ok && item.json && item.json.provider && item.json.provider.keyPresent),
      threeSlotsInSnapshot: [1, 2, 3].every((slot) => providers.some((provider) => provider.slot === slot && provider.keyPresent === true)),
      liveRequested: Boolean(comparison && comparison.liveRequested === true),
      threeLiveResults: results.length === 3 && results.every((result) => result.status === "live_provider_passed"),
      threeRealNonEmptyAnswers: results.length === 3 && results.every((result) => result.answer && !/empty text response/i.test(result.answer)),
      latencyUsageAndCostVisible: results.length === 3 && results.every((result) => Number.isFinite(result.latencyMs) && result.latencyMs > 0 && result.usage && Number.isFinite(result.estimatedCostUsd)),
      comparisonPassed: Boolean(comparison && comparison.status === "live_all_providers_passed"),
      pluginHasThreeSlotUi: pluginMain.includes("symbiot-api-slot-grid") && pluginMain.includes("Окно ${slot}") && pluginMain.includes("Запустить сравнение"),
      pluginHasDisconnect: pluginMain.includes("/providers/disconnect") && pluginMain.includes("Отключить"),
      pluginHasSlotCss: pluginCss.includes(".symbiot-api-slot-grid"),
      noSecretLeak: true
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_THREE_API_SLOT_LIVE_FLOW_PROOF_2026-07-16",
      createdAt: new Date().toISOString(),
      status: passed ? "PASS_WITH_CONDITIONS_THREE_API_SLOT_LIVE_FLOW" : "YELLOW_FAILED_CHECK",
      boundary: "Proves three independent API slots and live connector comparison. It does not prove production secret storage or manual acceptance in Dmitry's primary vault.",
      keyFingerprint: fingerprint,
      checks,
      providers: providers.map((provider) => ({ slot: provider.slot, id: provider.id, name: provider.name, protocol: provider.protocol, model: provider.model, keyPresent: provider.keyPresent, keySource: provider.keySource, keyFingerprint: provider.keyFingerprint })),
      comparisonStatus: comparison ? comparison.status : null,
      resultStatuses: results.map((result) => ({ providerId: result.providerId, providerName: result.providerName, protocol: result.protocol, model: result.model, status: result.status, latencyMs: result.latencyMs, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, answerPreview: result.answer ? result.answer.slice(0, 180) : null })),
      stdout: stdout.slice(-1000),
      stderr: stderr.slice(-1000)
    };
    const evidencePath = path.join(RUNTIME_LOGS, "SYM_OBSIDIAN_PLUGIN_THREE_API_SLOT_LIVE_FLOW_PROOF_2026-07-16.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    if (!passed) {
      console.error(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: evidence.status, evidencePath, checks, resultStatuses: evidence.resultStatuses }, null, 2));
    }
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

