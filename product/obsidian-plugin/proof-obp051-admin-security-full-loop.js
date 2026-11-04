const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP051_ADMIN_SECURITY_FULL_LOOP_PROOF_2026-07-22.json");
const tempAppData = path.join(evidenceDir, "obp051_temp_appdata");
const connectorPort = 8807;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;

fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assertCheck(condition, message) { if (!condition) throw new Error(message); return true; }
async function waitForHealth() {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${connectorUrl}/health`);
      const body = await response.json();
      if (response.ok && body.ok) return body;
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
async function requestJson(method, endpoint, token, body, expectedStatuses = [200]) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${connectorUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  if (!expectedStatuses.includes(response.status)) throw new Error(`${method} ${endpoint} failed: ${response.status} ${JSON.stringify(payload)}`);
  return { status: response.status, payload };
}

async function main() {
  const server = spawn(process.execPath, [connectorServer], {
    cwd: connectorDir,
    env: {
      ...process.env,
      APPDATA: tempAppData,
      SYMBIOT_CONNECTOR_DATA_DIR: path.join(tempAppData, "Symbiot", "connector"),
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
    await waitForHealth();
    const token = readConnectorToken();
    const adminHtmlResponse = await fetch(`${connectorUrl}/admin`);
    const adminHtml = await adminHtmlResponse.text();
    const unauthorizedAdmin = await requestJson("GET", "/admin/state", null, undefined, [401]);
    const unauthorizedBackup = await requestJson("POST", "/backup/create", null, { source: "proof" }, [401]);
    const registered = await requestJson("POST", "/plugin/register", token, { deviceId: "proof-device", vaultId: "proof-vault", pluginVersion: "0.1.1" });
    const security = await requestJson("GET", "/security/posture", token);
    const backup = await requestJson("POST", "/backup/create", token, { source: "proof" });
    const backupVerify = await requestJson("POST", "/backup/verify", token, { source: "proof", path: backup.payload.path });
    const unsafeBackupVerify = await requestJson("POST", "/backup/verify", token, { source: "proof", path: path.join(root, "package.json") }, [409]);

    const incomplete = await requestJson("POST", "/mission/full-loop", token, { source: "proof", missionText: "Подготовь результат для бизнеса." });
    const completeText = [
      "Подготовить коммерческое предложение для клиента по внедрению Симбиота.",
      "Результат нужен как документ с аргументами, источниками, рисками и следующим шагом.",
      "Сохрани результат в Obsidian vault.",
      "Проверь, что документ можно открыть и в нем есть итог, evidence, ограничения и следующий шаг."
    ].join(" ");
    const awaitingApproval = await requestJson("POST", "/mission/full-loop", token, { source: "proof", missionText: completeText, approved: false });
    const completed = await requestJson("POST", "/mission/full-loop", token, { source: "proof", missionText: completeText, approved: true });
    const admin = await requestJson("GET", "/admin/state", token);

    const serializedPublicEvidence = JSON.stringify({ security: security.payload, backup: backup.payload, backupVerify: backupVerify.payload, completed: completed.payload, admin: admin.payload });
    const loop = completed.payload.fullMissionLoop;
    const checks = {
      adminHtmlAvailable: assertCheck(adminHtmlResponse.ok && adminHtml.includes('data-symbiot-admin-dashboard="metadata-only"'), "admin dashboard HTML missing"),
      adminHtmlUsesAuthenticatedFetch: assertCheck(adminHtml.includes("x-symbiot-connector-token") && adminHtml.includes("sessionStorage"), "admin dashboard auth UI missing"),
      adminUnauthorizedBlocked: assertCheck(unauthorizedAdmin.status === 401 && unauthorizedAdmin.payload.error === "connector_auth_required", "unauthorized admin state not blocked"),
      backupUnauthorizedBlocked: assertCheck(unauthorizedBackup.status === 401, "unauthorized backup not blocked"),
      deviceRegistrationVisible: assertCheck(registered.payload.ok && admin.payload.devices.some((item) => item.id === "proof-device"), "registered device missing from admin state"),
      securityPostureVisible: assertCheck(security.payload.connectorAuthRequired && security.payload.protectedEndpoints.includes("/backup/create"), "security posture incomplete"),
      corsAllowlistVisible: assertCheck(security.payload.corsAllowlist.includes(connectorUrl), "CORS allowlist missing proof origin"),
      tenantRlsPostureVisible: assertCheck(typeof security.payload.tenantBoundary.rlsPolicySkeletonReady === "boolean", "RLS posture missing"),
      backupCreated: assertCheck(backup.payload.ok && fs.existsSync(backup.payload.path) && backup.payload.bytes > 100, "backup not created"),
      backupVerified: assertCheck(backupVerify.payload.status === "backup_verified_yellow" && backupVerify.payload.noSecretLeak, "backup verification failed"),
      unsafeBackupPathBlocked: assertCheck(unsafeBackupVerify.status === 409 && unsafeBackupVerify.payload.reason === "backup_path_not_allowed", "unsafe backup path not blocked"),
      clarificationBlocksRuntime: assertCheck(incomplete.payload.status === "needs_clarification" && incomplete.payload.runtimeStarted === false && incomplete.payload.modelCallsBeforeApproval === 0, "incomplete mission started runtime"),
      approvalBlocksRuntime: assertCheck(awaitingApproval.payload.status === "ready_for_approval" && awaitingApproval.payload.runtimeStarted === false && awaitingApproval.payload.modelCallsBeforeApproval === 0, "unapproved mission started runtime"),
      fullLoopCompleted: assertCheck(completed.payload.status === "completed_yellow" && loop.status === "completed_yellow", "full mission loop not completed"),
      infrastructureTraceComplete: assertCheck(loop.infrastructureTrace.map((item) => item.component).join("|") === "Gateway|Router|Role Registry|Context Builder|Role Runtime|Validator|Trace", "infrastructure trace incomplete"),
      roleTeamBounded: assertCheck(loop.roles.length >= 2 && loop.roles.length <= 5 && loop.roles[0].kind === "main", "role team invalid"),
      equalizerApplied: assertCheck(loop.equalizer.effortMode && loop.equalizer.modelTier && loop.equalizer.validatorDepth, "responsibility equalizer not applied"),
      resultArtifactExists: assertCheck(loop.result.path && fs.existsSync(loop.result.path) && loop.result.bytes > 100, "result artifact missing"),
      qaEvidencePassed: assertCheck(Object.values(loop.qa.checks).every(Boolean) && loop.evidence.status.includes("PASS_WITH_CONDITIONS"), "QA/evidence checks failed"),
      nextStepVisible: assertCheck(Boolean(loop.nextStep), "next step missing"),
      adminShowsMissionRunEvidence: assertCheck(admin.payload.counters.missions >= 1 && admin.payload.counters.runtimeRuns >= 1 && admin.payload.counters.evidence >= 1 && admin.payload.counters.fullMissionLoops >= 1, "admin counters do not show mission loop"),
      adminMetadataOnly: assertCheck(admin.payload.boundaries.some((item) => item.includes("No full vault")) && !serializedPublicEvidence.includes(completeText), "admin exposed full mission content"),
      noSecretLeak: assertCheck(!/sb_secret_|sk-[a-z0-9_-]{20,}/i.test(serializedPublicEvidence), "secret leaked into evidence payload")
    };
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP051_ADMIN_SECURITY_FULL_LOOP_PROOF_2026-07-22",
      date: "2026-07-22",
      project: "SYM-SaaS",
      gates: ["A4 / OBP-036B Admin Sync Dashboard", "A5 / OBP-029B Security / Tenant / Backup Architecture Gate", "B1 / OBP-041B Agent Runtime Full Mission Loop"],
      status: "PASS_WITH_CONDITIONS_ADMIN_SECURITY_FULL_LOOP_YELLOW",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      passed: Object.values(checks).every(Boolean),
      checks,
      runtimeLevels: ["local_admin_dashboard_mvp", "local_security_tenant_backup_mvp", "local_full_mission_loop_mvp"],
      evidence: {
        adminCounters: admin.payload.counters,
        securityPosture: security.payload,
        backup: backup.payload,
        backupVerify: backupVerify.payload,
        missionLoop: loop
      },
      boundaries: [
        "Production multi-tenant admin console remains YELLOW.",
        "External restore drill and signed installer remain YELLOW.",
        "Live LLM execution, semantic vector RAG and public remote relay are separate gates."
      ],
      connectorStdout: stdout.join(""),
      connectorStderr: stderr.join("")
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, checks: Object.keys(checks).length }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP051_ADMIN_SECURITY_FULL_LOOP_PROOF_2026-07-22", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
