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
    if (/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(key)) continue;
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
function classifyFailure(output, targets, options = {}) {
  const text = String(output || '');
  if (options.targetsExist && ASSERTION_RE.test(text) && !/Must use|Unknown (option|argument)|command not found|is not recognized|Cannot find module '(?!\.)/i.test(text)) {
    return 'assertion_red';
  }
  if (!MISSING_TARGET_RE.test(text)) return 'broken_command';
  const mentioned = targets.some((file) => {
    const base = path.basename(file).replace(/\.(c|m)?[jt]sx?$/, '');
    return text.includes(file) || (base.length > 2 && text.includes(base));
  });
  return mentioned ? 'missing_target' : 'broken_command';
}

const SEVERITY = { already_green: 0, missing_target: 1, assertion_red: 1, timeout: 3, broken_command: 4 };

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
function dryRunVerifyCommands(projectRoot, plan, options = {}) {
  const timeoutMs = options.timeoutMs || 180_000;
  const results = [];
  const errors = [];
  const warnings = [];
  for (const task of plan && Array.isArray(plan.tasks) ? plan.tasks : []) {
    if (task.done || !task.verifyCommand) continue;
    const targets = (task.files || []).filter(Boolean);
    // OXB-018: each `a && b` segment runs alone. A first segment red for the right reason used to hide a broken
    // second one (the SPEC "Como verificar" the compile appends), which surfaced only once the task made the first pass.
    const targetsExist = targets.length > 0 && targets.every((f) => require('fs').existsSync(path.resolve(projectRoot, f)));
    const segments = splitSegments(task.verifyCommand);
    let verdict = null;
    let code = null;
    let excerpt = '';
    for (const segment of segments) {
      const run = runCommand(segment, projectRoot, timeoutMs);
      const v = run.timedOut ? 'timeout' : run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist });
      // The worst segment decides; among equals, a red one beats green (a red segment proves the task is not done).
      if (verdict === null || SEVERITY[v] > SEVERITY[verdict]) {
        verdict = v;
        code = run.code;
        const tail = run.output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-6).join(' | ');
        excerpt = `${segments.length > 1 ? `[${segment.slice(0, 80)}] ` : ''}${tail}`.slice(0, 600);
      }
    }
    results.push({ task: task.id, verdict, code, excerpt, segments: segments.length });
    if (verdict === 'broken_command') errors.push(`${task.id}: comando de verificação falha por outro motivo que não o alvo ausente — corrija o plano antes de executar: ${excerpt}`);
    else if (verdict === 'timeout') errors.push(`${task.id}: comando de verificação passou de ${Math.round(timeoutMs / 1000)}s sem terminar`);
    else if (verdict === 'already_green') warnings.push(`${task.id}: verificação já passa antes da tarefa — não prova o trabalho dela`);
  }
  return { ok: errors.length === 0, results, errors, warnings };
}

module.exports = { dryRunVerifyCommands, classifyFailure };
