const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const evidenceDir = path.join(rootDir, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_SUPABASE_MISSION_GRAPH_LIVE_PROOF_2026-07-20.json");
const reportPath = path.join(evidenceDir, "TEST_REPORT_OBP_038A2_SUPABASE_MISSION_GRAPH_LIVE_2026-07-20.md");
const foundationMigrationPath = path.join(__dirname, "supabase", "migrations", "202607170235_business_memory_foundation.sql");
const graphMigrationPath = path.join(__dirname, "supabase", "migrations", "202607200120_mission_graph_persistence.sql");
const graphTables = ["mission_canvas_nodes", "mission_canvas_edges", "mission_methodology_patterns"];

function env(name, fallback = "") {
  return process.env[name] || fallback || "";
}

function fingerprint(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

function envConfig() {
  return {
    supabaseUrl: env("SYMBIOT_SUPABASE_URL", env("SUPABASE_URL")).trim(),
    anonKey: env("SYMBIOT_SUPABASE_ANON_KEY", env("SYMBIOT_SUPABASE_PUBLISHABLE_KEY", env("SUPABASE_ANON_KEY", env("SUPABASE_PUBLISHABLE_KEY")))).trim(),
    serviceRoleKey: env("SYMBIOT_SUPABASE_SERVICE_ROLE_KEY", env("SYMBIOT_SUPABASE_SECRET_KEY", env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SECRET_KEY")))).trim(),
    dbUrl: env("SYMBIOT_SUPABASE_DB_URL", env("DATABASE_URL")).trim(),
    testUserId: env("SYMBIOT_SUPABASE_TEST_USER_ID").trim()
  };
}

function configSummary(config) {
  let urlHost = null;
  if (config.supabaseUrl) {
    try { urlHost = new URL(config.supabaseUrl).host; } catch (_) { urlHost = "invalid_url"; }
  }
  return {
    supabaseUrlPresent: Boolean(config.supabaseUrl),
    supabaseUrlHost: urlHost,
    anonKeyPresent: Boolean(config.anonKey),
    anonKeyFingerprint: fingerprint(config.anonKey),
    serviceRoleKeyPresent: Boolean(config.serviceRoleKey),
    serviceRoleKeyFingerprint: fingerprint(config.serviceRoleKey),
    dbUrlPresent: Boolean(config.dbUrl),
    dbUrlFingerprint: fingerprint(config.dbUrl),
    testUserIdPresent: Boolean(config.testUserId),
    testUserIdFingerprint: fingerprint(config.testUserId)
  };
}

function noSecretLeak(evidence, config) {
  const text = JSON.stringify(evidence);
  return [config.anonKey, config.serviceRoleKey, config.dbUrl].filter(Boolean).every((secret) => !text.includes(secret));
}

async function createTemporaryTestUser(config) {
  if (config.testUserId) {
    return { userId: config.testUserId, created: false, cleanup: async () => ({ ok: true, skipped: true, reason: "configured_test_user" }) };
  }
  const userId = randomUUID();
  const email = `symbiot-proof-${userId}@example.com`;
  await withPgClient(config, async (client) => {
    await client.query(
      "insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ($1, 'authenticated', 'authenticated', $2, now(), $3::jsonb, $4::jsonb, now(), now(), false, false)",
      [userId, email, JSON.stringify({ provider: "email", providers: ["email"] }), JSON.stringify({ proof: "OBP-038A.2", temporary: true })]
    );
  });
  return {
    userId,
    created: true,
    cleanup: async () => withPgClient(config, async (client) => {
      await client.query("delete from auth.users where id=$1", [userId]);
      return { ok: true, skipped: false };
    })
  };
}


async function withPgClient(config, fn) {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch (error) {
    return { ok: false, skipped: true, reason: "pg_dependency_missing", error: error.message };
  }
  const client = new Client({ connectionString: config.dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applyMigration(config, migrationPath) {
  if (!fs.existsSync(migrationPath)) return { ok: false, skipped: false, reason: "migration_missing", migrationPath };
  return withPgClient(config, async (client) => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await client.query(sql);
    return { ok: true, skipped: false, migrationPath, migrationSha256: createHash("sha256").update(sql).digest("hex") };
  });
}

async function verifyGraphTables(config) {
  return withPgClient(config, async (client) => {
    const result = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
      [graphTables]
    );
    const present = result.rows.map((row) => row.table_name);
    const rls = await client.query(
      "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) order by c.relname",
      [graphTables]
    );
    const rlsEnabled = rls.rows.filter((row) => row.rls_enabled).map((row) => row.table_name);
    return {
      ok: present.length === graphTables.length && rlsEnabled.length === graphTables.length,
      presentTables: present,
      rlsEnabledTables: rlsEnabled,
      missingTables: graphTables.filter((table) => !present.includes(table)),
      rlsMissingTables: graphTables.filter((table) => !rlsEnabled.includes(table))
    };
  });
}

async function missionGraphSmoke(config, testUserId) {
  return withPgClient(config, async (client) => {
    const organizationId = randomUUID();
    const vaultId = randomUUID();
    const missionId = randomUUID();
    const artifactId = randomUUID();
    const evidenceId = randomUUID();
    const nodeIds = ["request", "sources", "mission", "ai_team", "result", "evidence", "next_step"];
    const edgePairs = [["request", "sources"], ["sources", "mission"], ["mission", "ai_team"], ["ai_team", "result"], ["result", "evidence"], ["evidence", "next_step"]];

    await client.query("begin");
    try {
      await client.query("insert into public.organizations (id, owner_user_id, name) values ($1, $2, $3)", [organizationId, testUserId, "OBP-038A.2 proof org"]);
      await client.query("insert into public.vaults (id, organization_id, owner_user_id, vault_fingerprint, vault_name) values ($1, $2, $3, $4, $5)", [vaultId, organizationId, testUserId, `obp038a2-${missionId}`, "OBP-038A.2 Proof Vault"]);
      await client.query("insert into public.missions (id, organization_id, vault_id, owner_user_id, title, mission_type, status, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [missionId, organizationId, vaultId, testUserId, "Proof client mission graph", "client_mission", "draft", JSON.stringify({ methodologyOwner: "РОЛЬ_AI_Методолог_клиентских_миссий" })]);
      await client.query("insert into public.artifacts (id, organization_id, vault_id, mission_id, owner_user_id, artifact_type, title, obsidian_path, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [artifactId, organizationId, vaultId, missionId, testUserId, "html_result", "Proof HTML result", "02_Missions/Proof/04_Результат.html", "draft"]);
      await client.query("insert into public.evidence_items (id, organization_id, vault_id, mission_id, artifact_id, owner_user_id, evidence_type, status, summary) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [evidenceId, organizationId, vaultId, missionId, artifactId, testUserId, "mission_graph_proof", "yellow", "Mission graph live smoke proof"]);
      for (const [index, nodeKey] of nodeIds.entries()) {
        await client.query("insert into public.mission_canvas_nodes (organization_id, vault_id, mission_id, owner_user_id, node_key, node_type, title, text_content, x, y, width, height, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)", [organizationId, vaultId, missionId, testUserId, nodeKey, "text", nodeKey, `Proof node ${nodeKey}`, index * 240, index % 2 ? 120 : 0, 220, 100, JSON.stringify({ proof: "OBP-038A.2" })]);
      }
      for (const [index, pair] of edgePairs.entries()) {
        await client.query("insert into public.mission_canvas_edges (organization_id, vault_id, mission_id, owner_user_id, edge_key, from_node_key, to_node_key, label, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [organizationId, vaultId, missionId, testUserId, `edge_${index + 1}`, pair[0], pair[1], "route", JSON.stringify({ proof: "OBP-038A.2" })]);
      }
      await client.query("insert into public.mission_methodology_patterns (organization_id, vault_id, mission_id, owner_user_id, pattern_key, title, route_summary, evidence_status, source_count, node_count, edge_count, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)", [organizationId, vaultId, missionId, testUserId, `proof-pattern-${missionId}`, "Proof client mission pattern", "источник -> смысловая связь -> миссия -> результат -> evidence", "yellow", 3, nodeIds.length, edgePairs.length, JSON.stringify({ proof: "OBP-038A.2" })]);
      const check = await client.query("select (select count(*)::int from public.mission_canvas_nodes where mission_id=$1) as node_count, (select count(*)::int from public.mission_canvas_edges where mission_id=$1) as edge_count, (select count(*)::int from public.mission_methodology_patterns where mission_id=$1) as pattern_count, (select count(*)::int from public.evidence_items where mission_id=$1) as evidence_count", [missionId]);
      await client.query("rollback");
      return { ok: check.rows[0].node_count === nodeIds.length && check.rows[0].edge_count === edgePairs.length && check.rows[0].pattern_count === 1 && check.rows[0].evidence_count === 1, insertedAndRolledBack: true, missionId, ...check.rows[0] };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function writeReport(evidence) {
  const report = [
    "# TEST REPORT OBP-038A.2: Supabase Mission Graph Persistence",
    "",
    "Дата: 2026-07-20",
    "Проект / код: SYM-SaaS / Symbiot Obsidian Plugin",
    `Статус: ${evidence.status}`,
    "Readiness: не изменялась, остается `13205 / 14075 = 93.8%`.",
    "",
    "## Что проверялось",
    "",
    "- новая migration для mission graph tables;",
    "- live application в Supabase через DB URL;",
    "- RLS enabled на graph tables;",
    "- smoke insert/select для mission canvas nodes/edges/pattern/evidence с rollback;",
    "- no-secret-leak в evidence.",
    "",
    "## Что не считать готовым",
    "",
    "- RAG retrieval/citations;",
    "- автоматическое построение canvas из голоса;",
    "- production tenant security;",
    "- market-ready release.",
    "",
    `JSON: \`${evidencePath}\``
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const config = envConfig();
  const evidence = {
    id: "SYM_OBSIDIAN_PLUGIN_SUPABASE_MISSION_GRAPH_LIVE_PROOF_2026-07-20",
    project: "SYM-SaaS / OBP-038A.2 Supabase Mission Graph Persistence",
    date: "2026-07-20",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    config: configSummary(config),
    checks: {},
    boundaries: [
      "Test data is rolled back in the smoke proof.",
      "No full Obsidian vault upload.",
      "Service role / DB URL are never written to evidence."
    ]
  };
  const missing = [];
  if (!config.dbUrl) missing.push("SYMBIOT_SUPABASE_DB_URL");
  
  if (missing.length) {
    evidence.status = "BLOCKED_MISSING_SUPABASE_MISSION_GRAPH_CREDENTIALS_YELLOW";
    evidence.blocker = `Missing ${missing.join(", ")}`;
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 2;
    return;
  }
  try {
    const testUser = await createTemporaryTestUser(config);
    evidence.checks.temporaryTestUser = { ok: Boolean(testUser.userId), created: testUser.created, userIdFingerprint: fingerprint(testUser.userId) };
    try {
      evidence.checks.applyFoundationMigration = await applyMigration(config, foundationMigrationPath);
      evidence.checks.applyGraphMigration = await applyMigration(config, graphMigrationPath);
      evidence.checks.verifyGraphTables = await verifyGraphTables(config);
      evidence.checks.missionGraphSmoke = await missionGraphSmoke(config, testUser.userId);
    } finally {
      evidence.checks.temporaryTestUserCleanup = await testUser.cleanup();
    }
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    const passed = evidence.checks.temporaryTestUser.ok && evidence.checks.temporaryTestUserCleanup.ok && evidence.checks.applyFoundationMigration.ok && evidence.checks.applyGraphMigration.ok && evidence.checks.verifyGraphTables.ok && evidence.checks.missionGraphSmoke.ok && evidence.checks.noSecretLeak;
    evidence.status = passed ? "PASS_WITH_CONDITIONS_LIVE_SUPABASE_MISSION_GRAPH" : "FAILED_LIVE_SUPABASE_MISSION_GRAPH";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, reportPath, smoke: evidence.checks.missionGraphSmoke }, null, 2));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    evidence.status = "FAILED_LIVE_SUPABASE_MISSION_GRAPH";
    evidence.blocker = error.message;
    evidence.errorStack = error.stack ? error.stack.split("\n").slice(0, 6) : [];
    evidence.checks.noSecretLeak = noSecretLeak(evidence, config);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    writeReport(evidence);
    console.error(JSON.stringify({ status: evidence.status, blocker: evidence.blocker, evidencePath, reportPath }, null, 2));
    process.exitCode = 1;
  }
}

main();


