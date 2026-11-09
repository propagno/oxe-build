'use strict';

/**
 * OXB-132: a size budget for workflows and personas, a compact variant of the long ones, and the per-task context pack.
 *  - `oxe/workflows/size-budget.json` declares the size class of every workflow and persona (s ≤ 200 lines, m ≤ 400,
 *    l ≤ 650); a repository test fails when one passes its limit or is not declared.
 *  - every `l` workflow has `oxe/workflows/compact/<name>.md`, generated (scripts/build-compact-workflows.cjs): the
 *    headings, the numbered steps' first lines, every line that cites an `oxe-cc` command, a gate or a blocking rule.
 *    It preserves every command and gate the full one cites (tested).
 *  - which variant to read: config `context.compact: auto|on|off`; auto picks the compact one when the context slack
 *    (`runtime context --used --limit`) is under 30%.
 */

const fs = require('fs');
const path = require('path');

const LIMITS = Object.freeze({ s: 200, m: 400, l: 650 });
const ROOT = path.join(__dirname, '..', '..');
const BUDGET_FILE = path.join(ROOT, 'oxe', 'workflows', 'size-budget.json');

function lineCount(text) { return String(text).split(/\r?\n/).length; }

/** Errors of the budget: undeclared files, files over the limit of their class, l files without a compact variant. */
function checkBudget(root = ROOT) {
  const budget = JSON.parse(fs.readFileSync(path.join(root, 'oxe', 'workflows', 'size-budget.json'), 'utf8'));
  const errors = [];
  const files = [
    ...fs.readdirSync(path.join(root, 'oxe', 'workflows')).filter((n) => n.endsWith('.md')).map((n) => `workflows/${n}`),
    ...fs.readdirSync(path.join(root, 'oxe', 'personas')).filter((n) => n.endsWith('.md')).map((n) => `personas/${n}`),
  ];
  for (const rel of files) {
    const size = budget.files[rel];
    if (!size) { errors.push(`${rel}: sem nível de tamanho em oxe/workflows/size-budget.json`); continue; }
    if (!LIMITS[size]) { errors.push(`${rel}: nível "${size}" inválido (s|m|l)`); continue; }
    const n = lineCount(fs.readFileSync(path.join(root, 'oxe', rel), 'utf8'));
    if (n > LIMITS[size]) errors.push(`${rel}: ${n} linhas, acima do limite ${LIMITS[size]} do nível ${size}`);
    if (size === 'l' && rel.startsWith('workflows/') && !fs.existsSync(path.join(root, 'oxe', 'workflows', 'compact', path.basename(rel)))) errors.push(`${rel}: nível l sem variante compacta (rode node scripts/build-compact-workflows.cjs)`);
  }
  for (const rel of Object.keys(budget.files)) if (!files.includes(rel)) errors.push(`${rel}: declarado no orçamento mas não existe`);
  return errors;
}

const KEEP_RE = /oxe-cc\s|`[a-z_]+:[A-Za-z0-9*_-]+`|\b(gate|bloque|recusa|nunca|sempre|obrigat|exige|não avan|NUNCA|SEMPRE|STOP|PARE)\b/i;

/** The commands (`oxe-cc …` up to the first flag value) and gate ids a workflow cites. */
function citations(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/oxe-cc\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/g)) out.add(`oxe-cc ${m[1].trim()}`);
  for (const m of String(text).matchAll(/`([a-z_]+:[A-Za-z0-9*_-]+)`/g)) out.add(m[1]);
  return out;
}

function compactOf(name, text) {
  const out = [`<!-- variante compacta de oxe/workflows/${name} (OXB-132): gerada por scripts/build-compact-workflows.cjs. Em dúvida, leia a completa. -->`];
  let inFence = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const ln = raw.replace(/\s+$/, '');
    if (/^```/.test(ln.trim())) { inFence = !inFence; continue; }
    if (inFence) { if (KEEP_RE.test(ln)) out.push(`    ${ln.trim()}`); continue; }
    if (/^#{1,6}\s/.test(ln) || /^<\/?[a-z_]+>$/.test(ln.trim())) { out.push(ln); continue; }
    if (/^\s*\d+[a-z]?\.\s/.test(ln)) { out.push(ln); continue; }
    if (KEEP_RE.test(ln)) out.push(ln);
  }
  return `${out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')}\n`;
}

/** Which variant to read: `context.compact` on|off|auto (auto → compact when the slack is under 30%). */
function chooseVariant(name, config, slack) {
  const mode = (config && config.context && config.context.compact) || 'auto';
  const compact = path.join(ROOT, 'oxe', 'workflows', 'compact', name);
  const full = path.join(ROOT, 'oxe', 'workflows', name);
  if (!fs.existsSync(compact) || mode === 'off') return { variant: 'full', path: full };
  if (mode === 'on') return { variant: 'compact', path: compact };
  return slack != null && slack < 0.3 ? { variant: 'compact', path: compact, slack } : { variant: 'full', path: full, slack };
}

/**
 * The context pack of one task: its PLAN.json entry and the entries it depends on (transitively), and its
 * IMPLEMENTATION-PACK entries — nothing of the other tasks. stats compares with the whole PLAN.json + pack.
 */
function taskContextPack(doc, pack, taskId) {
  const tasks = (doc && doc.tasks) || [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (!byId.has(taskId)) throw new Error(`tarefa ${taskId} não está no PLAN.json`);
  const need = new Set();
  const walk = (id) => { if (need.has(id) || !byId.has(id)) return; need.add(id); for (const d of byId.get(id).depends_on || byId.get(id).dependsOn || []) walk(d); };
  walk(taskId);
  const slice = {
    task: byId.get(taskId),
    dependencies: [...need].filter((id) => id !== taskId).map((id) => { const t = byId.get(id); return { id: t.id, title: t.title, files: t.files, done: Boolean(t.done) }; }),
    acceptance_tests: (doc.acceptance_tests || []).filter((a) => a && (a.task === taskId || (!a.task && (byId.get(taskId).acceptance || []).includes(a.criterion)))),
    pack: pack && Array.isArray(pack.tasks) ? pack.tasks.filter((x) => x && need.has(x.id || x.task)) : [],
  };
  const full = JSON.stringify(doc).length + (pack ? JSON.stringify(pack).length : 0);
  const mine = JSON.stringify(slice).length;
  return { slice, stats: { tasks_included: [...need], full_chars: full, pack_chars: mine, reduction: full ? Math.round((1 - mine / full) * 1000) / 1000 : 0 } };
}

module.exports = { LIMITS, BUDGET_FILE, lineCount, checkBudget, citations, compactOf, chooseVariant, taskContextPack };
