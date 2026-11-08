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

/** OXB-152: same Windows mapping as the runtime (gradlew/mvnw → .bat/.cmd) and a UTF-8 console for readable errors. */
function windowsCommand(command) {
  const mapped = String(command).replace(/(^|&&\s*|\|\|\s*|&\s*|;\s*)(?:\.\/)?((?:[\w.@-]+\/)*)(gradlew|mvnw)(?=\s|$)/g, (_m, lead, dir, name) => `${lead}${dir.replace(/\//g, '\\')}${name}${name === 'gradlew' ? '.bat' : '.cmd'}`);
  return mapped;
}

function runCommand(command, cwd, timeoutMs) {
  const started = Date.now();
  const decode = require('./oxe-console-decode.cjs').decodeConsoleOutput;
  const isWin = process.platform === 'win32';
  const res = spawnSync(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', windowsCommand(command)] : ['-c', command], {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    windowsVerbatimArguments: isWin,
    env: scrubbedEnv(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    code: res.status,
    timedOut: Boolean(res.error && /ETIMEDOUT/.test(String(res.error.code || res.error.message))),
    output: `${decode(res.stdout)}\n${decode(res.stderr)}${/\b(gradlew(\.bat)?|gradle|mvnw?(\.cmd)?)\b/.test(command) ? `\n${junitReportsSince(cwd, started)}` : ''}`,
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
  // OXB-154 (compiled languages): a stub that runs (Kotlin TODO(), NotImplementedError, UnsupportedOperationException
  // "TODO", a "not implemented" marker) is the work not done yet — the right red.
  if (STUB_RE.test(text) && !CONFIG_ERROR_RE.test(text)) return 'missing_target';
  // A compile error on symbols the task's pack declares (Kotlin "Unresolved reference", Java "cannot find symbol",
  // tsc "has no exported member"/"Cannot find name") is the right red too — only when EVERY such symbol is the task's.
  const missingSymbols = compileMissingSymbols(text);
  const own = new Set(options.symbols || []);
  if (missingSymbols.length && own.size && missingSymbols.every((s) => own.has(s))) return 'missing_target';
  // JUnit results (the XML the build wrote): compile succeeded; failures that are assertions in a test file the task
  // proves are the right red.
  const junit = junitFailures(text);
  if (junit.length && junit.every((f) => f.assertion || f.stub)) {
    const proved = (options.provedFiles || []).map((p) => path.posix.basename(String(p).replace(/\\/g, '/')).replace(/\.[^.]+$/, ''));
    if (!proved.length || junit.every((f) => proved.some((b) => f.className.endsWith(b) || f.className.split('.').pop() === b))) return 'assertion_red';
  }
  const someOwnExist = options.someTargetsExist != null ? options.someTargetsExist : options.targetsExist;
  if (someOwnExist && ASSERTION_RE.test(text) && !TOOL_ERROR_RE.test(text)) return 'assertion_red';
  return 'broken_command';
}

/** OXB-154: stubs that run — the planned skeleton, not a broken command. */
const STUB_RE = /kotlin\.NotImplementedError|An operation is not implemented|NotImplementedError|UnsupportedOperationException[^\n]{0,80}\b(TODO|not implemented)|\bnot implemented yet\b/i;
/** Build configuration problems: never the right red. */
const CONFIG_ERROR_RE = /Task '[^']+' not found|Could not resolve (all )?(dependencies|plugin)|A problem occurred configuring|Plugin \[id: [^\]]+\] was not found|Unknown (option|argument)/i;

/** Symbols a compiler says are missing (Kotlin, Java, TypeScript). */
function compileMissingSymbols(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/Unresolved reference:?\s*'?([A-Za-z_$][\w$]*)'?/g)) out.add(m[1]);
  for (const m of String(text).matchAll(/cannot find symbol[\s\S]{0,240}?symbol:\s*(?:class|method|variable|interface)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of String(text).matchAll(/has no exported member(?: named)? '([A-Za-z_$][\w$]*)'|Cannot find name '([A-Za-z_$][\w$]*)'|Property '([A-Za-z_$][\w$]*)' does not exist/g)) out.add(m[1] || m[2] || m[3]);
  return [...out];
}

