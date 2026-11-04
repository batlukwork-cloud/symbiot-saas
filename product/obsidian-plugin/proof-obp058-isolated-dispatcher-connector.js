const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const connectorDirectory = path.join(__dirname, "symbiot-connector-service");
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiot-obp058-"));
const port = 18000 + Math.floor(Math.random() * 1000);
const workspaceRoot = path.join(proofRoot, "Настройка диспетчерской");
const dataDirectory = path.join(proofRoot, "connector-data");
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const payload = await response.json();
      if (response.ok && payload.ok) return payload;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`connector_health_timeout: ${lastError ? lastError.message : "unknown"}`);
}

async function request(method, requestPath, token, body) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json();
  return { response, payload };
}

function startConnector() {
  return spawn(process.execPath, ["server.js"], {
    cwd: connectorDirectory,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(port),
      SYMBIOT_CONNECTOR_DATA_DIR: dataDirectory,
      SYMBIOT_DISPATCHER_WORKSPACE_ROOT: workspaceRoot
    },
    windowsHide: true,
    stdio: "ignore"
  });
}

function stopConnector(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) return resolve();
    child.once("exit", resolve);
    child.kill();
  });
}

async function main() {
  let child = startConnector();
  try {
    await waitForHealth();
    const token = JSON.parse(fs.readFileSync(path.join(dataDirectory, "connector-token.json"), "utf8")).token;
    const prepared = await request("POST", "/dispatcher/v1/intake", token, {
      source: "obp058-proof",
      missionText: "Провести аудит архитектуры диспетчерской, подготовить MCC, план и бюджет для утверждения человеком.",
      missionType: "SOFTWARE_DELIVERY",
      executionMode: "G"
    });
    assert.strictEqual(prepared.response.status, 200, "intake must return HTTP 200");
    assert.strictEqual(prepared.payload.status, "HUMAN_APPROVAL", "mission must wait for human approval");
    assert.strictEqual(prepared.payload.executionAllowed, false, "execution must be disabled before approval");
    assert.strictEqual(prepared.payload.modelCallsAllowed, false, "LLM calls must be disabled before approval");
    assert.strictEqual(prepared.payload.contract.missionType.id, "SOFTWARE_DELIVERY", "explicit mission type must be preserved");
    assert.strictEqual(prepared.payload.contract.executionMode.id, "G", "explicit execution mode must be preserved");
    const missionId = prepared.payload.contract.missionId;
    const missionDirectory = prepared.payload.missionDirectory;

    const detail = await request("GET", `/dispatcher/v1/missions/${missionId}`, token);
    assert.strictEqual(detail.response.status, 200, "mission detail must return HTTP 200");
    assert.strictEqual(detail.payload.contract.missionId, missionId, "mission detail must return the selected mission");
    assert.strictEqual(detail.payload.contract.missionType.id, "SOFTWARE_DELIVERY", "mission detail must preserve mission type");
    [
      path.join(missionDirectory, "01_КАРТОЧКИ_МИССИЙ", `MCC-${missionId}.md`),
      path.join(missionDirectory, "02_ПЛАНЫ_НА_СОГЛАСОВАНИЕ", `PLAN-${missionId}.md`),
      path.join(missionDirectory, "02_ПЛАНЫ_НА_СОГЛАСОВАНИЕ", "mission-manifest.json"),
      path.join(missionDirectory, "06_ЭКОНОМИКА", `BUDGET-${missionId}.md`)
    ].forEach((artifact) => assert.ok(fs.existsSync(artifact), `missing artifact ${artifact}`));
    assert.ok(!fs.existsSync(path.join(missionDirectory, "03_КОНТРАКТЫ_ОДОБРЕННЫЕ", "mission-manifest.json")), "approval record must not exist yet");

    const blocked = await request("POST", "/dispatcher/v1/approve", token, { missionId, approved: false });
    assert.strictEqual(blocked.response.status, 409, "approval endpoint must block execution without explicit human approval");
    assert.strictEqual(blocked.payload.status, "HUMAN_APPROVAL_REQUIRED", "block reason must be explicit");

    const approved = await request("POST", "/dispatcher/v1/approve", token, { missionId, approved: true, approvedBy: "obp058-proof" });
    assert.strictEqual(approved.response.status, 200, "approval must return HTTP 200");
    assert.strictEqual(approved.payload.status, "READY_FOR_HERMES", "approval must prepare but not self-execute Hermes");
    assert.strictEqual(approved.payload.externalActionsAllowed, false, "external actions remain separately gated");
    assert.ok(fs.existsSync(path.join(missionDirectory, "03_КОНТРАКТЫ_ОДОБРЕННЫЕ", "mission-manifest.json")), "approved manifest must be written after approval");

    await stopConnector(child);
    child = startConnector();
    await waitForHealth();
    const restored = await request("GET", "/dispatcher/v1/missions", token);
    assert.strictEqual(restored.response.status, 200, "mission list must return HTTP 200 after restart");
    assert.ok(restored.payload.missions.some((mission) => mission.missionId === missionId), "isolated mission must be restored from its workspace after restart");

    console.log(JSON.stringify({
      status: "PASS_CONNECTOR_ISOLATED_RUNTIME_INTEGRATION",
      missionId,
      preparedState: prepared.payload.status,
      blockedApprovalStatus: blocked.response.status,
      approvedState: approved.payload.status,
      workspaceRoot: prepared.payload.workspaceRoot,
      artifacts: ["MCC", "PLAN", "BUDGET", "APPROVED_MANIFEST"],
      detailEndpoint: true,
      restoredAfterRestart: true
    }, null, 2));
  } finally {
    await stopConnector(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
