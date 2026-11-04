'use strict';
// api.js — локальный HTTP API executor'а (127.0.0.1:8790), sandbox-only.
// Routes:
//   POST /api/executor/start      {payload} -> execution
//   GET  /api/executor/:id/status
//   POST /api/executor/:id/decide {task_id, decision, comment?, answers?}
//   GET  /api/executor/:id/events
//   GET  /api/executor/:id/checkpoints
const http = require('node:http');
const { GraphExecutor } = require('./executor');

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 1);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function startApi(executor, port = 8790, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      const parts = url.pathname.split('/').filter(Boolean); // api, executor, :id?, action
      if (parts[0] !== 'api' || parts[1] !== 'executor') return json(res, 404, { error: 'not_found' });

      if (parts.length === 3 && parts[2] === 'start' && req.method === 'POST') {
        const body = await readBody(req);
        const ex = executor.start(body.payload || body);
        return json(res, 201, { execution_id: ex.id, status: ex.status, current_node: ex.current_node, wait_task: ex.wait_task });
      }
      if (parts.length === 4 && parts[3] === 'status' && req.method === 'GET') {
        const st = executor.status(parts[2]);
        if (!st) return json(res, 404, { error: 'not_found' });
        return json(res, 200, st);
      }
      if (parts.length === 4 && parts[3] === 'decide' && req.method === 'POST') {
        const body = await readBody(req);
        const ex = executor.decide(parts[2], body);
        return json(res, 200, { execution_id: ex.id, status: ex.status, current_node: ex.current_node, wait_task: ex.wait_task });
      }
      if (parts.length === 4 && parts[3] === 'events' && req.method === 'GET') {
        return json(res, 200, { events: executor.events(parts[2]) });
      }
      if (parts.length === 4 && parts[3] === 'checkpoints' && req.method === 'GET') {
        return json(res, 200, { checkpoints: executor.checkpoints(parts[2]) });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      json(res, 400, { error: String(e && e.message || e) });
    }
  });
  server.listen(port, host);
  return server;
}

module.exports = { startApi };
