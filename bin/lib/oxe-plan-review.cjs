'use strict';

/**
 * OXB-111: adversarial review of the plan (`oxe-cc plan lint --review`), written to `.oxe/PLAN-REVIEW.md` (+ .json).
 * Deterministic, from PLAN.json, the phase criteria (PROGRAM.json), the implementation pack, the decisions and the
 * frozen tests. One verdict per dimension (PASS / WARN / FAIL):
 *   coverage       — every criterion of the phase has a task AND a frozen acceptance test
 *   completeness   — every code task has files, a verify and criteria
 *   coupling       — tasks that can run in any order (no dependency path) touching the same file; a task whose frozen
 *                    test needs a file another task owns without depending on it
 *   links          — a new source file only its creating task mentions: nothing planned wires it up
 *   scope          — scopes that are globs of everything or very large
 *   verification   — a task with criteria whose verify runs none of its frozen tests
 *   decisions      — tasks citing decisions that do not exist; decisions no task cites
 *   scope_cut      — a phase criterion delivered only by verify-only / external tasks (the work moved elsewhere)
 * A FAIL blocks `runtime execute` while the review matches the current plan, unless waived:
 * `plan lint --review --waive <dimension> --reason "…" --by <papel>`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIMENSIONS = ['coverage', 'completeness', 'coupling', 'links', 'scope', 'verification', 'decisions', 'scope_cut'];
const LABEL = {
  coverage: 'Cobertura', completeness: 'Completude', coupling: 'Acoplamento temporal não declarado', links: 'Ligações planejadas',
  scope: 'Escopo', verification: 'Verificação derivada dos critérios', decisions: 'Decisões', scope_cut: 'Redução de escopo',
};
const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java|py|go|rs|swift|cs|vue|svelte)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function planHash(doc) {
  return crypto.createHash('sha256').update(JSON.stringify({ tasks: doc.tasks, acceptance_tests: doc.acceptance_tests || [] })).digest('hex').slice(0, 16);
}

function review(projectRoot, doc, ctx = {}) {
  const tasks = (doc.tasks || []).filter(Boolean);
  const pending = tasks.filter((t) => t.done !== true);
  const tests = (doc.acceptance_tests || []).filter(Boolean);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isCode = (t) => !['external_delivery', 'verify_only', 'spike'].includes(t.kind) && (t.files || []).some((f) => CODE_RE.test(String(f)));
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, { verdict: 'PASS', findings: [] }]));
  const add = (dim, level, text) => {
    out[dim].findings.push({ level, text });
    if (level === 'FAIL') out[dim].verdict = 'FAIL';
    else if (out[dim].verdict === 'PASS') out[dim].verdict = 'WARN';
  };
  // dependency closure
  const reach = new Map();
  const deps = (id, seen = new Set()) => {
    if (reach.has(id)) return reach.get(id);
    if (seen.has(id)) return new Set();
    seen.add(id);
    const t = byId.get(id);
    const set = new Set();
    for (const d of (t && t.depends_on) || []) { set.add(d); for (const x of deps(d, seen)) set.add(x); }
    reach.set(id, set);
    return set;
  };
  const ordered = (a, b) => deps(a).has(b) || deps(b).has(a);

  // coverage
  const criteria = ctx.phaseCriteria && ctx.phaseCriteria.length ? ctx.phaseCriteria : [...new Set(tasks.flatMap((t) => t.acceptance || []))];
  for (const c of criteria) {
    if (ctx.standing && ctx.standing.includes(c)) continue;
    const owners = tasks.filter((t) => (t.acceptance || []).includes(c));
    const frozen = tests.filter((a) => a.criterion === c);
    if (!owners.length) add('coverage', 'FAIL', `${c}: nenhuma tarefa cobre o critério`);
    else if (!frozen.length) add('coverage', 'WARN', `${c}: coberto por ${owners.map((t) => t.id).join(', ')} mas sem teste de aceite congelado`);
    // scope cut
    if (owners.length && owners.every((t) => ['external_delivery', 'verify_only'].includes(t.kind) || (t.blocked_by || []).some((b) => typeof b === 'string'))) {
      add('scope_cut', 'WARN', `${c}: só tarefas de verificação/entrega externa (${owners.map((t) => t.id).join(', ')}) — o trabalho saiu desta fase; confirme com um CR ou registre a decisão`);
    }
  }
  // completeness
  for (const t of pending) {
    if (['external_delivery', 'verify_only'].includes(t.kind)) continue;
    const cmds = ((t.verify && t.verify.commands) || []).filter((x) => String(x).trim());
    if (!(t.files || []).length) add('completeness', 'FAIL', `${t.id}: sem files (escopo vazio)`);
    if (!cmds.length && !(t.verify && t.verify.command)) add('completeness', isCode(t) ? 'FAIL' : 'WARN', `${t.id}: sem verify`);
    if (!(t.acceptance || []).length) add('completeness', 'WARN', `${t.id}: sem critério (acceptance) — não fecha nada do SPEC`);
  }
  // coupling: same file, no order between them
  const owners = new Map();
  for (const t of pending) for (const f of t.files || []) { const p = norm(f); if (!p.includes('*')) owners.set(p, [...(owners.get(p) || []), t.id]); }
  for (const [file, ids] of owners) {
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      if (!ordered(ids[i], ids[j])) add('coupling', 'FAIL', `${ids[i]} e ${ids[j]} mexem em ${file} sem dependência entre elas — a ordem fica por conta do acaso (declare depends_on)`);
    }
  }
  try {
    const gaps = require('./oxe-test-scope.cjs').scopeGaps(projectRoot, doc);
    for (const [id, g] of Object.entries(gaps)) {
      for (const f of g.files) {
        const owner = pending.find((t) => t.id !== id && (t.files || []).some((x) => norm(x) === f));
        if (owner && !deps(id).has(owner.id)) add('coupling', 'WARN', `${id}: o teste congelado precisa de ${f}, que ${owner.id} entrega, sem ${id} depender de ${owner.id}`);
      }
    }
  } catch { /* */ }
  // links: a new source file nothing else in the plan mentions
  const planText = JSON.stringify({ tasks: tasks.map((t) => ({ id: t.id, title: t.title, files: t.files, commit: t.commit })), pack: ctx.pack || null });
  for (const t of pending) {
    for (const f of t.files || []) {
      const p = norm(f);
      if (p.includes('*') || !CODE_RE.test(p) || TEST_RE.test(p) || fs.existsSync(path.join(projectRoot, p))) continue;
      const stem = path.posix.basename(p).replace(/\.[^.]+$/, '');
      if (/^(index|main)$/.test(stem)) continue;
      const mentions = (planText.match(new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      const importedByTest = tests.some((a) => (a.files || []).some((tf) => { try { return fs.readFileSync(path.join(projectRoot, norm(tf)), 'utf8').includes(stem); } catch { return false; } }));
      if (mentions <= 1 && !importedByTest) add('links', 'WARN', `${t.id}: cria ${p}, mas nenhuma outra tarefa, pack ou teste congelado o menciona — quem liga este módulo?`);
    }
  }
  // scope
  for (const t of pending) {
    const files = (t.files || []).map(norm);
    if (files.some((f) => f === '**' || f === '**/*' || f === '*' || /^[^/]+\/\*\*$/.test(f) && f.split('/').length === 2 && ['src/**', 'app/**', 'lib/**'].includes(f))) add('scope', 'FAIL', `${t.id}: escopo amplo demais (${files.filter((f) => f.includes('**')).join(', ')})`);
    else if (files.length > (ctx.maxFiles || 25)) add('scope', 'WARN', `${t.id}: ${files.length} arquivos no escopo — divida a tarefa`);
  }
  // verification derived from criteria
  for (const t of pending) {
    if (!(t.acceptance || []).length || ['external_delivery', 'spike'].includes(t.kind)) continue;
    const mine = tests.filter((a) => a.task === t.id || (!a.task && (t.acceptance || []).includes(a.criterion)));
    if (!mine.length) continue;
    const verifyText = [...((t.verify && t.verify.commands) || []), (t.verify && t.verify.command) || ''].join(' ').replace(/\\/g, '/');
    const runsOne = mine.some((a) => (a.command && verifyText.includes(a.command.trim())) || (a.files || []).some((f) => verifyText.includes(norm(f)) || verifyText.includes(path.posix.basename(norm(f)))));
    if (!runsOne) add('verification', 'FAIL', `${t.id}: o verify não roda nenhum dos testes congelados dos critérios dela (${mine.flatMap((a) => a.files || []).slice(0, 3).join(', ')})`);
  }
  // decisions
  const decisionIds = new Set((ctx.decisions || []).map((d) => d.id));
  const cited = new Set();
  for (const t of tasks) for (const d of t.decisions || []) { cited.add(d); if (decisionIds.size && !decisionIds.has(d)) add('decisions', 'FAIL', `${t.id}: cita ${d}, que não existe em decisions.ndjson`); }
  for (const d of ctx.decisions || []) {
    if (!d || !d.id || /^D-SPIKE-/.test(d.id) || (ctx.phase && d.phase && d.phase !== ctx.phase)) continue;
    if (!cited.has(d.id)) add('decisions', 'WARN', `${d.id} (${String(d.title || '').slice(0, 60)}) não é citada por nenhuma tarefa`);
  }
  return { schema_version: 1, generated_at: new Date().toISOString(), plan_hash: planHash(doc), phase: ctx.phase || null, dimensions: out };
}

function previous(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'PLAN-REVIEW.json'), 'utf8')); } catch { return null; }
}

