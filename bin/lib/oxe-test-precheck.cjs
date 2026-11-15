'use strict';

/**
 * 1.21.2 (G36 part 2, coordination 14/11): a frozen test is tested before any paid attempt depends on it. Three planner
 * test defects in one night (OxeChat F2 T5/T6, OxeCode F4 T20 CA-6) cost ~US$ 50 of attempts on code that was right.
 * The dry-verify ran each test against the CURRENT code, where it failed fast on the missing module — the defect (act +
 * fake timers that never settle, a count that depends on the run) only shows once there is code to run.
 *
 * `oxe-cc plan lint --precheck-tests [--precheck-runs 2]`: in a temporary worktree at HEAD (node_modules linked, the
 * frozen test files copied from the working tree), the planned skeleton (stubs from the pack signatures, `plan
 * skeleton`) is written so the tests import; each acceptance test of a pending task runs `runs` times. FIRST:
 *   - Fast / Self-validating: a run that hits the timeout is an error (`precheck_hang`) — the test hangs against a stub;
 *   - Repeatable: different passed/failed names between runs is an error (`precheck_flaky`);
 *   - Timely: every named proof passing against the stub is a warning (`precheck_passes_on_stub`) — the test does not
 *     need the implementation, so it does not prove the criterion.
 * The temporary worktree loses its node_modules link before it is removed (never a forced removal with it in place).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const norm = (p) => String(p || '').replace(/\\/g, '/');

/**
 * Runs the command in a child node that kills the WHOLE process tree on timeout. A plain spawnSync timeout kills only
 * the shell on Windows: the hung test (the very thing this check looks for) kept running, leaked, and held the
 * temporary worktree open.
 */
function defaultRun(cwd, command, timeoutMs) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, [__filename, String(timeoutMs), command], { cwd, encoding: 'utf8', timeout: timeoutMs + 30_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env });
  try { return JSON.parse(res.stdout); } catch { return { code: res.status, timedOut: Boolean(res.error), output: `${res.stdout || ''}\n${res.stderr || ''}` }; }
}

function childMain(timeoutMs, command) {
  const { spawn } = require('child_process');
  const chunks = [];
  let size = 0;
  const child = spawn(command, { shell: true, cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const onData = (b) => { if (size < 32 * 1024 * 1024) { chunks.push(b.toString('utf8')); size += b.length; } };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* */ } } }
  }, timeoutMs);
  child.on('close', (code) => { clearTimeout(timer); process.stdout.write(JSON.stringify({ code: timedOut ? null : code, timedOut, output: chunks.join('') })); });
}

if (require.main === module) childMain(Number(process.argv[2]) || 120_000, process.argv.slice(3).join(' '));

function resultNames(output) {
  let ex = null;
  try { ex = require('../../lib/runtime/index.js').extractTestResults; } catch { ex = null; }
  if (!ex) return { passed: [], failed: [] };
  const r = ex(output);
  return { passed: [...new Set(r.passed)].sort(), failed: [...new Set(r.failed)].sort() };
}

/** The acceptance tests of the pending tasks (by task, else by criterion). */
function pendingAcceptance(doc) {
  const tasks = ((doc && doc.tasks) || []).filter((t) => t && !(t.done === true || t.status === 'done'));
  const ids = new Set(tasks.map((t) => String(t.id).toUpperCase()));
  const crit = new Set(tasks.flatMap((t) => t.acceptance || []));
  return ((doc && doc.acceptance_tests) || []).filter((a) => a && a.command && (a.task ? ids.has(String(a.task).toUpperCase()) : crit.has(a.criterion)));
}

/**
 * @param {string} root project root (a git checkout)
 * @param {object} doc PLAN.json
 * @param {object} pack IMPLEMENTATION-PACK.json
 * @param {{ runs?: number, timeoutMs?: number, run?: Function, workspace?: { create: Function, dispose: Function } }} options
 */
