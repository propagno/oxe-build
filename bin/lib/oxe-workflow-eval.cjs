'use strict';

/**
 * OXB-141: behavioral evaluation of OXE's own workflows. A case (`evals/<workflow>/*.json`) gives an input (the SPEC
 * criteria, the files, the phase acceptance tests), the guards the workflow must keep (regex of the instruction) and
 * the deterministic rules that score the produced plan. The runner produces a plan from the workflow text with a
 * MODEL — the default is a deterministic simulated planner that follows only the instructions present in the text
 * (so removing a guard reintroduces the defect it prevents); `--model claude` runs a real `claude -p` (paid, opt-in).
 * Baseline (the packaged workflow) × candidate are compared with the variance across `--runs`; a significant drop of
 * any rule's score is a regression. `--self-test` seeds one mutation per guard (the guard sentence removed) and the
 * evaluator must detect each one. The release report is `.oxe/release/eval-report.json`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadCases(workflow, dir = path.join(ROOT, 'evals')) {
  const d = path.join(dir, workflow.replace(/\.md$/, ''));
  let names = [];
  try { names = fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort(); } catch { names = []; }
  return names.map((n) => ({ file: n, ...JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')) }));
}

const has = (text, re) => new RegExp(re, 'im').test(String(text || ''));

/** The deterministic planner: follows only the instructions the workflow text contains. */
function simulatedPlanner(workflowText, input) {
  const g = Object.fromEntries((input.guards || []).map((x) => [x.id, has(workflowText, x.pattern)]));
  const tasks = (input.tasks || []).map((t, i) => {
    const phaseTest = (input.phase_acceptance_tests || [])[0];
    const ownTest = t.test || null;
    let verify;
    if (g['phase-acceptance-not-task-verify'] === false && phaseTest) verify = { commands: [phaseTest.command] };
    else if (ownTest) verify = { commands: [ownTest] };
    else verify = g['verify-required'] === false ? undefined : { commands: [input.default_verify || 'npm test'] };
    const files = g['explicit-files'] === false && i === 0 ? ['src/**'] : t.files;
    return { id: `T${i + 1}`, title: t.title, files, acceptance: t.acceptance, ...(verify ? { verify } : {}) };
  });
  return { tasks, acceptance_tests: input.phase_acceptance_tests || [] };
}

/** Deterministic rules over a produced plan: 1 = respected, 0 = violated, per task averaged. */
const RULES = {
  no_phase_acceptance_as_task_verify(plan) {
    const phaseCmds = new Set((plan.acceptance_tests || []).map((a) => a.command));
    const ts = plan.tasks || [];
    return ts.length ? ts.filter((t) => !((t.verify && t.verify.commands) || []).some((c) => phaseCmds.has(c))).length / ts.length : 1;
  },
  every_task_has_verify(plan) {
    const ts = plan.tasks || [];
    return ts.length ? ts.filter((t) => t.verify && (t.verify.commands || []).length).length / ts.length : 1;
  },
  explicit_files(plan) {
    const ts = plan.tasks || [];
    return ts.length ? ts.filter((t) => (t.files || []).length && !(t.files || []).some((f) => String(f).includes('*'))).length / ts.length : 1;
  },
};

function score(plan, rules) {
  const out = {};
  for (const r of rules) { if (!RULES[r]) throw new Error(`regra de avaliação desconhecida: ${r}`); out[r] = Math.round(RULES[r](plan) * 1000) / 1000; }
  return out;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

async function evaluateText(workflowText, cases, options = {}) {
  const runs = Math.max(1, Number(options.runs) || 1);
  const model = options.model || ((text, input) => simulatedPlanner(text, input));
  const perRule = {};
  for (const c of cases) {
    for (let i = 0; i < runs; i += 1) {
      const plan = await model(workflowText, c.input, c);
      for (const [r, v] of Object.entries(score(plan, c.rules))) (perRule[r] = perRule[r] || []).push(v);
    }
  }
  return Object.fromEntries(Object.entries(perRule).map(([r, xs]) => [r, { mean: Math.round(mean(xs) * 1000) / 1000, sd: Math.round(sd(xs) * 1000) / 1000, n: xs.length }]));
}

/** Regression: the candidate's mean drops by more than max(0.05, 2 × the pooled sd). */
function compare(base, cand) {
  const regressions = [];
  for (const [r, b] of Object.entries(base)) {
    const c = cand[r];
    if (!c) continue;
    const tol = Math.max(0.05, 2 * Math.max(b.sd, c.sd));
    if (b.mean - c.mean > tol) regressions.push({ rule: r, baseline: b.mean, candidate: c.mean, tolerance: Math.round(tol * 1000) / 1000 });
  }
  return regressions;
}

async function evalWorkflow(name, options = {}) {
  const cases = options.cases || loadCases(name, options.evalsDir);
  if (!cases.length) throw new Error(`sem casos de avaliação para ${name} (evals/${name.replace(/\.md$/, '')}/*.json)`);
  const baseText = options.baselineText != null ? options.baselineText : fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', name), 'utf8');
  const candText = options.candidate ? fs.readFileSync(options.candidate, 'utf8') : options.candidateText != null ? options.candidateText : baseText;
  const baseline = await evaluateText(baseText, cases, options);
  const candidate = await evaluateText(candText, cases, options);
  const regressions = compare(baseline, candidate);
  let selfTest = null;
  if (options.selfTest) {
    const guards = [...new Map(cases.flatMap((c) => (c.input.guards || [])).map((g) => [g.id, g])).values()];
    const results = [];
    for (const g of guards) {
      const mutated = baseText.split(/\r?\n/).filter((l) => !has(l, g.pattern)).join('\n');
      if (mutated === baseText) { results.push({ guard: g.id, detected: false, why: 'a guarda não existe no workflow' }); continue; }
      const m = await evaluateText(mutated, cases, options);
      results.push({ guard: g.id, detected: compare(baseline, m).length > 0 });
    }
    selfTest = { mutations: results.length, detected: results.filter((r) => r.detected).length, results };
  }
  return { workflow: name, runs: Number(options.runs) || 1, cases: cases.length, baseline, candidate, regressions, self_test: selfTest, ok: regressions.length === 0 && (!selfTest || selfTest.detected === selfTest.mutations) };
}

module.exports = { RULES, loadCases, simulatedPlanner, score, evaluateText, compare, evalWorkflow };
