const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const { spawn } = require("child_process");
const { mkdirSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const port = Number(process.env.SYMBIOT_CONNECTOR_PROOF_PORT || 8797);
const baseUrl = `http://127.0.0.1:${port}`;
const evidenceDir = resolve(__dirname, "..", "runtime_logs");
const evidencePath = resolve(evidenceDir, "SYM_OBSIDIAN_PLUGIN_CONNECTOR_SERVICE_PROOF_2026-07-16.json");

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
  while (Date.now() - started < 15000) {
    try {
      const result = await request("GET", "/health");
      if (result.ok && result.json && result.json.ok) {
        return result;
      }
    } catch (error) {
      await wait(150);
    }
  }
  throw new Error("Connector service did not become healthy in 15s");
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
    project: "SYM-SaaS / Symbiot Obsidian Plugin Connector",
    date: "2026-07-16",
    level: "local_connector_mvp",
    status: "RUNNING",
    baseUrl,
    checks: [],
    restrictions: [
      "Not production runtime",
      "No tenant isolation proof",
      "No real LLM execution proof",
      "Environment agent executes only list_processes in this MVP"
    ]
  };

  try {
    evidence.checks.push(await waitForHealth());
    evidence.checks.push(await request("GET", "/admin/snapshot"));
    evidence.checks.push(await request("GET", "/mobile/pairing"));
    evidence.checks.push(await request("POST", "/plugin/register", {
      deviceId: "proof-obsidian-desktop",
      vaultId: "proof-vault",
      pluginVersion: "0.1.0"
    }));
    const missionCreate = await request("POST", "/mission/create", {
      title: "Proof mission",
      source: "proof"
    });
    evidence.checks.push(missionCreate);
    const missionId = missionCreate.json && missionCreate.json.mission ? missionCreate.json.mission.id : null;
    evidence.checks.push(await request("POST", "/mission/run", {
      missionId,
      source: "proof",
      llmProviders: ["openai"],
      approved: false
    }));
    evidence.checks.push(await request("POST", "/mission/run", {
      missionId,
      source: "proof",
      llmProviders: ["openai"],
      approved: true
    }));
    evidence.checks.push(await request("POST", "/environment/action", {
      source: "proof",
      action: "list_processes"
    }));
    evidence.checks.push(await request("GET", "/admin/snapshot"));

    const required = [
      ["/health", 200],
      ["/admin/snapshot", 200],
      ["/mobile/pairing", 200],
      ["/plugin/register", 200],
      ["/mission/create", 200],
      ["/mission/run", 409],
      ["/mission/run", 200],
      ["/environment/action", 200]
    ];
    const passedRequired = required.every(([path, status]) =>
      evidence.checks.some((check) => check.path === path && check.status === status)
    );
    const finalAdminSnapshot = [...evidence.checks].reverse().find((check) =>
      check.path === "/admin/snapshot" && check.status === 200 && check.json
    );
    const hasAdminRuntimeState = Boolean(
      finalAdminSnapshot &&
      Array.isArray(finalAdminSnapshot.json.devices) &&
      Array.isArray(finalAdminSnapshot.json.missions) &&
      Array.isArray(finalAdminSnapshot.json.queues) &&
      Array.isArray(finalAdminSnapshot.json.audit)
    );
    const blockedRunDidNotQueue = Boolean(finalAdminSnapshot && finalAdminSnapshot.json.queues.length === 1);
    const blockedRunAudited = Boolean(
      finalAdminSnapshot &&
      finalAdminSnapshot.json.audit.some((record) => record.action === "mission_run" && record.result === "blocked")
    );
    evidence.guards = { hasAdminRuntimeState, blockedRunDidNotQueue, blockedRunAudited };

    evidence.status = passedRequired && hasAdminRuntimeState && blockedRunDidNotQueue && blockedRunAudited ? "PASS_WITH_CONDITIONS" : "YELLOW";
    evidence.passed = evidence.status === "PASS_WITH_CONDITIONS";
    evidence.logs = logs;
  } catch (error) {
    evidence.status = "RED";
    evidence.passed = false;
    evidence.error = error.message;
    evidence.logs = logs;
  } finally {
    child.kill();
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main();


