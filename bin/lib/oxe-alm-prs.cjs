'use strict';

/**
 * OxeSpace 15/11 (coordinator, OXE-277): cards went to "Na main" on the first PR citing their key, even when the PR
 * was only part of the card (4 of 51 wrong). `oxe-cc alm pr-merged --pr N [--apply]` reads the markers of a merged
 * PR — "Fecha/Closes KEY" moves the card to integrated, "Parte de/Part of KEY" only comments the PR link, a bare key
 * is reported and not moved — and `oxe-cc alm list --state "<name>"[,…] [--with-prs]` lists the cards in those board
 * states with the merged PRs that cite each one. Every write goes through oxe-cc alm (the repo workflow calls it).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CLOSE_WORDS = '(?:Fecha|Fechas|Fechar|Closes|Close|Closed|Fixes|Fix|Resolves|Resolve)';
const PART_WORDS = '(?:Parte[\\s-]+de|Part[\\s-]+of|Refs?|Relacionad[oa]\\s+a)';

/** The key regex of the configured provider (Jira PROJ-n; Azure AB#n). */
function keyPattern(cfg) {
  if (cfg && cfg.provider === 'azure-devops') return 'AB#\\d+';
  const proj = cfg && cfg.p && cfg.p.project ? String(cfg.p.project).toUpperCase().replace(/[^A-Z0-9]/g, '') : '[A-Z][A-Z0-9]+';
  return `${proj}-\\d+`;
}

const normKey = (k) => String(k).toUpperCase().replace(/^AB#/, 'AB#');

/**
 * The markers of a PR text (title, body, commit messages and trailers). A key both closed and partial counts as closed.
 * @returns {{ closes: string[], partial: string[], bare: string[] }}
 */
function prMarkers(texts, cfg) {
  const kp = keyPattern(cfg);
  const list = `(${kp}(?:\\s*(?:,|e|and|&)\\s*${kp})*)`;
  const all = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '')).join('\n');
  const closes = new Set();
  const partial = new Set();
  const grab = (re, into) => { for (const m of all.matchAll(re)) for (const k of m[1].match(new RegExp(kp, 'gi')) || []) into.add(normKey(k)); };
  grab(new RegExp(`\\b${CLOSE_WORDS}\\s*:?\\s+${list}`, 'gi'), closes);
  grab(new RegExp(`\\b${PART_WORDS}\\s*:?\\s+${list}`, 'gi'), partial);
  for (const k of closes) partial.delete(k);
  const bare = new Set();
  for (const k of all.match(new RegExp(kp, 'gi')) || []) { const n = normKey(k); if (!closes.has(n) && !partial.has(n)) bare.add(n); }
  return { closes: [...closes].sort(), partial: [...partial].sort(), bare: [...bare].sort() };
}

