const { createHash } = require("crypto");

const TAXONOMY_VERSION = "2026.07.26-v1";
const CLASSIFIED_THRESHOLD = 0.88;

const ARTIFACT_FAMILIES = Object.freeze([
  "product_document",
  "architecture_document",
  "business_document",
  "knowledge_document",
  "presentation",
  "brand_asset",
  "financial_model",
  "structured_data",
  "project_material",
  "visual_evidence",
  "visual_asset",
  "accepted_result",
  "unknown"
]);

const CLASSIFICATION_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://symbiot.local/schemas/reference-classification-v1.json",
  title: "Symbiot Reference Classification",
  type: "object",
  additionalProperties: false,
  required: [
    "classificationVersion",
    "sourceId",
    "artifactFamily",
    "artifactType",
    "roleIds",
    "taskTypes",
    "classificationStatus",
    "confidence",
    "matchedRuleIds",
    "reasons",
    "qualityStatus",
    "classificationSha256"
  ],
  properties: {
    classificationVersion: { const: TAXONOMY_VERSION },
    sourceId: { type: "string", minLength: 5 },
    artifactFamily: { enum: ARTIFACT_FAMILIES },
    artifactType: { type: "string", minLength: 3 },
    roleIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    taskTypes: { type: "array", items: { type: "string" }, uniqueItems: true },
    classificationStatus: { enum: ["CLASSIFIED", "NEEDS_REVIEW"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    matchedRuleIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    reasons: { type: "array", items: { type: "string" }, minItems: 1 },
    qualityStatus: { const: "RAW" },
    classificationSha256: { type: "string", pattern: "^[a-f0-9]{64}$" }
  }
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rule(id, pattern, extensions, result) {
  return { id, pattern, extensions: new Set(extensions), ...result };
}

const RULES = Object.freeze([
  rule("TX-001", /white[_\s-]?paper|бел[а-я]*\s+книг/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "product_document",
    artifactType: "white_paper",
    roleIds: ["product_methodologist", "product_marketer"],
    taskTypes: ["product_positioning", "market_promise"],
    confidence: 0.99
  }),
  rule("TX-002", /benchmark[_\s-]?matrix|матриц[а-я]*\s+бенчмарк/i, [".xlsx", ".csv"], {
    artifactFamily: "product_document",
    artifactType: "benchmark_matrix",
    roleIds: ["product_analyst", "quality_controller"],
    taskTypes: ["benchmark_validation", "acceptance_planning"],
    confidence: 0.99
  }),
  rule("TX-003", /полн[а-я]*[_\s-]?бенчмарк|full[_\s-]?benchmark/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "product_document",
    artifactType: "benchmark_specification",
    roleIds: ["product_analyst", "quality_controller"],
    taskTypes: ["benchmark_definition", "acceptance_planning"],
    confidence: 0.97
  }),
  rule("TX-004", /role[_\s-]?(runtime|system)[_\s-]?(concept|architecture)|архитектур[а-я]*\s+рол/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "architecture_document",
    artifactType: "role_runtime_architecture",
    roleIds: ["system_architect", "role_methodologist"],
    taskTypes: ["runtime_design", "role_design"],
    confidence: 0.98
  }),
  rule("TX-005", /financial[_\s-]?model|финансов[а-я]*[_\s-]?модел/i, [".xlsx", ".xlsm", ".xls"], {
    artifactFamily: "financial_model",
    artifactType: "financial_model",
    roleIds: ["financial_analyst", "quality_controller"],
    taskTypes: ["financial_modeling", "calculation_validation"],
    confidence: 0.98
  }),
  rule("TX-006", /бизнес[_\s-]?план|business[_\s-]?plan/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "business_document",
    artifactType: "business_plan",
    roleIds: ["business_analyst", "financial_analyst"],
    taskTypes: ["business_planning", "investment_packaging"],
    confidence: 0.98
  }),
  rule("TX-007", /договор|contract|agreement/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "business_document",
    artifactType: "contract",
    roleIds: ["legal_controller", "document_executor"],
    taskTypes: ["contract_drafting", "legal_review"],
    confidence: 0.96
  }),
  rule("TX-008", /стандарт|регламент|standard|regulation|policy/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "business_document",
    artifactType: "standard_or_regulation",
    roleIds: ["methodologist", "quality_controller"],
    taskTypes: ["standards_application", "compliance_review"],
    confidence: 0.95
  }),
  rule("TX-009", /отчет|report/i, [".docx", ".pdf", ".md", ".html"], {
    artifactFamily: "business_document",
    artifactType: "report",
    roleIds: ["document_executor", "quality_controller"],
    taskTypes: ["reporting", "result_delivery"],
    confidence: 0.93
  }),
  rule("TX-010", /методик|методолог|guide|гайд|digest|research|исследован/i, [".docx", ".pdf", ".md"], {
    artifactFamily: "knowledge_document",
    artifactType: "methodology_or_digest",
    roleIds: ["methodologist", "researcher"],
    taskTypes: ["method_development", "knowledge_grounding"],
    confidence: 0.92
  }),
  rule("TX-011", /инвестиц[а-я]*[_\s-]?презент|investor[_\s-]?deck/i, [".pptx", ".ppt"], {
    artifactFamily: "presentation",
    artifactType: "investment_presentation",
    roleIds: ["presentation_designer", "financial_analyst"],
    taskTypes: ["investment_packaging", "presentation_production"],
    confidence: 0.97
  }),
  rule("TX-012", /презентац|presentation|pitch[_\s-]?deck/i, [".pptx", ".ppt"], {
    artifactFamily: "presentation",
    artifactType: "presentation",
    roleIds: ["presentation_designer", "product_marketer"],
    taskTypes: ["presentation_production", "visual_packaging"],
    confidence: 0.93
  }),
  rule("TX-013", /brand|бренд|logo|логотип|identity|айдентик/i, [".png", ".jpg", ".jpeg", ".svg", ".pdf"], {
    artifactFamily: "brand_asset",
    artifactType: "brand_identity_asset",
    roleIds: ["brand_designer", "quality_controller"],
    taskTypes: ["brand_application", "visual_validation"],
    confidence: 0.95
  }),
  rule("TX-014", /^(qa\d*|proof|render)[_\s-]?(page|screen)|скриншот|screenshot/i, [".png", ".jpg", ".jpeg", ".webp"], {
    artifactFamily: "visual_evidence",
    artifactType: "rendered_page_evidence",
    roleIds: ["quality_controller", "visual_controller"],
    taskTypes: ["visual_qa", "artifact_acceptance"],
    confidence: 0.96
  }),
  rule("TX-015", /принят|accepted|approved[_\s-]?result|final[_\s-]?accepted/i, [".docx", ".pdf", ".xlsx", ".pptx", ".md", ".html"], {
    artifactFamily: "accepted_result",
    artifactType: "accepted_artifact",
    roleIds: ["quality_controller", "archive_registrar"],
    taskTypes: ["reference_promotion", "result_reuse"],
    confidence: 0.94
  })
]);

