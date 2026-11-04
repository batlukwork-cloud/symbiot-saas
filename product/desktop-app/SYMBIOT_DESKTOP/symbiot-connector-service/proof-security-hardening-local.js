const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { requestHeaders, connectorToken, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");

const port = Number(process.env.SYMBIOT_CONNECTOR_SECURITY_PROOF_PORT || 8803);
const baseUrl = `http://127.0.0.1:${port}`;
const rootDir = path.resolve(__dirname, "..");
const pluginDir = fs.existsSync(path.join(rootDir, "symbiot-obsidian-plugin"))
  ? path.join(rootDir, "symbiot-obsidian-plugin")
  : path.join(rootDir, "obsidian-plugin");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_SECURITY_HARDENING_LOCAL_PROOF_2026-07-17.json");
const integrityPath = path.join(rootDir, "release", "SYM_OBSIDIAN_PLUGIN_RELEASE_INTEGRITY_2026-07-17.json");

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function request(method, route, body, options = {}) {
  const headers = options.headers || (options.auth === false ? (body ? { "content-type": "application/json" } : {}) : requestHeaders(body));
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { method, route, status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), text, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const result = await request("GET", "/health", null, { auth: false });
      if (result.ok && result.json && result.json.ok) return result;
    } catch (_) {}
    await wait(150);
  }
  throw new Error("Connector service did not become healthy in 15s");
}

function hasNoSecretLeak(values) {
  const token = connectorToken();
  return values.every((value) => {
    const text = String(value || "");
    return !/sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,}/.test(text) && (!token || !text.includes(token));
  });
}

function buildIntegrityManifest() {
  fs.mkdirSync(path.dirname(integrityPath), { recursive: true });
  const files = [
    path.join(pluginDir, "manifest.json"),
    path.join(pluginDir, "main.js"),
    path.join(pluginDir, "styles.css"),
    path.join(__dirname, "server.js"),
    path.join(__dirname, "connector-auth-helper.js")
  ];
  const manifest = {
    id: "OBP-033-RELEASE-INTEGRITY",
    date: "2026-07-17",
    status: "PASS_WITH_CONDITIONS_LOCAL_INTEGRITY_HASHES",
    files: files.map((filePath) => ({ path: filePath, sha256: sha256(filePath) })),
    boundary: "Hashes prove local artifact integrity only. This is not code signing or marketplace approval."
  };
  fs.writeFileSync(integrityPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    const health = await waitForHealth();
    const unauthorizedAdmin = await request("GET", "/admin/snapshot", null, { auth: false });
    const unauthorizedPairing = await request("GET", "/mobile/pairing", null, { auth: false });
    const unauthorizedProvider = await request("POST", "/providers/connect", { input: "sk-test-not-real" }, { auth: false });
    const unauthorizedCompare = await request("POST", "/llm/compare", { source: "attack", live: false, prompt: "test" }, { auth: false });
    const badOrigin = await request("OPTIONS", "/admin/snapshot", null, { auth: false, headers: { origin: "http://evil.example", "access-control-request-method": "GET" } });
    const allowedOrigin = await request("GET", "/health", null, { auth: false, headers: { origin: `http://127.0.0.1:${port}` } });
    const authorizedPreflight = await request("GET", "/preflight");
    const authorizedSnapshot = await request("GET", "/admin/snapshot");
    const pairing = await request("GET", "/mobile/pairing");
    const mobileToken = pairing.json && pairing.json.token ? pairing.json.token : null;
    const mobileStatus = await request("GET", `/mobile/status?token=${encodeURIComponent(mobileToken || "")}`, null, { auth: false });
    const mobileCompare = await request("POST", "/llm/compare", { source: "mobile-web-security-proof", token: mobileToken, live: false, prompt: "security proof" }, { auth: false });
    const integrity = buildIntegrityManifest();

    const valuesForLeakCheck = [
      health.text,
      unauthorizedAdmin.text,
      unauthorizedPairing.text,
      unauthorizedProvider.text,
      unauthorizedCompare.text,
      badOrigin.text,
      allowedOrigin.text,
      authorizedPreflight.text,
      authorizedSnapshot.text,
      pairing.text,
      mobileStatus.text,
      mobileCompare.text,
      JSON.stringify(integrity)
    ];

    const checks = {
      connectorTokenFileExists: fs.existsSync(CONNECTOR_TOKEN_FILE),
      connectorTokenLoaded: Boolean(connectorToken()),
      tokenFingerprintPresent: Boolean(connectorTokenFingerprint()),
      healthPublicMinimal: health.ok && health.json && health.json.ok === true && health.json.connector.security.authRequired === true,
      adminSnapshotRequiresAuth: unauthorizedAdmin.status === 401,
      mobilePairingRequiresAuth: unauthorizedPairing.status === 401,
      providerConnectRequiresAuth: unauthorizedProvider.status === 401,
      llmCompareRequiresAuthWithoutMobileToken: unauthorizedCompare.status === 401,
      badCorsOriginBlocked: badOrigin.status === 403,
      noWildcardCorsOnAllowedOrigin: allowedOrigin.headers["access-control-allow-origin"] !== "*",
      allowedLocalCorsOriginEchoed: allowedOrigin.headers["access-control-allow-origin"] === `http://127.0.0.1:${port}`,
      authorizedPreflightWorks: authorizedPreflight.ok && authorizedPreflight.json && authorizedPreflight.json.ok === true,
      authorizedSnapshotWorks: authorizedSnapshot.ok && authorizedSnapshot.json && Array.isArray(authorizedSnapshot.json.devices),
      authenticatedPairingIssued: pairing.ok && Boolean(mobileToken),
      mobileStatusWorksWithPairingToken: mobileStatus.ok && mobileStatus.json && mobileStatus.json.ok === true,
      mobileCompareWorksWithPairingToken: Boolean(mobileCompare.ok && mobileCompare.json && mobileCompare.json.comparison),
      remoteRelayOffByDefault: authorizedPreflight.json && authorizedPreflight.json.preflight && authorizedPreflight.json.preflight.checks.mobileRemoteRelayReady === false,
      noSecretLeak: hasNoSecretLeak(valuesForLeakCheck),
      releaseIntegrityManifestWritten: fs.existsSync(integrityPath) && integrity.files.length >= 5
    };
    const passed = Object.values(checks).every(Boolean);
    const proof = {
      id: "OBP-033",
      date: "2026-07-17",
      project: "SYM-SaaS / Symbiot Obsidian Plugin Connector",
      gate: "Security Hardening for Local Connector",
      status: passed ? "PASS_WITH_CONDITIONS_SECURITY_HARDENING_LOCAL" : "YELLOW_SECURITY_HARDENING_INCOMPLETE",
      baseUrl,
      connectorTokenFile: CONNECTOR_TOKEN_FILE,
      connectorTokenFingerprint: connectorTokenFingerprint(),
      integrityManifest: integrityPath,
      checks,
      boundaries: [
        "Local connector endpoints now require connector-token except public health/mobile page/QR and mobile pairing-token flow.",
        "CORS is local allowlist, not wildcard.",
        "Mobile web uses short pairing-token, not the connector-token.",
        "Release integrity is local hash manifest only, not signed distribution.",
        "Production tenant security, remote relay and marketplace release remain YELLOW/RED."
      ]
    };
    fs.writeFileSync(evidencePath, JSON.stringify(proof, null, 2), "utf8");
    console.log(JSON.stringify(proof, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    if (!child.killed) child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

