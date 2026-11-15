'use strict';

/**
 * OXB-140: risk priority per criterion and a phase decision with three outcomes.
 *  - Each criterion has a risk P0–P3: a "Risco"/"Risk" column in the SPEC criteria table, or a `[P1]` tag in its
 *    text. Without one it inherits `program.default_risk` (P2) and the decision warns.
 *  - Coverage of a criterion in the phase: `full` (a frozen acceptance test and the phase verify completed, or a fresh
 *    sign-off with evidence), `partial` (tasks cover it, no proof), `none`.
 *  - Decision: FAIL when any P0/P1 is not full (a waiver never helps a P0/P1: partial never counts for P0); CONCERNS
 *    when every P0/P1 is full and every P2/P3 gap has an active waiver; PASS when everything is full. A P2/P3 gap
 *    without a waiver is FAIL too ("sem waiver, não fecha").
 *  - Waivers: `.oxe/program/waivers.ndjson` — criterion, reason, owner, `until` phase. A waiver whose `until` phase
 *    is reached (or passed) no longer counts: the gap is back in that phase.
 * Opt-in: `program.risk_decision: true`, or any criterion with a declared risk.
 */

const fs = require('fs');
const path = require('path');
const criteriaIds = require('./oxe-criteria-ids.cjs');

const RISKS = ['P0', 'P1', 'P2', 'P3'];
const FILE = (programDir) => path.join(programDir, 'waivers.ndjson');

function stripNoise(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$/gm, ' ');
}

function splitTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

