'use strict';
// router.js — оценка expr-условий и выбор маршрута по routing table.
// Поддержка: true | state.path == value | != | < | >= | && | || | (кавычки для строк)

function getPath(state, pathStr) {
  // pathStr вида: state.event.valid
  const parts = pathStr.split('.').slice(1);
  let cur = state;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return { ok: true, value: true };
  if (v === 'false') return { ok: true, value: false };
  if (v.startsWith('"') && v.endsWith('"')) return { ok: true, value: v.slice(1, -1) };
  const num = Number(v);
  if (!Number.isNaN(num)) return { ok: true, value: num };
  return { ok: false, value: undefined };
}

function evalAtom(atom, state) {
  const a = atom.trim();
  if (a === 'true') return true;
  const m = a.match(/^(\S+?)\s*(==|!=|>=|<)\s*(.+)$/);
  if (!m) return false;
  const [, lhs, op, rhsRaw] = m;
  if (!lhs.startsWith('state.')) return false;
  const lhsVal = getPath(state, lhs);
  const { ok, value: rhsVal } = parseValue(rhsRaw);
  if (!ok) return false;
  // Отсутствующие поля: любое сравнение ложно (кроме явного == "нет" — не поддерживаем)
  if (lhsVal === undefined) return false;
  switch (op) {
    case '==': return lhsVal === rhsVal;
    case '!=': return lhsVal !== rhsVal;
    case '<': return typeof lhsVal === 'number' && lhsVal < rhsVal;
    case '>=': return typeof lhsVal === 'number' && lhsVal >= rhsVal;
    default: return false;
  }
}

function splitTopLevel(s, sep) {
  // разделить по sep вне кавычек
  const out = [];
  let cur = '', inQ = false;
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && s.startsWith(sep, out.join('').length + cur.length + 1)) {
      // упрощённый вариант ниже
    }
    cur += ch;
  }
  // — упрощённая реализация через прямой обход:
  out.length = 0; cur = ''; inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQ = !inQ;
    if (!inQ && s.slice(i, i + sep.length) === sep) {
      out.push(cur); cur = ''; i += sep.length - 1; continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function evalExpr(expr, state) {
  if (!expr || expr.trim() === '') return false;
  const orParts = splitTopLevel(expr, '||');
  for (const orPart of orParts) {
    const andParts = splitTopLevel(orPart, '&&');
    let ok = true;
    for (const andPart of andParts) {
      if (!evalAtom(andPart, state)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function pickRoute(routes, fromNode, state) {
  const candidates = routes
    .filter(r => r.from === fromNode || r.from === 'any')
    .sort((a, b) => a.priority - b.priority);
  for (const r of candidates) {
    if (evalExpr(r.expr, state)) return r;
  }
  return { priority: 999, from: fromNode, expr: 'true', to: 'requires_human', edge_type: 'error', condition: 'fallback', audit_reason: 'no route matched' };
}

module.exports = { evalExpr, pickRoute, getPath };
