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

module.exports = { criterionRow, criteriaVersions, headOf, freshness };
