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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const norm = (p) => String(p || '').replace(/\\/g, '/');
const DEFAULT_TIMEOUT_MS = 120_000;
const REMOTE_VERIFY_TIMEOUT_MS = 30 * 60_000;

function isRemoteVerify(command) {
  return /(?:^|[\s/\\"'])remote-verify(?:\.[cm]?js|\b)/i.test(String(command || ''));
}

function resolveTimeout(command, entryTimeoutMs, optionTimeoutMs) {
  const remote = isRemoteVerify(command);
  if (Number(optionTimeoutMs) > 0) {
    const ms = Number(optionTimeoutMs);
    return {
      remote,
      timeoutMs: ms,
      reason: remote
        ? `--precheck-timeout (${Math.round(ms / 1000)} s); comando remote-verify roda 1 vez`
        : `--precheck-timeout (${Math.round(ms / 1000)} s)`,
    };
  }
  if (Number(entryTimeoutMs) > 0) {
    const ms = Number(entryTimeoutMs);
    return {
      remote,
      timeoutMs: ms,
      reason: remote
        ? `timeout_ms do teste (${Math.round(ms / 1000)} s); comando remote-verify roda 1 vez`
        : `timeout_ms do teste (${Math.round(ms / 1000)} s)`,
    };
  }
  if (remote) {
    return {
      remote: true,
      timeoutMs: REMOTE_VERIFY_TIMEOUT_MS,
      reason: `remote-verify detectado — timeout próprio de ${Math.round(REMOTE_VERIFY_TIMEOUT_MS / 60_000)} min (${Math.round(REMOTE_VERIFY_TIMEOUT_MS / 1000)} s, 1 execução: inclui fila e execução remota da CI)`,
    };
  }
  return {
    remote: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    reason: `padrão (${Math.round(DEFAULT_TIMEOUT_MS / 1000)} s)`,
  };
}

function fileMatchesSha(absPath, expectedSha) {
  if (!expectedSha || !fs.existsSync(absPath)) return false;
  try {
    const fn = require('../../lib/runtime/index.js').frozenFileMatches;
    if (typeof fn === 'function') return Boolean(fn(absPath, expectedSha));
  } catch { /* fallback below */ }
  const raw = fs.readFileSync(absPath);
  const hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  if (hex(raw) === expectedSha) return true;
  const lf = raw.toString('utf8').replace(/\r\n/g, '\n');
  return hex(Buffer.from(lf, 'utf8')) === expectedSha || hex(Buffer.from(lf.replace(/\n/g, '\r\n'), 'utf8')) === expectedSha;
}

function sha256Lf(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  const lf = fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(lf, 'utf8').digest('hex');
}

function entryFiles(entry) {
  return ((entry && entry.files) || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean);
}

function readPrecheckCache(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePrecheckCache(cachePath, cache) {
  if (!cachePath) return;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function isEntryCachedOk(root, entry, cache) {
  if (!root || !cache) return false;
  const files = entryFiles(entry);
  if (!files.length) return false;
  return files.every((rel) => {
    const item = cache[rel];
    if (!item || item.ok !== true || typeof item.hash !== 'string' || !item.hash) return false;
    return fileMatchesSha(path.join(root, rel), item.hash);
  });
}

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

/** OXB-C27-2: a frozen e2e (Playwright/Cypress, an e2e path, or a remote-verify run). */
function isE2e(entry) {
  const files = (entry && entry.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).join(' ');
  const cmd = String(entry && entry.command || '');
  return isRemoteVerify(cmd) || /\b(playwright|cypress|wdio|detox)\b/i.test(cmd) || /(^|[\s/._-])e2e([\s/._-]|$)/i.test(`${cmd} ${files}`);
}

// Red for a setup reason: the app/browser never got to the contract. Definitive ones block; a selector the task may
// still create is reported (and blocks with lint.precheck_e2e_selector: "error").
const SETUP_HARD_RE = /(browserType\.launch|Failed to launch|ECONNREFUSED|net::ERR_CONNECTION_REFUSED|Cannot find module|ERR_MODULE_NOT_FOUND|webServer.*(exited|timed out)|Error: (before|after)(All|Each)? hook|"before (all|each)" hook|beforeAll hook|global ?setup)/i;
const SETUP_SELECTOR_RE = /(waiting for (locator|selector|getBy\w+)\(([^\n]{0,160})|locator\.\w+: Timeout [\d,.]+ ?ms exceeded[^\n]*|element\(s\) not found|Unable to find an? (accessible )?element[^\n]*|No element (found|matches)[^\n]*|strict mode violation[^\n]*)/i;
const ASSERTION_RE = /(AssertionError|toEqual|toStrictEqual|toBe\(|toHaveText|toHaveCount|toHaveValue|toContainText|deepStrictEqual|Expected[:\s][^\n]*\n\s*Received[:\s](?![^\n]*element\(s\) not found))/;

/** OXB-C27-2: why a red run is red — 'assertion', 'setup' (hard) or 'selector', with the line that says so. */
function redReason(output) {
  const out = String(output || '');
  const hard = SETUP_HARD_RE.exec(out);
  if (hard) return { kind: 'setup', line: lineOf(out, hard.index) };
  const sel = SETUP_SELECTOR_RE.exec(out);
  if (sel && !ASSERTION_RE.test(out.replace(/Expected[^\n]*\n\s*Received[^\n]*element\(s\) not found[^\n]*/g, ''))) {
    const s = /(getBy\w+\([^)]*\)|locator\([^)]*\)|\[data-testid=[^\]]+\])/.exec(sel[0]) || /(getBy\w+\([^)]*\)|locator\([^)]*\)|\[data-testid=[^\]]+\])/.exec(out);
    return { kind: 'selector', line: lineOf(out, sel.index), selector: s ? s[1] : null };
  }
  if (ASSERTION_RE.test(out)) return { kind: 'assertion', line: null };
  return { kind: 'unknown', line: null };
}
function lineOf(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 240);
}

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
 * Pending acceptance tests whose frozen test files are new or modified (vs HEAD, phase base_commit, or active run lock).
 * Used by default `plan lint` so newly authored/amended frozen tests run precheck automatically unless `--no-precheck`.
 */
