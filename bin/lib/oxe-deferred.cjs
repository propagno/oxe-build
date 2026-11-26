'use strict';

/**
 * OXB-138: the phase's deferred ledger — `.oxe/program/deferred.ndjson`, append-only. A task that exhausted its attempts
 * is recorded as `AD-<fase>-<n>` with the reason (failure class) and the last evidence; `close` lines close an entry
 * (resolved, done elsewhere, waived). Open entries block the close through the open-defects register (OXB-110).
 */

const fs = require('fs');
const path = require('path');

const FILE = (dir) => path.join(dir, 'deferred.ndjson');

function read(dir) {
  try {
    return fs.readFileSync(FILE(dir), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function list(dir) {
  const byId = new Map();
  for (const r of read(dir)) {
    if (r.kind === 'deferred') byId.set(r.id, { ...r, status: 'open' });
    else if (r.kind === 'deferred_retry' && byId.has(r.id)) {
      const prev = byId.get(r.id);
      Object.assign(prev, {
        status: 'open',
        retried_at: r.at,
        retry_count: (prev.retry_count || 0) + 1,
        ...(r.evidence ? { evidence: r.evidence } : {}),
      });
    } else if (r.kind === 'deferred_close' && byId.has(r.id)) Object.assign(byId.get(r.id), { status: r.status, closed_at: r.at });
  }
  return [...byId.values()];
}

const open = (dir) => list(dir).filter((e) => e.status === 'open');

function add(dir, input) {
  const all = list(dir);
  // one open entry per task: a later failure of the same task updates the evidence (a new line), not a new id
  const existing = all.find((e) => e.status === 'open' && e.task === input.task);
  const phase = input.phase || 'X';
  const n = all.filter((e) => String(e.id).startsWith(`AD-${phase}-`)).length + 1;
  const rec = { kind: 'deferred', id: existing ? existing.id : `AD-${phase}-${n}`, task: input.task, phase: input.phase || null, reason: input.reason || 'logic', evidence: input.evidence || '', run_id: input.run_id || null, at: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(FILE(dir), `${JSON.stringify(rec)}\n`);
  return rec;
}

function markRetried(dir, id, info = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const rec = {
    kind: 'deferred_retry',
    id,
    status: 'ready',
    ...(info.task ? { task: info.task } : {}),
    ...(info.tail ? { evidence: String(info.tail).slice(-1500) } : {}),
    at: new Date().toISOString(),
  };
  fs.appendFileSync(FILE(dir), `${JSON.stringify(rec)}\n`);
  return rec;
}

function close(dir, id, status) {
  fs.appendFileSync(FILE(dir), `${JSON.stringify({ kind: 'deferred_close', id, status, at: new Date().toISOString() })}\n`);
}

function closeTask(dir, taskId, phase = null, status = 'resolved') {
  const closed = [];
  for (const entry of open(dir)) {
    if (entry.task === taskId && (!phase || !entry.phase || entry.phase === phase)) {
      close(dir, entry.id, status);
      closed.push(entry.id);
    }
  }
  return closed;
}

module.exports = { list, open, add, markRetried, close, closeTask };
