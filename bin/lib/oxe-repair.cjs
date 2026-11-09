'use strict';

/**
 * OXB-130: a repair strategy after a failure, decided and recorded — never a blind retry.
 *  - `retry` needs a concrete adjustment: what the next attempt changes (the failing segment / tests named by the
 *    verify, the files the attempt left). No adjustment → the retry is refused and the next strategy is taken.
 *  - `decompose` proposes subtasks with their own verify: by acceptance criterion when the task has several, else by
 *    file. The proposal goes to `.oxe/repairs/<task>.json`; `oxe-cc runtime repair apply <task>` puts them in the plan
 *    (new ids `T<n>` with `split_of`, shown as `T7.1`, `T7.2`; the task moves to PLAN.json `decomposed`; its dependents
 *    depend on the subtasks). A subtask outside the task's files changes the pack scope and needs `--approve`.
 *  - `prune` takes the task out of the run and opens a CR for its owner with the task and the reason — never silent.
 * Config `execute.repair: { budget: 2, allow: ["retry", "decompose", "prune"] }`; the budget counts repairs per task.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOW = ['retry', 'decompose', 'prune'];

/** The concrete adjustment a retry can declare from the failure output; null when there is nothing new to act on. */
function adjustmentFrom(output, changes) {
  const text = String(output || '');
  const seg = /Failing segment[^:]*:\s*(.+)/.exec(text);
  const tests = [...new Set([...text.matchAll(/(?:✖|not ok \d+ -|FAIL(?:ED)?:?)\s+([^\n]{4,120})/g)].map((m) => m[1].trim()))].slice(0, 5);
  const assertion = /(AssertionError[^\n]{0,160}|Expected[^\n]{0,120}|expected[^\n]{0,120})/.exec(text);
  const parts = [];
  if (/^turns_exhausted:/m.test(text)) parts.push('a tentativa acabou sem turnos: a próxima recebe o nível de turnos seguinte e deve priorizar terminar o escopo restante');
  if (tests.length) parts.push(`fazer passar: ${tests.join('; ')}`);
  if (assertion) parts.push(`a asserção: ${assertion[1].trim()}`);
  if (seg && !tests.length) parts.push(`o segmento que reprovou: ${seg[1].trim().slice(0, 160)}`);
  if (changes && changes.kept && changes.kept.length && parts.length) parts.push(`partir do que a tentativa deixou (${changes.kept.slice(0, 5).join(', ')})`);
  return parts.length ? parts.join(' · ') : null;
}

function decomposition(task, doc) {
  const crit = Array.isArray(task.acceptance) ? task.acceptance : [];
  const files = (Array.isArray(task.files) ? task.files : []).filter((f) => !String(f).includes('*'));
  const tests = (doc.acceptance_tests || []).filter((a) => a && crit.includes(a.criterion));
  let parts = [];
  if (crit.length > 1) parts = crit.map((c) => ({ acceptance: [c], files: files.slice(), verify: tests.find((a) => a.criterion === c) ? { commands: [tests.find((a) => a.criterion === c).command] } : task.verify, label: c }));
  else if (files.length > 1) parts = files.map((f) => ({ acceptance: crit.slice(), files: [f], verify: task.verify, label: f }));
  if (parts.length < 2) return null;
  return parts;
}

function nextIds(doc, n) {
  const used = [...(doc.tasks || []), ...(doc.decomposed || [])].map((t) => Number(String(t.id).replace(/^T/, ''))).filter(Number.isFinite);
  let max = used.length ? Math.max(...used) : 0;
  return Array.from({ length: n }, () => `T${(max += 1)}`);
}

/**
 * The decision after a failure of `task`. ctx: { attempt, maxAttempts, failureClass, output, verifySuspect, changes,
 * repairsSoFar, config, final (true when the attempts are exhausted) }.
 */
