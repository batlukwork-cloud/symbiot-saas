const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.SYMBIOT_PROOF_PORT || 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const RUNTIME_LOGS = path.resolve(__dirname, "..", "runtime_logs");
const DATA_DIR = path.join(RUNTIME_LOGS, "obp007_provider_store");
const SECRET = "sk-test-symbiot-proof-007-do-not-leak";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  for (let i = 0; i < 40; i += 1) {
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

function assertNoSecret(name, value) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(SECRET)) throw new Error(`${name}_leaks_secret_value`);
}

(async () => {
  fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
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

  try {
    const health = await waitForHealth();
    const connect = await request("POST", "/providers/connect", {
      source: "proof-obp-007",
      input: SECRET
    });
    const snapshot = await request("GET", "/admin/snapshot");
    const compare = await request("POST", "/llm/compare", {
      source: "proof-obp-007",
      prompt: "Proof prompt for simple API-key connect UX. Do not call external provider in this proof."
    });

    assertNoSecret("connect_response", connect);
    assertNoSecret("snapshot", snapshot);
    assertNoSecret("compare_response", compare);

    const provider = connect.json && connect.json.provider;
    const providers = snapshot.json && Array.isArray(snapshot.json.providers) ? snapshot.json.providers : [];
    const comparison = compare.json && compare.json.comparison;
    const checks = {
      healthOk: health.ok,
      connectOk: connect.ok && connect.json && connect.json.ok === true,
      providerSanitized: Boolean(provider && provider.keyPresent === true && provider.keyFingerprint && !provider.secretRef),
      snapshotHasProvider: providers.some((item) => item.id === "openai" && item.keyPresent === true),
      compareUsesConnectedProvider: Boolean(comparison && comparison.providerSecrets && comparison.providerSecrets.some((item) => item.providerId === "openai" && item.keySource === "memory" && item.keyPresent === true)),
      compareDoesNotGoLiveWithoutProofFlag: Boolean(comparison && comparison.status === "live_disabled"),
      noSecretLeak: true
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_SIMPLE_API_KEY_CONNECT_PROOF_2026-07-16",
      createdAt: new Date().toISOString(),
      status: passed ? "PASS_WITH_CONDITIONS_SIMPLE_API_KEY_CONNECT" : "YELLOW_FAILED_CHECK",
      boundary: "Fake key proves one-line connect UX and sanitized local runtime registry only. Real external LLM execution is not proven.",
      port: PORT,
      checks,
      provider: provider || null,
      comparisonStatus: comparison ? comparison.status : null,
      resultStatuses: comparison ? comparison.results.map((result) => ({ providerId: result.providerId, protocol: result.protocol, status: result.status })) : [],
      stdout: stdout.slice(-1000),
      stderr: stderr.slice(-1000)
    };
    const evidencePath = path.join(RUNTIME_LOGS, "SYM_OBSIDIAN_PLUGIN_SIMPLE_API_KEY_CONNECT_PROOF_2026-07-16.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    if (!passed) {
      console.error(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: evidence.status, evidencePath, checks }, null, 2));
    }
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});


