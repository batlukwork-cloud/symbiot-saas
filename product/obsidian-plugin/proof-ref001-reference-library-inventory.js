const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONNECTOR = path.join(ROOT, "symbiot-connector-service");
const RUNTIME_LOGS = path.join(ROOT, "runtime_logs");
const PILOT_ROOT = path.join(ROOT, "..", "..", "docs", "00_idea");
const {
  INVENTORY_VERSION,
  scanReferenceLibraries
} = require(path.join(CONNECTOR, "symbiot-reference-library"));

const EXPECTED_FILES = [
  "WHITE_PAPER_SYMBIOT_PRODUCT_BENEFITS_2026-07-20.docx",
  "benchmark_matrix_Symbiot_vs_JustAI_vs_Product_Isaev_2026-07-20.xlsx"
];

function sourceSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  return { sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs };
}

function noSecretLikeFields(value) {
  return !/api[_-]?key|password|secret[_-]?value|authorization/i.test(JSON.stringify(value));
}

fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
const expectedPaths = EXPECTED_FILES.map((fileName) => path.join(PILOT_ROOT, fileName));
const before = Object.fromEntries(expectedPaths.map((filePath) => [filePath, sourceSnapshot(filePath)]));
let emptyRootsBlocked = false;
try {
  scanReferenceLibraries({ roots: [] });
} catch (error) {
  emptyRootsBlocked = /explicit_roots_required/.test(error.message);
}

const options = {
  roots: [{
    rootId: "sym_saas_l0_product_promise",
    libraryType: "product_documents",
    path: PILOT_ROOT
  }],
  includeHash: true,
  maxFiles: 5000
};
const first = scanReferenceLibraries(options);
const second = scanReferenceLibraries(options);
const after = Object.fromEntries(expectedPaths.map((filePath) => [filePath, sourceSnapshot(filePath)]));
const indexedNames = new Set(first.records.map((record) => record.fileName));
const checks = {
  explicitRootsRequired: emptyRootsBlocked,
  pilotRootExists: fs.existsSync(PILOT_ROOT),
  expectedMarketFilesIndexed: EXPECTED_FILES.every((fileName) => indexedNames.has(fileName)),
  stableRerun: first.inventorySha256 === second.inventorySha256,
  stableUniqueIds: new Set(first.records.map((record) => record.sourceId)).size === first.records.length,
  everyFileHasSha256: first.records.every((record) => /^[a-f0-9]{64}$/.test(record.sha256)),
  noContentExtracted: first.records.every((record) => record.contentExtracted === false),
  noSourceMutation: expectedPaths.every((filePath) =>
    before[filePath].sizeBytes === after[filePath].sizeBytes &&
    before[filePath].modifiedAtMs === after[filePath].modifiedAtMs
  ),
  rawNotGold: first.records.every((record) => record.qualityStatus === "RAW"),
  noSecretLikeFields: noSecretLikeFields(first),
  inventoryPolicyEnforced:
    first.policy.explicitRootsOnly === true &&
    first.policy.contentExtraction === false &&
    first.policy.fileMutation === false &&
    first.policy.symbolicLinksFollowed === false
};
const passed = Object.values(checks).every(Boolean);
const evidence = {
  id: "SYM_SAAS_REF001_REFERENCE_LIBRARY_INVENTORY_PROOF_2026-07-26",
  createdAt: new Date().toISOString(),
  status: passed
    ? "PASS_WITH_CONDITIONS_REFERENCE_INVENTORY_PILOT_YELLOW"
    : "FAIL_REFERENCE_INVENTORY",
  runtimeLevel: "explicit_root_metadata_inventory_pilot",
  boundary:
    "Доказывает инженерный inventory scanner на одном явно разрешенном корне L0. Не доказывает полный охват библиотек, утвержденную типологию, GOLD, semantic RAG, tenant isolation или market-ready.",
  inventoryVersion: INVENTORY_VERSION,
  checks,
  inventory: first
};
const evidencePath = path.join(
  RUNTIME_LOGS,
  "SYM_SAAS_REF001_REFERENCE_LIBRARY_INVENTORY_PROOF_2026-07-26.json"
);
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

console.log(JSON.stringify({
  passed,
  status: evidence.status,
  evidencePath,
  summary: first.summary,
  checks
}, null, 2));
if (!passed) process.exitCode = 1;
