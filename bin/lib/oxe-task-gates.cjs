'use strict';

/**
 * 1.21.2 (OXB-048): light gates on EVERY task that writes code, not only at phase verify.
 *
 * F1-T4 went green on its own new tests while the typecheck and the neighbouring migrations suite were red; the
 * `phase_gates` only run once, at phase verify, after the per-task PR was already out. `task_gates` are cheap checks
 * (incremental typecheck, tests related to the changed files) appended to the verify of each code task, so with the
 * per-segment verify (OXB-066) the executor sees exactly which gate failed and why.
 *
 * Declared in PLAN.json `task_gates` and/or `.oxe/config.json` `task_gates` (the plan wins on the same id):
 *   { id, command, applies_to?: regex of task files (default: code files), runner?: "… {command} …" }
 * `{files}` in the command expands to the task's matching files, quoted. A task may also list `affected_suites`
 * (e.g. a migration → tests/integration/migrations.test.ts); they run through config `task_suite_command`
 * ("npx vitest run {suites}"). Config `suite_rules: [{ paths, suite, reason? }]` makes lint warn when a task touches
 * `paths` without that suite in its verify or `affected_suites`.
 */

const CODE_FILE_RE = /\.(c|m)?[jt]sx?$|\.(vue|svelte|py|go|rs|java|kt|cs|rb|php|swift)$/i;

function quoteArg(value) {
  return /[\s"'&|<>^()]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : String(value);
}

function normalizeTaskGate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.command !== 'string' || !raw.command.trim()) return null;
  let appliesTo = null;
  if (typeof raw.applies_to === 'string' && raw.applies_to.trim()) {
    try { appliesTo = new RegExp(raw.applies_to); } catch { appliesTo = null; }
  }
  return {
    id: raw.id.trim(),
    command: raw.command.trim(),
    applies_to: appliesTo,
    runner: typeof raw.runner === 'string' && raw.runner.includes('{command}') ? raw.runner : null,
  };
}

/** config gates first, then the plan's (same id → the plan wins). */
function collectTaskGates(config, planDoc) {
  const byId = new Map();
  for (const source of [config && config.task_gates, planDoc && planDoc.task_gates]) {
    for (const raw of Array.isArray(source) ? source : []) {
      const gate = normalizeTaskGate(raw);
      if (gate) byId.set(gate.id, gate);
    }
  }
  return [...byId.values()];
}

/** A task the executor does not write code for gets no gates (done, external, verify-only, spike, docs-only). */
function taskWritesCode(task) {
  if (!task || task.done === true) return false;
  if (['external_delivery', 'verify_only', 'spike'].includes(task.kind)) return false;
  if (Array.isArray(task.blocked_by) && task.blocked_by.length) return false;
  return (task.files || []).some((f) => CODE_FILE_RE.test(String(f)));
}

/**
 * Commands appended to the task's verify, in order: each applicable gate, then the affected suites.
 * @returns {Array<{ id: string, command: string }>}
 */
function taskGateCommands(task, gates, config = {}) {
  const out = [];
  if (!taskWritesCode(task)) return out;
  const files = (task.files || []).map(String);
  for (const gate of gates) {
    const matching = files.filter((f) => (gate.applies_to ? gate.applies_to.test(f) : CODE_FILE_RE.test(f)));
    if (!matching.length) continue;
    let command = gate.command.replace(/\{files\}/g, matching.map(quoteArg).join(' '));
    if (gate.runner) command = gate.runner.replace(/\{command\}/g, command);
    out.push({ id: `task-gate-${gate.id}`, command });
  }
  const suites = Array.isArray(task.affected_suites) ? task.affected_suites.filter(Boolean).map(String) : [];
  const template = typeof config.task_suite_command === 'string' && config.task_suite_command.includes('{suites}') ? config.task_suite_command : null;
  if (suites.length && template) out.push({ id: 'affected-suites', command: template.replace(/\{suites\}/g, suites.map(quoteArg).join(' ')) });
  return out;
}

/** Appends the gate commands to `verifyCommand` (skips ones already in it). */
function withTaskGates(verifyCommand, commands) {
  const base = String(verifyCommand || '').trim();
  const extra = commands.map((c) => c.command).filter((c) => !base.includes(c));
  if (!extra.length) return base || null;
  return [base, ...extra].filter(Boolean).join(' && ');
}

/** Lint: PLAN.json `task_gates` shape, and the suite rules / affected_suites without a suite command. */
function lintTaskGates(planDoc, config = {}) {
  const errors = [];
  const warnings = [];
  if (planDoc && planDoc.task_gates != null) {
    if (!Array.isArray(planDoc.task_gates)) errors.push('$.task_gates: lista');
    else planDoc.task_gates.forEach((g, i) => {
      const at = `$.task_gates[${i}]`;
      if (!g || typeof g !== 'object') return errors.push(`${at}: deve ser objeto`);
      if (typeof g.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(g.id)) errors.push(`${at}.id: identificador (ex.: "tsc")`);
      if (typeof g.command !== 'string' || !g.command.trim()) errors.push(`${at}.command: obrigatório`);
      if (g.applies_to != null) { try { new RegExp(g.applies_to); } catch { errors.push(`${at}.applies_to: regex inválida`); } }
      if (g.runner != null && (typeof g.runner !== 'string' || !g.runner.includes('{command}'))) errors.push(`${at}.runner: modelo com {command}`);
    });
  }
  const tasks = planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : [];
  const rules = Array.isArray(config.suite_rules) ? config.suite_rules : [];
  for (const task of tasks) {
    if (!task || task.done === true) continue;
    const suites = Array.isArray(task.affected_suites) ? task.affected_suites.map(String) : [];
    if (suites.length && !(typeof config.task_suite_command === 'string' && config.task_suite_command.includes('{suites}'))) {
      warnings.push(`${task.id}: affected_suites declarado, mas o config.json não tem task_suite_command (ex.: "npx vitest run {suites}") — as suítes não rodam`);
    }
    const verifyText = (task.verify && Array.isArray(task.verify.commands) ? task.verify.commands : []).join(' ');
    for (const rule of rules) {
      if (!rule || !rule.paths || !rule.suite) continue;
      let re;
      try { re = new RegExp(rule.paths); } catch { continue; }
      const touched = (task.files || []).filter((f) => re.test(String(f)));
      if (!touched.length) continue;
      if (suites.includes(rule.suite) || verifyText.includes(rule.suite)) continue;
      warnings.push(`${task.id}: toca ${touched[0]} sem a suíte ${rule.suite} no verify nem em affected_suites${rule.reason ? ` (${rule.reason})` : ''}`);
    }
  }
  return { errors, warnings };
}

module.exports = { CODE_FILE_RE, collectTaskGates, taskWritesCode, taskGateCommands, withTaskGates, lintTaskGates };