function newFrozenAcceptance(root, doc, options = {}) {
  const entries = pendingAcceptance(doc);
  if (!entries.length || !root) return [];
  const hasHead = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).status === 0;
  if (!hasHead && !options.allowWithoutGit) return [];
  const locked = new Map();
  const lockTests = options.acceptanceLock && Array.isArray(options.acceptanceLock.tests) ? options.acceptanceLock.tests : [];
  for (const t of lockTests) {
    for (const f of (t && t.files) || []) {
      if (f && f.path && f.sha256 && !locked.has(norm(f.path))) locked.set(norm(f.path), f.sha256);
    }
  }
  const baseCommit = options.baseCommit && hasHead
    && spawnSync('git', ['cat-file', '-e', `${options.baseCommit}^{commit}`], { cwd: root, windowsHide: true }).status === 0
    ? String(options.baseCommit)
    : null;
  const blobMatches = (ref, rel, diskLf) => {
    const show = spawnSync('git', ['show', `${ref}:${norm(rel)}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (show.status !== 0) return false;
    return String(show.stdout || '').replace(/\r\n/g, '\n') === diskLf;
  };
  return entries.filter((a) => {
    const files = (a.files || []).map((f) => norm(typeof f === 'string' ? f : f && f.path)).filter(Boolean);
    if (!files.length) return false;
    return files.some((rel) => {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) return false;
      if (!hasHead) return true;
      const diskLf = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
      if (!blobMatches('HEAD', rel, diskLf)) return true;
      if (locked.size > 0) return !fileMatchesSha(abs, locked.get(rel));
      if (baseCommit && !blobMatches(baseCommit, rel, diskLf)) return true;
      return false;
    });
  });
}

/**
 * @param {string} root project root (a git checkout)
 * @param {object} doc PLAN.json
 * @param {object} pack IMPLEMENTATION-PACK.json
 * @param {{ entries?: Array, mode?: string, cachePath?: string | false, runs?: number, timeoutMs?: number, onProgress?: Function, run?: Function, workspace?: { create: Function, dispose: Function } }} options
 */
function precheck(root, doc, pack, options = {}) {
  const mode = options.mode || 'explicit';
  const isAuto = mode === 'auto';
  const allPending = pendingAcceptance(doc);
  const entries = Array.isArray(options.entries) ? options.entries : allPending;
  if (!entries.length && !(options.suites || []).length) {
    return { ran: 0, cached: 0, skipped_remote: 0, suites: 0, runs: 0, mode, findings: [], notes: [], details: [] };
  }
  const cachePath = options.cachePath === false
    ? null
    : (options.cachePath || (root ? path.join(root, '.oxe', 'precheck-cache.json') : null));
  const cache = cachePath ? readPrecheckCache(cachePath) : null;
  const findings = [];
  const notes = [];
  const details = [];
  const runnableEntries = [];
  let cachedCount = 0;
  let skippedRemoteCount = 0;

  for (const a of entries) {
    if (isAuto && cache && isEntryCachedOk(root, a, cache)) {
      cachedCount += 1;
      continue;
    }
    if (isAuto && isRemoteVerify(a.command)) {
      const id = a.id || a.criterion;
      const skipMsg = `precheck: ${id} é remote-verify — pulado no modo padrão; rode plan lint --precheck-tests para checar contra o stub na CI`;
      skippedRemoteCount += 1;
      findings.push({
        criterion: a.criterion || null,
        id,
        task: a.task || null,
        command: a.command,
        level: 'warn',
        kind: 'precheck_skipped_remote',
        why: 'pulado no modo padrão; rode plan lint --precheck-tests para checar contra o stub na CI',
        message: skipMsg,
      });
      if (typeof options.onProgress === 'function') options.onProgress(skipMsg);
      continue;
    }
    runnableEntries.push(a);
  }

  const runs = Math.max(2, Number(options.runs) || 2);
  if (!runnableEntries.length && !(options.suites || []).length) {
    return { ran: 0, cached: cachedCount, skipped_remote: skippedRemoteCount, suites: 0, runs: 0, mode, findings, notes, details };
  }

  const run = options.run || defaultRun;
  // OxeSpace 15/11 (OxeQuery polish): 20 remote runs (1 h) and then the process ended with no verdict table. The verdict
  // so far is written after EACH entry to .oxe/precheck-last.json — a process killed mid-way leaves what it found.
  // cross-review 15/11: the default (auto) precheck of a plain `plan lint` writes its own file — it never overwrites the
  // partial verdict of an explicit run of an hour; the caller puts it next to the session's PLAN.json
  const progressPath = options.progressPath === false ? null : (options.progressPath
    ? (isAuto ? options.progressPath.replace(/precheck-last\.json$/, 'precheck-auto-last.json') : options.progressPath)
    : (root ? path.join(root, '.oxe', isAuto ? 'precheck-auto-last.json' : 'precheck-last.json') : null));
  const startedAt = new Date().toISOString();
  const total = runnableEntries.length + (options.suites || []).length;
  let doneCount = 0;
  const writeProgress = (finished) => {
    if (!progressPath) return;
    try {
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      // atomic: a kill during the write never leaves a truncated JSON
      const tmp = `${progressPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify({ schema_version: 1, mode, started_at: startedAt, updated_at: new Date().toISOString(), finished, total, done: doneCount, runs, findings, details, notes }, null, 2)}\n`);
      fs.renameSync(tmp, progressPath);
    } catch { /* auxiliar */ }
  };
  const cleanFiles = new Set();
  const dirtyFiles = new Set();
  let cacheFlushed = false;
  const flushCache = () => { if (cacheFlushed) return; cacheFlushed = true; flushPrecheckCache(cachePath, cache, root, cleanFiles, dirtyFiles); };
  const ws = options.workspace || gitWorkspace(root);
  const wt = ws.create();
  writeProgress(false);
  try {
    // Copy all pending frozen tests from the working tree (they may not be committed yet), then write planned stubs so they import
    for (const a of allPending.length ? allPending : runnableEntries) for (const f of a.files || []) {
      const rel = norm(typeof f === 'string' ? f : f.path);
      const from = path.join(root, rel);
      if (fs.existsSync(from) && path.resolve(wt) !== path.resolve(root)) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.copyFileSync(from, path.join(wt, rel)); }
    }
    try {
      const sk = require('./oxe-plan-skeleton.cjs');
      sk.write(wt, sk.plan(wt, doc, pack, {}));
    } catch { /* no pack symbols: the tests run as they are */ }
    for (const a of runnableEntries) {
      const id = a.id || a.criterion;
      const findingsBefore = findings.length;
      // OxeSpace 15/11 (OxeChat sessions): a command that runs on the CI (remote-verify) waits in its queue — wall time
      // is not the test's. Remote: 30 min by default, one run (no CI quota doubled), and a timeout is a warning.
      const resolved = resolveTimeout(a.command, a.timeout_ms, options.timeoutMs);
      const { remote, timeoutMs } = resolved;
      const e2eMode = mode === 'e2e';
      const n = remote || e2eMode ? 1 : runs;
      const note = remote
        ? `teste de aceite ${id}${a.task ? ` (${a.task})` : ''}: ${resolved.reason}`
        : Number(options.timeoutMs) > 0
          ? `teste de aceite ${id}${a.task ? ` (${a.task})` : ''}: timeout ajustado por ${resolved.reason}`
          : null;
      if (note) {
        notes.push(note);
        if (typeof options.onProgress === 'function') options.onProgress(`precheck: ${note}`);
      }
      details.push({ criterion: a.criterion || null, id, task: a.task || null, command: a.command, remote, runs: n, timeout_ms: timeoutMs, timeout_reason: resolved.reason });
      const seen = [];
      let hang = null;
      let last = null;
      for (let i = 0; i < n; i += 1) {
        const r = run(wt, a.command, timeoutMs);
        if (r.timedOut) { hang = r; break; }
        last = r;
        seen.push(resultNames(r.output));
      }
      const base = { criterion: a.criterion, id, task: a.task || null, command: a.command };
      if (hang && remote) {
        const limitLabel = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} min` : `${Math.round(timeoutMs / 1000)} s`;
        findings.push({ ...base, level: 'warn', kind: 'precheck_timeout_remote', timeout_ms: timeoutMs, timeout_reason: resolved.reason, why: `o run remoto (${resolved.reason}) passou de ${limitLabel} (fila da CI?) — não é travamento do teste; rode de novo ou aumente --precheck-timeout` });
      } else if (hang) {
        findings.push({ ...base, level: 'error', kind: 'precheck_hang', timeout_ms: timeoutMs, timeout_reason: resolved.reason, why: `passou de ${Math.round(timeoutMs / 1000)} s (${resolved.reason}) contra o stub sem terminar — act + fake timers, um await que nunca resolve ou um servidor que não fecha` });
      } else {
        const sig = (x) => `${x.passed.join('|')}#${x.failed.join('|')}`;
        if (new Set(seen.map(sig)).size > 1) {
          const diff = seen[0].passed.filter((n) => !seen[1].passed.includes(n)).concat(seen[1].passed.filter((n) => !seen[0].passed.includes(n)));
          findings.push({ ...base, level: 'error', kind: 'precheck_flaky', why: `resultado diferente entre ${runs} execuções contra o mesmo stub (${diff.slice(0, 4).join(' | ') || 'contagem'}) — o teste depende de tempo, ordem ou estado de fora` });
        } else {
          const proves = Array.isArray(a.proves) ? a.proves : [];
          const passed = seen[0] ? seen[0].passed : [];
          if (proves.length && proves.every((p) => passed.some((n) => n.toLowerCase().includes(String(p).toLowerCase())))) {
            findings.push({ ...base, level: 'warn', kind: 'precheck_passes_on_stub', why: 'todos os testes nomeados passam contra o stub, sem a implementação — o teste não prova o critério' });
          } else if (last && last.code !== 0 && (e2eMode || isE2e(a))) {
            // OXB-C27-2 (polish2 pp-05-13, US$ 15.8): an e2e must be red on a contract assertion, not on setup
            const why = redReason(last.output);
            if (why.kind === 'setup') {
              findings.push({ ...base, level: e2eMode ? 'error' : 'warn', kind: 'precheck_red_on_setup', line: why.line, why: `vermelho na montagem, não no contrato: "${why.line}" — nenhuma implementação faz este teste passar; corrija o teste antes do execute` });
            } else if (why.kind === 'selector') {
              findings.push({ ...base, level: e2eMode && options.selectorLevel === 'error' ? 'error' : 'warn', kind: 'precheck_red_on_selector', line: why.line, selector: why.selector, why: `vermelho num seletor${why.selector ? ` (${why.selector})` : ''} antes de qualquer asserção: "${why.line}" — confirme que a tarefa cria esse elemento neste app (senão o teste é impossível)` });
            } else if (why.kind === 'unknown' && e2eMode) {
              findings.push({ ...base, level: 'warn', kind: 'precheck_red_unclassified', why: 'vermelho sem asserção reconhecível na saída — confira o motivo antes do execute' });
            }
          }
        }
      }
      const hasFinding = findings.length > findingsBefore;
      for (const rel of entryFiles(a)) {
        if (hasFinding) dirtyFiles.add(rel);
        else cleanFiles.add(rel);
      }
      doneCount += 1;
      writeProgress(false);
      if (typeof options.onProgress === 'function') {
        const fresh = findings.slice(findingsBefore);
        options.onProgress(`precheck ${doneCount}/${total}: ${id} — ${fresh.length ? fresh.map((f) => f.kind).join(', ') : 'ok (vermelho pelo motivo certo)'}${n === 1 && runs > 1 ? ' (1 execução: remote-verify)' : ''}`);
      }
    }
    // G30b part 2: the existing suites the G30 found (they import a task's files) run once at HEAD. Already red there
    // is not the task's red: fix or exclude it before the paid attempt (it would read as the task's failure).
    for (const s of options.suites || []) {
      const resolvedS = resolveTimeout(s.command, null, options.timeoutMs);
      const remoteS = resolvedS.remote;
      if (remoteS) {
        const suiteNote = `${s.task ? `${s.task}: ` : ''}suíte ${s.file}: ${resolvedS.reason}`;
        notes.push(suiteNote);
        if (typeof options.onProgress === 'function') options.onProgress(`precheck: ${suiteNote}`);
      }
      const r = run(wt, s.command, resolvedS.timeoutMs);
      if (r.timedOut) findings.push({ criterion: null, id: s.file, task: s.task || null, command: s.command, level: 'warn', kind: remoteS ? 'suite_timeout_remote' : 'suite_hangs_at_head', timeout_ms: resolvedS.timeoutMs, timeout_reason: resolvedS.reason, why: remoteS ? `o run remoto da suíte (${resolvedS.reason}) passou do teto (fila da CI?) — não é travamento` : 'a suíte que importa os arquivos da tarefa trava no HEAD, antes de qualquer mudança' });
      else if (r.code !== 0) findings.push({ criterion: null, id: s.file, task: s.task || null, command: s.command, level: 'warn', kind: 'suite_red_at_head', why: 'a suíte que importa os arquivos da tarefa já está vermelha no HEAD — não é vermelho da tarefa; conserte ou exclua antes da tentativa paga' });
      doneCount += 1;
      writeProgress(false);
      if (typeof options.onProgress === 'function') {
        const last = findings[findings.length - 1];
        options.onProgress(`precheck ${doneCount}/${total}: suíte ${s.file} — ${last && last.id === s.file ? last.kind : 'verde no HEAD'}`);
      }
    }
  } finally {
    ws.dispose(wt);
    // cross-review 15/11: the entries already approved are cached even when the process dies mid-way (paid work)
    flushCache();
  }
  writeProgress(true);
  return { ran: runnableEntries.length, cached: cachedCount, skipped_remote: skippedRemoteCount, suites: (options.suites || []).length, runs, mode, findings, notes, details };
}

