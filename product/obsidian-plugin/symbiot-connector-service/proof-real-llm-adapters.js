const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const { spawn } = require("child_process");
const { mkdirSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const port = Number(process.env.SYMBIOT_LLM_ADAPTER_PROOF_PORT || 8799);
const baseUrl = `http://127.0.0.1:${port}`;
const evidenceDir = resolve(__dirname, "..", "runtime_logs");
const evidencePath = resolve(evidenceDir, "SYM_OBSIDIAN_PLUGIN_REAL_LLM_ADAPTER_LAYER_PROOF_2026-07-16.json");
const prompt = "Дмитрий, очень приятно. Проверь live LLM adapter layer.";

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders(body),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = { parseError: error.message, raw: text };
  }
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

function secretPresence() {
  return {
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    GOOGLE_API_KEY: Boolean(process.env.GOOGLE_API_KEY),
    SYMBIOT_LLM_LIVE_ENABLED: process.env.SYMBIOT_LLM_LIVE_ENABLED === "1"
  };
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const evidence = {
    project: "SYM-SaaS / OBP-005 Real LLM Adapter Layer",
    date: "2026-07-16",
    level: "local_connector_real_provider_adapter_layer",
    status: "RUNNING",
    baseUrl,
    prompt,
    secretPresence: secretPresence(),
    checks: {},
    restrictions: [
      "Provider API keys are checked only as booleans; secret values are never written to evidence.",
      "If keys are missing, real external LLM execution remains YELLOW.",
      "If keys are present and live=true, provider calls may incur cost and must be accepted as live proof only after passed response evidence."
    ]
  };

  try {
    await waitForHealth();
    const compare = await request("POST", "/llm/compare", {
      source: "proof-real-llm-adapters",
      prompt,
      live: true,
      providers: [
        { id: "openai", name: "OpenAI", model: "not_configured" },
        { id: "anthropic", name: "Anthropic", model: "not_configured" },
        { id: "gemini", name: "Gemini", model: "not_configured" }
      ]
    });
    const snapshot = await request("GET", "/admin/snapshot");
    const comparison = compare.json && compare.json.comparison ? compare.json.comparison : null;
    const results = comparison ? comparison.results : [];
    const statuses = results.map((result) => result.status);
    const keyStatuses = comparison ? comparison.providerSecrets : [];
    const livePassedCount = statuses.filter((status) => status === "live_provider_passed").length;
    const missingKeyCount = statuses.filter((status) => status === "missing_api_key").length;
    const hasSecretValuesInEvidence = JSON.stringify({ compare: compare.json, snapshot: snapshot.json }).includes("sk-") ||
      JSON.stringify({ compare: compare.json, snapshot: snapshot.json }).includes("AIza");

    evidence.checks = {
      compareStatus: compare.status,
      comparisonStatus: comparison ? comparison.status : null,
      liveRequested: comparison ? comparison.liveRequested : null,
      providerCount: results.length,
      providerStatuses: statuses,
      providerSecretBooleans: keyStatuses,
      livePassedCount,
      missingKeyCount,
      snapshotStatus: snapshot.status,
      snapshotHasComparison: Boolean(snapshot.json && Array.isArray(snapshot.json.llmComparisons) && snapshot.json.llmComparisons.length >= 1),
      snapshotHasLlmAudit: Boolean(snapshot.json && snapshot.json.audit.some((record) => record.action === "llm_compare")),
      hasSecretValuesInEvidence
    };

    const noKeysPresent = !evidence.secretPresence.OPENAI_API_KEY &&
      !evidence.secretPresence.ANTHROPIC_API_KEY &&
      !evidence.secretPresence.GEMINI_API_KEY &&
      !evidence.secretPresence.GOOGLE_API_KEY;
    const expectedMissingKeyPass = noKeysPresent &&
      compare.ok &&
      comparison &&
      comparison.status === "missing_api_key" &&
      comparison.liveRequested === true &&
      results.length === 3 &&
      missingKeyCount === 3 &&
      !hasSecretValuesInEvidence &&
      evidence.checks.snapshotHasLlmAudit;
    const liveProofPass = livePassedCount >= 1 && !hasSecretValuesInEvidence && evidence.checks.snapshotHasLlmAudit;

    evidence.status = liveProofPass ? "LIVE_PROVIDER_PASS" : expectedMissingKeyPass ? "PASS_WITH_CONDITIONS_MISSING_KEYS" : "YELLOW";
    evidence.passed = liveProofPass || expectedMissingKeyPass;
    evidence.realLlmExecution = liveProofPass;
    evidence.logs = logs;
  } catch (error) {
    evidence.status = "RED";
    evidence.passed = false;
    evidence.realLlmExecution = false;
    evidence.error = error.stack || error.message;
    evidence.logs = logs;
  } finally {
    child.kill();
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, realLlmExecution: evidence.realLlmExecution, evidencePath }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main();

