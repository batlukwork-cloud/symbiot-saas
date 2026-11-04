const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const http = require("http");
const { spawn } = require("child_process");
const { mkdirSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const connectorPort = Number(process.env.SYMBIOT_UNIVERSAL_ADAPTER_PROOF_PORT || 8802);
const mockPort = Number(process.env.SYMBIOT_UNIVERSAL_MOCK_PROVIDER_PORT || 8803);
const baseUrl = `http://127.0.0.1:${connectorPort}`;
const mockUrl = `http://127.0.0.1:${mockPort}/any-vlm-api`;
const evidenceDir = resolve(__dirname, "..", "runtime_logs");
const evidencePath = resolve(evidenceDir, "SYM_OBSIDIAN_PLUGIN_UNIVERSAL_LLM_ADAPTER_PROOF_2026-07-16.json");
const prompt = "Проверь универсальный LLM/VLM API adapter для произвольного провайдера.";

function wait(ms) { return new Promise((resolveWait) => setTimeout(resolveWait, ms)); }

function startMockProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/any-vlm-api") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let json = {};
      try { json = body ? JSON.parse(body) : {}; } catch (error) { json = { parseError: error.message }; }
      calls.push({ headers: req.headers, body: json });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        arbitrary: {
          nested: {
            text: `MockAnyAPI:${json.model}:${json.input}`
          }
        },
        usage: { input: String(json.input || "").length, output: 42 }
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(mockPort, "127.0.0.1", () => resolve({ server, calls }));
  });
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders(body),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (error) { json = { parseError: error.message, raw: text }; }
  return { path, method, status: response.status, ok: response.ok, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 6000) {
    try {
      const result = await request("GET", "/health");
      if (result.ok && result.json && result.json.ok) return result;
    } catch (error) {
      await wait(150);
    }
  }
  throw new Error("Connector service did not become healthy");
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  const mock = await startMockProvider();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_ALLOW_LOCAL_PROVIDER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const evidence = {
    project: "SYM-SaaS / OBP-006 Universal LLM API Adapter",
    date: "2026-07-16",
    level: "local_connector_universal_generic_http_adapter",
    status: "RUNNING",
    prompt,
    mockUrl,
    checks: {},
    restrictions: [
      "Proof uses local mock provider with SYMBIOT_ALLOW_LOCAL_PROVIDER=1.",
      "Production must keep SSRF controls and avoid arbitrary local/private endpoints unless explicitly allowed.",
      "This proves configurable API protocol, not marketplace-ready provider governance."
    ]
  };

  try {
    await waitForHealth();
    const compare = await request("POST", "/llm/compare", {
      source: "proof-universal-adapter",
      prompt,
      live: true,
      providers: [{
        id: "mock-any-vlm",
        name: "Mock Any VLM API",
        protocol: "generic_http",
        endpoint: mockUrl,
        method: "POST",
        authType: "none",
        requiresKey: false,
        model: "any-vlm-26000",
        bodyTemplate: {
          input: "{{prompt}}",
          model: "{{model}}",
          caller: "{{providerId}}"
        },
        responsePath: "arbitrary.nested.text"
      }]
    });
    const snapshot = await request("GET", "/admin/snapshot");
    const comparison = compare.json && compare.json.comparison ? compare.json.comparison : null;
    const result = comparison && comparison.results ? comparison.results[0] : null;
    const serialized = JSON.stringify({ compare: compare.json, snapshot: snapshot.json, calls: mock.calls });

    evidence.checks = {
      compareStatus: compare.status,
      comparisonStatus: comparison ? comparison.status : null,
      providerCount: comparison && comparison.results ? comparison.results.length : 0,
      resultStatus: result ? result.status : null,
      resultProtocol: result ? result.protocol : null,
      answerIncludesMock: Boolean(result && result.answer.includes("MockAnyAPI:any-vlm-26000")),
      mockCallCount: mock.calls.length,
      mockReceivedPrompt: Boolean(mock.calls[0] && mock.calls[0].body && mock.calls[0].body.input === prompt),
      mockReceivedModel: Boolean(mock.calls[0] && mock.calls[0].body && mock.calls[0].body.model === "any-vlm-26000"),
      keyName: comparison && comparison.providerSecrets && comparison.providerSecrets[0] ? comparison.providerSecrets[0].keyName : null,
      keyPresent: comparison && comparison.providerSecrets && comparison.providerSecrets[0] ? comparison.providerSecrets[0].keyPresent : null,
      snapshotStatus: snapshot.status,
      snapshotHasLlmAudit: Boolean(snapshot.json && snapshot.json.audit.some((record) => record.action === "llm_compare")),
      hasSecretValuesInEvidence: serialized.includes("sk-") || serialized.includes("AIza")
    };

    const passed = compare.ok &&
      comparison && comparison.status === "live_all_providers_passed" &&
      evidence.checks.providerCount === 1 &&
      evidence.checks.resultStatus === "live_provider_passed" &&
      evidence.checks.resultProtocol === "generic_http" &&
      evidence.checks.answerIncludesMock &&
      evidence.checks.mockCallCount === 1 &&
      evidence.checks.mockReceivedPrompt &&
      evidence.checks.mockReceivedModel &&
      evidence.checks.keyName === "NO_KEY_REQUIRED" &&
      evidence.checks.keyPresent === false &&
      evidence.checks.snapshotHasLlmAudit &&
      !evidence.checks.hasSecretValuesInEvidence;

    evidence.status = passed ? "PASS_WITH_CONDITIONS_UNIVERSAL_ADAPTER" : "YELLOW";
    evidence.passed = passed;
    evidence.realLlmExecution = false;
    evidence.universalAdapterExecution = passed;
    evidence.logs = logs;
  } catch (error) {
    evidence.status = "RED";
    evidence.passed = false;
    evidence.error = error.stack || error.message;
    evidence.logs = logs;
  } finally {
    child.kill();
    mock.server.close();
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, universalAdapterExecution: evidence.universalAdapterExecution, evidencePath }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main();

