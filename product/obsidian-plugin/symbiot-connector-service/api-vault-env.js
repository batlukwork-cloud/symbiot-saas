const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");

const DEFAULT_VAULT_ROOT = ""; // задаётся через SYMBIOT_API_VAULT_ROOT
const ENV_RECORDS = [
  ["sym-saas.supabase.url", "SYMBIOT_SUPABASE_URL"],
  ["sym-saas.supabase.publishable-key", "SYMBIOT_SUPABASE_PUBLISHABLE_KEY"],
  ["sym-saas.supabase.secret-key", "SYMBIOT_SUPABASE_SECRET_KEY"],
  ["sym-saas.supabase.db-url", "SYMBIOT_SUPABASE_DB_URL"],
  ["sym-saas.deepseek.api-key", "DEEPSEEK_API_KEY"],
  ["sym-saas.openrouter.api-key", "OPENROUTER_API_KEY"],
  ["sym-saas.google.api-key", "GOOGLE_API_KEY"]
];

function fingerprint(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

function revealRecord({ id, storeFile, getScript, powershell }) {
  const command = `$ErrorActionPreference='Stop'; & '${getScript.replace(/'/g, "''")}' -Id $env:SYMBIOT_API_VAULT_ID -StorePath $env:SYMBIOT_API_VAULT_STORE_FILE -Reveal`;
  return String(execFileSync(powershell, ["-NoProfile", "-Command", command], {
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, SYMBIOT_API_VAULT_ID: id, SYMBIOT_API_VAULT_STORE_FILE: storeFile },
    stdio: ["ignore", "pipe", "pipe"]
  }) || "").replace(/\r?\n$/, "").trim();
}

function hydrateApiVaultEnv(options = {}) {
  const vaultRoot = options.vaultRoot || process.env.SYMBIOT_API_VAULT_ROOT || DEFAULT_VAULT_ROOT;
  const storeFile = path.join(vaultRoot, "store", "api-secrets.dpapi.json");
  const getScript = path.join(vaultRoot, "scripts", "Get-ApiSecret.ps1");
  const powershell = process.env.SYMBIOT_POWERSHELL_EXE || "pwsh.exe";
  const summary = { available: fs.existsSync(storeFile) && fs.existsSync(getScript), loaded: [], alreadyPresent: [], missing: [], failed: [] };
  if (!summary.available) return summary;
  const selected = Array.isArray(options.records) ? options.records : ENV_RECORDS;
  const pending = [];
  for (const [id, envName] of selected) {
    if (String(process.env[envName] || "").trim()) summary.alreadyPresent.push({ id, envName, fingerprint: fingerprint(process.env[envName]) });
    else pending.push({ id, envName });
  }
  if (!pending.length) return summary;
  try {
    const command = [
      "$ErrorActionPreference='SilentlyContinue';",
      "$records = $env:SYMBIOT_API_VAULT_RECORDS | ConvertFrom-Json;",
      "$result = @{};",
      "foreach($record in $records){ try {",
      `  $value = & '${getScript.replace(/'/g, "''")}' -Id ([string]$record.id) -StorePath $env:SYMBIOT_API_VAULT_STORE_FILE -Reveal 2>$null;`,
      "  if($value){ $result[[string]$record.envName] = [string]$value }",
      "} catch {} };",
      "$result | ConvertTo-Json -Compress"
    ].join(" ");
    const output = execFileSync(powershell, ["-NoProfile", "-Command", command], {
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, SYMBIOT_API_VAULT_RECORDS: JSON.stringify(pending), SYMBIOT_API_VAULT_STORE_FILE: storeFile },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const values = JSON.parse(String(output || "{}").trim() || "{}");
    for (const record of pending) {
      const value = String(values[record.envName] || "").trim();
      if (!value) summary.missing.push(record);
      else {
        process.env[record.envName] = value;
        summary.loaded.push({ ...record, fingerprint: fingerprint(value) });
      }
    }
  } catch (error) {
    for (const record of pending) summary.failed.push({ ...record, error: String(error.message || error).split(/\r?\n/)[0] });
  }
  return summary;
}

module.exports = { hydrateApiVaultEnv, fingerprint, ENV_RECORDS };
