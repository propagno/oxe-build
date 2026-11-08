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
const crypto = require('crypto');
const fs = require('fs');
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

function git(projectRoot, args, input) {
  const res = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true, input, maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? String(res.stdout || '') : null;
}

/**
 * OXB-084: identity of the working tree the commands run against: HEAD + the content diff + the untracked files'
 * blob hashes (.oxe/ excluded, it changes with the cache itself). Null outside git (no resume there).
 */
function treeHash(projectRoot) {
  const head = git(projectRoot, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (head === null && git(projectRoot, ['rev-parse', '--is-inside-work-tree']) === null) return null;
  const h = crypto.createHash('sha256');
  h.update(String(head || 'no-head').trim());
  h.update(git(projectRoot, ['diff', 'HEAD', '--binary', '--', '.', ':(exclude).oxe']) || '');
  const untracked = (git(projectRoot, ['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude).oxe']) || '').split('\n').map((l) => l.trim()).filter(Boolean).sort();
  if (untracked.length) {
    h.update(untracked.join('\n'));
    h.update(git(projectRoot, ['hash-object', '--stdin-paths'], untracked.join('\n')) || '');
  }
  return h.digest('hex').slice(0, 24);
}

function readCache(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' && doc.entries ? doc : { schema_version: 1, entries: {}, tasks: {} };
  } catch {
    return { schema_version: 1, entries: {}, tasks: {} };
  }
}

function writeCache(file, doc) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* the cache is an optimization: never fails the lint */ }
}

const segmentKey = (tree, taskId, segment) => crypto.createHash('sha256').update(`${tree}\0${taskId}\0${segment}`).digest('hex').slice(0, 24);
const taskDefinitionHash = (task) => crypto.createHash('sha256').update(JSON.stringify([task.verifyCommand || '', [...(task.files || [])].sort()])).digest('hex').slice(0, 16);
/** Results worth reusing on the same tree: the right red and the already green. A timeout or a broken command reruns. */
const REUSABLE = new Set(['missing_target', 'assertion_red', 'already_green']);

/**
 * OXB-094: runs the vitest segments of the selected tasks in batches (same runner + flags, up to maxFiles files) with
 * the JSON reporter, and returns `taskId\0segment` → { code, output } for each segment the report answers.
 */