function flushPrecheckCache(cachePath, cache, root, cleanFiles, dirtyFiles) {
  if (cachePath && cache && root) {
    let cacheChanged = false;
    const nowIso = new Date().toISOString();
    for (const rel of dirtyFiles) {
      if (Object.prototype.hasOwnProperty.call(cache, rel)) {
        delete cache[rel];
        cacheChanged = true;
      }
    }
    for (const rel of cleanFiles) {
      if (dirtyFiles.has(rel)) continue;
      const hash = sha256Lf(path.join(root, rel));
      if (hash) {
        cache[rel] = { hash, ok: true, at: nowIso };
        cacheChanged = true;
      }
    }
    if (cacheChanged) {
      try { writePrecheckCache(cachePath, cache); } catch { /* non-fatal cache write */ }
    }
  }
}

/** A temporary detached worktree at HEAD with node_modules linked; disposed link-first. */
function gitWorkspace(root) {
  return {
    create() {
      const wsParent = path.join(root, '.oxe', '.cache', 'precheck-ws');
      const wt = path.join(wsParent, `p-${Date.now().toString(36)}`);
      fs.mkdirSync(wsParent, { recursive: true });
      const add = spawnSync('git', ['worktree', 'add', '-q', '--detach', wt, 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
      if (add.status !== 0) throw new Error(`precheck: worktree add falhou: ${String(add.stderr || '').trim()}`);
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      try { require('./oxe-local-config.cjs').copyLocalFiles(root, wt); } catch { /* */ }
      return wt;
    },
    dispose(wt) {
      const nm = path.join(wt, 'node_modules');
      try {
        if (fs.lstatSync(nm).isSymbolicLink()) {
          if (process.platform === 'win32') {
            try { fs.rmdirSync(nm); } catch { fs.unlinkSync(nm); }
          } else {
            fs.unlinkSync(nm);
          }
        }
      } catch { /* no link */ }
      let linkLeft = false;
      try { linkLeft = fs.lstatSync(nm).isSymbolicLink(); } catch { linkLeft = false; }
      if (linkLeft) return; // never remove with the link in place: it would delete the real node_modules
      spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, windowsHide: true });
      if (fs.existsSync(wt)) {
        try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      const wsParent = path.dirname(wt);
      try { if (fs.existsSync(wsParent) && fs.readdirSync(wsParent).length === 0) fs.rmdirSync(wsParent); } catch { /* ignore */ }
      const cacheDir = path.dirname(wsParent);
      try { if (path.basename(cacheDir) === '.cache' && fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length === 0) fs.rmdirSync(cacheDir); } catch { /* ignore */ }
      spawnSync('git', ['worktree', 'prune'], { cwd: root, windowsHide: true });
    },
  };
}

function messages(result) {
  const errors = [];
  const warnings = [];
  for (const f of result.findings || []) {
    const line = f.message
      ? f.message
      : f.criterion
        ? `teste de aceite ${f.id}${f.task ? ` (${f.task})` : ''}: ${f.kind} — ${f.why} [G36]`
        : `${f.task ? `${f.task}: ` : ''}suíte ${f.id}: ${f.kind} — ${f.why} [G30b]`;
    (f.level === 'error' ? errors : warnings).push(line);
  }
  return { errors, warnings };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  REMOTE_VERIFY_TIMEOUT_MS,
  isRemoteVerify,
  isE2e,
  redReason,
  resolveTimeout,
  sha256Lf,
  readPrecheckCache,
  isEntryCachedOk,
  precheck,
  messages,
  pendingAcceptance,
  newFrozenAcceptance,
  gitWorkspace,
};
