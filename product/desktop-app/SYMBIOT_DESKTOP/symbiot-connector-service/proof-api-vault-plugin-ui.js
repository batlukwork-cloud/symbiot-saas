const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");
const { requestHeaders } = require("./connector-auth-helper");

const port = Number(process.env.SYMBIOT_CONNECTOR_API_VAULT_PROOF_PORT || 8804);
const baseUrl = `http://127.0.0.1:${port}`;
const rootDir = path.resolve(__dirname, "..");
const pluginDir = path.join(rootDir, "symbiot-obsidian-plugin");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_API_VAULT_UI_PROOF_2026-07-19.json");
const realVaultRoot = process.env.SYMBIOT_API_VAULT_ROOT || "";
const realVaultScriptsDir = path.join(realVaultRoot, "scripts");
const tempVaultRoot = path.join(os.tmpdir(), `symbiot-api-vault-proof-${Date.now()}`);
const fakeSecret = `sk-symbiot-proof-${Date.now()}-not-real`;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function request(method, route, body, options = {}) {
  const headers = options.auth === false ? (body ? { "content-type": "application/json" } : {}) : requestHeaders(body);
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { method, route, status: response.status, ok: response.ok, text, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 6000) {
    try {
      const result = await request("GET", "/health", null, { auth: false });
      if (result.ok && result.json && result.json.ok) return result;
    } catch (_) {}
    await wait(150);
  }
  throw new Error("Connector service did not become healthy in 6s");
}

function prepareTempVault() {
  fs.mkdirSync(path.join(tempVaultRoot, "store"), { recursive: true });
}

function noSecretLeak(values) {
  return values.every((value) => !String(value || "").includes(fakeSecret));
}

function sha(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  prepareTempVault();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(port), SYMBIOT_API_VAULT_ROOT: tempVaultRoot, SYMBIOT_API_VAULT_SCRIPTS_DIR: realVaultScriptsDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    const health = await waitForHealth();
    const unauthorizedList = await request("GET", "/api-vault/list", null, { auth: false });
    const unauthorizedReveal = await request("POST", "/api-vault/reveal", { id: "sym-saas.deepseek.api-key", confirmed: true }, { auth: false });
    const unauthorizedSave = await request("POST", "/api-vault/save", { id: "sym-saas.proof.api-key", value: fakeSecret }, { auth: false });
    const initialList = await request("GET", "/api-vault/list");
    const save = await request("POST", "/api-vault/save", {
      source: "proof-api-vault-plugin-ui",
      id: "sym-saas.proof.api-key",
      provider: "ProofProvider",
      scope: "SYM-SaaS",
      envName: "SYMBIOT_PROOF_API_KEY",
      secretType: "llm_api_key",
      value: fakeSecret,
      notes: "Proof-only fake secret"
    });
    const afterSaveList = await request("GET", "/api-vault/list");
    const revealWithoutConfirm = await request("POST", "/api-vault/reveal", { id: "sym-saas.proof.api-key" });
    const reveal = await request("POST", "/api-vault/reveal", { id: "sym-saas.proof.api-key", confirmed: true });
    const snapshot = await request("GET", "/admin/snapshot");

    const mainJs = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
    const stylesCss = fs.readFileSync(path.join(pluginDir, "styles.css"), "utf8");
    const serverJs = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

    const checks = {
      healthOk: health.ok,
      unauthorizedListBlocked: unauthorizedList.status === 401,
      unauthorizedRevealBlocked: unauthorizedReveal.status === 401,
      unauthorizedSaveBlocked: unauthorizedSave.status === 401,
      listEndpointWorks: initialList.ok && Array.isArray(initialList.json.records) && initialList.json.records.some((record) => record.id === "sym-saas.openrouter.api-key"),
      saveEndpointWorks: save.ok && save.json && save.json.record && save.json.record.fingerprint === sha(fakeSecret),
      listAfterSaveSanitized: afterSaveList.ok && afterSaveList.text.includes("sym-saas.proof.api-key") && !afterSaveList.text.includes(fakeSecret),
      revealRequiresExplicitConfirmation: revealWithoutConfirm.status === 409,
      revealReturnsOnlyAfterConfirmation: reveal.ok && reveal.json && reveal.json.value === fakeSecret,
      snapshotDoesNotLeakSecret: snapshot.ok && !snapshot.text.includes(fakeSecret),
      pluginCommandPresent: mainJs.includes("Симбиот: открыть API-ключи") && mainJs.includes("openApiVault"),
      pluginModalPresent: mainJs.includes("class SymbiotApiVaultModal") && mainJs.includes("Показать") && mainJs.includes("Скопировать") && mainJs.includes("Сохранить ключ"),
      connectorEndpointsPresent: serverJs.includes("/api-vault/list") && serverJs.includes("/api-vault/reveal") && serverJs.includes("/api-vault/save"),
      cssPresent: stylesCss.includes(".symbiot-api-vault-modal") && stylesCss.includes(".symbiot-api-vault-row"),
      packageScriptRegistered: packageJson.scripts && packageJson.scripts["proof:api-vault"] === "node proof-api-vault-plugin-ui.js",
      noSecretLeak: noSecretLeak([unauthorizedList.text, unauthorizedReveal.text, unauthorizedSave.text, initialList.text, save.text, afterSaveList.text, revealWithoutConfirm.text, snapshot.text, logs.join("\n")])
    };
    const passed = Object.values(checks).every(Boolean);
    const proof = {
      id: "OBP-036",
      date: "2026-07-19",
      project: "SYM-SaaS / Symbiot Obsidian Plugin",
      gate: "Plugin API Keys User Interface",
      status: passed ? "PASS_WITH_CONDITIONS_PLUGIN_API_VAULT_UI" : "YELLOW_PLUGIN_API_VAULT_UI_INCOMPLETE",
      readinessChangeAllowed: false,
      tempVaultRoot,
      checks,
      evidence: {
        revealReturnedExpectedValue: checks.revealReturnsOnlyAfterConfirmation,
        revealedValueFingerprint: reveal.json && reveal.json.value ? sha(reveal.json.value) : null,
        secretValueWrittenToEvidence: false
      },
      debug: {
        saveStatus: save.status,
        saveError: save.json && (save.json.error || save.json.reason) ? save.json.error || save.json.reason : null,
        afterSaveStatus: afterSaveList.status,
        revealStatus: reveal.status,
        revealError: reveal.json && (reveal.json.error || reveal.json.reason) ? reveal.json.error || reveal.json.reason : null
      },
      files: {
        connector: path.join(__dirname, "server.js"),
        plugin: path.join(pluginDir, "main.js"),
        styles: path.join(pluginDir, "styles.css"),
        packageJson: path.join(__dirname, "package.json")
      },
      boundaries: [
        "The plugin now has a user-facing API keys UI.",
        "List/save endpoints do not return secret values.",
        "Reveal requires explicit local user action and returns the value only to authenticated plugin UI.",
        "This is local Windows DPAPI vault UX, not production tenant secret management."
      ]
    };
    fs.writeFileSync(evidencePath, JSON.stringify(proof, null, 2), "utf8");
    console.log(JSON.stringify(proof, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    if (!child.killed) child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