function decide(task, doc, ctx) {
  const cfg = (ctx.config && ctx.config.execute && ctx.config.execute.repair) || {};
  const allow = new Set(Array.isArray(cfg.allow) ? cfg.allow : DEFAULT_ALLOW);
  const budget = Number.isInteger(cfg.budget) ? cfg.budget : 2;
  const logic = ['verify', 'llm', 'logic', 'turn_limit_exhausted', 'turns_exhausted', 'no_tool_call'].includes(String(ctx.failureClass || ''));
  if (!logic) return null; // OXB-120: environment / quota / waiting are not repaired here
  const overBudget = (ctx.repairsSoFar || 0) >= budget;
  if (!ctx.final && !ctx.verifySuspect && !overBudget && allow.has('retry')) {
    const adjustment = adjustmentFrom(ctx.output, ctx.changes);
    if (adjustment) return { strategy: 'retry', reason: `falha ${ctx.failureClass} na tentativa ${ctx.attempt}`, adjustment };
  }
  const why = ctx.verifySuspect ? 'a mesma falha duas vezes: repetir não traz informação nova' : overBudget ? `orçamento de reparo (${budget}) esgotado` : ctx.final ? 'tentativas esgotadas' : 'o retry não tem ajuste concreto a declarar';
  if (allow.has('decompose')) {
    const parts = decomposition(task, doc || {});
    if (parts) return { strategy: 'decompose', reason: why, adjustment: null, parts };
  }
  if (allow.has('prune')) return { strategy: 'prune', reason: why, adjustment: null };
  return { strategy: 'stop', reason: why, adjustment: null };
}

function proposalFile(root, taskId) { return path.join(root, '.oxe', 'repairs', `${taskId}.json`); }

function writeProposal(root, task, doc, decision) {
  const ids = nextIds(doc, decision.parts.length);
  const subtasks = decision.parts.map((p, i) => ({
    id: ids[i],
    title: `${task.id}.${i + 1} — ${task.title} (${p.label})`,
    wave: task.wave,
    files: p.files,
    acceptance: p.acceptance,
    verify: p.verify,
    depends_on: i === 0 ? (task.depends_on || []) : [...(task.depends_on || []), ids[i - 1]],
    split_of: task.id,
    alias: `${task.id}.${i + 1}`,
  }));
  const inside = new Set((task.files || []).map(String));
  const requiresApproval = subtasks.some((s) => s.files.some((f) => !inside.has(String(f))));
  const proposal = { schema: 1, task: task.id, strategy: 'decompose', reason: decision.reason, subtasks, requires_approval: requiresApproval, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(proposalFile(root, task.id)), { recursive: true });
  fs.writeFileSync(proposalFile(root, task.id), `${JSON.stringify(proposal, null, 2)}\n`);
  return proposal;
}

/** Puts the proposed subtasks in PLAN.json; the task moves to `decomposed`; its dependents depend on the subtasks. */
function applyProposal(root, jsonPath, doc, taskId, options = {}) {
  let proposal;
  try { proposal = JSON.parse(fs.readFileSync(proposalFile(root, taskId), 'utf8')); } catch { throw new Error(`sem proposta de reparo para ${taskId} (.oxe/repairs/${taskId}.json)`); }
  if (proposal.requires_approval && !options.approve) throw new Error(`${taskId}: as subtarefas mudam o escopo do pack — revise e rode com --approve`);
  const i = doc.tasks.findIndex((t) => t.id === taskId);
  if (i < 0) throw new Error(`${taskId} não está mais em PLAN.json tasks`);
  const [task] = doc.tasks.splice(i, 1, ...proposal.subtasks);
  doc.decomposed = [...(doc.decomposed || []), { ...task, into: proposal.subtasks.map((s) => s.id), reason: proposal.reason, at: new Date().toISOString() }];
  const last = proposal.subtasks[proposal.subtasks.length - 1].id;
  for (const t of doc.tasks) if (Array.isArray(t.depends_on) && t.depends_on.includes(taskId)) t.depends_on = t.depends_on.map((d) => (d === taskId ? last : d));
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(proposalFile(root, taskId), `${JSON.stringify({ ...proposal, applied_at: new Date().toISOString() }, null, 2)}\n`);
  return { task: taskId, into: proposal.subtasks.map((s) => ({ id: s.id, alias: s.alias })) };
}

module.exports = { adjustmentFrom, decide, decomposition, writeProposal, applyProposal, proposalFile };
