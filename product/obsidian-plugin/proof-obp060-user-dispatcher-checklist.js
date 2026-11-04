const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const missionId = process.argv[2] || "MIS-SYM-20260928-94D582";
const pluginRoot = path.join(__dirname, "symbiot-obsidian-plugin");
const installedPluginRoot = "D:\\СИСТЕМА\\01.Базы данных\\01_База № 3 (MAC)\\15.03_База № 3 (MAC)\\.obsidian\\plugins\\symbiot-obsidian-plugin";
const workspaceRoot = "<локальный путь>";
const expectedSourceRoot = "<локальный путь>";
const connectorRoot = path.join(__dirname, "symbiot-connector-service");
const tokenFile = path.join(process.env.APPDATA || os.tmpdir(), "Symbiot", "connector", "connector-token.json");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function status(id, result, evidence) {
  return { id, result, evidence };
}

async function main() {
  const healthResponse = await fetch("http://127.0.0.1:8787/health");
  const health = await healthResponse.json();
  assert.ok(healthResponse.ok && health.ok, "connector must be available for checklist run");

  const token = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token;
  const detailResponse = await fetch(`http://127.0.0.1:8787/dispatcher/v1/missions/${encodeURIComponent(missionId)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const detail = await detailResponse.json();
  assert.ok(detailResponse.ok && detail.contract, "control mission must be readable");

  const contract = detail.contract;
  const missionRoot = path.join(workspaceRoot, missionId);
  const planPath = path.join(missionRoot, "02_ПЛАНЫ_НА_СОГЛАСОВАНИЕ", `PLAN-${missionId}.md`);
  const requiredArtifacts = [
    path.join(missionRoot, "01_КАРТОЧКИ_МИССИЙ", `MCC-${missionId}.md`),
    planPath,
    path.join(missionRoot, "06_ЭКОНОМИКА", `BUDGET-${missionId}.md`),
    path.join(missionRoot, "02_ПЛАНЫ_НА_СОГЛАСОВАНИЕ", "mission-manifest.json")
  ];
  const artifactsPresent = requiredArtifacts.every((filePath) => fs.existsSync(filePath));
  const planText = fs.existsSync(planPath) ? fs.readFileSync(planPath, "utf8").toLowerCase() : "";
  const planIsTaskSpecific = ["витрин", "темп", "бюджет продаж"].every((term) => planText.includes(term));
  const serverSource = fs.readFileSync(path.join(connectorRoot, "server.js"), "utf8");
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.json"), "utf8"));
  const installedPluginDataPath = path.join(installedPluginRoot, "data.json");
  const installedPluginData = fs.existsSync(installedPluginDataPath) ? JSON.parse(fs.readFileSync(installedPluginDataPath, "utf8")) : {};
  const pluginFilesMatch = ["main.js", "manifest.json", "styles.css"].every((name) => (
    sha256(path.join(pluginRoot, name)) === sha256(path.join(installedPluginRoot, name))
  ));
  const sourceAllowed = Boolean(contract.preflight
    && ["PASS", "PASS_WITH_CONDITIONS"].includes(contract.preflight.status)
    && Array.isArray(contract.preflight.sources)
    && contract.preflight.sources.some((source) => source.originalPath === expectedSourceRoot && source.importedRelativePath));
  const hasHermesExecuteRoute = /url\.pathname\s*===\s*["']\/dispatcher\/v1\/(?:execute|run|hermes)["']/.test(serverSource);

  const checks = [
    status("connector", "PASS", `${health.host}:${health.port}`),
    status("plugin_install", pluginManifest.version === "0.5.0" && pluginFilesMatch ? "PASS" : "FAIL", `version=${pluginManifest.version}; filesMatch=${pluginFilesMatch}`),
    status("primary_mission", installedPluginData.activeDispatcherMissionId === missionId ? "PASS" : "FAIL", `activeDispatcherMissionId=${installedPluginData.activeDispatcherMissionId || "missing"}`),
    status("obsidian_ui", "MANUAL", "native Obsidian surface is not available to the automation session"),
    status("intake_artifacts", artifactsPresent ? "PASS" : "FAIL", `${requiredArtifacts.filter(fs.existsSync).length}/${requiredArtifacts.length}`),
    status("observable_result", "MANUAL", "0.5.0 implementation is installed; visual reload check remains"),
    status("obsidian_context", contract.obsidianContext && contract.obsidianContext.sourceOfTruth === "obsidian" && contract.obsidianContext.entryCount > 0 ? "PASS" : "FAIL", `entries=${contract.obsidianContext ? contract.obsidianContext.entryCount : 0}`),
    status("qualification", contract.missionType.id === "ARCHITECTURE_AUDIT" ? "FAIL" : "PASS", contract.missionType.id),
    status("source_preflight", fs.existsSync(expectedSourceRoot) && sourceAllowed ? "PASS" : "FAIL", `sourceExists=${fs.existsSync(expectedSourceRoot)}; sourceAllowed=${sourceAllowed}`),
    status("mcc_contract", contract.title && contract.plan && Array.isArray(contract.deliverables) && contract.deliverables.length ? "PASS" : "PARTIAL", `deliverables=${(contract.deliverables || []).length}`),
    status("task_specific_plan", planIsTaskSpecific ? "PASS" : "PARTIAL", `taskSpecific=${planIsTaskSpecific}`),
    status("budget_evidence", contract.budget && contract.budget.status === "PRELIMINARY_UNVERIFIED" && Array.isArray(contract.budget.breakdown) && contract.budget.breakdown.length ? "PASS" : "FAIL", `plannedUsd=${contract.budget && contract.budget.plannedUsd}; lines=${contract.budget && contract.budget.breakdown ? contract.budget.breakdown.length : 0}`),
    status("approval_guard", contract.state === "READY_FOR_HERMES" && (!sourceAllowed || !planIsTaskSpecific) ? "FAIL" : "PASS", contract.state),
    status("hermes_execution", hasHermesExecuteRoute ? "PASS" : "FAIL", `executeRoute=${hasHermesExecuteRoute}`),
    status("final_result", contract.state === "CLOSED" ? "PASS" : "FAIL", contract.state),
    status("layered_acceptance", contract.state === "CLOSED" ? "PASS" : "FAIL", "no execution evidence")
  ];
  const counts = checks.reduce((acc, check) => {
    acc[check.result] = (acc[check.result] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    status: counts.FAIL ? "AUDIT_COMPLETE_WITH_BLOCKERS" : "PASS_END_TO_END",
    missionId,
    counts,
    checks
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
