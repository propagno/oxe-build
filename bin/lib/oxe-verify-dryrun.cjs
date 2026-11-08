'use strict';

/**
 * OXE 1.19 — "vermelho pelo motivo certo" (OXB-009).
 *
 * Antes de executar, cada comando de verificação de tarefa ainda não feita roda uma vez. Ele deve FALHAR porque o
 * alvo da tarefa ainda não existe (módulo/arquivo ausente). Se falhar por outro motivo, o comando está quebrado
 * e reprovaria toda tentativa do executor, que pagaria retries por um defeito do plano (OxeVoice F1: esbuild sem
 * `outdir`, 3 tentativas perdidas). Se já PASSAR, não prova nada sobre a tarefa.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const MISSING_TARGET_RE = /cannot find module|failed to resolve import|does the file exist|enoent|no such file|could not resolve|module not found|não encontrad|cannot open file|file not found|not found/i;

function scrubbedEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^OXESPACE_/i.test(key)) continue;
    if (/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/i.test(key)) continue;
    // Inherited from a parent `node --test`, it makes a child `node --test` speak the runner protocol and exit 0:
    // a red verify read as already green.
    if (key === 'NODE_TEST_CONTEXT') continue;
    out[key] = value;
  }
  return out;
}

function runCommand(command, cwd, timeoutMs) {
  const isWin = process.platform === 'win32';
  const res = spawnSync(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', command] : ['-c', command], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    windowsVerbatimArguments: isWin,
    env: scrubbedEnv(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    code: res.status,
    timedOut: Boolean(res.error && /ETIMEDOUT/.test(String(res.error.code || res.error.message))),
    output: `${res.stdout || ''}\n${res.stderr || ''}`,
  };
}

// A test runner's own assertion failure (not a tool/config error): the right red for a task that FIXES existing code.
const ASSERTION_RE = /AssertionError|expected .+ to (be|equal|deeply equal|match|contain|have)|Expected:|toEqual|toBe\(|^\s*(FAIL|×|✗|not ok)\s/im;

/**
 * "Red for the right reason": the failure complains about something the task creates (missing target) or, when the
 * task changes files that already exist, the test runner's own assertions fail (the behavior is not there yet).
 */
const TOOL_ERROR_RE = /Must use|Unknown (option|argument)|command not found|is not recognized|Cannot find module '(?!\.)/i;

/** A target and its directories, with `/` separators (Windows prints `src\design\icons`). */
function targetForms(file, projectRoot = null) {
  const norm = String(file).replace(/\\/g, '/');
  const forms = [norm];
  const base = path.posix.basename(norm).replace(/\.(c|m)?[jt]sx?$/, '');
  if (base.length > 2) forms.push(base);
  // OXB-040: a missing target DIRECTORY ("ENOENT scandir src\design\icons") is the right red too — only directories
  // that do not exist yet (an existing `src/design` in a message proves nothing).
  let dir = path.posix.dirname(norm);
  while (dir && dir !== '.' && dir !== '/' && dir.includes('/')) {
    if (!projectRoot || !require('fs').existsSync(path.resolve(projectRoot, dir))) forms.push(dir);
    dir = path.posix.dirname(dir);
  }
  return forms;
}

function classifyFailure(output, targets, options = {}) {
  const text = String(output || '');
  // `\` and `\\` (JSON-escaped paths in some runners) both become `/`.
  const normalized = text.replace(/\\+/g, '/');
  // OXB-040: per file. "Missing target" when the output names a target (or its directory) that does not exist yet;
  // "assertion red" when the runner's assertions fail and SOME of the task's own files already exist — a task that
  // changes existing files and adds a new test fit neither path before (both required ALL or NONE to exist).
  const missing = (options.missingTargets || targets).filter(Boolean);
  if (MISSING_TARGET_RE.test(text) && missing.some((file) => targetForms(file, options.projectRoot || null).some((form) => normalized.includes(form)))) {
    return 'missing_target';
  }
  const someOwnExist = options.someTargetsExist != null ? options.someTargetsExist : options.targetsExist;
  if (someOwnExist && ASSERTION_RE.test(text) && !TOOL_ERROR_RE.test(text)) return 'assertion_red';
  return 'broken_command';
}

const SEVERITY = { external_pending: 0, already_green: 0, missing_target: 1, assertion_red: 1, timeout: 3, broken_command: 4 };

/** Top-level `&&` segments of a command (quoted text is not split). */
function splitSegments(command) {
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '&' && command[i + 1] === '&') {
      out.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * @param {{ tasks: Array<{id:string, files?:string[], verifyCommand?:string|null, done?:boolean}> }} plan
 * @returns {{ ok: boolean, results: Array<{task:string, verdict:string, code:number|null, excerpt:string}>, errors: string[], warnings: string[] }}
 */
/** `'…'` used as a shell argument (not an apostrophe inside double quotes). */
function hasSingleQuotedArgument(command) {
  const outsideDouble = String(command || '').replace(/"[^"]*"/g, '""');
  return /(^|\s)'[^']*'(\s|$)/.test(outsideDouble);
}

