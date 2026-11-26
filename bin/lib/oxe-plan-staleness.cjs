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

const git = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
const isClosedTask = (t) => Boolean(!t || t.done === true || t.status === 'done' || t.superseded || t.merged_into);

function headOf(root) { const r = git(root, ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; }

function checkpointTasks(body) {
  const ids = [];
  for (const m of String(body || '').matchAll(/^OXE-Task:\s*(.+)$/gm)) {
    for (const tok of m[1].split(/[\s,]+/).filter(Boolean)) {
      const tm = /^(?:F\d+(?:\.\d+)*\/)?(T[\w.-]+)$/i.exec(tok);
      if (tm) ids.push(tm[1]);
    }
  }
  return ids;
}

/** Files changed since `base` by commits that are not checkpoints of this plan's tasks: Map file → status. */
function foreignChanges(root, base, ownTaskIds) {
  const out = new Map();
  const log = git(root, ['log', '--format=%x00%H%x01%B%x02', '--name-status', `${base}..HEAD`]).stdout || '';
  for (const chunk of log.split('\0').filter(Boolean)) {
    const [, rest] = chunk.split('\x01');
    const [body, files] = String(rest || '').split('\x02');
    const cited = checkpointTasks(body);
    if (cited.length && cited.every((id) => ownTaskIds.has(id))) continue;
    for (const line of String(files || '').split(/\r?\n/).filter(Boolean)) {
      const parts = line.split('\t');
      const st = parts[0].charAt(0);
      const file = norm(parts[parts.length - 1]);
      if (!file || file.startsWith('.oxe/')) continue;
      out.set(file, st);
      if (st === 'R' && parts[1]) out.set(norm(parts[1]), 'D');
    }
  }
  return out;
}

/**
 * OxeSpace 15/11 (F6): a declared ratchet file (config lint.ratchets) whose diff since the base only moves the cap
 * number does not make the plan stale for the other tasks listing it (a cap-down quick touched every later task).
 */
function capOnlyFiles(root, base, changed) {
  const out = new Set();
  let config = null;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'config.json'), 'utf8')); } catch { return out; }
  let ratchets;
  try { ratchets = require('./oxe-ratchets.cjs'); } catch { return out; }
  for (const r of ratchets.ratchetsOf(config)) {
    if (!changed.has(r.file) || changed.get(r.file) === 'D') continue;
    const before = git(root, ['show', `${base}:${r.file}`]);
    if (before.status !== 0) continue;
    let after = '';
    try { after = fs.readFileSync(path.join(root, r.file), 'utf8'); } catch { continue; }
    const headText = git(root, ['show', `HEAD:${r.file}`]);
    if (headText.status === 0) after = headText.stdout;
    if (ratchets.onlyCapChanged(before.stdout, after, config, r.file)) out.add(r.file);
  }
  return out;
}

function staleness(root, doc, pack) {
  const tasks = (doc && doc.tasks) || [];
  const own = new Set(tasks.map((t) => t && t.id).filter(Boolean));
  const head = headOf(root);
  const report = [];
  const cache = new Map();
  const capOnly = new Map();
  const accept = (doc && (Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : Array.isArray(doc.acceptanceTests) ? doc.acceptanceTests : [])) || [];
  for (const t of tasks) {
    if (isClosedTask(t)) continue;
    const base = t.base_sha || (doc && doc.base_sha);
    if (!base || base === head) continue;
    if (!cache.has(base)) cache.set(base, git(root, ['cat-file', '-e', `${base}^{commit}`]).status === 0 ? foreignChanges(root, base, own) : null);
    const changed = cache.get(base);
    if (changed && !capOnly.has(base)) capOnly.set(base, capOnlyFiles(root, base, changed));
    if (!changed) { report.push({ task: t.id, file: null, why: `base_sha ${String(base).slice(0, 10)} não existe neste repositório` }); continue; }
    const seen = new Set();
    const pushHit = (file, why) => { if (file && !seen.has(file)) { seen.add(file); report.push({ task: t.id, file, why }); } };
    const scope = (t.files || []).map(norm).filter((f) => f && !f.includes('*'));
    for (const f of scope) if (changed.has(f) && !capOnly.get(base).has(f)) pushHit(f, changed.get(f) === 'D' ? 'o caminho foi removido depois do plano' : 'o arquivo mudou depois do plano');
    const entries = pack && (Array.isArray(pack.tasks) ? pack.tasks : Array.isArray(pack.entries) ? pack.entries : []);
    const entry = entries ? entries.find((x) => x && (x.id === t.id || x.task === t.id)) : null;
    for (const s of (entry && entry.symbols) || []) {
      const f = norm((s && (s.path || s.file)) || '');
      if (f && changed.has(f) && !scope.includes(f)) pushHit(f, `o arquivo do símbolo ${s.name} mudou depois do plano`);
    }
    const tCrit = (t.acceptance || []).map(String);
    for (const a of accept.filter((x) => x && (x.task === t.id || (!x.task && tCrit.some((c) => c === x.criterion || String(x.criterion || '').startsWith(`${c}.`) || c.startsWith(`${x.criterion}.`)))))) {
      for (const f of (a.files || []).map(norm)) if (f && changed.has(f)) pushHit(f, 'o teste congelado mudou depois do plano');
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
    if (t && ids.includes(t.id) && !isClosedTask(t)) { t.base_sha = head; t.refreshed_at = new Date().toISOString(); done.push(t.id); }
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  return done;
}

module.exports = { staleness, stamp, refresh, foreignChanges };