/** Failed testcases of JUnit XML in the output: { className, assertion, stub }. */
function junitFailures(text) {
  const out = [];
  for (const m of String(text).matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
    const fail = /<(failure|error)\b([^>]*)>?([\s\S]*?)(?:<\/(?:failure|error)>|$)/.exec(m[2]);
    if (!fail) continue;
    const className = (/classname="([^"]*)"/.exec(m[1]) || [])[1] || '';
    const body = `${fail[2]} ${fail[3]}`;
    out.push({
      className,
      assertion: /AssertionFailedError|AssertionError|ComparisonFailure|kotlin\.test|expected:\s*<|Expected\s*:/.test(body),
      stub: STUB_RE.test(body),
    });
  }
  return out;
}

/** OXB-154: JUnit XML files under test-results/ or surefire-reports/ written since `since` (dry-verify of gradle/maven). */
function junitReportsSince(root, since) {
  const parts = [];
  let budget = 8 * 1024 * 1024;
  const walk = (dir, depth, inReports) => {
    if (depth > 8 || budget <= 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.git', '.gradle', '.oxe'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1, inReports || e.name === 'test-results' || e.name === 'surefire-reports');
      else if (inReports && /\.xml$/i.test(e.name)) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs + 1000 < since || st.size > budget) continue;
          parts.push(fs.readFileSync(full, 'utf8'));
          budget -= st.size;
        } catch { /* */ }
      }
    }
  };
  walk(root, 0, false);
  return parts.join('\n');
}