function dryRunVerifyCommands(projectRoot, plan, options = {}) {
  const timeoutMs = options.timeoutMs || 180_000;
  const platform = options.platform || process.platform;
  const results = [];
  const errors = [];
  const warnings = [];
  const allTasks = plan && Array.isArray(plan.tasks) ? plan.tasks : [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  /** Files of the pending tasks this one depends on (transitively): their absence is the right red too (OXB-027). */
  const pendingDependencyFiles = (task) => {
    const out = new Set();
    const seen = new Set();
    const stack = [...(task.dependsOn || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const dep = byId.get(id);
      if (!dep || dep.done) continue;
      for (const f of dep.files || []) if (f) out.add(f);
      stack.push(...(dep.dependsOn || []));
    }
    return [...out];
  };
  for (const task of allTasks) {
    if (task.done || !task.verifyCommand) continue;
    // OXB-063: work delivered by another path, still waiting on an open external dependency, cannot be green yet —
    // its verify is not run and the verdict is `external_pending` (never an error). Once unblocked it runs as usual.
    const meta = task.meta || {};
    const openDeps = Array.isArray(meta.blocked_by) ? meta.blocked_by.filter(Boolean) : [];
    if (openDeps.length) {
      results.push({ task: task.id, verdict: 'external_pending', code: null, excerpt: `aguardando ${openDeps.join(', ')}`, segments: 0 });
      warnings.push(`${task.id}: verify não rodado — aguardando ${openDeps.join(', ')} (external_pending; roda quando a dependência for mergeada)`);
      continue;
    }
    const ownTargets = (task.files || []).filter(Boolean);
    // OXB-027: a test of T2 that requires T1's module fails with "Cannot find module" for T1's file while T1 has not
    // run: red for the right reason (a pending dependency), not a broken command.
    const targets = [...ownTargets, ...pendingDependencyFiles(task)];
    // OXB-018: each `a && b` segment runs alone. A first segment red for the right reason used to hide a broken
    // second one (the SPEC "Como verificar" the compile appends), which surfaced only once the task made the first pass.
    const exists = (f) => require('fs').existsSync(path.resolve(projectRoot, f));
    const targetsExist = ownTargets.length > 0 && targets.every(exists);
    // OXB-040: per file — the targets still missing, and whether any of the task's own files already exists.
    const missingTargets = targets.filter((f) => !exists(f));
    const someTargetsExist = ownTargets.some(exists);
    const segments = splitSegments(task.verifyCommand);
    let verdict = null;
    let code = null;
    let excerpt = '';
    for (const segment of segments) {
      const run = runCommand(segment, projectRoot, timeoutMs);
      const v = run.timedOut ? 'timeout' : run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist, someTargetsExist, missingTargets, projectRoot });
      // The worst segment decides; among equals, a red one beats green (a red segment proves the task is not done).
      if (verdict === null || SEVERITY[v] > SEVERITY[verdict]) {
        verdict = v;
        code = run.code;
        const tail = run.output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-6).join(' | ');
        excerpt = `${segments.length > 1 ? `[${segment.slice(0, 80)}] ` : ''}${tail}`.slice(0, 600);
      }
    }
    results.push({ task: task.id, verdict, code, excerpt, segments: segments.length });
    // OXB-040: cmd.exe does not group arguments with single quotes (`--jq '.[0].conclusion'` reaches gh split).
    const singleQuoted = platform === 'win32' && hasSingleQuotedArgument(task.verifyCommand);
    if (singleQuoted) warnings.push(`${task.id}: o verify usa aspas simples — no Windows (cmd.exe) elas não agrupam o argumento; use aspas duplas`);
    if (verdict === 'broken_command') errors.push(`${task.id}: comando de verificação falha por outro motivo que não o alvo ausente — corrija o plano antes de executar${singleQuoted ? ' (provável causa: aspas simples no Windows — troque por aspas duplas)' : ''}: ${excerpt}`);
    else if (verdict === 'timeout') errors.push(`${task.id}: comando de verificação passou de ${Math.round(timeoutMs / 1000)}s sem terminar`);
    else if (verdict === 'already_green') warnings.push(`${task.id}: verificação já passa antes da tarefa — não prova o trabalho dela`);
  }
  return { ok: errors.length === 0, results, errors, warnings };
}

module.exports = { dryRunVerifyCommands, classifyFailure, hasSingleQuotedArgument };