function gh(args, cwd, spawn) {
  const r = (spawn || spawnSync)('gh', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (!r || r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} falhou: ${String((r && (r.stderr || r.error)) || 'sem saída').trim().split(/\r?\n/).slice(-2).join(' · ')}`);
  return JSON.parse(String(r.stdout || 'null'));
}

/** A PR with its text parts: title, branch, body and each commit's message (gh pr view). */
function readPr(root, pr, options = {}) {
  const n = String(pr || '').replace(/^#/, '');
  if (!/^\d+$/.test(n)) throw new Error('informe o número do PR (--pr 771)');
  const args = ['pr', 'view', n, '--json', 'number,title,body,headRefName,url,state,mergedAt,commits'];
  if (options.repo) args.push('-R', options.repo);
  const j = gh(args, root, options.ghSpawn);
  const commits = (j.commits || []).map((c) => [c.messageHeadline, c.messageBody].filter(Boolean).join('\n'));
  return { number: j.number, title: j.title || '', branch: j.headRefName || '', body: j.body || '', url: j.url || null, state: String(j.state || '').toUpperCase(), merged_at: j.mergedAt || null, commits };
}

const ledgerFile = (programDir) => path.join(programDir, 'alm-pr-merged.ndjson');
function ledger(programDir) {
  try { return fs.readFileSync(ledgerFile(programDir), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/**
 * `alm pr-merged --pr N`: dry run by default (the plan); with apply, the closed keys move to integrated once (a key
 * already moved by this PR is skipped), the partial ones get a comment with the PR link. Bare keys are only reported.
 */
async function prMerged(root, programDir, cfg, almLib, options = {}) {
  const pr = options.prData || readPr(root, options.pr, options);
  if (pr.state !== 'MERGED') throw new Error(`PR #${pr.number} não está mergeado (${pr.state || 'estado desconhecido'}) — nada a mover`);
  const m = prMarkers([pr.title, pr.branch, pr.body, ...pr.commits], cfg);
  const done = new Set(ledger(programDir).filter((r) => r.pr === pr.number).map((r) => `${r.action}:${r.key}`));
  const plan = {
    pr: pr.number,
    url: pr.url,
    close: m.closes.map((key) => ({ key, stage: 'integrated', skip: done.has(`moved:${key}`) })),
    comment: m.partial.map((key) => ({ key, skip: done.has(`commented:${key}`) })),
    bare: m.bare,
  };
  if (!options.apply) return { dry_run: true, ...plan };
  const out = { ...plan, moved: [], commented: [], errors: [] };
  const net = { ...(options.net || {}), dryRun: false };
  const at = new Date().toISOString();
  const rec = (r) => { fs.mkdirSync(programDir, { recursive: true }); fs.appendFileSync(ledgerFile(programDir), `${JSON.stringify({ ...r, pr: pr.number, at })}\n`, 'utf8'); };
  for (const c of plan.close) {
    if (c.skip) continue;
    try {
      const r = await almLib.move(programDir, cfg, c.key, 'integrated', { ...net, comment: `PR #${pr.number} mergeado (${pr.url || ''}) — fecha o card` });
      out.moved.push({ key: c.key, ...(r.queued ? { queued: true } : {}), ...(r.changed === false ? { already: true } : {}) });
      rec({ action: 'moved', key: c.key });
    } catch (err) { out.errors.push(`${c.key}: ${err.message}`); }
  }
  for (const c of plan.comment) {
    if (c.skip) continue;
    try {
      await almLib.comment(programDir, cfg, c.key, `PR #${pr.number} mergeado (${pr.url || ''}) — parte deste card; o card segue aberto até o PR que o fecha`, net);
      out.commented.push(c.key);
      rec({ action: 'commented', key: c.key });
    } catch (err) { out.errors.push(`${c.key}: ${err.message}`); }
  }
  return out;
}

/**
 * The merged PRs that cite each key (gh pr list --state merged), with the kind of citation.
 * @returns {Map<string, { pr: number, url: string|null, kind: 'closes'|'partial'|'bare', merged_at: string|null }[]>}
 */
function mergedPrsByKey(root, cfg, options = {}) {
  const args = ['pr', 'list', '--state', 'merged', '--limit', String(options.limit || 500), '--json', 'number,title,body,headRefName,url,mergedAt'];
  if (options.repo) args.push('-R', options.repo);
  const prs = gh(args, root, options.ghSpawn) || [];
  const out = new Map();
  for (const p of prs) {
    const m = prMarkers([p.title, p.headRefName, p.body], cfg);
    const add = (k, kind) => { if (!out.has(k)) out.set(k, []); out.get(k).push({ pr: p.number, url: p.url || null, kind, merged_at: p.mergedAt || null }); };
    for (const k of m.closes) add(k, 'closes');
    for (const k of m.partial) add(k, 'partial');
    for (const k of m.bare) add(k, 'bare');
  }
  return out;
}

/** "Parte de KEY" or "Fecha KEY" for a task PR: Fecha only when no other open task of the plan shares the card. */
function prMarkerFor(key, taskId, planDoc, keyOfTask) {
  if (!key) return null;
  const others = ((planDoc && planDoc.tasks) || []).filter((t) => t && t.id !== taskId && !(t.done === true || t.status === 'done') && !t.superseded && !t.merged_into && keyOfTask(t.id) === key);
  return others.length ? { marker: `Parte de ${key}`, open_tasks: others.map((t) => t.id) } : { marker: `Fecha ${key}`, open_tasks: [] };
}

module.exports = { prMarkers, readPr, prMerged, mergedPrsByKey, prMarkerFor, keyPattern, ledger };