const EXTENSION_FALLBACKS = Object.freeze({
  ".pptx": ["presentation", "presentation", 0.76],
  ".ppt": ["presentation", "presentation", 0.74],
  ".xlsx": ["structured_data", "spreadsheet", 0.7],
  ".xlsm": ["structured_data", "spreadsheet", 0.7],
  ".csv": ["structured_data", "tabular_data", 0.72],
  ".docx": ["business_document", "document", 0.66],
  ".pdf": ["knowledge_document", "reference_pdf", 0.66],
  ".md": ["knowledge_document", "knowledge_note", 0.64],
  ".png": ["visual_asset", "image", 0.62],
  ".jpg": ["visual_asset", "image", 0.62],
  ".jpeg": ["visual_asset", "image", 0.62],
  ".svg": ["visual_asset", "vector_image", 0.66],
  ".html": ["project_material", "html_artifact", 0.68]
});

function validateInventoryRecord(record) {
  const errors = [];
  for (const key of ["sourceId", "fileName", "extension", "relativePath", "libraryType", "qualityStatus"]) {
    if (!record || typeof record[key] !== "string" || !record[key].trim()) errors.push(`missing_or_invalid:${key}`);
  }
  if (record && record.qualityStatus !== "RAW") errors.push("inventory_quality_status_must_be_RAW");
  return { valid: errors.length === 0, errors };
}

