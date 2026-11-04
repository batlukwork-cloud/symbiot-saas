const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031D_RELEASE_CANDIDATE_PROOF_2026-07-22.json");
const PORT = Number(process.env.SYMBIOT_OBP031D_PROOF_PORT || 18790);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function hasNoSecretLeak(values) {
  return !values.some((value) => /(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql:\/\/[^:\s]+:[^@\s]+@)/i.test(String(value || "")));
}

function runRcCheck() {
  const script = path.join(ROOT, "RUN_SYMBIOT_RC_CHECK.ps1");
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Port", String(PORT)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90000
  });
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = {
    startDesktopCmd: path.join(ROOT, "START_SYMBIOT_DESKTOP.cmd"),
    rcCheckCmd: path.join(ROOT, "RUN_SYMBIOT_RC_CHECK.cmd"),
    rcCheckPs1: path.join(ROOT, "RUN_SYMBIOT_RC_CHECK.ps1"),
    checklist: path.join(ROOT, "02_MANUAL_ACCEPTANCE_CHECKLIST_RU.md"),
    startHere: path.join(ROOT, "00_START_HERE_RU.md"),
    installGuide: path.join(ROOT, "01_CLIENT_INSTALL_RU.md"),
    desktopMain: exists("symbiot-desktop-shell/main.js") ? path.join(ROOT, "symbiot-desktop-shell", "main.js") : path.join(ROOT, "desktop-shell", "main.js"),
    electronCmd: exists("symbiot-desktop-shell/node_modules/.bin/electron.cmd") ? path.join(ROOT, "symbiot-desktop-shell", "node_modules", ".bin", "electron.cmd") : path.join(ROOT, "desktop-shell", "node_modules", ".bin", "electron.cmd")
  };

  const proof = {
    id: "OBP-031D",
    date: "2026-07-22",
    project: "SYM-SaaS / Symbiot Release Candidate",
    gate: "Manual Windows Client Acceptance + Release Candidate",
    status: "YELLOW_NOT_RUN",
    proofPort: PORT,
    files,
    fileHashes: {},
    checks: {},
    boundaries: [
      "Release Candidate can be prepared by automation.",
      "Manual Windows/client-machine acceptance is still required before release GREEN.",
      "Signed installer, marketplace, production remote relay and full Windows agent remain YELLOW/RED.",
      "Readiness must not be changed by this proof alone."
    ]
  };

  for (const [key, file] of Object.entries(files)) {
    proof.fileHashes[key] = fs.existsSync(file) ? sha256(read(file)) : null;
  }

  const startHere = fs.existsSync(files.startHere) ? read(files.startHere) : "";
  const installGuide = fs.existsSync(files.installGuide) ? read(files.installGuide) : "";
  const checklist = fs.existsSync(files.checklist) ? read(files.checklist) : "";
  const rcPs1 = fs.existsSync(files.rcCheckPs1) ? read(files.rcCheckPs1) : "";

  proof.checks.startDesktopCmdPresent = fs.existsSync(files.startDesktopCmd);
  proof.checks.rcCheckCmdPresent = fs.existsSync(files.rcCheckCmd);
  proof.checks.rcCheckPs1Present = fs.existsSync(files.rcCheckPs1);
  proof.checks.manualChecklistPresent = fs.existsSync(files.checklist) && checklist.includes("Что считать приемкой");
  proof.checks.instructionsUseDesktopFirst = startHere.includes("START_SYMBIOT_DESKTOP.cmd") && installGuide.includes("desktop-окно");
  proof.checks.instructionsMentionRcCheck = startHere.includes("RUN_SYMBIOT_RC_CHECK.cmd") || installGuide.includes("RUN_SYMBIOT_RC_CHECK.cmd");
  proof.checks.rcCheckHasPortParameter = rcPs1.includes("[int]$Port = 8787") && rcPs1.includes("http://127.0.0.1:$Port");
  proof.checks.rcCheckWritesReports = rcPs1.includes("SYM_OBSIDIAN_PLUGIN_OBP031D_RC_MANUAL_CHECK_2026-07-22.json") && rcPs1.includes("SYM_OBSIDIAN_PLUGIN_OBP031D_RC_MANUAL_CHECK_2026-07-22.md");
  proof.checks.electronBundled = fs.existsSync(files.electronCmd);
  proof.checks.noStaticSecretLeak = hasNoSecretLeak([startHere, installGuide, checklist]);

  const run = runRcCheck();
  proof.rcCheckRun = {
    status: run.status,
    signal: run.signal,
    stdout: String(run.stdout || "").slice(-2000),
    stderr: String(run.stderr || "").slice(-2000)
  };
  const rcReportPath = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031D_RC_MANUAL_CHECK_2026-07-22.json");
  let rcReport = null;
  if (fs.existsSync(rcReportPath)) {
    rcReport = JSON.parse(read(rcReportPath).replace(/^\uFEFF/, ""));
  }
  proof.rcReportPath = rcReportPath;
  proof.rcReportStatus = rcReport ? rcReport.status : null;
  proof.checks.rcCheckPassed = run.status === 0 && rcReport && rcReport.status === "PASS_WITH_CONDITIONS_RELEASE_CANDIDATE_YELLOW";
  proof.checks.rcCheckManualAcceptanceBoundary = rcReport && rcReport.manualAcceptanceRequired === true;

  proof.status = Object.values(proof.checks).every(Boolean)
    ? "PASS_WITH_CONDITIONS_RELEASE_CANDIDATE_YELLOW"
    : "YELLOW_RELEASE_CANDIDATE_INCOMPLETE";

  fs.writeFileSync(OUT_FILE, JSON.stringify(proof, null, 2), "utf8");
  console.log(JSON.stringify(proof, null, 2));
  if (!Object.values(proof.checks).every(Boolean)) process.exitCode = 1;
}

main();