function precheck(root, doc, pack, options = {}) {
  const entries = pendingAcceptance(doc);
  if (!entries.length && !(options.suites || []).length) return { ran: 0, findings: [] };
  const runs = Math.max(2, Number(options.runs) || 2);
  const run = options.run || defaultRun;
  const ws = options.workspace || gitWorkspace(root);
  const wt = ws.create();
  const findings = [];
  try {
    // the frozen tests as they are now (they may not be committed yet), then the planned stubs so they import
    for (const a of entries) for (const f of a.files || []) {
      const rel = norm(typeof f === 'string' ? f : f.path);
      const from = path.join(root, rel);
      if (fs.existsSync(from) && path.resolve(wt) !== path.resolve(root)) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.copyFileSync(from, path.join(wt, rel)); }
    }
    try {
      const sk = require('./oxe-plan-skeleton.cjs');
      sk.write(wt, sk.plan(wt, doc, pack, {}));
    } catch { /* no pack symbols: the tests run as they are */ }
    for (const a of entries) {
      const id = a.id || a.criterion;
      // OxeSpace 15/11 (OxeChat sessions): a command that runs on the CI (remote-verify) waits in its queue — wall time
      // is not the test's. Remote: 30 min by default, one run (no CI quota doubled), and a timeout is a warning.
      const remote = /remote-verify/.test(String(a.command));
      const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : Number(a.timeout_ms) > 0 ? Number(a.timeout_ms) : remote ? 30 * 60_000 : 120_000;
      const n = remote ? 1 : runs;
      const seen = [];
      let hang = null;
      for (let i = 0; i < n; i += 1) {
        const r = run(wt, a.command, timeoutMs);
        if (r.timedOut) { hang = r; break; }
        seen.push(resultNames(r.output));
      }
      const base = { criterion: a.criterion, id, task: a.task || null, command: a.command };
      if (hang && remote) { findings.push({ ...base, level: 'warn', kind: 'precheck_timeout_remote', why: `o run remoto passou de ${Math.round(timeoutMs / 60000)} min (fila da CI?) — não é travamento do teste; rode de novo ou aumente --precheck-timeout` }); continue; }
      if (hang) { findings.push({ ...base, level: 'error', kind: 'precheck_hang', why: `passou de ${Math.round(timeoutMs / 1000)} s contra o stub sem terminar — act + fake timers, um await que nunca resolve ou um servidor que não fecha` }); continue; }
      const sig = (x) => `${x.passed.join('|')}#${x.failed.join('|')}`;
      if (new Set(seen.map(sig)).size > 1) {
        const diff = seen[0].passed.filter((n) => !seen[1].passed.includes(n)).concat(seen[1].passed.filter((n) => !seen[0].passed.includes(n)));
        findings.push({ ...base, level: 'error', kind: 'precheck_flaky', why: `resultado diferente entre ${runs} execuções contra o mesmo stub (${diff.slice(0, 4).join(' | ') || 'contagem'}) — o teste depende de tempo, ordem ou estado de fora` });
        continue;
      }
      const proves = Array.isArray(a.proves) ? a.proves : [];
      const passed = seen[0] ? seen[0].passed : [];
      if (proves.length && proves.every((p) => passed.some((n) => n.toLowerCase().includes(String(p).toLowerCase())))) {
        findings.push({ ...base, level: 'warn', kind: 'precheck_passes_on_stub', why: 'todos os testes nomeados passam contra o stub, sem a implementação — o teste não prova o critério' });
      }
    }
    // G30b part 2: the existing suites the G30 found (they import a task's files) run once at HEAD. Already red there
    // is not the task's red: fix or exclude it before the paid attempt (it would read as the task's failure).
    for (const s of options.suites || []) {
      const remoteS = /remote-verify/.test(String(s.command));
      const r = run(wt, s.command, Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : remoteS ? 30 * 60_000 : 120_000);
      if (r.timedOut) findings.push({ criterion: null, id: s.file, task: s.task || null, command: s.command, level: 'warn', kind: remoteS ? 'suite_timeout_remote' : 'suite_hangs_at_head', why: remoteS ? 'o run remoto da suíte passou do teto (fila da CI?) — não é travamento' : 'a suíte que importa os arquivos da tarefa trava no HEAD, antes de qualquer mudança' });
      else if (r.code !== 0) findings.push({ criterion: null, id: s.file, task: s.task || null, command: s.command, level: 'warn', kind: 'suite_red_at_head', why: 'a suíte que importa os arquivos da tarefa já está vermelha no HEAD — não é vermelho da tarefa; conserte ou exclua antes da tentativa paga' });
    }
  } finally {
    ws.dispose(wt);
  }
  return { ran: entries.length, suites: (options.suites || []).length, runs, findings };
}

/** A temporary detached worktree at HEAD with node_modules linked; disposed link-first. */
function gitWorkspace(root) {
  return {
    create() {
      const wt = path.join(root, '.oxe', 'precheck-ws', `p-${Date.now().toString(36)}`);
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      const add = spawnSync('git', ['worktree', 'add', '-q', '--detach', wt, 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
      if (add.status !== 0) throw new Error(`precheck: worktree add falhou: ${String(add.stderr || '').trim()}`);
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      try { require('./oxe-local-config.cjs').copyLocalFiles(root, wt); } catch { /* */ }
      return wt;
    },
    dispose(wt) {
      const nm = path.join(wt, 'node_modules');
      try { if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm); } catch { /* no link */ }
      let linkLeft = false;
      try { linkLeft = fs.lstatSync(nm).isSymbolicLink(); } catch { linkLeft = false; }
      if (linkLeft) return; // never remove with the link in place: it would delete the real node_modules
      spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, windowsHide: true });
      spawnSync('git', ['worktree', 'prune'], { cwd: root, windowsHide: true });
    },
  };
}

function messages(result) {
  const errors = [];
  const warnings = [];
  for (const f of result.findings || []) {
    const line = f.criterion
      ? `teste de aceite ${f.id}${f.task ? ` (${f.task})` : ''}: ${f.kind} — ${f.why} [G36]`
      : `${f.task ? `${f.task}: ` : ''}suíte ${f.id}: ${f.kind} — ${f.why} [G30b]`;
    (f.level === 'error' ? errors : warnings).push(line);
  }
  return { errors, warnings };
}

module.exports = { precheck, messages, pendingAcceptance, gitWorkspace };