function criterionRisks(specText) {
  const out = new Map();
  let riskCol = -1;
  let inCriteriaTable = true;
  for (const ln of stripNoise(specText).split(/\r?\n/)) {
    const cells = splitTableCells(ln);
    if (!cells) continue;
    if (cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    const c0 = (cells[0] || '').replace(/\*/g, '').trim();
    if (/^(?:r-?)?id$/i.test(c0)) {
      const c1 = (cells[1] || '').replace(/\*/g, '').trim();
      inCriteriaTable = /^id$/i.test(c0) && /crit[ée]rio|criterion/i.test(c1);
      riskCol = inCriteriaTable ? cells.findIndex((c) => /^(risco|risk)\b/i.test(c.replace(/\*/g, '').trim())) : -1;
      continue;
    }
    if (!inCriteriaTable) continue;
    const id = /^(A\d+(?:\.\d+)?|G\d+)$/i.exec(c0);
    if (!id) continue;
    const col = riskCol >= 0 ? String(cells[riskCol] || '').replace(/\*/g, '').trim().toUpperCase() : '';
    const tag = /\[(P[0-3])\]/i.exec(ln);
    const r = RISKS.includes(col) ? col : tag ? tag[1].toUpperCase() : null;
    if (r) out.set(id[1].toUpperCase(), r);
  }
  return out;
}

function listWaivers(programDir) {
  let raw = '';
  try { raw = fs.readFileSync(FILE(programDir), 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((w) => w && w.kind === 'waiver');
}

function addWaiver(programDir, input) {
  const criteria = String(input.criteria || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (!criteria.length) throw new Error('waive exige --criteria A12[,A13]');
  if (!input.reason || String(input.reason).trim().length < 8) throw new Error('waive exige --reason (o risco aceito, em uma frase)');
  if (!input.by) throw new Error('waive exige --by <dono>');
  if (!/^F\d+(?:\.\d+)?$/i.test(String(input.until || ''))) throw new Error('waive exige --until Fn (a fase em que o item volta)');
  fs.mkdirSync(programDir, { recursive: true });
  const recs = criteria.map((c) => ({ kind: 'waiver', criterion: c, reason: String(input.reason), by: String(input.by), until: String(input.until).toUpperCase(), phase: input.phase || null, at: new Date().toISOString() }));
  for (const r of recs) fs.appendFileSync(FILE(programDir), `${JSON.stringify(r)}\n`, 'utf8');
  return recs;
}

const phaseIndex = (program, id) => ((program && program.phases) || []).findIndex((p) => p.id === id);

/**
 * ctx: { phase, program, specText, doc (PLAN.json), verifyCompleted, signoffs (fresh), waivers, config }
 */
function decide(ctx) {
  const cfg = (ctx.config && ctx.config.program) || {};
  const risks = criterionRisks(ctx.specText);
  const enabled = cfg.risk_decision === true || risks.size > 0;
  const defaultRisk = RISKS.includes(cfg.default_risk) ? cfg.default_risk : 'P2';
  const criteria = ((ctx.phase && ctx.phase.acceptance) || []).map((x) => String(x).toUpperCase());
  const tests = ((ctx.doc && (ctx.doc.acceptance_tests || ctx.doc.acceptanceTests)) || []).filter(Boolean);
  const tasks = ((ctx.doc && ctx.doc.tasks) || []).filter(Boolean);
  const phaseId = ctx.phase && ctx.phase.id ? String(ctx.phase.id).toUpperCase() : null;
  const curIdx = phaseIndex(ctx.program, ctx.phase && ctx.phase.id);
  const testedSet = new Set(tests.map((a) => String(a.criterion || '').toUpperCase()).filter(Boolean));
  const signedSet = new Set(
    (ctx.signoffs || [])
      .filter((s) => s && s.evidence && (!phaseId || !s.phase || String(s.phase).toUpperCase() === phaseId))
      .flatMap((s) => (s.criteria || []).map((x) => String(x).toUpperCase())),
  );
  const taskSet = new Set(tasks.flatMap((t) => (t.acceptance || []).map((x) => String(x).toUpperCase())));
  const allKnownIds = [...new Set([...risks.keys(), ...testedSet, ...signedSet, ...taskSet])];
  const subsByParent = criteriaIds.subcriteriaOf(allKnownIds);
  const warnings = [];
  const rows = criteria.map((c) => {
    const subs = subsByParent.get(c) || [];
    const subRisks = subs.map((s) => risks.get(s)).filter(Boolean);
    const derivedSubRisk = subRisks.length ? subRisks.sort((a, b) => RISKS.indexOf(a) - RISKS.indexOf(b))[0] : null;
    const directOrParentRisk = risks.get(c) || risks.get(criteriaIds.parentOf(c)) || derivedSubRisk;
    const risk = directOrParentRisk || defaultRisk;
    if (!directOrParentRisk && enabled) warnings.push(`${c}: sem prioridade de risco — herdou ${defaultRisk} (declare a coluna Risco ou [P1] no critério)`);
    const frozen = criteriaIds.inPhase(c, testedSet) || (subs.length > 0 && subs.every((s) => testedSet.has(s)));
    const signed = criteriaIds.inPhase(c, signedSet) || (subs.length > 0 && subs.every((s) => signedSet.has(s)));
    const byTask = criteriaIds.inPhase(c, taskSet) || (subs.length > 0 && subs.some((s) => taskSet.has(s)));
    const coverage = (frozen && ctx.verifyCompleted) || signed ? 'full' : byTask || frozen ? 'partial' : 'none';
    const waiver = (ctx.waivers || []).filter((w) => String(w.criterion || '').toUpperCase() === c).pop() || null;
    const expired = waiver ? phaseIndex(ctx.program, waiver.until) >= 0 && curIdx >= phaseIndex(ctx.program, waiver.until) : false;
    return { criterion: c, risk, coverage, waiver: waiver && !expired ? { by: waiver.by, reason: waiver.reason, until: waiver.until } : null, waiver_expired: Boolean(waiver && expired) };
  });
  const reasons = [];
  for (const r of rows) {
    if (r.coverage === 'full') continue;
    if (r.risk === 'P0' || r.risk === 'P1') reasons.push(`FAIL: ${r.criterion} (${r.risk}) com cobertura ${r.coverage} — P0/P1 exige cobertura total; waiver não vale`);
    else if (!r.waiver) reasons.push(`FAIL: ${r.criterion} (${r.risk}) com cobertura ${r.coverage} sem waiver${r.waiver_expired ? ' (o waiver venceu nesta fase)' : ''} — oxe-cc runtime waive --criteria ${r.criterion} --reason "…" --until Fn --by <dono>`);
  }
  const decision = reasons.length ? 'FAIL' : rows.some((r) => r.coverage !== 'full') ? 'CONCERNS' : 'PASS';
  return { enabled, decision, rows, reasons, warnings };
}

function renderMatrix(out, phaseId) {
  const lines = [`# Matriz de risco — ${phaseId}`, '', `**Decisão:** ${out.decision}`, '', '| Critério | Risco | Cobertura | Waiver |', '|---|---|---|---|'];
  for (const r of out.rows) lines.push(`| ${r.criterion} | ${r.risk} | ${r.coverage} | ${r.waiver ? `${r.waiver.by} até ${r.waiver.until}: ${r.waiver.reason}` : r.waiver_expired ? 'vencido' : '—'} |`);
  if (out.warnings.length) lines.push('', ...out.warnings.map((w) => `- ${w}`));
  return `${lines.join('\n')}\n`;
}

module.exports = { RISKS, criterionRisks, listWaivers, addWaiver, decide, renderMatrix };
