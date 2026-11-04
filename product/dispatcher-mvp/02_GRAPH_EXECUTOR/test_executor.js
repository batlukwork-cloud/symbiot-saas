'use strict';
// test_executor.js — прогон eval-сценариев графа «Диспетчерский цикл» на живом executor'е.
// Сценарии: EVAL-001 happy path, EVAL-002 битое событие, EVAL-003 дубль,
//           EVAL-005 reject, EVAL-006 revision, EVAL-019 неполный контракт.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { GraphExecutor } = require('./executor');

const ROOT = __dirname;
const PKG = path.join(ROOT, '..', '..', '..', 'docs', '03_design', '02_АРХИТЕКТУРА', 'graph-package.dispatch_cycle.v0.1.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-executor-'));
const DB = path.join(TMP, 'executor.db');
const EVENTS = path.join(TMP, 'events.jsonl');
const SANDBOX = path.join(TMP, 'sandbox_vault');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} — ${detail || ''}`); }
}

// авто-помощник: гоняет execution до ожидания человека, применяет решения по списку
function runWithDecisions(exec, payload, decisions) {
  let ex = exec.start(payload);
  for (const d of decisions) {
    if (ex.status !== 'waiting_human') break;
    ex = exec.decide(ex.id, { task_id: ex.wait_task.task_id, ...d });
  }
  return ex;
}

console.log('Graph Executor MVP tests');
console.log('package:', PKG, 'exists:', fs.existsSync(PKG));
console.log('tmp:', TMP);
console.log('');

// ---------- T1: EVAL-001 happy path ----------
console.log('T1 EVAL-001 happy path:');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_happy_1', channel: 'telegram', received_at: new Date().toISOString(), text: 'Проверь договор и собери пакет документов' };
  const ex = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'accept' },
    { node: 'human.confirm', decision: 'confirm' },
    { node: 'human.accept', decision: 'accepted' },
  ]);
  check('terminal archived', ex.current_node === 'archived', ex.current_node);
  check('9 файлов миссии', ex.state.run?.files_created === true, `files=${ex.state.run?.files_created}`);
  const dir = path.join(SANDBOX, `mission_${payload.id}`);
  const fileCount = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.json')).length : 0;
  check('файлы на диске (9+)', fileCount >= 9, `count=${fileCount}`);
  const trace = exec.events(ex.id).filter(e => e.event_type === 'node.completed').map(e => e.payload.node);
  const expectTrace = ['intake.event','classify.event','propose.action','human.gate','contract.build','human.confirm','runtime.run','evidence.check','human.accept','reflection.record','result.report','mission.archive'];
  check('путь узлов корректен', JSON.stringify(trace) === JSON.stringify(expectTrace), trace.join(' -> '));
  const cp = exec.checkpoints(ex.id);
  check('checkpoints на каждом узле', cp.length >= trace.length, `cp=${cp.length}`);
  exec.close();
}

// ---------- T2: EVAL-002 битое событие ----------
console.log('T2 EVAL-002 битое событие:');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const ex = exec.start({ id: 'evt_broken_2', received_at: new Date().toISOString(), text: 'x' }); // нет channel
  check('terminal requires_human', ex.current_node === 'requires_human', ex.current_node);
  check('model_calls=0 (LLM OFF)', exec.llm.calls === 0, `calls=${exec.llm.calls}`);
  check('нет файлов миссии', !fs.existsSync(path.join(SANDBOX, 'mission_evt_broken_2')));
  exec.close();
}

// ---------- T3: EVAL-003 дубль события ----------
console.log('T3 EVAL-003 дубль:');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_dup_3', channel: 'telegram', received_at: new Date().toISOString(), text: 'Обработай заявку клиента' };
  const ex1 = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'accept' },
    { node: 'human.confirm', decision: 'confirm' },
    { node: 'human.accept', decision: 'accepted' },
  ]);
  const ex2 = exec.start({ ...payload, text: 'Обработай заявку клиента (повтор)' });
  check('первый execution завершён', ex1.current_node === 'archived', ex1.current_node);
  check('второй execution отклонён как дубль', ex2.current_node === 'cancelled', ex2.current_node);
  exec.close();
}

// ---------- T4: EVAL-005 reject контракта ----------
console.log('T4 EVAL-005 reject контракта:');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_reject_4', channel: 'telegram', received_at: new Date().toISOString(), text: 'Подготовь презентацию для клиента' };
  const ex = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'accept' },
    { node: 'human.confirm', decision: 'reject', comment: 'не согласовано' },
  ]);
  check('terminal rejected', ex.current_node === 'rejected', ex.current_node);
  check('причина rejection сохранена', ex.state.mission?.reject_reason === 'не согласовано', String(ex.state.mission?.reject_reason));
  exec.close();
}

// ---------- T5: EVAL-006 revision ----------
console.log('T5 EVAL-006 revision (возврат на доработку):');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_rev_5', channel: 'telegram', received_at: new Date().toISOString(), text: 'Собери отчёт по продажам' };
  const ex = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'accept' },
    { node: 'human.confirm', decision: 'confirm' },
    { node: 'human.accept', decision: 'revision', comment: 'добавь динамику' },
    { node: 'human.accept', decision: 'accepted' },
  ]);
  check('terminal archived после revision', ex.current_node === 'archived', ex.current_node);
  check('rework выполнен (rework_pass=2)', ex.state.run?.rework_pass === 2, `rework_pass=${ex.state.run?.rework_pass}`);
  check('причина возврата в reflection', (ex.state.reflection?.records || []).some(r => (r.reasons || []).includes('добавь динамику')));
  exec.close();
}

// ---------- T6: EVAL-019 неполный контракт ----------
console.log('T6 EVAL-019 неполный контракт (rework contract):');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_contract_6', channel: 'telegram', received_at: new Date().toISOString(), text: 'Разработай регламент', force_contract_invalid: true };
  const ex = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'accept' },
    { node: 'human.confirm', decision: 'confirm' },
    { node: 'human.accept', decision: 'accepted' },
  ]);
  check('terminal archived', ex.current_node === 'archived', ex.current_node);
  check('contract пересобран (attempts=2)', ex.state.attempts['contract_build'] === 2, `attempts=${ex.state.attempts['contract_build']}`);
  check('runtime не запускался до валидного контракта', ex.state.mission?.contract?.valid === true);
  exec.close();
}

// ---------- T7: waiting/defer ----------
console.log('T7 defer (отложено):');
{
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const payload = { id: 'evt_defer_7', channel: 'email', received_at: new Date().toISOString(), text: 'Вопрос по договору' };
  const ex = runWithDecisions(exec, payload, [
    { node: 'human.gate', decision: 'defer' },
  ]);
  check('переход в waiting', ex.current_node === 'waiting', ex.current_node);
  const ex2 = exec.decide(ex.id, { task_id: ex.wait_task.task_id, decision: 'resume' });
  check('возврат к human.gate после waiting', ex2.current_node === 'human.gate' && ex2.status === 'waiting_human', `${ex2.current_node}/${ex2.status}`);
  exec.close();
}

// ---------- T8: API smoke ----------
async function runT8() {
  console.log('T8 HTTP API smoke:');
  const { startApi } = require('./api');
  const exec = new GraphExecutor({ packagePath: PKG, dbPath: DB, sandboxDir: SANDBOX, eventLogPath: EVENTS });
  const server = startApi(exec, 8799);
  const http = require('node:http');
  const post = (p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 8799, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 8799, path: p }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
  try {
    const started = await post('/api/executor/start', { payload: { id: 'evt_api_8', channel: 'desktop', received_at: new Date().toISOString(), text: 'Проверка API' } });
    check('start возвращает execution', !!started.execution_id && started.status === 'waiting_human', JSON.stringify(started));
    const decided = await post(`/api/executor/${started.execution_id}/decide`, { task_id: started.wait_task.task_id, decision: 'accept' });
    check('decide работает', decided.current_node === 'human.confirm', decided.current_node);
    const status = await get(`/api/executor/${started.execution_id}/status`);
    check('status работает', status.execution_id === started.execution_id);
    const events = await get(`/api/executor/${started.execution_id}/events`);
    check('events работает', Array.isArray(events.events) && events.events.length > 0);
  } catch (e) {
    check('API smoke', false, String(e && e.message || e));
  }
  server.close();
  exec.close();
}

(async () => {
  await runT8();
  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
