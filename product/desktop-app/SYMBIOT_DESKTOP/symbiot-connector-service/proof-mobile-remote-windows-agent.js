const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP027_028_MOBILE_REMOTE_WINDOWS_AGENT_PROOF_2026-07-21.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_027_028_MOBILE_REMOTE_WINDOWS_AGENT_2026-07-21.md");
const port = Number(process.env.SYMBIOT_MOBILE_REMOTE_PROOF_PORT || 8807);
const baseUrl = `http://127.0.0.1:${port}`;
const tempDataDir = path.join(os.tmpdir(), "symbiot-obp027-028-connector");

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function fingerprint(value) { return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null; }
function readConnectorToken() {
  const tokenPath = path.join(tempDataDir, "connector-token.json");
  const parsed = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  return parsed.token;
}
function authHeaders(body, token) {
  const headers = body ? { "content-type": "application/json" } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
async function request(method, routeOrUrl, body, options = {}) {
  const url = /^https?:\/\//i.test(routeOrUrl) ? routeOrUrl : `${baseUrl}${routeOrUrl}`;
  const response = await fetch(url, {
    method,
    headers: options.headers || authHeaders(body, options.connectorToken),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: response.status, ok: response.ok, text, json, headers: Object.fromEntries(response.headers.entries()) };
}
async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const result = await request("GET", "/health");
      if (result.ok && result.json && result.json.ok) return result;
    } catch (_) {}
    await wait(150);
  }
  throw new Error("connector health timeout");
}
function noSecretLeak(values, connectorToken) {
  const forbidden = [connectorToken, process.env.SYMBIOT_SUPABASE_SECRET_KEY, process.env.SYMBIOT_SUPABASE_DB_URL].filter(Boolean);
  return values.every((value) => {
    const text = String(value || "");
    return forbidden.every((secret) => !text.includes(secret));
  });
}
function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-027/028: Mobile Remote + Windows Agent",
    "",
    "Дата: 2026-07-21",
    "Проект / код: SYM-SaaS",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "- mobile QR/pairing token;",
    "- mobile endpoint `/mobile/remote/action`;",
    "- Windows Agent safe actions: `check_path`, `list_processes`;",
    "- approval guard для `open_url`;",
    "- блокировка произвольного действия;",
    "- direct `/environment/action` остается под connector-token;",
    "- no secret/token leak в evidence.",
    "",
    `JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  fs.mkdirSync(tempDataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(port),
      SYMBIOT_CONNECTOR_DATA_DIR: tempDataDir,
      SYMBIOT_ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port},app://obsidian.md`
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  let mobileToken = "";
  let connectorToken = "";
  try {
    const health = await waitForHealth();
    connectorToken = readConnectorToken();
    const pairing = await request("GET", "/mobile/pairing", null, { connectorToken });
    mobileToken = pairing.json && pairing.json.token ? pairing.json.token : "";
    const mobileHtml = pairing.json && pairing.json.url ? await request("GET", pairing.json.url) : { ok: false, text: "" };
    const mobileStatus = await request("GET", `/mobile/status?token=${encodeURIComponent(mobileToken)}`);
    const unauthorizedRemote = await request("POST", "/mobile/remote/action", { action: "check_path", approved: true, path: __dirname });
    const unauthorizedEnvironment = await request("POST", "/environment/action", { action: "check_path", path: __dirname });
    const missingApprovalOpenUrl = await request("POST", "/mobile/remote/action", { token: mobileToken, source: "mobile-proof", action: "open_url", approved: false, url: "https://just-ai.com/" });
    const checkPath = await request("POST", "/mobile/remote/action", { token: mobileToken, source: "mobile-proof", action: "check_path", approved: true, path: __dirname });
    const listProcesses = await request("POST", "/mobile/remote/action", { token: mobileToken, source: "mobile-proof", action: "list_processes", approved: true });
    const unsupported = await request("POST", "/mobile/remote/action", { token: mobileToken, source: "mobile-proof", action: "run_any_program", approved: true, command: "calc.exe" });
    const directEnvironment = await request("POST", "/environment/action", { action: "check_path", path: __dirname }, { connectorToken });
    const preflight = await request("GET", "/preflight", null, { connectorToken });
    const snapshot = await request("GET", "/admin/snapshot", null, { connectorToken });
    const remoteActions = snapshot.json && Array.isArray(snapshot.json.mobileRemoteActions) ? snapshot.json.mobileRemoteActions : [];
    const processCount = listProcesses.json && listProcesses.json.actionResult && Array.isArray(listProcesses.json.actionResult.processes) ? listProcesses.json.actionResult.processes.length : 0;
    const leakValues = [
      health.text,
      mobileHtml.text,
      mobileStatus.text,
      unauthorizedRemote.text,
      unauthorizedEnvironment.text,
      missingApprovalOpenUrl.text,
      checkPath.text,
      listProcesses.text,
      unsupported.text,
      directEnvironment.text,
      preflight.text,
      snapshot.text
    ];
    const checks = {
      healthOk: health.ok && health.json && health.json.ok === true,
      pairingIssued: pairing.ok && Boolean(mobileToken) && Boolean(pairing.json.url) && Boolean(pairing.json.qrUrl),
      mobileHtmlHasRemoteUi: mobileHtml.ok && mobileHtml.text.includes("Windows Agent: безопасные действия") && mobileHtml.text.includes("/mobile/remote/action"),
      mobileStatusShowsLocalRemoteMvp: mobileStatus.ok && mobileStatus.json && mobileStatus.json.mobile && mobileStatus.json.mobile.localRemoteControlReady === true && mobileStatus.json.mobile.remoteAccessReady === false,
      mobileRemoteRequiresToken: unauthorizedRemote.status === 401,
      directEnvironmentStillRequiresConnectorAuth: unauthorizedEnvironment.status === 401,
      openUrlRequiresExplicitApproval: missingApprovalOpenUrl.status === 409 && missingApprovalOpenUrl.json && missingApprovalOpenUrl.json.reason === "explicit_mobile_approval_required",
      checkPathFromMobileWorks: checkPath.ok && checkPath.json && checkPath.json.runtimeLevel === "local_mobile_remote_windows_agent_mvp" && checkPath.json.actionResult && checkPath.json.actionResult.exists === true,
      listProcessesFromMobileWorks: listProcesses.ok && processCount >= 1,
      arbitraryProgramBlocked: unsupported.status === 409 && unsupported.json && unsupported.json.reason === "unsupported_in_safe_mvp",
      connectorEnvironmentRegressionWorks: directEnvironment.ok && directEnvironment.json && directEnvironment.json.exists === true,
      preflightFlagsPresent: preflight.ok && preflight.json && preflight.json.preflight && preflight.json.preflight.checks.localMobileRemoteControlReady === true && preflight.json.preflight.checks.mobileRemoteRelayReady === false,
      snapshotTracksRemoteActions: remoteActions.length >= 4,
      noSecretLeak: noSecretLeak(leakValues, connectorToken)
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP027_028_MOBILE_REMOTE_WINDOWS_AGENT_PROOF_2026-07-21",
      date: "2026-07-21",
      project: "SYM-SaaS / OBP-027/028 Mobile Remote + Windows Agent",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      status: passed ? "PASS_WITH_CONDITIONS_MOBILE_REMOTE_WINDOWS_AGENT_YELLOW" : "YELLOW_MOBILE_REMOTE_WINDOWS_AGENT_INCOMPLETE",
      baseUrl,
      tokenFingerprints: {
        connectorToken: fingerprint(connectorToken),
        mobileToken: fingerprint(mobileToken)
      },
      checks,
      counts: {
        mobileRemoteActions: remoteActions.length,
        listedProcesses: processCount
      },
      boundaries: [
        "local mobile pairing token only",
        "safe Windows Agent MVP actions only",
        "explicit approval required for mobile remote actions",
        "direct environment action remains connector-token protected",
        "no arbitrary program execution",
        "production remote relay/public internet access not ready"
      ]
    };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({
      status: evidence.status,
      evidencePath,
      reportPath,
      checks,
      counts: evidence.counts
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    if (!child.killed) child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
