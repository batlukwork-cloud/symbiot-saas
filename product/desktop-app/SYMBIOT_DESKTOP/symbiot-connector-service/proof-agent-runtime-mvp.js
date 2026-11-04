const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const connectorDir = __dirname;
const connectorServer = path.join(connectorDir, "server.js");
const root = path.dirname(connectorDir);
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP041_AGENT_RUNTIME_MVP_PROOF_2026-07-21.json");
const tempAppData = path.join(evidenceDir, "obp041_temp_appdata");
const connectorPort = 8794;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;

fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForHealth() {
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

function readConnectorToken() {
  const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json");
  const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  if (!parsed.token) throw new Error("connector token missing");
  return parsed.token;
}

async function postJson(pathname, body, token) {
  const response = await fetch(`${connectorUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-symbiot-connector-token": token },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  return { ok: response.ok, status: response.status, json };
}

async function getJson(pathname, token) {
  const response = await fetch(`${connectorUrl}${pathname}`, {
    headers: { "x-symbiot-connector-token": token }
  });
  const json = await response.json();
  return { ok: response.ok, status: response.status, json };
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

async function main() {
  const server = spawn(process.execPath, [connectorServer], {
    cwd: connectorDir,
    env: {
      ...process.env,
      APPDATA: tempAppData,
      SYMBIOT_CONNECTOR_PORT: String(connectorPort),
      SYMBIOT_CONNECTOR_HOST: "127.0.0.1",
      SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md`
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const stdout = [];
  const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    const health = await waitForHealth();
    const token = readConnectorToken();
    const blocked = await postJson("/agent-runtime/run", {
      source: "proof-obp041",
      approved: false,
      missionId: "obp041-proof-mission",
      task: "Подготовить тестовый артефакт runtime MVP",
      expectedResult: "Файл результата и evidence"
    }, token);
    const approved = await postJson("/agent-runtime/run", {
      source: "proof-obp041",
      approved: true,
      missionId: "obp041-proof-mission",
      task: "Подготовить тестовый артефакт runtime MVP",
      expectedResult: "Файл результата и evidence",
      artifactName: "obp041_agent_runtime_result.md"
    }, token);
    const snapshot = await getJson("/admin/snapshot", token);
    const run = approved.json.run;
    const artifactPath = run && run.artifact ? run.artifact.path : null;
    const artifactText = artifactPath && fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, "utf8") : "";
    const snapshotRun = snapshot.json.runtimeRuns.find((item) => item.id === run.id);
    const snapshotArtifact = snapshot.json.artifacts.find((item) => item.id === run.artifact.id);
    const checks = {
      healthOk: assertCheck(health.ok === true, "health not ok"),
      tokenCreated: assertCheck(token.length >= 32, "token too short"),
      blockedWithoutApproval: assertCheck(blocked.status === 409 && blocked.json.reason === "approval_required", "run without approval was not blocked"),
      approvedRunOk: assertCheck(approved.ok && approved.status === 200, "approved run failed"),
      runCompletedYellow: assertCheck(run.status === "completed_yellow", "run not completed_yellow"),
      runtimeLevel: assertCheck(run.runtimeLevel === "local_agent_runtime_mvp", "runtime level mismatch"),
      planHasFourSteps: assertCheck(Array.isArray(run.plan) && run.plan.length === 4 && run.plan.every((step) => step.status === "done"), "plan steps missing"),
      artifactCreated: assertCheck(Boolean(artifactPath) && fs.existsSync(artifactPath), "artifact file missing"),
      artifactNonEmpty: assertCheck(artifactText.includes("задача -> инструмент -> файл/результат -> проверка") && artifactText.length > 500, "artifact content insufficient"),
      artifactHashPresent: assertCheck(Boolean(run.artifact.sha256) && run.artifact.sha256.length === 64, "artifact hash missing"),
      evidenceChecks: assertCheck(run.evidence && Object.values(run.evidence.checks).every(Boolean), "runtime evidence checks failed"),
      snapshotContainsRun: assertCheck(Boolean(snapshotRun), "snapshot runtime run missing"),
      snapshotContainsArtifact: assertCheck(Boolean(snapshotArtifact), "snapshot artifact missing"),
      auditContainsRuntime: assertCheck(snapshot.json.audit.some((item) => item.action === "agent_runtime_run" && item.result === "completed_yellow"), "runtime audit missing")
    };
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP041_AGENT_RUNTIME_MVP_PROOF_2026-07-21",
      date: "2026-07-21",
      project: "SYM-SaaS",
      gate: "OBP-041 Agent Runtime MVP",
      status: "PASS_WITH_CONDITIONS_AGENT_RUNTIME_MVP_YELLOW",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      connectorUrl,
      tempAppData,
      blocked: blocked.json,
      run,
      artifactPreview: artifactText.slice(0, 1200),
      snapshotCounts: {
        runtimeRuns: snapshot.json.runtimeRuns.length,
        artifacts: snapshot.json.artifacts.length,
        queues: snapshot.json.queues.length,
        audit: snapshot.json.audit.length
      },
      checks,
      yellowConditions: [
        "Runtime MVP доказан только как local connector executor.",
        "Browser/GUI/program launch остаются за Windows Agent gate.",
        "Context Retriever/RAG не входит в этот proof и остается OBP-046.",
        "Live LLM execution/OpenRouter остается отдельным gate OBP-035B.",
        "Manual real Obsidian acceptance pending."
      ],
      connectorStdout: stdout.join(""),
      connectorStderr: stderr.join("")
    };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, artifactPath }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    id: "SYM_OBSIDIAN_PLUGIN_OBP041_AGENT_RUNTIME_MVP_PROOF_2026-07-21",
    date: "2026-07-21",
    project: "SYM-SaaS",
    gate: "OBP-041 Agent Runtime MVP",
    status: "FAILED_RED",
    readinessChanged: false,
    error: error.message,
    stack: error.stack
  }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
