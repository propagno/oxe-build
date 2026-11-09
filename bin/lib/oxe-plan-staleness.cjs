'use strict';

/**
 * OXB-126: a plan written against an older tree. PLAN.json keeps `base_sha` (the commit it was written against;
 * `plan staleness --stamp` writes it) and a task may carry its own `base_sha` after `plan refresh --tasks`. Before the
 * execute, the commits since that base — minus the plan's own task checkpoints — are intersected with each PENDING
 * task's files, the files of its pack symbols and its frozen acceptance files. A hit means the task was planned against
 * code that has changed since: the execute refuses with the report, and `plan refresh --tasks Tn` records that the
 * task was reviewed against the current tree (ids and done tasks are preserved).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const norm = (p) => String(p).replace(/\\/g, '/');

function headOf(root) { const r = git(root, ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; }

/** Files changed since `base` by commits that are not checkpoints of this plan's tasks: Map file → status. */
function foreignChanges(root, base, ownTaskIds) {
  const out = new Map();
  const log = git(root, ['log', '--format=%x00%H%x01%B%x02', '--name-status', `${base}..HEAD`]).stdout || '';
  for (const chunk of log.split('\0').filter(Boolean)) {
    const [, rest] = chunk.split('\x01');
    const [body, files] = String(rest || '').split('\x02');
    const m = /^OXE-Task: (?:F\d+\/)?(T\d+)\s*$/m.exec(body || '');
    if (m && ownTaskIds.has(m[1])) continue;
    for (const line of String(files || '').split(/\r?\n/).filter(Boolean)) {
      const parts = line.split('\t');
      const st = parts[0].charAt(0);
      const file = norm(parts[parts.length - 1]);
      if (file.startsWith('.oxe/')) continue;
      out.set(file, st);
      if (st === 'R' && parts[1]) out.set(norm(parts[1]), 'D');
    }
  }
  return out;
}

function staleness(root, doc, pack) {
  const tasks = (doc && doc.tasks) || [];
  const own = new Set(tasks.map((t) => t && t.id).filter(Boolean));
  const head = headOf(root);
  const report = [];
  const cache = new Map();
  for (const t of tasks) {
    if (!t || t.done) continue;
    const base = t.base_sha || (doc && doc.base_sha);
    if (!base || base === head) continue;
    if (!cache.has(base)) cache.set(base, git(root, ['cat-file', '-e', `${base}^{commit}`]).status === 0 ? foreignChanges(root, base, own) : null);
    const changed = cache.get(base);
    if (!changed) { report.push({ task: t.id, file: null, why: `base_sha ${String(base).slice(0, 10)} não existe neste repositório` }); continue; }
    const scope = (t.files || []).map(norm).filter((f) => !f.includes('*'));
    for (const f of scope) if (changed.has(f)) report.push({ task: t.id, file: f, why: changed.get(f) === 'D' ? 'o caminho foi removido depois do plano' : 'o arquivo mudou depois do plano' });
    const entry = pack && Array.isArray(pack.tasks) ? pack.tasks.find((x) => x && (x.id === t.id || x.task === t.id)) : null;
    for (const s of (entry && entry.symbols) || []) {
      const f = norm(s && (s.path || s.file) || '');
      if (f && changed.has(f) && !scope.includes(f)) report.push({ task: t.id, file: f, why: `o arquivo do símbolo ${s.name} mudou depois do plano` });
    }
    for (const a of (doc.acceptance_tests || []).filter((x) => x && (x.task === t.id || (!x.task && (t.acceptance || []).includes(x.criterion))))) {
      for (const f of (a.files || []).map((x) => norm(typeof x === 'string' ? x : x.path))) if (changed.has(f)) report.push({ task: t.id, file: f, why: 'o teste congelado mudou depois do plano' });
    }
  }
  return { head, stale: report };
}

function stamp(jsonPath, doc, head) {
  doc.base_sha = head;
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
}

function refresh(jsonPath, doc, ids, head) {
  const done = [];
  for (const t of doc.tasks || []) {
    if (t && ids.includes(t.id) && !t.done) { t.base_sha = head; t.refreshed_at = new Date().toISOString(); done.push(t.id); }
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  return done;
}

module.exports = { staleness, stamp, refresh, foreignChanges };