const SEVERITY = { external_pending: 0, already_green: 0, missing_target: 1, assertion_red: 1, timeout: 3, broken_command: 4, not_a_command: 5, unsafe_command: 6 };
const unsafeLib = require('./oxe-unsafe-commands.cjs');
/** OXB-147: a segment the dry-verify must never run (it would change node_modules / git) or cannot run (prose). */
const refusal = (segment) => (unsafeLib.unsafeReason(segment) ? 'unsafe_command' : unsafeLib.looksLikeProse(segment) ? 'not_a_command' : null);

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
  const batches = [];
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
      const report = path.join(require('os').tmpdir(), `oxe-vitest-${process.pid}-${Date.now().toString(36)}-${batches.length}.json`);
      batches.push({ chunk, report, label: `[lote] ${g.prefix} · ${allFiles.length} arquivo(s) de ${[...new Set(chunk.map((m) => m.task))].join(', ')}`, command: `${vb.commandOf(g.prefix, g.flags, allFiles)} --reporter=json --outputFile.json=${report.replace(/\\/g, '/')}` });
    }
  }
  // OXB-095: batches run concurrently (parallel.max, min_free_mb) when allowed.
  const timeout = (options.timeoutMs || 180_000) * 3;
  if (options.parallel && options.parallel.max > 1 && batches.length > 1) {
    require('./oxe-parallel-run.cjs').runParallel(batches.map((b, i) => ({ id: i, command: b.command, label: b.label, timeoutMs: timeout })), { max: options.parallel.max, minFreeMb: options.parallel.minFreeMb, cwd: projectRoot, timeoutMs: timeout, env: scrubbedEnv(), onProgress: options.progress });
  } else {
    for (const b of batches) {
      if (options.progress) options.progress(`${b.label} ...`);
      const started = Date.now();
      runCommand(b.command, projectRoot, timeout);
      if (options.progress) options.progress(`[lote] ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
  for (const b of batches) {
    let json = null;
    try { json = JSON.parse(fs.readFileSync(b.report, 'utf8')); } catch { json = null; }
    try { fs.rmSync(b.report, { force: true }); } catch { /* */ }
    if (!json) { if (options.progress) options.progress(`${b.label}: sem relatório JSON — cada comando roda sozinho`); continue; }
    const byFile = vb.resultsByFile(json, projectRoot);
    for (const m of b.chunk) {
      const r = vb.segmentResult(byFile, m.files);
      if (r) out.set(`${m.task}\u0000${m.segment}`, r);
    }
  }
  return out;
}

/**
 * OXB-147: node_modules against package-lock.json (required packages only). A tree that breaks before or during the
 * run stops it with one clear reason instead of hundreds of misleading reds. null when fine or not applicable.
 */
function depsProblem(projectRoot) {
  const lockPath = path.join(projectRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath) || !fs.existsSync(path.join(projectRoot, 'node_modules'))) return null;
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return null; }
  const missing = require('./oxe-project-env.cjs').missingLockfilePackages(projectRoot, lock).filter((m) => !/\(optional\)$/.test(String(m)));
  if (!missing.length) return null;
  return `node_modules diverge do package-lock: ${missing.length} pacote(s) ausente(s) (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}) — rode npm install (nunca npm ci com o app/IDE abertos)`;
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
  // OXB-154: the frozen test files each task proves (acceptance_tests with its task id or its criteria).
  const provedFilesOf = (task) => (Array.isArray(plan && plan.acceptanceTests) ? plan.acceptanceTests : [])
    .filter((a) => a && ((a.task && a.task === task.id) || (!a.task && (task.aceite || []).includes(a.criterion))))
    .flatMap((a) => (a.files || []).map((f) => (typeof f === 'string' ? f : f.path)));
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
  // OXB-147: never start on a broken dependency tree.
  if (options.depsCheck) {
    const broken = depsProblem(projectRoot);
    if (broken) {
      if (progress) progress(`dry-verify não rodou: ${broken}`);
      return { ok: false, results: [], errors: [`dependências: ${broken}; dry-verify não rodou`], warnings, reused, skipped, tree, deps_broken: broken };
    }
  }
  const batched = options.batch === false ? new Map() : batchVitestSegments(projectRoot, selected, { timeoutMs, progress, cache: options.resume && cache, tree, maxFiles: options.batchMaxFiles, parallel: options.parallel });
  // OXB-095: what the batches did not answer runs concurrently (each distinct command once), bounded by parallel.max
  // and min_free_mb; results feed the per-task loop below, in plan order, as if run there.
  // OXB-147: wave of each task, and the deps check at each wave boundary (also between parallel groups).
  let depsBroken = null;
  const waveCheck = (wave) => {
    if (!options.depsCheck || depsBroken) return depsBroken;
    depsBroken = depsProblem(projectRoot);
    if (depsBroken) {
      errors.push(`dependências: ${depsBroken} — quebrou durante a rodada (antes da onda ${wave}); o resto do dry-verify não rodou`);
      if (progress) progress(`dry-verify parado: ${depsBroken}`);
    }
    return depsBroken;
  };
  if (options.parallel && options.parallel.max > 1) {
    const seen = new Set();
    const byWave = new Map();
    for (const task of selected) {
      const meta = task.meta || {};
      if (Array.isArray(meta.blocked_by) && meta.blocked_by.filter(Boolean).length) continue;
      for (const segment of splitSegments(task.verifyCommand)) {
        if (seen.has(segment) || batched.has(`${task.id}\u0000${segment}`) || refusal(segment)) continue;
        if (options.resume && tree && cache.entries[segmentKey(tree, task.id, segment)]) continue;
        seen.add(segment);
        const w = task.wave != null ? task.wave : 0;
        if (!byWave.has(w)) byWave.set(w, []);
        byWave.get(w).push({ command: segment, label: `${task.id} ${segment.slice(0, 70)}` });
      }
    }
    const waves = [...byWave.keys()].sort((a, b) => a - b);
    waves.forEach((w, wi) => {
      if (depsBroken || (wi > 0 && waveCheck(w))) return;
      const pending = byWave.get(w).map((p, i) => ({ id: i, ...p }));
      if (pending.length < 2) return;
      if (progress) progress(`dry-verify paralelo: ${pending.length} comando(s)${waves.length > 1 ? ` da onda ${w}` : ''}, até ${options.parallel.max} por vez`);
      const results = require('./oxe-parallel-run.cjs').runParallel(pending, { max: options.parallel.max, minFreeMb: options.parallel.minFreeMb, cwd: projectRoot, timeoutMs, env: scrubbedEnv(), onProgress: progress });
      for (const r of results) if (r && !r.timedOut) sameCommand.set(pending[r.id].command, { code: r.code, output: r.output, parallel: true });
    });
  }
  if (progress) progress(`dry-verify: ${totalSegments} comando(s) em ${selected.length} tarefa(s)${skipped.length ? ` · fora: ${skipped.length}` : ''}${tree ? (options.resume ? ' · --resume' : '') : ''}`);
  let lastWave = null;
  for (const task of selected) {
    if (depsBroken) break;
    // OXB-147: at each wave boundary, node_modules is checked again; a tree that broke mid-run stops the rest.
    if (lastWave !== null && task.wave != null && task.wave !== lastWave && waveCheck(task.wave)) break;
    lastWave = task.wave != null ? task.wave : lastWave;
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
      const refused = refusal(segment);
      if (refused) {
        run = { code: null, output: refused === 'unsafe_command' ? `não executado: ${unsafeLib.unsafeReason(segment)}` : 'não executado: é texto, não comando' };
        v = refused;
        if (progress) progress(`${label} ... ${refused} (não executado)`);
      } else if (cached) {
        reused += 1;
        run = { code: cached.code, output: cached.output || '' };
        v = cached.verdict;
        if (progress) progress(`${label} ... ${v} (já rodado nesta árvore)`);
      } else if (fromBatch) {
        run = fromBatch;
        v = run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist, someTargetsExist, missingTargets, projectRoot, symbols: task.packSymbols || [], provedFiles: provedFilesOf(task) });
        if (progress) progress(`${label} ... ${v === 'missing_target' || v === 'assertion_red' ? 'ok' : v} (${run.parallel ? 'paralelo' : 'lote'})`);
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
        v = run.timedOut ? 'timeout' : run.code === 0 ? 'already_green' : classifyFailure(run.output, targets, { targetsExist, someTargetsExist, missingTargets, projectRoot, symbols: task.packSymbols || [], provedFiles: provedFilesOf(task) });
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
    if (verdict === 'unsafe_command' || verdict === 'not_a_command') errors.push(...unsafeLib.verifyCommandProblems(task.id, task.verifyCommand, splitSegments));
    else if (verdict === 'broken_command') errors.push(`${task.id}: comando de verificação falha por outro motivo que não o alvo ausente — corrija o plano antes de executar${singleQuoted ? ' (provável causa: aspas simples no Windows — troque por aspas duplas)' : ''}: ${excerpt}`);
    else if (verdict === 'timeout') errors.push(`${task.id}: comando de verificação passou de ${Math.round(timeoutMs / 1000)}s sem terminar`);
    else if (verdict === 'already_green') warnings.push(`${task.id}: verificação já passa antes da tarefa — não prova o trabalho dela`);
  }
  if (skipped.length) warnings.push(`dry-verify parcial: ${skipped.length} tarefa(s) fora desta rodada (${skipped.join(', ')})`);
  return { ok: errors.length === 0, results, errors, warnings, reused, skipped, tree, ...(depsBroken ? { deps_broken: depsBroken } : {}) };
}

module.exports = { compileMissingSymbols, junitFailures, dryRunVerifyCommands, classifyFailure, hasSingleQuotedArgument, treeHash, depsProblem, windowsCommand };
