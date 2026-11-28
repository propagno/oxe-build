'use strict';

/**
 * OXB-117: the remaining gaps.
 *  (a) cost and time per task, CR and retry, with a forecast of the phase budget (`oxe-cc runtime cost`);
 *  (b) a flaky verify (green then red on the same tree, OXB-162's flaky_suspect) goes to quarantine with evidence
 *      (`.oxe/QUARANTINE.json`); the lint points at plans still using it;
 *  (c) the regression impact across phases before the execute: pending tasks that touch files the frozen regression
 *      of a closed phase exercises;
 *  (d) a rollback rehearsal before the close: the phase's commits reverted in a temporary worktree;
 *  (e) a one-page, human-readable phase report written at the close (`RELATORIO.md` in the phase dossier).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const money = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const isDone = (t) => Boolean(t && (t.done === true || t.status === 'done'));
const isInactive = (t) => Boolean(t && (t.superseded || t.merged_into || t.status === 'superseded'));
const normPath = (f) => String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

function matchesCriterion(a, b) {
  const x = String(a || '').trim().toUpperCase();
  const y = String(b || '').trim().toUpperCase();
  return Boolean(x && y && (x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`)));
}

function taskVerifyCommands(t) {
  const v = t && t.verify;
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.map(String);
  return [...(Array.isArray(v.commands) ? v.commands.map(String) : []), ...(v.command ? [String(v.command)] : [])];
}

// ── (a) cost ──────────────────────────────────────────────────────────────────────────────────────────────────
function costReport(events, doc, changes) {
  const tasks = new Map();
  const row = (id) => { if (!tasks.has(id)) tasks.set(id, { task: id, attempts: 0, turns: 0, cost_usd: 0, ms: 0, retry_cost_usd: 0, retry_ms: 0 }); return tasks.get(id); };
  for (const e of events || []) {
    if (!e || e.type !== 'ExecutorUsage' || !e.work_item_id) continue;
    const p = e.payload || {};
    const r = row(e.work_item_id);
    const attempt = Number(p.attempt) || 1;
    r.attempts = Math.max(r.attempts, attempt);
    r.turns += Number(p.turns) || 0;
    r.cost_usd += Number(p.cost_usd) || 0;
    r.ms += Number(p.elapsed_ms) || 0;
    if (attempt > 1) { r.retry_cost_usd += Number(p.cost_usd) || 0; r.retry_ms += Number(p.elapsed_ms) || 0; }
  }
  for (const r of tasks.values()) { r.cost_usd = money(r.cost_usd); r.retry_cost_usd = money(r.retry_cost_usd); }
  const planTasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter((t) => t && !isInactive(t));
  const done = planTasks.filter(isDone);
  const pending = planTasks.filter((t) => !isDone(t) && !['external_delivery', 'verify_only'].includes(t.kind));
  const doneCosts = done.map((t) => tasks.get(t.id)).filter(Boolean);
  const avg = doneCosts.length ? doneCosts.reduce((a, r) => a + r.cost_usd, 0) / doneCosts.length : null;
  const avgMs = doneCosts.length ? doneCosts.reduce((a, r) => a + r.ms, 0) / doneCosts.length : null;
  const crs = (changes || []).filter(Boolean).map((cr) => {
    const ids = new Set([
      ...(cr.tasks || []),
      ...planTasks.filter((t) => (t.acceptance || []).some((a) => (cr.criteria || []).some((c) => matchesCriterion(a, c))) && t.reopened && t.reopened.some((x) => x.by === cr.id)).map((t) => t.id),
    ]);
    const cost = [...ids].reduce((a, id) => a + ((tasks.get(id) || {}).cost_usd || 0), 0);
    return { cr: cr.id, class: cr.class, tasks: [...ids], cost_usd: money(cost) };
  }).filter((c) => c.tasks.length);
  const all = [...tasks.values()];
  const spent = money(all.reduce((a, r) => a + r.cost_usd, 0));
  return {
    tasks: all.sort((a, b) => b.cost_usd - a.cost_usd),
    crs,
    totals: { cost_usd: spent, retry_cost_usd: money(all.reduce((a, r) => a + r.retry_cost_usd, 0)), ms: all.reduce((a, r) => a + r.ms, 0), turns: all.reduce((a, r) => a + r.turns, 0) },
    forecast: avg == null ? null : { pending_tasks: pending.length, avg_cost_usd: money(avg), remaining_cost_usd: money(avg * pending.length), phase_total_usd: money(spent + avg * pending.length), remaining_ms: Math.round(avgMs * pending.length) },
  };
}

// ── (b) quarantine ────────────────────────────────────────────────────────────────────────────────────────────
const QFILE = (root) => path.join(root, '.oxe', 'QUARANTINE.json');
function readQuarantine(root) { try { return JSON.parse(fs.readFileSync(QFILE(root), 'utf8')); } catch { return { schema_version: 1, entries: [] }; } }
function quarantine(root, entry) {
  const q = readQuarantine(root);
  if (!entry || !String(entry.command || '').trim()) return q;
  const cmd = String(entry.command).trim();
  const key = `${entry.task || ''}|${cmd}`;
  const prev = q.entries.find((e) => `${e.task || ''}|${e.command}` === key);
  if (prev) { prev.count = (prev.count || 1) + 1; prev.last_at = entry.at; prev.evidence = entry.evidence || prev.evidence; }
  else q.entries.push({ ...entry, command: cmd, count: 1, first_at: entry.at, last_at: entry.at });
  fs.mkdirSync(path.dirname(QFILE(root)), { recursive: true });
  fs.writeFileSync(QFILE(root), `${JSON.stringify(q, null, 2)}\n`);
  return q;
}
function quarantineWarnings(root, doc) {
  const q = readQuarantine(root);
  const out = [];
  for (const e of q.entries || []) {
    const cmd = String((e && e.command) || '').trim();
    const needle = cmd.slice(0, 60);
    if (!needle) continue;
    const users = ((doc && doc.tasks) || []).filter((t) => t && !isDone(t) && !isInactive(t) && taskVerifyCommands(t).some((c) => c.includes(needle)));
    if (users.length) out.push(`verify em quarentena (instável ${e.count}×, último ${e.last_at}): \`${cmd.slice(0, 80)}\` — usado por ${users.map((t) => t.id).join(', ')}; estabilize o teste ou isole o que ele depende de ordem/tempo`);
  }
  return out;
}

// ── (c) regression impact ─────────────────────────────────────────────────────────────────────────────────────
function regressionImpact(root, checks, doc) {
  const testScope = require('./oxe-test-scope.cjs');
  const touchedBy = new Map();
  for (const t of ((doc && doc.tasks) || []).filter((x) => x && !isDone(x) && !isInactive(x))) {
    for (const raw of t.files || []) {
      const f = normPath(raw);
      if (!f) continue;
      const list = touchedBy.get(f) || [];
      if (!list.includes(t.id)) touchedBy.set(f, [...list, t.id]);
    }
  }
  const hits = [];
  const seen = new Set();
  for (const c of checks || []) {
    if (!c) continue;
    const tests = [...new Set((String(c.command || '').match(/[\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?\b/g) || []).map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')))];
    for (const tf of tests) {
      for (const r of [{ path: tf, kind: 'test' }, ...testScope.testRequirements(root, tf)]) {
        const key = `${c.id || ''}|${r.path}`;
        if (seen.has(key)) continue;
        const ids = touchedBy.get(r.path);
        if (ids) {
          seen.add(key);
          hits.push({ check: c.id, phase: c.regression_phase || null, file: r.path, tasks: ids });
        }
      }
    }
  }
  return hits;
}

// ── (d) rollback rehearsal ────────────────────────────────────────────────────────────────────────────────────
function rehearseRollback(root, base) {
  if (!base) return { ok: true, skipped: 'sem base_commit' };
  const commits = (git(root, ['rev-list', `${base}..HEAD`]).stdout || '').split(/\r?\n/).filter(Boolean);
  if (!commits.length) return { ok: true, commits: 0 };
  const wsDir = path.join(root, '.oxe', 'rollback-ws');
  fs.mkdirSync(wsDir, { recursive: true });
  const stamp = Date.now().toString(36);
  let wt = path.join(wsDir, `r-${stamp}`);
  let seq = 1;
  while (fs.existsSync(wt)) wt = path.join(wsDir, `r-${stamp}-${seq++}`);
  const add = git(root, ['worktree', 'add', '-q', '--detach', wt, 'HEAD']);
  if (add.status !== 0) return { ok: false, error: `worktree: ${add.stderr.trim()}` };
  try {
    const merges = (git(root, ['rev-list', '--merges', `${base}..HEAD`]).stdout || '').trim();
    const r = merges
      ? { status: 1, stderr: 'a fase tem merges: reverta-os com -m <pai> à mão' }
      : spawnSync('git', ['-c', 'core.quotepath=false', 'revert', '--no-commit', '--no-edit', `${base}..HEAD`], { cwd: wt, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_EDITOR: 'true' } });
    const conflicts = (git(wt, ['diff', '--name-only', '--diff-filter=U']).stdout || '').split(/\r?\n/).filter(Boolean);
    return { ok: r.status === 0 && !conflicts.length, commits: commits.length, conflicts, error: r.status === 0 ? null : String(r.stderr || '').trim().split(/\r?\n/).slice(-2).join(' · ') };
  } finally {
    git(wt, ['revert', '--abort']);
    git(root, ['worktree', 'remove', '--force', wt]); // no links inside: a plain checkout of HEAD
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (fs.existsSync(wsDir) && fs.readdirSync(wsDir).length === 0) fs.rmdirSync(wsDir); } catch { /* ignore */ }
    git(root, ['worktree', 'prune']);
  }
}

