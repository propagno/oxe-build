'use strict';

/**
 * OXB-124: verdicts pinned to what they judged. A sign-off (and the phase verify) records the `head` it saw and the
 * version of each criterion (a hash of its SPEC row). At the close a verdict counts only when its head is an ancestor of
 * the closing HEAD with no commit since then touching the criterion's scope (the files of the tasks that cover it; with
 * none, any file outside docs/ and .oxe/), and the criterion text is the same. Otherwise: `stale_verdict` with the why.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const git = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const escapeRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normPath = (f) => String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

function matchesCriterion(a, b) {
  const x = String(a || '').trim().toUpperCase();
  const y = String(b || '').trim().toUpperCase();
  return Boolean(x && y && (x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`)));
}

function criterionRow(specText, id) {
  const esc = escapeRe(String(id || '').trim());
  if (!esc) return null;
  const re = new RegExp(`^\\|\\s*(?:\\*\\*|\`)?${esc}(?:\\*\\*|\`)?\\s*\\|.*$`, 'im');
  const m = re.exec(String(specText || ''));
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function criteriaVersions(specText, ids) {
  const out = {};
  for (const id of ids || []) {
    const row = criterionRow(specText, id);
    out[id] = row ? crypto.createHash('sha256').update(row).digest('hex').slice(0, 16) : null;
  }
  return out;
}

function headOf(root) {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The tree of the working directory as it is now (tracked + untracked, .gitignore respected), without touching the
 * real index: a verify judges the files on disk, and a commit made afterwards with exactly those files is the same
 * code. Returns the tree sha or null (no repository, git failure).
 *
 * Only when `root` IS the repository's top level. A project folder that merely sits inside some outer repository (a
 * home directory under git, a monorepo) gets null: `git add -A` there would crawl — and hash into that repository —
 * everything around the project. Null means the close falls back to the commit comparison (a second verify).
 */
function worktreeTree(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return null;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(real(top.stdout.trim()), real(root))) return null;
  const dir = git(root, ['rev-parse', '--git-dir']);
  if (dir.status !== 0) return null;
  const gitDir = path.resolve(root, dir.stdout.trim());
  const tmp = path.join(gitDir, `oxe-verify-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  const run = (args) => spawnSync('git', ['-c', 'core.quotepath=false', '-c', 'core.safecrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, env, maxBuffer: 32 * 1024 * 1024 });
  try {
    try { fs.copyFileSync(path.join(gitDir, 'index'), tmp); } catch { /* a repository with no index yet */ }
    if (run(['add', '-A']).status !== 0) return null;
    const r = run(['write-tree']);
    return r.status === 0 ? r.stdout.trim() : null;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(`${tmp}.lock`, { force: true }); } catch { /* best effort */ }
  }
}

/** Code files that differ between a tree-ish and another (same filter as the close: no .oxe/, docs/ or *.md). */
function codeDiff(root, from, to) {
  const r = git(root, ['diff', '--name-only', from, to, '--']);
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean).filter((f) => !f.startsWith('.oxe/') && !/^docs\//.test(f) && !/\.md$/i.test(f));
}

function resolveCommit(root, rev) {
  const r = git(root, ['rev-parse', '--verify', `${rev}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : null;
}

function scopeOf(doc, criterion) {
  const files = [];
  for (const t of (doc && doc.tasks) || []) {
    if (!t || t.superseded || t.merged_into || t.status === 'superseded') continue;
    if ((t.acceptance || []).some((a) => matchesCriterion(a, criterion))) files.push(...(t.files || []));
  }
  return [...new Set(files.map(normPath).filter(Boolean))];
}

/**
 * @returns {{ fresh: boolean, why: string|null }}
 */
function freshness(root, verdict, ctx = {}) {
  const head = ctx.head || headOf(root);
  if (!verdict) return { fresh: false, why: 'sem veredito' };
  // a repository with no commit yet has nothing to pin a verdict to
  if (!verdict.head) return head ? { fresh: false, why: 'sign-off sem head (gravado antes da 1.21.2): refaça o sign-off no commit atual' } : { fresh: true, why: null };
  const resolvedVerdictHead = head ? resolveCommit(root, verdict.head) : null;
  if (head && resolvedVerdictHead !== head) {
    if (!resolvedVerdictHead || git(root, ['merge-base', '--is-ancestor', resolvedVerdictHead, head]).status !== 0) {
      return { fresh: false, why: `o commit avaliado (${String(verdict.head).slice(0, 8)}) não está na história do HEAD` };
    }
    const testScope = require('./oxe-test-scope.cjs');
    const changed = (git(root, ['diff', '--name-only', resolvedVerdictHead, head, '--']).stdout || '').split(/\r?\n/).filter(Boolean).filter((f) => !f.startsWith('.oxe/'));
    for (const c of verdict.criteria || []) {
      const scope = scopeOf(ctx.doc, c);
      const inScope = scope.length
        ? changed.filter((f) => scope.some((s) => f === s || f.startsWith(`${s.replace(/\/$/, '')}/`) || testScope.covers(s, f)))
        : changed.filter((f) => !/^docs\//.test(f) && !/\.md$/i.test(f));
      if (inScope.length) return { fresh: false, why: `commit novo no escopo de ${c} depois de ${String(verdict.head).slice(0, 8)} (${inScope.slice(0, 3).join(', ')})` };
    }
  }
  const now = criteriaVersions(ctx.specText, verdict.criteria || []);
  for (const c of verdict.criteria || []) {
    const was = verdict.criteria_versions && verdict.criteria_versions[c];
    if (was && (!now[c] || was !== now[c])) return { fresh: false, why: `${c} foi emendado depois do sign-off` };
  }
  return { fresh: true, why: null };
}

module.exports = { criterionRow, criteriaVersions, headOf, freshness, worktreeTree, codeDiff };
