const { createHash } = require("crypto");
const path = require("path");
const {
  scanReferenceLibraries
} = require("./symbiot-reference-library");
const {
  classifyInventory
} = require("./symbiot-reference-taxonomy");

const ADAPTER_VERSION = "2026.07.27-v1";
const DEFAULT_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map();
const DEFAULT_LIBRARY_BASE_PATH =
  "D:\\СИСТЕМА\\02_БИБЛИОТЕКИ_СИМБИОТА";

const CORE_MISSION_ROLE_IDS = [
  "mission_methodologist",
  "researcher",
  "document_executor",
  "data_analyst",
  "developer",
  "quality_controller",
  "risk_controller",
  "archive_registrar"
];

const DEFAULT_LIBRARY_ADAPTERS = Object.freeze([
  {
    libraryId: "lib_document_templates",
    label: "Шаблоны и типовые документы",
    libraryType: "document_templates",
    relativeRoot: "01_ШАБЛОНЫ_И_ТИПОВЫЕ_ДОКУМЕНТЫ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "document_executor",
      "legal_controller",
      "methodologist",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_financial_models",
    label: "Финансы и финмодели",
    libraryType: "financial_models",
    relativeRoot: "02_ФИНАНСЫ_И_ФИНМОДЕЛИ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "financial_analyst",
      "business_analyst",
      "data_analyst",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_sales_commercial",
    label: "Продажи и коммерческий блок",
    libraryType: "sales_commercial",
    relativeRoot: "03_ПРОДАЖИ_И_КОММЕРЧЕСКИЙ_БЛОК",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "business_analyst",
      "product_marketer",
      "document_executor",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_marketing_brand",
    label: "Маркетинг, презентации и бренд",
    libraryType: "marketing_brand",
    relativeRoot: "04_МАРКЕТИНГ_ПРЕЗЕНТАЦИИ_БРЕНД",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "presentation_designer",
      "brand_designer",
      "product_marketer",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_rea_development",
    label: "REA девелопмент и методики",
    libraryType: "rea_development_methods",
    relativeRoot: "05_REA_ДЕВЕЛОПМЕНТ_МЕТОДИКИ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_ai_roles_sources",
    label: "AI-роли и исходники",
    libraryType: "ai_roles_sources",
    relativeRoot: "06_AI_РОЛИ_И_ИСХОДНИКИ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "role_methodologist",
      "system_architect",
      "developer",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_accepted_examples",
    label: "Примеры качественных результатов",
    libraryType: "accepted_examples",
    relativeRoot: "07_ПРИМЕРЫ_КАЧЕСТВЕННЫХ_РЕЗУЛЬТАТОВ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "document_executor",
      "methodologist",
      "quality_controller",
      "archive_registrar"
    ]
  },
  {
    libraryId: "lib_accounting_primary",
    label: "Бухгалтерия и первичка",
    libraryType: "accounting_primary",
    relativeRoot: "09_БУХГАЛТЕРИЯ_И_ПЕРВИЧКА",
    allowedRoleIds: [
      "data_analyst",
      "risk_controller",
      "quality_controller",
      "archive_registrar"
    ]
  },
  {
    libraryId: "lib_project_cases",
    label: "Проектные кейсы и пакеты",
    libraryType: "project_cases",
    relativeRoot: "11_ПРОЕКТНЫЕ_КЕЙСЫ_И_ПАКЕТЫ",
    allowedRoleIds: [
      ...CORE_MISSION_ROLE_IDS,
      "business_analyst",
      "quality_controller"
    ]
  },
  {
    libraryId: "lib_books_methods",
    label: "Книги и методические источники",
    libraryType: "books_methods",
    relativeRoot: "14_КНИГИ_И_МЕТОДИЧЕСКИЕ_ИСТОЧНИКИ",
    allowedRoleIds: [
      "mission_methodologist",
      "researcher",
      "document_executor",
      "quality_controller",
      "archive_registrar"
    ]
  }
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "");
}

