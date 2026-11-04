const { requestHeaders, connectorTokenFingerprint, CONNECTOR_TOKEN_FILE } = require("./connector-auth-helper");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.SYMBIOT_CONNECTOR_URL || "http://127.0.0.1:8787";
const OUT_DIR = path.join(__dirname, "..", "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_MOBILE_QR_WEB_FLOW_PROOF_2026-07-17.json");

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: requestHeaders(body),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), text, json };
}

function hasNoSecretLeak(values) {
  return !values.some((value) => /sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,}/.test(String(value || "")));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const health = await request("GET", `${BASE_URL}/health`);
  const mobileStatus = await request("GET", `${BASE_URL}/mobile/status`);
  const pairing = await request("GET", `${BASE_URL}/mobile/pairing`);
  const qr = pairing.json && pairing.json.qrUrl ? await request("GET", pairing.json.qrUrl) : { ok: false, status: 0, text: "" };
  const mobileHtml = pairing.json && pairing.json.url ? await request("GET", pairing.json.url) : { ok: false, status: 0, text: "" };
  const compare = await request("POST", `${BASE_URL}/llm/compare`, {
    source: "mobile-web-proof",
    token: pairing.json ? pairing.json.token : null,
    live: true,
    prompt: "Symbiot mobile proof: ответь одной короткой строкой, что mobile LLM hub работает."
  });

  const results = compare.json && compare.json.comparison && Array.isArray(compare.json.comparison.results) ? compare.json.comparison.results : [];
  const checks = {
    healthOk: health.ok && health.json && health.json.ok === true,
    mobileStatusOk: mobileStatus.ok && mobileStatus.json && mobileStatus.json.mobile && mobileStatus.json.mobile.webAppReady === true,
    mobileQrReady: mobileStatus.ok && mobileStatus.json && mobileStatus.json.mobile && mobileStatus.json.mobile.qrPairingReady === true,
    pairingIssued: pairing.ok && pairing.json && Boolean(pairing.json.token) && Boolean(pairing.json.url) && Boolean(pairing.json.qrUrl),
    qrSvgReturned: qr.ok && /<svg[\s>]/i.test(qr.text) && /image\/svg\+xml/i.test(qr.headers["content-type"] || ""),
    mobileHtmlReturned: mobileHtml.ok && mobileHtml.text.includes("Симбиот: мобильный доступ") && mobileHtml.text.includes("Запустить три окна"),
    mobileCompareReachable: compare.ok && compare.json && compare.json.comparison && results.length >= 1,
    threeWindowShape: results.length === 3,
    noSecretLeak: hasNoSecretLeak([pairing.text, qr.text, mobileHtml.text, compare.text]),
    remoteRelayStillYellow: mobileStatus.json && mobileStatus.json.mobile && mobileStatus.json.mobile.remoteAccessReady === false
  };
  const passed = Object.values(checks).every(Boolean);
  const proof = {
    id: "OBP-013",
    date: "2026-07-17",
    project: "SYM-SaaS / Symbiot Obsidian Plugin",
    gate: "Mobile QR Web Connector MVP",
    status: passed ? "PASS_WITH_CONDITIONS_MOBILE_QR_WEB_FLOW" : "YELLOW_MOBILE_QR_WEB_FLOW_INCOMPLETE",
    baseUrl: BASE_URL,
    pairing: pairing.json ? { url: pairing.json.url, qrUrl: pairing.json.qrUrl, expiresAt: pairing.json.expiresAt } : null,
    comparisonStatus: compare.json && compare.json.comparison ? compare.json.comparison.status : null,
    providerStatuses: results.map((result) => ({ providerId: result.providerId, status: result.status, protocol: result.protocol })),
    checks,
    boundaries: [
      "Mobile local web panel and QR pairing are proven against the local connector.",
      "Production remote relay remains YELLOW and must not be promised as market-ready.",
      "No API key values are written to this proof."
    ]
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(proof, null, 2), "utf8");
  console.log(JSON.stringify(proof, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


