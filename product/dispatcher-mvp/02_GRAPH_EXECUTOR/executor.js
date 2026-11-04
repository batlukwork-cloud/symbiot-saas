'use strict';
// executor.js — ядро графового runtime: читает graph-package, исполняет узлы,
// маршрутизация по routing table (expr), checkpoints, event log, human-in-loop.
const fs = require('node:fs');
const path = require('node:path');
const { StateStore } = require('./state_store');
const { pickRoute } = require('./router');
const { HANDLERS } = require('./handlers');

const TERMINALS = new Set(['accepted', 'rejected', 'cancelled', 'archived', 'failed', 'requires_human']);
const MAX_LOOP = 100;

function deepMerge(target, updates) {
  // updates: { 'a.b.c': value } (точечные пути) и/или { a: { b: 1 } } (объекты)
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let cur = target;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

class GraphExecutor {
  constructor({ packagePath, dbPath, sandboxDir, eventLogPath, llm }) {
    this.pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    this.routes = this.pkg.routes || [];
    this.store = new StateStore(dbPath, eventLogPath);
    this.sandboxDir = sandboxDir;
    fs.mkdirSync(sandboxDir, { recursive: true });
    this.llm = llm || { enabled: false, calls: 0 };
    this.payloads = new Map(); // execution_id -> payload (для handlers)
  }

  start(payload) {
    const id = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const state = {
      execution_id: id,
      graph_version: this.pkg.graph_version,
      attempts: {},
      cancel_requested: false,
    };
    this.store.createExecution({ id, graph_version: this.pkg.graph_version, status: 'running', current_node: 'intake.event', state });
    this.payloads.set(id, payload || {});
    this.store.addEvent(id, 'execution.started', { graph_version: this.pkg.graph_version, trigger: payload && payload.id });
    return this._run(id);
  }

  _run(id) {
    let guard = 0;
    for (;;) {
      if (++guard > MAX_LOOP) {
        this.store.updateExecution(id, { status: 'failed', current_node: 'failed', wait_task: null, state: this.store.getExecution(id).state });
        this.store.addEvent(id, 'execution.failed', { error: 'loop_guard_exceeded' });
        return this.store.getExecution(id);
      }
      const ex = this.store.getExecution(id);
      const node = ex.current_node;
      if (TERMINALS.has(node)) {
        this.store.addEvent(id, 'execution.completed', { terminal_state: node, summary: ex.state });
        return ex;
      }
      // счётчик попыток узла (ключ без точек — совместимо с expr-путями)
      const attemptKey = node.replace(/\./g, '_');
      ex.state.attempts[attemptKey] = (ex.state.attempts[attemptKey] || 0) + 1;

      const trace = this._traceOf(id);
      const ctx = {
        state: ex.state,
        node,
        execution_id: id,
        payload: this.payloads.get(id) || {},
        store: this.store,
        llm: this.llm,
        sandboxDir: this.sandboxDir,
        trace,
      };
      const handler = HANDLERS[node];
      let result;
      if (!handler) {
        this.store.addEvent(id, 'node.failed', { node, error: 'no_handler' });
        ex.state.run = { ...(ex.state.run || {}), error_type: 'permanent' };
        this.store.updateExecution(id, { status: 'running', current_node: node, wait_task: null, state: ex.state });
        continue; // маршрут p85 уведёт в failed
      }
      try {
        result = handler(ctx) || { updates: {} };
      } catch (e) {
        this.store.addEvent(id, 'node.failed', { node, error: String(e && e.message || e) });
        ex.state.run = { ...(ex.state.run || {}), error_type: 'permanent' };
        this.store.updateExecution(id, { status: 'running', current_node: node, wait_task: null, state: ex.state });
        continue;
      }
      if (result.updates) deepMerge(ex.state, result.updates);

      if (result.wait_task) {
        ex.status = 'waiting_human';
        ex.wait_task = { task_id: `task_${id}_${node}`, ...result.wait_task };
        this.store.updateExecution(id, { status: ex.status, current_node: node, wait_task: ex.wait_task, state: ex.state });
        this.store.addEvent(id, 'human_task.created', { node, task_id: ex.wait_task.task_id, allowed_responses: ex.wait_task.allowed_responses });
        this.store.addCheckpoint(id, node, ex.state);
        return this.store.getExecution(id);
      }

      const route = pickRoute(this.routes, node, ex.state);
      this.store.addEvent(id, 'route.selected', { from: node, to: route.to, condition: route.expr, priority: route.priority, audit_reason: route.audit_reason });
      this.store.addEvent(id, 'node.completed', { node, next: route.to });
      this.store.addCheckpoint(id, node, ex.state);
      ex.current_node = route.to;
      this.store.updateExecution(id, { status: 'running', current_node: route.to, wait_task: null, state: ex.state });
    }
  }

  decide(id, { task_id, decision, comment, answers }) {
    const ex = this.store.getExecution(id);
    if (!ex) throw new Error('execution not found');
    if (ex.status !== 'waiting_human') throw new Error('execution is not waiting for human');
    const node = ex.current_node;
    const st = ex.state;
    st._pending = node; // маркер «решение потребляется на следующем входе в узел»
    switch (node) {
      case 'human.gate':
        st.decision = { action: decision, actor: 'human', comment: comment || null };
        break;
      case 'human.confirm':
        st.mission = st.mission || {};
        st.mission.confirmed = decision === 'confirm';
        st.mission.confirmed_at = new Date().toISOString();
        st.mission.reject_reason = decision === 'reject' ? (comment || 'no reason') : null;
        break;
      case 'clarify.event':
        st.event = st.event || {};
        st.event.clarifications = st.event.clarifications || [];
        st.event.clarifications.push({ round: st.event.clarifications.length + 1, answers: answers || [comment || ''] });
        break;
      case 'human.accept':
        st.acceptance_history = st.acceptance_history || [];
        st.acceptance_history.push({ decision, reason: comment || null, at: new Date().toISOString() });
        st.acceptance = { decision, reason: comment || null, actor: 'human' };
        break;
      case 'waiting':
        st.waiting_resolved = true;
        break;
      default:
        throw new Error(`no decision handler for node ${node}`);
    }
    this.store.addEvent(id, 'human_task.completed', { node, task_id, decision, comment });
    ex.status = 'running';
    this.store.updateExecution(id, { status: 'running', current_node: node, wait_task: null, state: st });
    return this._run(id);
  }

  status(id) {
    const ex = this.store.getExecution(id);
    if (!ex) return null;
    return {
      execution_id: ex.id,
      graph_version: ex.graph_version,
      status: ex.status,
      current_node: ex.current_node,
      wait_task: ex.wait_task,
      attempts: ex.state.attempts,
      state: ex.state,
    };
  }

  events(id) { return this.store.listEvents(id); }
  checkpoints(id) { return this.store.listCheckpoints(id); }
  close() { this.store.close(); }

  _traceOf(id) {
    return this.store.listEvents(id).filter(e => e.event_type === 'node.completed').map(e => e.payload.node);
  }
}

module.exports = { GraphExecutor, TERMINALS };
