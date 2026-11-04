'use strict';
// handlers.js — обработчики узлов графа «Диспетчерский цикл» (MVP, sandbox-only).
// LLM: по умолчанию OFF (детерминированные моки, model_calls=0) — соответствует
// доказательствам Dispatcher MVP. Реальный LLM-адаптер подключается через env
// GRAPH_EXECUTOR_LLM_URL / GRAPH_EXECUTOR_LLM_KEY (OpenAI-совместимый).
const fs = require('node:fs');
const path = require('node:path');

const MISSION_FILES = [
  '00_mission_passport.md',
  '01_mission_contract.md',
  '02_result.md',
  '03_evidence.md',
  '04_reflection.md',
  '05_execution_trace.md',
  '06_pre_llm_trace.md',
  '07_graph_links.md',
  'mission_manifest.json',
];

function iso() { return new Date().toISOString(); }

// ---------- deterministic: intake ----------
function intake(ctx) {
  const p = ctx.payload || {};
  const id = p.id;
  const existing = ctx.store.findExecutionByEventId(id);
  const duplicate = existing !== null;
  const valid = !!(id && p.channel && p.received_at);
  // индексация события ТОЛЬКО после проверки дубликата (иначе узел видит свою запись)
  if (!duplicate && valid) {
    ctx.store.indexEventId(id, ctx.execution_id);
  }
  return {
    updates: {
      event: {
        id,
        channel: p.channel || null,
        sender: p.sender || null,
        received_at: p.received_at || null,
        payload_type: p.payload_type || 'text',
        payload_ref: p.payload_ref || null,
        raw_text: p.text || null,
        valid,
        duplicate,
      },
    },
  };
}

// ---------- agent: classify (LLM OFF mock) ----------
function classify(ctx) {
  const text = ctx.state.event?.raw_text || '';
  const hasClarifications = (ctx.state.event?.clarifications || []).length > 0;
  const ambiguous = !hasClarifications && (!text.trim() || text.includes('?'));
  return {
    updates: {
      'event.classification': {
        type: 'task',
        urgency: 'medium',
        domain: 'unknown',
        ambiguous,
        suggested_route: ambiguous ? null : 'dispatch',
      },
    },
  };
}

// ---------- agent: propose action ----------
function proposeAction(ctx) {
  return {
    updates: {
      decision_card: {
        action_proposal: 'Исполнить миссию по тексту события',
        alternatives: ['Исполнить сразу', 'Уточнить детали', 'Отложить'],
        questions: [],
      },
    },
  };
}

// ---------- human: gate (waiting) ----------
function humanGate(ctx) {
  if (ctx.state._pending === 'human.gate') return { updates: { _pending: null } };
  return {
    wait_task: {
      node_id: 'human.gate',
      question: 'Принять предложенное действие?',
      allowed_responses: ['accept', 'clarify', 'defer', 'archive'],
      context: { decision_card: ctx.state.decision_card, event: ctx.state.event },
    },
  };
}

// ---------- human+agent: clarify ----------
function clarifyEvent(ctx) {
  if (ctx.state._pending === 'clarify.event') {
    return { updates: { _pending: null } };
  }
  const rounds = ctx.state.event?.clarifications || [];
  const last = rounds[rounds.length - 1];
  if (last && last.answers && last.answers.length) {
    // ответы получены — переходим обратно в classify (маршрут p32)
    return { updates: {} };
  }
  return {
    wait_task: {
      node_id: 'clarify.event',
      question: 'Уточните: что именно нужно сделать и какие материалы уже есть?',
      allowed_responses: ['answers'],
      context: { event: ctx.state.event },
    },
  };
}

// ---------- agent+validator: contract build ----------
function contractBuild(ctx) {
  const attempts = ctx.state.attempts['contract_build'] || 1;
  const forceInvalid = ctx.payload.force_contract_invalid === true && attempts === 1;
  const ruleRefs = forceInvalid ? [] : ['rule.dispatcher_001', 'rule.security_001'];
  const goal = ctx.state.event?.raw_text || 'Миссия по событию';
  const valid = ruleRefs.length > 0 && !!goal;
  return {
    updates: {
      'mission.contract': {
        goal,
        proposed_roles: ['role.methodologist'],
        rule_refs: ruleRefs,
        budget: { max_tokens: 50000 },
        acceptance: [
          { id: 'a1', text: 'Результат создан' },
          { id: 'a2', text: 'Evidence по всем пунктам acceptance' },
        ],
        valid,
      },
      'mission.contract_draft': { id: `draft_${ctx.state.event.id}`, status: 'draft', valid },
      'mission.confirmed': false,
    },
  };
}

// ---------- human: confirm ----------
function humanConfirm(ctx) {
  if (ctx.state._pending === 'human.confirm') return { updates: { _pending: null } };
  return {
    wait_task: {
      node_id: 'human.confirm',
      question: 'Подтвердить mission contract и запустить runtime?',
      allowed_responses: ['confirm', 'reject'],
      context: { contract: ctx.state.mission?.contract },
    },
  };
}

