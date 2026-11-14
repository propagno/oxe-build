'use strict';

/**
 * 1.21.2 (from the ALM coordination, 13–14/11) — known CI failures. A merge-train car fell on a flake already fixed
 * in another PR (thread-view.spec.ts:310 → PR #797, OXE-103) and was handled by hand as a regression. A known failure
 * is a test name (substring, or /regex/) tied to the item that tracks it; when a failed CI log of an open PR matches
 * one whose item is still open, `ship status` says "falha conhecida" and suggests `gh run rerun <id> --failed`
 * instead of treating it as a regression. Append-only file: .oxe/program/known-failures.ndjson.
 */

const fs = require('fs');
const path = require('path');

const fileOf = (programDir) => path.join(programDir, 'known-failures.ndjson');

function list(programDir) {
  let raw = '';
  try { raw = fs.readFileSync(fileOf(programDir), 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of raw.split(/\r?\n/)) {
    let r = null;
    try { r = JSON.parse(line); } catch { r = null; }
    if (!r || !r.id) continue;
    if (r.removed) byId.delete(r.id); else byId.set(r.id, r);
  }
  return [...byId.values()];
}

function add(programDir, input = {}) {
  const pattern = String(input.pattern || '').trim();
  if (pattern.length < 3) throw new Error('informe o teste (nome, arquivo:linha ou /regex/): oxe-cc ship known-failure add "<teste>" --item OXE-103');
  if (!input.item) throw new Error('uma falha conhecida tem um item que a acompanha (--item OXE-103): sem item, é regressão');
  if (/^\/.*\/[a-z]*$/.test(pattern)) { try { toRe(pattern); } catch (err) { throw new Error(`regex inválida: ${err.message}`); } }
  const all = list(programDir);
  const id = `KF-${all.reduce((m, k) => Math.max(m, Number(String(k.id).replace(/\D/g, '')) || 0), 0) + 1}`;
  const rec = { id, pattern, item: String(input.item), pr: input.pr ? String(input.pr) : null, note: input.note || null, by: input.by || null, at: new Date().toISOString() };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(fileOf(programDir), `${JSON.stringify(rec)}\n`, 'utf8');
  return rec;
}

function remove(programDir, id, input = {}) {
  if (!list(programDir).some((k) => k.id === id)) throw new Error(`${id}: falha conhecida inexistente (oxe-cc ship known-failure list)`);
  fs.appendFileSync(fileOf(programDir), `${JSON.stringify({ id, removed: true, reason: input.reason || null, at: new Date().toISOString() })}\n`, 'utf8');
  return { id, removed: true };
}

function toRe(pattern) {
  const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  return m ? new RegExp(m[1], m[2].replace(/g/g, '')) : null;
}

/** The known failures whose pattern appears in `text` (a failed CI log). */
function match(text, known) {
  const s = String(text || '');
  return known.filter((k) => { const re = toRe(k.pattern); return re ? re.test(s) : s.includes(k.pattern); });
}

/** The run id of a check link (…/actions/runs/<id>/job/<job>). */
const runIdOf = (link) => { const m = /\/actions\/runs\/(\d+)/.exec(String(link || '')); return m ? m[1] : null; };

/**
 * The CI of one open PR, classified: green, pending, known flake (every failed run matches a known failure whose
 * item is still open) or regression. `itemOpen(key)` → true | false | null (unknown = treated as open).
 * @returns {{ state: 'green'|'pending'|'known_flake'|'regression'|'unknown', failed: Array, suggestion?: string }}
 */
function classifyPr(pr, known, options) {
  const spawn = options.spawn;
  const cwd = options.cwd;
  const r = spawn('gh', ['pr', 'checks', String(pr), '--json', 'name,state,bucket,link'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  let checks = null;
  try { checks = JSON.parse(String((r && r.stdout) || '')); } catch { checks = null; }
  if (!Array.isArray(checks)) return { state: 'unknown', failed: [] };
  const failed = checks.filter((c) => c.bucket === 'fail' || /^(FAILURE|ERROR|CANCELLED|TIMED_OUT)$/i.test(String(c.state || '')));
  if (!failed.length) return { state: checks.some((c) => c.bucket === 'pending' || /PENDING|IN_PROGRESS|QUEUED/i.test(String(c.state || ''))) ? 'pending' : 'green', failed: [] };
  const runs = new Map();
  for (const c of failed) { const id = runIdOf(c.link); if (id) runs.set(id, [...(runs.get(id) || []), c.name]); }
  const out = [];
  for (const [run, names] of runs) {
    const log = spawn('gh', ['run', 'view', run, '--log-failed'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    const hits = match(String((log && log.stdout) || ''), known).filter((k) => options.itemOpen(k.item) !== false);
    out.push({ run, checks: names, known: hits.map((k) => ({ id: k.id, pattern: k.pattern, item: k.item, pr: k.pr })) });
  }
  const unattached = failed.filter((c) => !runIdOf(c.link)).map((c) => ({ run: null, checks: [c.name], known: [] }));
  const all = [...out, ...unattached];
  const flake = all.length > 0 && all.every((f) => f.run && f.known.length);
  return {
    state: flake ? 'known_flake' : 'regression',
    failed: all,
    ...(flake ? { suggestion: all.map((f) => `gh run rerun ${f.run} --failed`).join(' && ') } : {}),
  };
}

/**
 * G5/G8 (OxeSpace 14/11: "KF-1 again — the store is per worktree; the train and other PRs don't see it"): the store
 * of the REPOSITORY, shared by every worktree and session of this clone — `<git common dir>/oxe/` (git keeps it out
 * of every checkout and every commit). Null outside git.
 */
function repoDir(projectRoot, spawn = require('child_process').spawnSync) {
  const r = spawn('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (!r || r.status !== 0) return null;
  const [top, common] = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim());
  if (!top || !common) return null;
  // only a project that IS the repository (or a worktree) root: a folder that merely sits inside some other repo
  // (a home directory under git, a temp dir) must not write into that repo's .git
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (norm(top) !== norm(projectRoot)) return null;
  return path.join(path.resolve(projectRoot, common), 'oxe');
}

/**
 * The known failures in force here: the repository's, plus a worktree's own older ones (.oxe/program, read-only,
 * shown as wt:KF-n). `prState(pr)` → 'MERGED' | 'OPEN' | 'CLOSED' | null: a failure tied to the PR that fixes it
 * expires when that PR merges (the fix is in main; a red after it is a regression again).
 */
function listAll(projectRoot, programDir, options = {}) {
  const repo = options.repoDir !== undefined ? options.repoDir : repoDir(projectRoot, options.spawn);
  const own = repo ? list(repo).map((k) => ({ ...k, scope: 'repo' })) : [];
  const legacy = programDir && (!repo || path.resolve(programDir) !== path.resolve(repo)) ? list(programDir).map((k) => ({ ...k, id: `wt:${k.id}`, scope: 'worktree' })) : [];
  const seen = new Set(own.map((k) => `${k.pattern}\u0000${k.item}`));
  const all = [...own, ...legacy.filter((k) => !seen.has(`${k.pattern}\u0000${k.item}`))];
  if (typeof options.prState !== 'function') return all;
  return all.map((k) => {
    const st = k.pr ? options.prState(String(k.pr).replace(/^#/, '')) : null;
    return st === 'MERGED' ? { ...k, expired: true, expired_by: `PR ${k.pr} mergeado` } : k;
  });
}

/** Removes (append-only) the repository's expired entries. */
function prune(projectRoot, options = {}) {
  const repo = options.repoDir !== undefined ? options.repoDir : repoDir(projectRoot, options.spawn);
  if (!repo) throw new Error('falhas conhecidas do repositório: fora de um repositório git');
  const gone = listAll(projectRoot, null, { ...options, repoDir: repo }).filter((k) => k.scope === 'repo' && k.expired);
  for (const k of gone) remove(repo, k.id, { reason: k.expired_by });
  return { pruned: gone.map((k) => ({ id: k.id, pattern: k.pattern, item: k.item, why: k.expired_by })) };
}

module.exports = { list, listAll, add, remove, prune, repoDir, match, classifyPr, runIdOf, fileOf };
