const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

const CONNECTOR_DATA_DIR = process.env.SYMBIOT_CONNECTOR_DATA_DIR || path.join(process.env.APPDATA || os.tmpdir(), "Symbiot", "connector");
const CONNECTOR_TOKEN_FILE = path.join(CONNECTOR_DATA_DIR, "connector-token.json");

function connectorToken() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONNECTOR_TOKEN_FILE, "utf8"));
    return parsed && typeof parsed.token === "string" ? parsed.token : null;
  } catch (_) {
    return null;
  }
}

function connectorTokenFingerprint() {
  const token = connectorToken();
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 12) : null;
}

function requestHeaders(body) {
  const headers = body ? { "content-type": "application/json" } : {};
  const token = connectorToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

module.exports = { CONNECTOR_TOKEN_FILE, connectorToken, connectorTokenFingerprint, requestHeaders };
