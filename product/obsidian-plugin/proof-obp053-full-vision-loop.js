const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const connectorDir = path.join(root, "symbiot-connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP053_FULL_VISION_LOOP_PROOF_2026-07-22.json");
const tempAppData = path.join(evidenceDir, "obp053_temp_appdata");
const port = 8808;
const baseUrl = `http://127.0.0.1:${port}`;

fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assertCheck(value, message) { if (!value) throw new Error(message); return true; }
async function waitForHealth() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseUrl}/health`); if (response.ok) return; } catch (_) {}
    await sleep(150);
  }
  throw new Error("connector health timeout");
}
function readToken() {
  return JSON.parse(fs.readFileSync(path.join(tempAppData, "Symbiot", "connector", "connector-token.json"), "utf8")).token;
}
async function post(endpoint, token, body, expected = 200) {
  const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (response.status !== expected) throw new Error(`${endpoint}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const server = spawn(process.execPath, [connectorServer], { cwd: connectorDir, env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_DATA_DIR: path.join(tempAppData, "Symbiot", "connector"), SYMBIOT_CONNECTOR_PORT: String(port), SYMBIOT_ALLOWED_ORIGINS: `${baseUrl},http://localhost:${port},app://obsidian.md` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stdout = [];
  const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForHealth();
    const token = readToken();
    const appResponse = await fetch(`${baseUrl}/app`);
    const appHtml = await appResponse.text();
    const unapproved = await post("/vision/capture", token, { source: "proof", approved: false }, 409);
    const captured = await post("/vision/capture", token, { source: "proof", approved: true, targetType: "screen" });
    const capture = captured.visionCapture;
    const imageResponse = await fetch(`${baseUrl}${capture.imageUrl}`, { headers: { Authorization: `Bearer ${token}` } });
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const unauthorizedImage = await fetch(`${baseUrl}${capture.imageUrl}`);
    const stateResponse = await fetch(`${baseUrl}/app/state`, { headers: { Authorization: `Bearer ${token}` } });
    const state = await stateResponse.json();
    const checks = {
      appVisionToolPresent: assertCheck(appResponse.ok && appHtml.includes('data-tool="vision"') && appHtml.includes("captureVision()"), "vision UI missing"),
      explicitApprovalRequired: assertCheck(unapproved.status === "blocked" && unapproved.reason === "explicit_approval_required", "unapproved capture not blocked"),
      realScreenCaptured: assertCheck(captured.ok && capture.status === "PASS_WITH_CONDITIONS_LOCAL_VISION_CAPTURE_YELLOW", "screen capture failed"),
      pngFileExists: assertCheck(fs.existsSync(capture.path) && capture.bytes > 1000, "PNG file missing"),
      pngSignatureValid: assertCheck(imageBuffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", "PNG signature invalid"),
      imageDimensionsValid: assertCheck(capture.width >= 320 && capture.height >= 240, "capture dimensions invalid"),
      evidenceComplete: assertCheck(Object.values(capture.evidence).every((value) => value === true || value === false) && capture.evidence.uploadedToExternalModel === false, "vision evidence incomplete"),
      imageRequiresAuth: assertCheck(unauthorizedImage.status === 401, "vision image exposed without auth"),
      stateTracksCapture: assertCheck(stateResponse.ok && state.visionCaptures.some((item) => item.id === capture.id), "vision capture missing from app state"),
      noSecretLeak: assertCheck(!/sb_secret_|sk-[a-z0-9_-]{20,}/i.test(JSON.stringify({ capture, state })), "secret leaked")
    };
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP053_FULL_VISION_LOOP_PROOF_2026-07-22",
      date: "2026-07-22",
      project: "SYM-SaaS",
      gate: "B5 / OBP-048 Full Vision Loop",
      status: "PASS_WITH_CONDITIONS_LOCAL_VISION_CAPTURE_YELLOW",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      passed: Object.values(checks).every(Boolean),
      checks,
      capture,
      boundaries: ["Local screen capture is proven.", "Browser/file/document-specific AI interpretation remains YELLOW until a multimodal provider is connected."],
      connectorStdout: stdout.join(""),
      connectorStderr: stderr.join("")
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, capture: { path: capture.path, width: capture.width, height: capture.height, bytes: capture.bytes } }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally { server.kill(); }
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP053_FULL_VISION_LOOP_PROOF_2026-07-22", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
