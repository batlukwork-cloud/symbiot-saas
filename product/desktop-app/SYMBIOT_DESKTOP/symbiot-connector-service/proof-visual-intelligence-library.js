const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { createHash, randomUUID } = require("crypto");

const serviceDir = __dirname;
const rootDir = path.resolve(serviceDir, "..");
const migrationPath = path.join(serviceDir, "supabase", "migrations", "20260720_visual_intelligence_library.sql");
const evidencePath = path.join(rootDir, "runtime_logs", "SYM_VISUAL_INTELLIGENCE_LIBRARY_SUPABASE_PROOF_2026-07-20.json");
const toolConfigPath = "<локальный путь>";
const requiredTables = [
  "visual_library_items",
  "visual_library_relations",
  "visual_library_collections",
  "visual_library_collection_items",
  "visual_library_annotations"
];

function env(name, fallback) {
  return String(process.env[name] || fallback || "").trim();
}

function fingerprint(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

async function restCheck(baseUrl, key) {
  const results = [];
  for (const table of requiredTables) {
    const response = await fetch(baseUrl.replace(/\/+$/, "") + "/rest/v1/" + table + "?select=id&limit=1", {
      headers: { apikey: key, authorization: "Bearer " + key, accept: "application/json" }
    });
    results.push({ table: table, status: response.status, ok: response.ok });
  }
  return { ok: results.every(function (item) { return item.ok; }), results: results };
}

async function main() {
  const config = {
    url: env("SYMBIOT_SUPABASE_URL", env("SUPABASE_URL")),
    key: env("SYMBIOT_SUPABASE_SECRET_KEY", env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_ROLE_KEY"))),
    dbUrl: env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL"))
  };
  const missing = Object.entries(config).filter(function (pair) { return !pair[1]; }).map(function (pair) { return pair[0]; });
  if (missing.length) throw new Error("Missing Supabase config: " + missing.join(", "));
  if (!fs.existsSync(migrationPath)) throw new Error("Migration missing: " + migrationPath);

  const evidence = {
    id: "SYM_VISUAL_INTELLIGENCE_LIBRARY_SUPABASE_PROOF_2026-07-20",
    project: "SYM-CORE",
    gate: "Visual Intelligence Library v0.3 Supabase schema and owner smoke",
    date: "2026-07-20",
    config: {
      host: new URL(config.url).host,
      serviceKeyFingerprint: fingerprint(config.key),
      dbUrlFingerprint: fingerprint(config.dbUrl)
    },
    checks: {}
  };

  const client = new Client({ connectionString: config.dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const migration = fs.readFileSync(migrationPath, "utf8");
    await client.query(migration);
    evidence.checks.migration = {
      ok: true,
      sha256: createHash("sha256").update(migration).digest("hex")
    };

    const tableResult = await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by table_name",
      [requiredTables]
    );
    const tables = tableResult.rows.map(function (row) { return row.table_name; });
    const rlsResult = await client.query(
      "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1::text[]) order by c.relname",
      [requiredTables]
    );
    evidence.checks.tables = {
      ok: tables.length === requiredTables.length && rlsResult.rows.every(function (row) { return row.rls_enabled; }),
      present: tables,
      rlsEnabled: rlsResult.rows.filter(function (row) { return row.rls_enabled; }).map(function (row) { return row.table_name; })
    };

    const bucketResult = await client.query(
      "select id, \"public\" as public, file_size_limit from storage.buckets where id='visual-intelligence-private'"
    );
    evidence.checks.privateBucket = {
      ok: bucketResult.rowCount === 1 && bucketResult.rows[0].public === false,
      present: bucketResult.rowCount === 1,
      public: bucketResult.rowCount ? bucketResult.rows[0].public : null,
      fileSizeLimit: bucketResult.rowCount ? Number(bucketResult.rows[0].file_size_limit) : null
    };

    const userResult = await client.query("select id from auth.users order by created_at asc limit 1");
    let ownerUserId;
    let ownerMode;
    if (userResult.rowCount) {
      ownerUserId = userResult.rows[0].id;
      ownerMode = "supabase_auth_user";
    } else {
      let localConfig = {};
      if (fs.existsSync(toolConfigPath)) {
        try { localConfig = JSON.parse(fs.readFileSync(toolConfigPath, "utf8")); } catch (_) {}
      }
      ownerUserId = localConfig.owner_user_id || randomUUID();
      ownerMode = "local_service_identity";
    }
    evidence.checks.ownerIdentity = {
      ok: true,
      authUserPresent: userResult.rowCount > 0,
      mode: ownerMode,
      boundary: ownerMode === "local_service_identity" ? "Service-role local tool only until Supabase Auth gate." : "Owner maps to Supabase Auth."
    };

    await client.query("begin");
    try {
      const itemId = randomUUID();
      await client.query(
        "insert into public.visual_library_items (id, owner_user_id, source_key, item_type, title, media_kind, rights_status) values ($1,$2,$3,$4,$5,$6,$7)",
        [itemId, ownerUserId, "proof/" + randomUUID(), "reference", "Visual library proof", "image", "owned"]
      );
      await client.query(
        "insert into public.visual_library_annotations (item_id, owner_user_id, author_role, taxonomy, what_works) values ($1,$2,$3,$4::jsonb,$5)",
        [itemId, ownerUserId, "proof", JSON.stringify({ carriers: ["dashboard"], effects: ["depth"] }), "proof"]
      );
      const smoke = await client.query(
        "select i.id from public.visual_library_items i join public.visual_library_annotations a on a.item_id=i.id where i.id=$1",
        [itemId]
      );
      evidence.checks.ownerSmoke = { ok: smoke.rowCount === 1, insertedAndRolledBack: true };
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    fs.writeFileSync(toolConfigPath, JSON.stringify({
      owner_user_id: ownerUserId,
      supabase_host: evidence.config.host,
      bucket: "visual-intelligence-private",
      project_code: "SYM-CORE",
      owner_mode: ownerMode
    }, null, 2), "utf8");
    evidence.checks.localConfig = { ok: true, path: toolConfigPath, containsSecrets: false };
  } finally {
    await client.end();
  }

  evidence.checks.rest = await restCheck(config.url, config.key);
  evidence.status = Object.values(evidence.checks).every(function (check) { return check.ok; })
    ? "PASS_WITH_CONDITIONS_PRIVATE_VISUAL_LIBRARY"
    : "FAILED_VISUAL_LIBRARY_FOUNDATION";
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({
    status: evidence.status,
    tables: evidence.checks.tables.present.length,
    privateBucket: evidence.checks.privateBucket.ok,
    ownerSmoke: evidence.checks.ownerSmoke.ok,
    localConfigWritten: evidence.checks.localConfig.ok,
    evidencePath: evidencePath
  }, null, 2));
  if (!evidence.status.startsWith("PASS")) process.exitCode = 1;
}

main().catch(function (error) {
  console.error(JSON.stringify({ status: "FAILED", error: error.message }, null, 2));
  process.exitCode = 1;
});