// ---------- agent node: runtime run (создаёт 9 файлов в sandbox) ----------
function runtimeRun(ctx) {
  const missionId = `mission_${ctx.state.event.id}`;
  const dir = path.join(ctx.sandboxDir, missionId);
  fs.mkdirSync(dir, { recursive: true });
  const contract = ctx.state.mission?.contract || {};
  const reworkPass = (ctx.state.run?.rework_pass || 0) + 1;
  const manifest = {
    mission_id: missionId,
    execution_id: ctx.execution_id,
    graph_version: ctx.state.graph_version,
    scope: 'local_sandbox_only',
    rework_pass: reworkPass,
    created_at: iso(),
    note: 'production, Supabase live, external webhooks and real personal data not touched',
  };
  const files = {
    '00_mission_passport.md': `# Паспорт миссии\n\nmission_id: ${missionId}\nцель: ${contract.goal || '—'}\n`,
    '01_mission_contract.md': `# Контракт миссии\n\nцель: ${contract.goal || '—'}\nроли: ${(contract.proposed_roles || []).join(', ')}\nправила: ${(contract.rule_refs || []).join(', ')}\n`,
    '02_result.md': `# Результат\n\n(результат исполнения, pass ${reworkPass})\n`,
    '03_evidence.md': `# Evidence\n\na1: создан\na2: создан\n`,
    '04_reflection.md': `# Reflection\n\nпричины возвратов: ${(ctx.state.acceptance?.reason ? [ctx.state.acceptance.reason] : []).join(', ') || 'нет'}\n`,
    '05_execution_trace.md': `# Execution trace\n\nnodes: ${ctx.trace.join(' -> ')}\n`,
    '06_pre_llm_trace.md': `# Pre-LLM trace\n\nmodel_calls до Human Gate: 0\n`,
    '07_graph_links.md': `# Граф связей\n\ngraph: symbiot.dispatcher_cycle v${ctx.state.graph_version}\n`,
    'mission_manifest.json': JSON.stringify(manifest, null, 2),
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  const created = MISSION_FILES.map(f => path.join(dir, f)).filter(f => fs.existsSync(f));
  return {
    updates: {
      run: {
        status: 'finished',
        mission_id: missionId,
        files_created: created.length === MISSION_FILES.length,
        rework_pass: reworkPass,
      },
      artifacts: { mission_id: missionId, dir, file_count: created.length },
    },
  };
}

// ---------- validator: evidence check ----------
function evidenceCheck(ctx) {
  const filesOk = ctx.state.run?.files_created === true;
  const verdict = filesOk ? 'GREEN' : 'RED';
  return {
    updates: {
      evidence: {
        verdict,
        report: { items_checked: 2, items_failed: verdict === 'GREEN' ? 0 : 2 },
      },
    },
  };
}

// ---------- human: accept ----------
function humanAccept(ctx) {
  if (ctx.state._pending === 'human.accept') return { updates: { _pending: null } };
  return {
    wait_task: {
      node_id: 'human.accept',
      question: 'Принять результат миссии?',
      allowed_responses: ['accepted', 'revision'],
      context: { evidence: ctx.state.evidence, artifacts: ctx.state.artifacts },
    },
  };
}

// ---------- deterministic: reflection ----------
function reflectionRecord(ctx) {
  const records = ctx.state.reflection?.records || [];
  const revisions = (ctx.state.acceptance_history || [])
    .filter(h => h.decision === 'revision')
    .map(h => h.reason)
    .filter(Boolean);
  records.push({ mission_id: ctx.state.run?.mission_id, reasons: revisions, recorded_at: iso() });
  return { updates: { 'reflection.records': records } };
}

// ---------- side_effect: report (idempotent) ----------
function resultReport(ctx) {
  if (ctx.state.report?.sent) {
    // повтор узла — не отправляем дубль (idempotency)
    return { updates: {} };
  }
  const dir = path.join(ctx.sandboxDir, ctx.state.run?.mission_id || 'mission_unknown');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'report.md'),
    `# Отчёт\n\nмиссия: ${ctx.state.run?.mission_id}\nвердикт evidence: ${ctx.state.evidence?.verdict}\nрешение: ${ctx.state.acceptance?.decision}\n`,
    'utf8'
  );
  return { updates: { report: { sent: true, message_ref: `sandbox://${ctx.state.run?.mission_id}/report.md` } } };
}

// ---------- deterministic: archive ----------
function missionArchive(ctx) {
  return { updates: { 'mission.archived': true } };
}

const HANDLERS = {
  'intake.event': intake,
  'classify.event': classify,
  'propose.action': proposeAction,
  'human.gate': humanGate,
  'clarify.event': clarifyEvent,
  'contract.build': contractBuild,
  'human.confirm': humanConfirm,
  'runtime.run': runtimeRun,
  'evidence.check': evidenceCheck,
  'human.accept': humanAccept,
  'reflection.record': reflectionRecord,
  'result.report': resultReport,
  'mission.archive': missionArchive,
  // авто-узлы
  'waiting': (ctx) => ctx.state._pending === 'waiting'
    ? { updates: { _pending: null } }
    : { wait_task: { node_id: 'waiting', question: 'Отложенная миссия: продолжить?', allowed_responses: ['resume', 'cancel'], context: {} } },
};

module.exports = { HANDLERS, MISSION_FILES };
