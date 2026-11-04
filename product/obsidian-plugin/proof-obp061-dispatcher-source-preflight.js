const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const connectorDirectory = path.join(__dirname, "symbiot-connector-service");
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiot-obp061-"));
const inboxRoot = path.join(proofRoot, "01_INBOX");
const workspaceRoot = path.join(inboxRoot, "Настройка диспетчерской");
const sourceRoot = path.join(inboxRoot, "ЖК Олимп - вход в проект");
const dataDirectory = path.join(proofRoot, "connector-data");
const port = 19000 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

fs.mkdirSync(sourceRoot, { recursive: true });
fs.writeFileSync(path.join(sourceRoot, "Справка_Олимп_инвестиционный_анализ.md"), "# Исходная справка\n", "utf8");
fs.writeFileSync(path.join(sourceRoot, "Бизнес план Олимп.xlsx"), "test-workbook-placeholder", "utf8");

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

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const payload = await response.json();
      if (response.ok && payload.ok) return;
    } catch (_) {
      // Connector can take a short moment to bind its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("connector_health_timeout");
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
  return { response, payload: await response.json() };
}

function stopConnector(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) return resolve();
    child.once("exit", resolve);
    child.kill();
  });
}

async function main() {
  const child = startConnector();
  try {
    await waitForHealth();
    const token = JSON.parse(fs.readFileSync(path.join(dataDirectory, "connector-token.json"), "utf8")).token;
    const missionText = `${sourceRoot} нужно обновить инвестиционную справку, подключить витрину новостроек, проверить цены и темпы продаж, собрать бюджет продаж.`;
    const prepared = await request("POST", "/dispatcher/v1/intake", token, {
      source: "obp061-proof",
      missionText,
      executionMode: "G"
    });
    assert.strictEqual(prepared.response.status, 200, "valid source intake must return HTTP 200");
    assert.strictEqual(prepared.payload.contract.missionType.id, "REAL_ESTATE_INVESTMENT_ANALYSIS", "real-estate mission must win scored classification");
    assert.strictEqual(prepared.payload.contract.preflight.status, "PASS_WITH_CONDITIONS", "validated source must pass preflight");
    assert.strictEqual(prepared.payload.status, "HUMAN_APPROVAL", "valid preflight must reach human approval");
    assert.ok(prepared.payload.contract.plan.steps.some((step) => /витрин|рын/i.test(step)), "plan must contain task-specific market work");
    const importedSource = prepared.payload.contract.preflight.sources[0].importedRelativePath;
    const importedRoot = path.join(prepared.payload.missionDirectory, ...importedSource.split("/"));
    assert.ok(fs.existsSync(path.join(importedRoot, "Справка_Олимп_инвестиционный_анализ.md")), "source note must be imported into isolated mission workspace");
    assert.ok(fs.existsSync(path.join(prepared.payload.missionDirectory, "00_ВХОДЯЩИЕ", "SOURCE_MANIFEST.json")), "source manifest must be written");

    const recalculated = await request("POST", "/dispatcher/v1/recalculate", token, {
      missionId: prepared.payload.contract.missionId,
      source: "obp061-proof"
    });
    assert.strictEqual(recalculated.response.status, 200, "unapproved mission budget must be recalculable");
    const budget = recalculated.payload.contract.budget;
    assert.strictEqual(budget.status, "PRELIMINARY_UNVERIFIED", "budget must be explicitly preliminary");
    assert.strictEqual(budget.inputs.fileCount, 2, "budget must use inspected source file count");
    assert.strictEqual(budget.breakdown.length, 4, "budget must include auditable line items");
    assert.strictEqual(Number(budget.breakdown.reduce((sum, item) => sum + item.estimatedUsd, 0).toFixed(2)), budget.plannedUsd, "budget lines must match total");
    assert.ok(budget.excludedCosts.length >= 3, "unpriced costs must be visible as exclusions");
    const budgetPath = path.join(prepared.payload.missionDirectory, "06_ЭКОНОМИКА", `BUDGET-${prepared.payload.contract.missionId}.md`);
    assert.ok(fs.readFileSync(budgetPath, "utf8").includes("## Расшифровка"), "budget artifact must explain its line items");

    const approved = await request("POST", "/dispatcher/v1/approve", token, {
      missionId: prepared.payload.contract.missionId,
      approved: true,
      approvedBy: "obp061-proof"
    });
    assert.strictEqual(approved.response.status, 200, "valid preflight may be approved");
    assert.strictEqual(approved.payload.status, "READY_FOR_HERMES", "approved mission must be ready for Hermes without auto-execution");
    const lockedRecalculation = await request("POST", "/dispatcher/v1/recalculate", token, {
      missionId: prepared.payload.contract.missionId,
      source: "obp061-proof"
    });
    assert.strictEqual(lockedRecalculation.response.status, 409, "approved contract budget must be immutable");
    assert.strictEqual(lockedRecalculation.payload.status, "MISSION_LOCKED_AFTER_APPROVAL", "immutable budget must return an explicit reason");

    const blocked = await request("POST", "/dispatcher/v1/intake", token, {
      source: "obp061-proof",
      missionText: "Подготовить инвестиционную справку, цены, темпы продаж и бюджет продаж.",
      sourcePath: path.join(inboxRoot, "НЕСУЩЕСТВУЮЩИЙ_ИСТОЧНИК")
    });
    assert.strictEqual(blocked.response.status, 200, "blocked intake must still return an observable mission contract");
    assert.strictEqual(blocked.payload.status, "PAUSED_FOR_GATE", "missing source must pause the mission");
    assert.strictEqual(blocked.payload.contract.preflight.status, "BLOCKED", "missing source must fail preflight");
    const rejectedApproval = await request("POST", "/dispatcher/v1/approve", token, {
      missionId: blocked.payload.contract.missionId,
      approved: true,
      approvedBy: "obp061-proof"
    });
    assert.strictEqual(rejectedApproval.response.status, 409, "approval must be rejected while preflight is blocked");
    assert.strictEqual(rejectedApproval.payload.reason, "PREFLIGHT_REQUIRED", "approval rejection must name the failed gate");

    console.log(JSON.stringify({
      status: "PASS_DISPATCHER_QUALIFICATION_AND_SOURCE_PREFLIGHT",
      missionType: prepared.payload.contract.missionType.id,
      components: prepared.payload.contract.missionComponents,
      importedSources: prepared.payload.sourceImport.sourceCount,
      importedFiles: prepared.payload.sourceImport.fileCount,
      plannedUsd: budget.plannedUsd,
      budgetLines: budget.breakdown.length,
      validState: prepared.payload.status,
      approvedState: approved.payload.status,
      blockedState: blocked.payload.status,
      blockedApprovalReason: rejectedApproval.payload.reason
    }, null, 2));
  } finally {
    await stopConnector(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
