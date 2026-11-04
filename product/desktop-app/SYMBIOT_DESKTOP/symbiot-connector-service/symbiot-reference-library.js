const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const INVENTORY_VERSION = "2026.07.26-v1";
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  "runtime_logs",
  "release",
  "backup",
  "backups"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "");
}

function stableSourceId(rootId, relativePath) {
  return `src_${sha256(`${rootId}:${relativePath.replace(/\\/g, "/").toLowerCase()}`).slice(0, 24)}`;
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function normalizeRoot(root, index) {
  const rawPath = String(root && root.path || "").trim();
  if (!rawPath) throw new Error(`reference_inventory_root_invalid:${index}`);
  const rootPath = normalizedPath(rawPath);
  if (!rootPath || !fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error(`reference_inventory_root_invalid:${rootPath || index}`);
  }
  return {
    rootId: String(root.rootId || `root_${index + 1}`).trim(),
    libraryType: String(root.libraryType || "unclassified").trim(),
    path: rootPath
  };
}

function scanReferenceLibraries(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots.map(normalizeRoot) : [];
  if (!roots.length) throw new Error("reference_inventory_explicit_roots_required");

  const excludedDirectories = new Set([
    ...DEFAULT_EXCLUDED_DIRECTORIES,
    ...(options.excludedDirectories || []).map((item) => String(item).toLowerCase())
  ]);
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || 10000), 100000));
  const includeHash = options.includeHash !== false;
  const records = [];
  const skipped = [];

  for (const root of roots) {
    const stack = [root.path];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, "ru"));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isSymbolicLink()) {
          skipped.push({ path: fullPath, reason: "symbolic_link_blocked" });
          continue;
        }
        if (entry.isDirectory()) {
          if (excludedDirectories.has(entry.name.toLowerCase())) {
            skipped.push({ path: fullPath, reason: "excluded_directory" });
          } else {
            stack.push(fullPath);
          }
          continue;
        }
        if (!entry.isFile()) {
          skipped.push({ path: fullPath, reason: "unsupported_entry_type" });
          continue;
        }
        if (records.length >= maxFiles) throw new Error(`reference_inventory_file_limit_exceeded:${maxFiles}`);

        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(root.path, fullPath);
        const extension = path.extname(entry.name).toLowerCase() || "(none)";
        records.push({
          sourceId: stableSourceId(root.rootId, relativePath),
          inventoryVersion: INVENTORY_VERSION,
          rootId: root.rootId,
          libraryType: root.libraryType,
          absolutePath: fullPath,
          relativePath: relativePath.replace(/\\/g, "/"),
          fileName: entry.name,
          extension,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          sha256: includeHash ? fileSha256(fullPath) : null,
          contentExtracted: false,
          catalogState: "INVENTORIED",
          qualityStatus: "RAW"
        });
      }
    }
  }

  records.sort((left, right) =>
    `${left.rootId}:${left.relativePath}`.localeCompare(`${right.rootId}:${right.relativePath}`, "ru")
  );
  const duplicateGroups = Object.entries(
    records.reduce((groups, record) => {
      if (!record.sha256) return groups;
      groups[record.sha256] = groups[record.sha256] || [];
      groups[record.sha256].push(record.sourceId);
      return groups;
    }, {})
  )
    .filter(([, sourceIds]) => sourceIds.length > 1)
    .map(([hash, sourceIds]) => ({ sha256: hash, sourceIds }));
  const extensionCounts = records.reduce((counts, record) => {
    counts[record.extension] = (counts[record.extension] || 0) + 1;
    return counts;
  }, {});
  const inventory = {
    version: INVENTORY_VERSION,
    policy: {
      explicitRootsOnly: true,
      contentExtraction: false,
      fileMutation: false,
      symbolicLinksFollowed: false,
      includeHash,
      maxFiles
    },
    roots,
    summary: {
      rootCount: roots.length,
      fileCount: records.length,
      totalBytes: records.reduce((total, record) => total + record.sizeBytes, 0),
      extensionCounts,
      duplicateGroupCount: duplicateGroups.length,
      skippedCount: skipped.length
    },
    records,
    duplicateGroups,
    skipped
  };
  inventory.inventorySha256 = sha256(JSON.stringify(inventory));
  return inventory;
}

module.exports = {
  DEFAULT_EXCLUDED_DIRECTORIES,
  INVENTORY_VERSION,
  scanReferenceLibraries,
  stableSourceId
};
