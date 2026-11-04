'use strict';
// state_store.js — SQLite state store (node:sqlite), checkpoints, event log.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class StateStore {
  constructor(dbPath, eventLogPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        graph_version TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node TEXT NOT NULL,
        wait_task TEXT,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_index (
        event_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL
      );
    `);
    this.eventLogPath = eventLogPath;
    if (eventLogPath) fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
  }

  _now() { return new Date().toISOString(); }

  createExecution({ id, graph_version, status, current_node, state }) {
    const now = this._now();
    this.db.prepare(
      'INSERT INTO executions (id, graph_version, status, current_node, wait_task, state_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, graph_version, status, current_node, null, JSON.stringify(state), now, now);
  }

  getExecution(id) {
    const row = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      graph_version: row.graph_version,
      status: row.status,
      current_node: row.current_node,
      wait_task: row.wait_task ? JSON.parse(row.wait_task) : null,
      state: JSON.parse(row.state_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  updateExecution(id, { status, current_node, wait_task, state }) {
    const now = this._now();
    this.db.prepare(
      'UPDATE executions SET status=?, current_node=?, wait_task=?, state_json=?, updated_at=? WHERE id=?'
    ).run(status, current_node, wait_task ? JSON.stringify(wait_task) : null, JSON.stringify(state), now, id);
  }

  addEvent(executionId, eventType, payload) {
    const now = this._now();
    this.db.prepare(
      'INSERT INTO events (execution_id, event_type, payload_json, created_at) VALUES (?,?,?,?)'
    ).run(executionId, eventType, JSON.stringify(payload), now);
    if (this.eventLogPath) {
      fs.appendFileSync(this.eventLogPath, JSON.stringify({ execution_id: executionId, event_type: eventType, payload, created_at: now }) + '\n', 'utf8');
    }
  }

  addCheckpoint(executionId, nodeId, state) {
    const seq = this.db.prepare('SELECT COUNT(*) AS c FROM checkpoints WHERE execution_id=?').get(executionId).c + 1;
    this.db.prepare(
      'INSERT INTO checkpoints (execution_id, node_id, seq, state_json, created_at) VALUES (?,?,?,?,?)'
    ).run(executionId, nodeId, seq, JSON.stringify(state), this._now());
  }

  listEvents(executionId) {
    return this.db.prepare('SELECT id, event_type, payload_json, created_at FROM events WHERE execution_id=? ORDER BY id').all(executionId)
      .map(r => ({ id: r.id, event_type: r.event_type, payload: JSON.parse(r.payload_json), created_at: r.created_at }));
  }

  listCheckpoints(executionId) {
    return this.db.prepare('SELECT seq, node_id, state_json, created_at FROM checkpoints WHERE execution_id=? ORDER BY seq').all(executionId)
      .map(r => ({ seq: r.seq, node_id: r.node_id, state: JSON.parse(r.state_json), created_at: r.created_at }));
  }

  indexEventId(eventId, executionId) {
    this.db.prepare('INSERT OR IGNORE INTO event_index (event_id, execution_id) VALUES (?,?)').run(eventId, executionId);
  }

  findExecutionByEventId(eventId) {
    const row = this.db.prepare('SELECT execution_id FROM event_index WHERE event_id=?').get(eventId);
    return row ? row.execution_id : null;
  }

  close() { this.db.close(); }
}

module.exports = { StateStore };