function isPathInside(basePath, candidatePath) {
  const relative = path.relative(normalizedPath(basePath), normalizedPath(candidatePath));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function normalizeAdapter(adapter, index, basePath) {
  const libraryId = String(adapter && adapter.libraryId || "").trim();
  const label = String(adapter && adapter.label || "").trim();
  const libraryType = String(adapter && adapter.libraryType || "").trim();
  const relativeRoot = String(adapter && adapter.relativeRoot || "").trim();
  const allowedRoleIds = Array.isArray(adapter && adapter.allowedRoleIds)
    ? [...new Set(adapter.allowedRoleIds.map((item) => String(item).trim()).filter(Boolean))].sort()
    : [];
  if (!libraryId || !label || !libraryType || !relativeRoot || !allowedRoleIds.length) {
    throw new Error(`reference_adapter_invalid:${index}`);
  }
  const rootPath = normalizedPath(path.join(basePath, relativeRoot));
  if (!isPathInside(basePath, rootPath)) {
    throw new Error(`reference_adapter_outside_approved_base:${libraryId}`);
  }
  return {
    libraryId,
    label,
    libraryType,
    relativeRoot: relativeRoot.replace(/\\/g, "/"),
    rootPath,
    allowedRoleIds,
    accessMode: "READ_ONLY",
    writeAllowed: false,
    automaticGoldPromotion: false
  };
}

function catalogCacheKey({ basePath, adapters, includeHash, maxFilesPerLibrary }) {
  return sha256(JSON.stringify({
    basePath: normalizedPath(basePath),
    adapters,
    includeHash,
    maxFilesPerLibrary
  }));
}

function clearSeparatedLibraryCatalogCache() {
  catalogCache.clear();
}

function buildSeparatedLibraryCatalog(options = {}) {
  const basePath = normalizedPath(options.basePath || DEFAULT_LIBRARY_BASE_PATH);
  const rawAdapters = Array.isArray(options.adapters)
    ? options.adapters
    : DEFAULT_LIBRARY_ADAPTERS;
  if (!rawAdapters.length) throw new Error("reference_adapters_required");

  const adapters = rawAdapters.map((adapter, index) =>
    normalizeAdapter(adapter, index, basePath)
  );
  if (new Set(adapters.map((adapter) => adapter.libraryId)).size !== adapters.length) {
    throw new Error("reference_adapter_library_id_duplicate");
  }
  if (new Set(adapters.map((adapter) => adapter.rootPath.toLowerCase())).size !== adapters.length) {
    throw new Error("reference_adapter_root_duplicate");
  }

  const includeHash = options.includeHash !== false;
  const maxFilesPerLibrary = options.maxFilesPerLibrary || 20000;
  const cacheTtlMs = Math.max(0, Number(
    options.cacheTtlMs == null
      ? process.env.SYMBIOT_LIBRARY_CACHE_TTL_MS || DEFAULT_CATALOG_CACHE_TTL_MS
      : options.cacheTtlMs
  ));
  const cacheKey = catalogCacheKey({ basePath, adapters, includeHash, maxFilesPerLibrary });
  const cached = catalogCache.get(cacheKey);
  if (cached && cacheTtlMs > 0 && Date.now() - cached.createdAt < cacheTtlMs) {
    Object.defineProperty(cached.catalog, "_runtimeCache", {
      configurable: true,
      enumerable: false,
      value: { status: "hit", ageMs: Date.now() - cached.createdAt, ttlMs: cacheTtlMs }
    });
    return cached.catalog;
  }

  const items = [];
  const adapterSummaries = [];
  for (const adapter of adapters) {
    const inventory = scanReferenceLibraries({
      roots: [{
        rootId: adapter.libraryId,
        libraryType: adapter.libraryType,
        path: adapter.rootPath
      }],
      includeHash,
      maxFiles: maxFilesPerLibrary
    });
    const taxonomy = classifyInventory(inventory);
    const classificationBySourceId = new Map(
      taxonomy.classifications.map((classification) => [
        classification.sourceId,
        classification
      ])
    );
    for (const record of inventory.records) {
      items.push({
        libraryId: adapter.libraryId,
        libraryLabel: adapter.label,
        libraryType: adapter.libraryType,
        accessMode: "READ_ONLY",
        writeAllowed: false,
        automaticGoldPromotion: false,
        allowedRoleIds: adapter.allowedRoleIds,
        inventory: record,
        classification: classificationBySourceId.get(record.sourceId)
      });
    }
    adapterSummaries.push({
      libraryId: adapter.libraryId,
      label: adapter.label,
      libraryType: adapter.libraryType,
      rootPath: adapter.rootPath,
      accessMode: "READ_ONLY",
      writeAllowed: false,
      automaticGoldPromotion: false,
      allowedRoleIds: adapter.allowedRoleIds,
      fileCount: inventory.summary.fileCount,
      totalBytes: inventory.summary.totalBytes,
      extensionCounts: inventory.summary.extensionCounts,
      taxonomyStatusCounts: taxonomy.summary.statusCounts,
      taxonomyFamilyCounts: taxonomy.summary.familyCounts
    });
  }

  items.sort((left, right) =>
    `${left.libraryId}:${left.inventory.relativePath}`.localeCompare(
      `${right.libraryId}:${right.inventory.relativePath}`,
      "ru"
    )
  );
  const duplicateGroups = Object.entries(
    items.reduce((groups, item) => {
      const hash = item.inventory.sha256;
      if (!hash) return groups;
      groups[hash] = groups[hash] || [];
      groups[hash].push({
        libraryId: item.libraryId,
        sourceId: item.inventory.sourceId
      });
      return groups;
    }, {})
  )
    .filter(([, references]) => references.length > 1)
    .map(([hash, references]) => ({ sha256: hash, references }));

  const catalog = {
    version: ADAPTER_VERSION,
    basePath,
    policy: {
      approvedBaseOnly: true,
      separatedLibraries: true,
      accessMode: "READ_ONLY",
      fileMutation: false,
      contentExtraction: false,
      llmCalls: 0,
      automaticGoldPromotion: false,
      roleAllowlistRequired: true
    },
    adapters,
    summary: {
      libraryCount: adapters.length,
      fileCount: items.length,
      totalBytes: items.reduce(
        (total, item) => total + item.inventory.sizeBytes,
        0
      ),
      duplicateGroupCount: duplicateGroups.length,
      adapterSummaries
    },
    items,
    duplicateGroups
  };
  catalog.catalogSha256 = sha256(JSON.stringify(catalog));
  Object.defineProperty(catalog, "_runtimeCache", {
    configurable: true,
    enumerable: false,
    value: { status: "miss", ageMs: 0, ttlMs: cacheTtlMs }
  });
  if (cacheTtlMs > 0) catalogCache.set(cacheKey, { catalog, createdAt: Date.now() });
  return catalog;
}

function selectReferencesForRole(catalog, options = {}) {
  if (!catalog || !Array.isArray(catalog.items)) {
    throw new Error("reference_adapter_catalog_invalid");
  }
  const roleId = String(options.roleId || "").trim();
  if (!roleId) throw new Error("reference_adapter_role_required");
  const requestedLibraryIds = Array.isArray(options.libraryIds)
    ? new Set(options.libraryIds.map((item) => String(item)))
    : null;
  const maxResults = Math.max(1, Math.min(Number(options.maxResults || 20), 100));
  return catalog.items
    .filter((item) => item.allowedRoleIds.includes(roleId))
    .filter((item) => !requestedLibraryIds || requestedLibraryIds.has(item.libraryId))
    .slice(0, maxResults)
    .map((item) => ({
      libraryId: item.libraryId,
      sourceId: item.inventory.sourceId,
      relativePath: item.inventory.relativePath,
      fileName: item.inventory.fileName,
      extension: item.inventory.extension,
      sha256: item.inventory.sha256,
      qualityStatus: "RAW",
      classificationStatus: item.classification.classificationStatus,
      artifactFamily: item.classification.artifactFamily,
      accessMode: "READ_ONLY"
    }));
}

module.exports = {
  ADAPTER_VERSION,
  DEFAULT_CATALOG_CACHE_TTL_MS,
  DEFAULT_LIBRARY_ADAPTERS,
  DEFAULT_LIBRARY_BASE_PATH,
  buildSeparatedLibraryCatalog,
  clearSeparatedLibraryCatalogCache,
  isPathInside,
  normalizeAdapter,
  selectReferencesForRole
};