// ── (e) phase report ──────────────────────────────────────────────────────────────────────────────────────────
function renderPhaseReport(r) {
  const fmtMs = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : `${Math.round(ms / 60000)} min`);
  const L = [`# Relatório da fase ${r.phase} — ${r.title || ''}`.trim(), '', `Fechada em ${r.at}${r.commit ? ` · commit ${String(r.commit).slice(0, 10)}` : ''}`, ''];
  L.push('## Entregue', '', `- Critérios: ${(r.criteria || []).join(', ') || '—'}`, `- Tarefas: ${r.tasks_done}/${r.tasks_total} concluídas${r.first_attempt_rate != null ? ` · ${Math.round(r.first_attempt_rate * 100)}% na 1ª tentativa` : ''}`, '');
  if (r.cost) L.push('## Custo e tempo', '', `- Gasto: US$ ${r.cost.totals.cost_usd.toFixed(2)} (retries US$ ${r.cost.totals.retry_cost_usd.toFixed(2)}) · ${r.cost.totals.turns} turnos · ${fmtMs(r.cost.totals.ms)} de executor`, '');
  L.push('## Mudanças pedidas', '', `- CRs abertos na fase: ${r.crs_total} · resolvidos: ${r.crs_resolved} · abertos: ${r.crs_open}`, '');
  L.push('## Riscos que ficaram', '');
  const risks = [];
  if (r.defects_waived) risks.push(`${r.defects_waived} defeito(s) dispensado(s) com motivo (.oxe/OPEN-DEFECTS.json)`);
  if (r.complexity_alarms) risks.push(`${r.complexity_alarms} alarme(s) de complexidade (.oxe/REFACTOR-PROPOSALS.md)`);
  if (r.api_flagged) risks.push(`${r.api_flagged} mudança(s) de API fora do pack (api-surface.md)`);
  if (r.deferred) risks.push(`${r.deferred} sign-off(s) adiado(s)`);
  if (r.quarantined) risks.push(`${r.quarantined} verify(s) em quarentena por instabilidade`);
  L.push(...(risks.length ? risks.map((x) => `- ${x}`) : ['- nenhum registrado']), '');
  L.push('## Rollback', '', r.rollback ? (r.rollback.ok ? `- Ensaio: os ${r.rollback.commits || 0} commit(s) da fase revertem sem conflito` : `- Ensaio FALHOU: ${r.rollback.error || ''} ${(r.rollback.conflicts || []).join(', ')}`) : '- não ensaiado', '');
  return `${L.join('\n')}\n`;
}

module.exports = { costReport, readQuarantine, quarantine, quarantineWarnings, regressionImpact, rehearseRollback, renderPhaseReport };