function writeReview(projectRoot, rev, options = {}) {
  const prev = previous(projectRoot);
  // waivers stay while the plan is the same one they were given for
  if (!options.keepWaivers) rev.waivers = prev && prev.plan_hash === rev.plan_hash && Array.isArray(prev.waivers) ? prev.waivers : [];
  fs.mkdirSync(path.join(projectRoot, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.oxe', 'PLAN-REVIEW.json'), `${JSON.stringify(rev, null, 2)}\n`);
  const lines = ['# PLAN-REVIEW', '', `Gerado em ${rev.generated_at} · plano ${rev.plan_hash}${rev.phase ? ` · fase ${rev.phase}` : ''}`, '', '| Dimensão | Veredito | Achados |', '|---|---|---|'];
  for (const d of DIMENSIONS) {
    const x = rev.dimensions[d];
    const waived = rev.waivers.find((w) => w.dimension === d);
    lines.push(`| ${LABEL[d]} | ${x.verdict}${waived ? ' (dispensado)' : ''} | ${x.findings.length} |`);
  }
  for (const d of DIMENSIONS) {
    const x = rev.dimensions[d];
    if (!x.findings.length) continue;
    lines.push('', `## ${LABEL[d]} — ${x.verdict}`, '');
    for (const f of x.findings) lines.push(`- **${f.level}** ${f.text}`);
  }
  if (rev.waivers.length) { lines.push('', '## Dispensas', ''); for (const w of rev.waivers) lines.push(`- ${LABEL[w.dimension] || w.dimension}: ${w.reason} (${w.by}, ${w.at})`); }
  fs.writeFileSync(path.join(projectRoot, '.oxe', 'PLAN-REVIEW.md'), `${lines.join('\n')}\n`);
  return rev;
}

function waive(projectRoot, dimension, options = {}) {
  const rev = previous(projectRoot);
  if (!rev) throw new Error('sem .oxe/PLAN-REVIEW.json — rode oxe-cc plan lint --review');
  if (!DIMENSIONS.includes(dimension)) throw new Error(`dimensão desconhecida: ${dimension} (use ${DIMENSIONS.join(', ')})`);
  const reason = String(options.reason || '').trim();
  const by = String(options.by || '').trim();
  if (!by || reason.length < 8) throw new Error('--waive exige --by <papel> e --reason "…"');
  rev.waivers = [...(rev.waivers || []).filter((w) => w.dimension !== dimension), { dimension, by, reason, at: new Date().toISOString() }];
  return writeReview(projectRoot, rev, { keepWaivers: true });
}

/** FAIL dimensions not waived, when the review is of the current plan (else: stale, nothing blocks). */
function blockingFails(projectRoot, doc) {
  const rev = previous(projectRoot);
  if (!rev || !doc) return { stale: false, fails: [] };
  if (rev.plan_hash !== planHash(doc)) return { stale: true, fails: [] };
  const waived = new Set((rev.waivers || []).map((w) => w.dimension));
  return { stale: false, fails: DIMENSIONS.filter((d) => rev.dimensions[d] && rev.dimensions[d].verdict === 'FAIL' && !waived.has(d)).map((d) => ({ dimension: d, findings: rev.dimensions[d].findings.filter((f) => f.level === 'FAIL') })) };
}

module.exports = { DIMENSIONS, LABEL, review, writeReview, waive, blockingFails, planHash };