function batchVitestSegments(projectRoot, tasks, options = {}) {
  const vb = require('./oxe-vitest-batch.cjs');
  const out = new Map();
  const groups = new Map();
  for (const task of tasks) {
    const meta = task.meta || {};
    if (Array.isArray(meta.blocked_by) && meta.blocked_by.filter(Boolean).length) continue;
    for (const segment of splitSegments(task.verifyCommand)) {
      if (options.cache && options.tree && options.cache.entries[segmentKey(options.tree, task.id, segment)]) continue;
      const v = vb.parseVitest(segment);
      if (!v || v.flags.some((f) => /^--outputFile/.test(f))) continue;
      if (!groups.has(v.key)) groups.set(v.key, { prefix: v.prefix, flags: v.flags, members: [] });
      groups.get(v.key).members.push({ task: task.id, segment, files: v.files });
    }
  }
  const maxFiles = options.maxFiles || 60;
  for (const g of groups.values()) {
    if (g.members.length < 2) continue;
    // chunks of up to maxFiles distinct files
    const chunks = [];
    let cur = [];
    let files = new Set();
    for (const m of g.members) {
      const add = m.files.filter((f) => !files.has(f));
      if (cur.length && files.size + add.length > maxFiles) { chunks.push(cur); cur = []; files = new Set(); }
      cur.push(m);
      for (const f of m.files) files.add(f);
    }
    if (cur.length) chunks.push(cur);
    for (const chunk of chunks) {
      if (chunk.length < 2) continue;
      const allFiles = [...new Set(chunk.flatMap((m) => m.files))];
      const report = path.join(require('os').tmpdir(), `oxe-vitest-${process.pid}-${Date.now().toString(36)}.json`);
      const cmd = `${vb.commandOf(g.prefix, g.flags, allFiles)} --reporter=json --outputFile.json=${report.replace(/\\/g, '/')}`;
      if (options.progress) options.progress(`[lote] ${g.prefix} · ${allFiles.length} arquivo(s) de ${[...new Set(chunk.map((m) => m.task))].join(', ')} ...`);
      const started = Date.now();
      runCommand(cmd, projectRoot, (options.timeoutMs || 180_000) * 3);
      let json = null;
      try { json = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { json = null; }
      try { fs.rmSync(report, { force: true }); } catch { /* */ }
      if (options.progress) options.progress(`[lote] ${json ? 'ok' : 'sem relatório JSON — cada comando roda sozinho'} ${Math.round((Date.now() - started) / 1000)}s`);
      if (!json) continue;
      const byFile = vb.resultsByFile(json, projectRoot);
      for (const m of chunk) {
        const r = vb.segmentResult(byFile, m.files);
        if (r) out.set(`${m.task}\u0000${m.segment}`, r);
      }
    }
  }
  return out;
}

function dryRunVerifyCommands(projectRoot, plan, options = {}) {
  const timeoutMs = options.timeoutMs || 180_000;
  // OXB-084: progress per command, resume on the same tree, and a subset (--only / --changed).
  const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const cachePath = options.cachePath || null;
  const cache = cachePath ? readCache(cachePath) : null;
  const tree = cachePath ? treeHash(projectRoot) : null;
  const only = Array.isArray(options.only) && options.only.length ? new Set(options.only.map((id) => String(id).trim().toUpperCase())) : null;
  let reused = 0;
  const skipped = [];
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
  const selected = allTasks.filter((task) => {
    if (task.done || !task.verifyCommand) return false;
    if (only && !only.has(String(task.id).toUpperCase())) { skipped.push(task.id); return false; }
    // --changed: the task's verify or files differ from the last dry run (or it never ran).
    if (options.changed && cache && cache.tasks && cache.tasks[task.id] === taskDefinitionHash(task)) { skipped.push(task.id); return false; }
    return true;
  });
  const totalSegments = selected.reduce((n, task) => n + ((task.meta && Array.isArray(task.meta.blocked_by) && task.meta.blocked_by.filter(Boolean).length) ? 0 : splitSegments(task.verifyCommand).length), 0);
  let index = 0;
  // OXB-094: vitest segments that share runner and flags run as ONE process (JSON reporter → result per file); a
  // segment the batch cannot answer (no JSON, file not in the report) runs alone as before.
  const sameCommand = new Map();
  const batched = options.batch === false ? new Map() : batchVitestSegments(projectRoot, selected, { timeoutMs, progress, cache: options.resume && cache, tree, maxFiles: options.batchMaxFiles });
  if (progress) progress(`dry-verify: ${totalSegments} comando(s) em ${selected.length} tarefa(s)${skipped.length ? ` · fora: ${skipped.length}` : ''}${tree ? (options.resume ? ' · --resume' : '') : ''}`);
  for (const task of selected) {
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
      index += 1;
      const label = `[${index}/${totalSegments}] ${task.id} ${segment.length > 70 ? `${segment.slice(0, 67)}...` : segment}`;
      const key = tree ? segmentKey(tree, task.id, segment) : null;
      const cached = options.resume && key && cache.entries[key] && REUSABLE.has(cache.entries[key].verdict) ? cache.entries[key] : null;
      let run;
      let v;
      const fromBatch = !cached ? (batched.get(`${task.id}\u0000${segment}`) || sameCommand.get(segment) || null) : null;
      if (cached) {
        reused += 1;
        run = { code: cached.code, output: cached.output || '' };
        v = cached.verdict;
        if (progress) progress(`${label} ... ${v} (já rodado nesta árvore)`);
      } else if (fromBatch) {
        run = fromBatch;
        v = run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist, someTargetsExist, missingTargets, projectRoot });
        if (progress) progress(`${label} ... ${v === 'missing_target' || v === 'assertion_red' ? 'ok' : v} (lote)`);
        if (key) {
          cache.entries[key] = { task: task.id, verdict: v, code: run.code, output: String(run.output || '').slice(-4000), at: new Date().toISOString(), secs: 0, batched: true };
          writeCache(cachePath, cache);
        }
      } else {
        if (progress) progress(`${label} ...`);
        const started = Date.now();
        run = runCommand(segment, projectRoot, timeoutMs);
        // OXB-096 (F2: 14× `npm run typecheck`, 13× `npm run lint`): the same command on the same tree has the same
        // output — the next tasks reuse it (each still classified against its own targets).
        if (!run.timedOut) sameCommand.set(segment, { code: run.code, output: run.output });
        v = run.timedOut ? 'timeout' : run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist, someTargetsExist, missingTargets, projectRoot });
        const secs = Math.round((Date.now() - started) / 1000);
        if (progress) progress(`${label} ... ${v === 'missing_target' || v === 'assertion_red' ? 'ok' : v} ${secs}s`);
        if (key) {
          // Written after each command, so an interrupted run (memory reaper, Ctrl+C) resumes where it stopped.
          cache.entries[key] = { task: task.id, verdict: v, code: run.code, output: String(run.output || '').slice(-4000), at: new Date().toISOString(), secs };
          writeCache(cachePath, cache);
        }
      }
      // The worst segment decides; among equals, a red one beats green (a red segment proves the task is not done).
      if (verdict === null || SEVERITY[v] > SEVERITY[verdict]) {
        verdict = v;
        code = run.code;
        const tail = run.output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-6).join(' | ');
        excerpt = `${segments.length > 1 ? `[${segment.slice(0, 80)}] ` : ''}${tail}`.slice(0, 600);
      }
    }
    results.push({ task: task.id, verdict, code, excerpt, segments: segments.length });
    if (cache && cachePath) {
      cache.tasks = cache.tasks || {};
      cache.tasks[task.id] = taskDefinitionHash(task);
      writeCache(cachePath, cache);
    }
    // OXB-040: cmd.exe does not group arguments with single quotes (`--jq '.[0].conclusion'` reaches gh split).
    const singleQuoted = platform === 'win32' && hasSingleQuotedArgument(task.verifyCommand);
    if (singleQuoted) warnings.push(`${task.id}: o verify usa aspas simples — no Windows (cmd.exe) elas não agrupam o argumento; use aspas duplas`);
    if (verdict === 'broken_command') errors.push(`${task.id}: comando de verificação falha por outro motivo que não o alvo ausente — corrija o plano antes de executar${singleQuoted ? ' (provável causa: aspas simples no Windows — troque por aspas duplas)' : ''}: ${excerpt}`);
    else if (verdict === 'timeout') errors.push(`${task.id}: comando de verificação passou de ${Math.round(timeoutMs / 1000)}s sem terminar`);
    else if (verdict === 'already_green') warnings.push(`${task.id}: verificação já passa antes da tarefa — não prova o trabalho dela`);
  }
  if (skipped.length) warnings.push(`dry-verify parcial: ${skipped.length} tarefa(s) fora desta rodada (${skipped.join(', ')})`);
  return { ok: errors.length === 0, results, errors, warnings, reused, skipped, tree };
}

module.exports = { dryRunVerifyCommands, classifyFailure, hasSingleQuotedArgument, treeHash };