function classifyInventoryRecord(record) {
  const validation = validateInventoryRecord(record);
  if (!validation.valid) throw new Error(`reference_taxonomy_record_invalid:${validation.errors.join(",")}`);

  const normalizedName = record.fileName.toLowerCase();
  const extension = record.extension.toLowerCase();
  const matches = RULES.filter((candidate) =>
    candidate.extensions.has(extension) && candidate.pattern.test(normalizedName)
  ).sort((left, right) => right.confidence - left.confidence);
  let selected = matches[0];
  let reasons = matches.map((match) => `matched:${match.id}`);

  if (!selected) {
    const fallback = EXTENSION_FALLBACKS[extension] || ["unknown", "unknown", 0.2];
    selected = {
      id: "TX-FALLBACK",
      artifactFamily: fallback[0],
      artifactType: fallback[1],
      roleIds: [],
      taskTypes: [],
      confidence: fallback[2]
    };
    reasons = [`fallback_by_extension:${extension}`];
  }

  const tiedConflict = matches.some((match) =>
    match.id !== selected.id &&
    match.confidence === selected.confidence &&
    (match.artifactFamily !== selected.artifactFamily || match.artifactType !== selected.artifactType)
  );
  const classificationStatus =
    selected.confidence >= CLASSIFIED_THRESHOLD && !tiedConflict
      ? "CLASSIFIED"
      : "NEEDS_REVIEW";
  if (tiedConflict) reasons.push("conflicting_equal_confidence_rules");
  if (selected.confidence < CLASSIFIED_THRESHOLD) reasons.push("confidence_below_threshold");

  const classification = {
    classificationVersion: TAXONOMY_VERSION,
    sourceId: record.sourceId,
    artifactFamily: selected.artifactFamily,
    artifactType: selected.artifactType,
    roleIds: [...new Set(selected.roleIds)].sort(),
    taskTypes: [...new Set(selected.taskTypes)].sort(),
    classificationStatus,
    confidence: selected.confidence,
    matchedRuleIds: matches.length ? matches.map((match) => match.id) : [selected.id],
    reasons,
    qualityStatus: "RAW"
  };
  classification.classificationSha256 = sha256(JSON.stringify(classification));
  return classification;
}

function validateClassification(value) {
  const errors = [];
  if (!value || value.classificationVersion !== TAXONOMY_VERSION) errors.push("classificationVersion");
  if (!value || !ARTIFACT_FAMILIES.includes(value.artifactFamily)) errors.push("artifactFamily");
  if (!value || !["CLASSIFIED", "NEEDS_REVIEW"].includes(value.classificationStatus)) errors.push("classificationStatus");
  if (!value || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence");
  if (!value || value.qualityStatus !== "RAW") errors.push("qualityStatus");
  if (!value || !/^[a-f0-9]{64}$/.test(value.classificationSha256 || "")) errors.push("classificationSha256");
  for (const key of ["roleIds", "taskTypes", "matchedRuleIds", "reasons"]) {
    if (!value || !Array.isArray(value[key])) errors.push(key);
  }
  return { valid: errors.length === 0, errors };
}

function classifyInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.records)) throw new Error("reference_taxonomy_inventory_invalid");
  const classifications = inventory.records.map(classifyInventoryRecord);
  const summary = classifications.reduce((result, item) => {
    result.statusCounts[item.classificationStatus] =
      (result.statusCounts[item.classificationStatus] || 0) + 1;
    result.familyCounts[item.artifactFamily] =
      (result.familyCounts[item.artifactFamily] || 0) + 1;
    return result;
  }, { statusCounts: {}, familyCounts: {} });
  const output = {
    version: TAXONOMY_VERSION,
    inventorySha256: inventory.inventorySha256,
    policy: {
      deterministicRulesOnly: true,
      contentRead: false,
      llmCalls: 0,
      automaticGoldPromotion: false,
      ambiguousFilesRequireReview: true,
      classifiedThreshold: CLASSIFIED_THRESHOLD
    },
    summary,
    classifications
  };
  output.taxonomySha256 = sha256(JSON.stringify(output));
  return output;
}

module.exports = {
  ARTIFACT_FAMILIES,
  CLASSIFICATION_SCHEMA,
  CLASSIFIED_THRESHOLD,
  RULES,
  TAXONOMY_VERSION,
  classifyInventory,
  classifyInventoryRecord,
  validateClassification,
  validateInventoryRecord
};
