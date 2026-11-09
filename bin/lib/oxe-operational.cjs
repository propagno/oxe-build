'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const VALID_RUN_STATUSES = new Set([
  'planned',
  'running',
  'paused',
  'waiting_approval',
  'blocked',
  'failed',
  'completed',
  'replaying',
  'aborted',
]);

const VALID_APPROVAL_POLICIES = new Set([
  'always_allow',
  'require_approval',
  'require_approval_if_external_side_effect',
  'deny_unless_overridden',
]);

const VALID_CAPABILITY_TYPES = new Set(['script', 'mcp', 'automation', 'local']);

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDirForFile(filePath) {
  ensureDir(path.dirname(filePath));
}

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseArrayField(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw === '[]') return [];
  if (/^\[.*\]$/.test(raw)) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter(Boolean);
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

const SHELL_COMMAND_RE =
  /^(npm|npx|pnpm|yarn|node|deno|bun|python3?|pytest|go|cargo|make|dotnet|mvn|gradle|bash|sh|curl|git|eslint|tsc|jest|vitest|mocha|oxe-cc|oxe|docker)(\s|$)/i;

/** Backtick spans of a markdown cell, trimmed and non-empty. */
function extractBacktickSpans(text) {
  return Array.from(String(text || '').matchAll(/`([^`]+)`/g)).map((match) => match[1].trim()).filter(Boolean);
}

function looksLikeShellCommand(span) {
  return SHELL_COMMAND_RE.test(String(span || '').trim());
}

const FILE_EXTENSIONS_RE =
  /\.(json|[cm]?[jt]sx?|md|ya?ml|toml|txt|html?|css|scss|py|go|rs|java|cs|sh|ps1|env|lock|xml|csv|sql|graphql|proto|vue|svelte)$/i;

/** `package.json`, `test/api.test.js` — but not dotted identifiers such as `scripts.test`. */
function looksLikeFilePath(span) {
  const value = String(span || '').trim();
  if (!value || /\s/.test(value)) return false;
  return value.includes('/') ? /^[\w@./-]+$/.test(value) : FILE_EXTENSIONS_RE.test(value);
}

function loadRuntimeModule() {
  try {
    return require('../../lib/runtime/index.js');
  } catch {
    return null;
  }
}

// Gap 1: factory that always wires GateManager into ctx
function createExecutionContext(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  const runId = options.runId || makeRunId();
  const gateManager = (runtime && typeof runtime.GateManager === 'function')
    ? new runtime.GateManager(projectRoot, activeSession || null, runId)
    : null;
  // Auto-wire PolicyEngine from .oxe/config.json runtime.policy when not explicitly injected
  let policyEngine = options.policyEngine || null;
  if (!policyEngine && runtime && typeof runtime.PolicyEngine === 'function') {
    try {
      const cfgPath = path.join(projectRoot, '.oxe', 'config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (cfg.runtime && cfg.runtime.policy && typeof cfg.runtime.policy === 'object') {
          policyEngine = runtime.PolicyEngine.fromConfig(cfg.runtime.policy);
        }
      }
    } catch {}
  }
  return {
    projectRoot,
    sessionId: activeSession || null,
    runId,
    executor: options.executor || null,
    workspaceManager: options.workspaceManager || null,
    gateManager,
    policyEngine,
    policyActor: options.policyActor || 'runtime',
    quota: options.quota || null,
    pluginRegistry: options.pluginRegistry || null,
    auditTrail: options.auditTrail || null,
    evidenceStore: options.evidenceStore || null,
    onEvent: options.onEvent || null,
    options: options.schedulerOptions || {},
  };
}

/**
 * Persists LLM provider config to .oxe/config.json under runtime.provider.
 * @param {string} projectRoot
 * @param {{ baseUrl?: string, model?: string, apiKeyEnv?: string, maxTurns?: number }} providerConfig
 */
function saveRuntimeProviderConfig(projectRoot, providerConfig) {
  const configPath = path.join(projectRoot, '.oxe', 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  if (!cfg.runtime || typeof cfg.runtime !== 'object') cfg.runtime = {};
  cfg.runtime.provider = {
    baseUrl: providerConfig.baseUrl || 'https://api.anthropic.com/v1',
    model: providerConfig.model || 'claude-sonnet-4-6',
  };
  if (providerConfig.apiKeyEnv) cfg.runtime.provider.apiKeyEnv = providerConfig.apiKeyEnv;
  if (providerConfig.adapter) cfg.runtime.provider.adapter = providerConfig.adapter;
  if (providerConfig.maxTurns != null) cfg.runtime.provider.maxTurns = providerConfig.maxTurns;
  const oxeDir = path.join(projectRoot, '.oxe');
  if (!fs.existsSync(oxeDir)) fs.mkdirSync(oxeDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return cfg.runtime.provider;
}

/**
 * Reads persisted LLM provider config from .oxe/config.json runtime.provider.
 * @param {string} projectRoot
 * @returns {{ baseUrl?: string, model?: string, apiKeyEnv?: string, maxTurns?: number } | null}
 */
function loadRuntimeProviderConfig(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8'));
    return (cfg.runtime && cfg.runtime.provider && typeof cfg.runtime.provider === 'object')
      ? cfg.runtime.provider
      : null;
  } catch {
    return null;
  }
}

/** Eventos `ExecutorUsage` da run, no formato da tabela do RUN-SUMMARY. */
function readExecutorUsageRows(projectRoot, activeSession, runId) {
  return readEvents(projectRoot, activeSession)
    .filter((event) => event && event.type === 'ExecutorUsage' && (!runId || event.run_id === runId))
    .map((event) => {
      const payload = event.payload || {};
      return {
        work_item_id: event.work_item_id || payload.work_item_id || '—',
        attempt: payload.attempt == null ? null : Number(payload.attempt),
        turns: payload.turns == null ? null : Number(payload.turns),
        tool_calls: payload.tool_calls == null ? null : Number(payload.tool_calls),
        cost_usd: typeof payload.cost_usd === 'number' ? payload.cost_usd : null,
        adapter: payload.adapter || null,
      };
    });
}

/** Adapters de executor conhecidos e se estão disponíveis nesta máquina (`runtime providers`). */
function detectRuntimeAdapters(options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.detectExecutorAdapters !== 'function') return [];
  return runtime.detectExecutorAdapters(options);
}

function buildRuntimePluginRegistry(projectRoot) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.PluginRegistry !== 'function') return null;
  const registry = new runtime.PluginRegistry();
  const pluginDir = path.join(projectRoot, '.oxe', 'plugins');
  if (fs.existsSync(pluginDir) && typeof registry.loadFromDirectory === 'function') {
    registry.loadFromDirectory(pluginDir);
  }
  if (typeof registry.registerProjectCapabilities === 'function') {
    registry.registerProjectCapabilities(projectRoot);
  }
  return registry;
}

function loadSdkParsers() {
  try {
    const sdk = require('../../lib/sdk/index.cjs');
    if (sdk && typeof sdk.parsePlan === 'function' && typeof sdk.parseSpec === 'function') {
      return { parsePlan: sdk.parsePlan, parseSpec: sdk.parseSpec };
    }
    return null;
  } catch {
    return null;
  }
}

function loadProjectHealth() {
  try {
    return require('./oxe-project-health.cjs');
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath) {
  const raw = readTextIfExists(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function preferExistingPath(primaryPath, fallbackPath) {
  if (primaryPath && fs.existsSync(primaryPath)) return primaryPath;
  return fallbackPath || primaryPath || null;
}

function resolveRuntimeArtifactPaths(projectRoot, activeSession) {
  // OXB-032: spec_ref / roadmap_ref in config.json point SPEC and ROADMAP to versioned files (a session's own copy wins).
  const refsLib = require('./oxe-artifact-refs.cjs');
  const refs = refsLib.artifactRefs(projectRoot);
  const withRefs = (p, sessionRoot) => ({
    ...p,
    spec: sessionRoot && p.spec && path.resolve(p.spec).startsWith(path.resolve(sessionRoot)) ? p.spec : refsLib.refOr(refs.spec, p.spec),
    roadmap: sessionRoot && p.roadmap && path.resolve(p.roadmap).startsWith(path.resolve(sessionRoot)) ? p.roadmap : refsLib.refOr(refs.roadmap, p.roadmap),
  });
  return withRefs(resolveRuntimeArtifactPathsRaw(projectRoot, activeSession), activeSession ? path.join(projectRoot, '.oxe', ...String(activeSession).split('/')) : null);
}

function resolveRuntimeArtifactPathsRaw(projectRoot, activeSession) {
  const health = loadProjectHealth();
  if (!health || typeof health.oxePaths !== 'function' || typeof health.scopedOxePaths !== 'function') {
    const oxeDir = path.join(projectRoot, '.oxe');
    if (!activeSession) {
      return {
        state: path.join(oxeDir, 'STATE.md'),
        spec: path.join(oxeDir, 'SPEC.md'),
        plan: path.join(oxeDir, 'PLAN.md'),
        verify: path.join(oxeDir, 'VERIFY.md'),
        implementationPack: path.join(oxeDir, 'IMPLEMENTATION-PACK.json'),
        roadmap: path.join(oxeDir, 'ROADMAP.md'),
        programDir: path.join(oxeDir, 'program'),
      };
    }
    const sessionRoot = path.join(oxeDir, ...String(activeSession).split('/'));
    return {
      state: path.join(oxeDir, 'STATE.md'),
      spec: preferExistingPath(path.join(sessionRoot, 'spec', 'SPEC.md'), path.join(oxeDir, 'SPEC.md')),
      plan: preferExistingPath(path.join(sessionRoot, 'plan', 'PLAN.md'), path.join(oxeDir, 'PLAN.md')),
      verify: preferExistingPath(path.join(sessionRoot, 'verification', 'VERIFY.md'), path.join(oxeDir, 'VERIFY.md')),
      implementationPack: preferExistingPath(path.join(sessionRoot, 'plan', 'IMPLEMENTATION-PACK.json'), path.join(oxeDir, 'IMPLEMENTATION-PACK.json')),
      roadmap: preferExistingPath(path.join(sessionRoot, 'spec', 'ROADMAP.md'), path.join(oxeDir, 'ROADMAP.md')),
      programDir: path.join(sessionRoot, 'program'),
    };
  }
  const base = health.oxePaths(projectRoot);
  const scoped = health.scopedOxePaths(projectRoot, activeSession || null);
  return {
    state: base.state,
    spec: preferExistingPath(scoped.spec, base.spec),
    plan: preferExistingPath(scoped.plan, base.plan),
    verify: preferExistingPath(scoped.verify, base.verify),
    implementationPack: preferExistingPath(scoped.implementationPackJson, base.implementationPackJson),
    roadmap: preferExistingPath(
      scoped.sessionRoot ? path.join(scoped.sessionRoot, 'spec', 'ROADMAP.md') : null,
      path.join(base.oxe, 'ROADMAP.md'),
    ),
    programDir: path.join(scoped.scopedRoot || base.oxe, 'program'),
  };
}

/**
 * Anexa a cada tarefa mutável do plano os `exact_paths` do IMPLEMENTATION-PACK como `filesExist`,
 * para que o verify cobre o contrato em vez de só registrá-lo.
 */
function attachImplementationPackContracts(parsedPlan, packPath) {
  if (!parsedPlan || !Array.isArray(parsedPlan.tasks) || !packPath) return parsedPlan;
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  } catch {
    return parsedPlan;
  }
  const packTasks = pack && Array.isArray(pack.tasks) ? pack.tasks : [];
  const byId = new Map(packTasks.map((task) => [String(task && (task.id || task.task_id) || '').trim(), task]));
  for (const task of parsedPlan.tasks) {
    const entry = byId.get(task.id);
    if (!entry || String(entry.mode || '').trim().toLowerCase() !== 'mutating') continue;
    // OXB-088: what the task removes must NOT exist after it (never a files_exist).
    const removal = require('./oxe-pack-removed.cjs').removalOf(entry);
    const removed = new Set(removal.removedPaths);
    const files = (Array.isArray(entry.exact_paths) ? entry.exact_paths : [])
      .map((value) => String(value || '').trim())
      .filter((value) => looksLikeFilePath(value) && !value.includes('*') && !value.includes('...') && !removed.has(value));
    if (files.length > 0) task.filesExist = [...new Set(files)];
    const exportsExpected = packSymbolExports(entry).filter((e) => !removed.has(e.file));
    // OXB-154: every symbol the pack declares (any kind) — the dry-verify reads a compile error on them as the right red.
    task.packSymbols = (Array.isArray(entry.symbols) ? entry.symbols : []).map((sym) => String((sym && (sym.name || sym)) || '').trim()).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    if (exportsExpected.length > 0) task.exportsExpected = exportsExpected;
    if ((removal.removedPaths.length || removal.symbolsRemoved.length) && !task.done) {
      const cmd = require('./oxe-pack-removed.cjs').checkCommand(packPath, task.id);
      if (!String(task.verifyCommand || '').includes(cmd)) task.verifyCommand = [task.verifyCommand, cmd].filter(Boolean).join(' && ');
      task.meta = { ...(task.meta || {}), removal_check: true };
    }
  }
  return parsedPlan;
}

/** Kinds of pack symbols that are module-level exports (methods, routes, fields are not). */
const EXPORTED_SYMBOL_KINDS = new Set(['', 'function', 'class', 'const', 'constant', 'variable', 'type', 'interface', 'enum', 'export', 'module']);

/** IMPLEMENTATION-PACK `symbols[] {kind, name, path}` → expected exports checked by the contract (1.19). */
function packSymbolExports(entry) {
  const symbols = Array.isArray(entry && entry.symbols) ? entry.symbols : [];
  const out = [];
  for (const symbol of symbols) {
    if (!symbol || typeof symbol !== 'object') continue;
    const kind = String(symbol.kind || '').trim().toLowerCase();
    if (!EXPORTED_SYMBOL_KINDS.has(kind) || symbol.exported === false) continue;
    const name = String(symbol.name || '').trim();
    const file = String(symbol.path || symbol.file || '').trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || !looksLikeFilePath(file) || file.includes('*')) continue;
    out.push({ file, name });
  }
  return out;
}

function readJsonQuiet(filePath) {
  try {
    return filePath ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Seção da tarefa no PLAN.md: do heading `### T3 …` até o próximo heading de mesmo nível ou acima. */
function extractPlanTaskBody(planText, taskId) {
  const lines = String(planText || '').split(/\r?\n/);
  const escaped = String(taskId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^(#{2,4})\\s+${escaped}(?![\\w-])`);
  const start = lines.findIndex((line) => startRe.test(line));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = lines[i].match(/^(#+)\s/);
    if (heading && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function readLessonLines(projectRoot, limit = 8) {
  for (const rel of [path.join('.oxe', 'global', 'LESSONS.md'), path.join('.oxe', 'LESSONS.md')]) {
    const text = readTextIfExists(path.join(projectRoot, rel));
    if (!text) continue;
    return text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/))
      .filter(Boolean)
      .map((match) => match[1].trim())
      .filter(Boolean)
      .slice(0, limit);
  }
  return [];
}

function snapshotWorkspaceFile(root, rel, headChars = 1500, headLines = 40) {
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { path: rel, exists: false };
  }
  if (!stat.isFile()) return null;
  let head = '';
  try {
    const fd = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, headChars * 4));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    head = buffer.toString('utf8').split(/\r?\n/).slice(0, headLines).join('\n').slice(0, headChars);
  } catch {}
  return { path: rel, exists: true, bytes: stat.size, head };
}

/**
 * NodeExecutionContext por nó: corpo da tarefa no PLAN, entradas do IMPLEMENTATION-PACK e do
 * FIXTURE-PACK, snapshot dos arquivos do escopo, git status e lições. Sem isso cada tentativa
 * redescobria o workspace (benchmark 1.17).
 */
function buildNodeContextProvider(projectRoot, activeSession) {
  const externalSignalsFor = (() => { try { return externalSignalsReader(projectRoot, activeSession); } catch { return () => []; } })();
  const rationality = require('./oxe-rationality.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const planText = readTextIfExists(paths.plan) || '';
  const pack = readJsonQuiet(paths.implementationPack);
  const fixturePath = paths.implementationPack
    ? path.join(path.dirname(paths.implementationPack), 'FIXTURE-PACK.json')
    : null;
  const fixturePack = readJsonQuiet(fixturePath);
  const lessons = readLessonLines(projectRoot);
  const packTasks = pack && Array.isArray(pack.tasks) ? pack.tasks : [];
  const fixtures = fixturePack && Array.isArray(fixturePack.fixtures) ? fixturePack.fixtures : [];
  const program = require('./oxe-program.cjs');
  const programState = paths.programDir ? program.readProgram(paths.programDir) : null;
  const closedInterfaces = programState ? program.loadClosedInterfaces(paths.programDir, programState) : [];
  // 1.21: what the closed phases told the next ones (dossier handoff), so it is read, not rediscovered.
  let handoffs = [];
  try {
    const dossierRoot = path.join(path.dirname(paths.plan || path.join(projectRoot, '.oxe', 'PLAN.md')), 'dossier');
    handoffs = programState ? program.loadClosedHandoffs(dossierRoot, programState) : [];
  } catch {
    handoffs = [];
  }
  // 1.21 (OXB-020): what the repo enforces on its own goes into every node prompt, collected once per run.
  let repoRules = [];
  try {
    repoRules = require('./oxe-repo-rules.cjs').collectRepoRules(projectRoot, { config: readProjectConfig(projectRoot) });
  } catch {
    repoRules = [];
  }
  const runtimeForExports = loadRuntimeModule();
  let planAcceptance = [];
  try {
    const sdkParsers = loadSdkParsers();
    const planArtifact = sdkParsers ? parsePlanArtifact(sdkParsers, planText, paths.plan) : null;
    planAcceptance = (planArtifact && planArtifact.acceptanceTests) || [];
  } catch {
    planAcceptance = [];
  }
  return (node, lease) => {
    const root = (lease && lease.root_path) || projectRoot;
    const contract = packTasks.find((task) => String(task && (task.id || task.task_id) || '').trim() === node.id) || null;
    const fixture = fixtures.find((entry) => rationality.fixtureTaskIds(entry).includes(node.id)) || null;
    const contractPaths = contract && Array.isArray(contract.exact_paths) ? contract.exact_paths : [];
    const files = [...new Set([...(node.mutation_scope || []), ...contractPaths].map((value) => String(value || '').trim()))]
      .filter((value) => looksLikeFilePath(value) && !value.includes('*'))
      .slice(0, 12)
      .map((rel) => snapshotWorkspaceFile(root, rel))
      .filter(Boolean);
    // Superfície pública do que já existe: fases fechadas + dependências concluídas da run.
    // Arquivos crus só para o próprio escopo; o resto entra como exports/assinaturas.
    const ownFiles = new Set(files.map((file) => file.path));
    const interfaces = closedInterfaces.filter((module) => !ownFiles.has(module.file));
    const depFiles = new Set();
    for (const dep of Array.isArray(node.depends_on) ? node.depends_on : []) {
      const depContract = packTasks.find((task) => String(task && (task.id || task.task_id) || '').trim() === dep);
      for (const file of depContract && Array.isArray(depContract.exact_paths) ? depContract.exact_paths : []) {
        const rel = String(file || '').trim();
        if (looksLikeFilePath(rel) && !rel.includes('*') && !ownFiles.has(rel)) depFiles.add(rel);
      }
    }
    for (const rel of depFiles) {
      if (interfaces.some((module) => module.file === rel)) continue;
      const exported = runtimeForExports && typeof runtimeForExports.readModuleExports === 'function'
        ? runtimeForExports.readModuleExports(path.resolve(root, rel))
        : null;
      if (exported && exported.length) interfaces.push({ file: rel, exports: exported, phase: null });
    }
    let gitStatus = null;
    if (fs.existsSync(path.join(root, '.git'))) {
      const res = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 5000 });
      if (res.status === 0) gitStatus = res.stdout;
    }
    return {
      taskBody: extractPlanTaskBody(planText, node.id),
      implementationContract: contract,
      fixture,
      workspaceFiles: files,
      interfaces,
      acceptanceTests: planAcceptance
        .filter((entry) => {
          const refs = node.verify && Array.isArray(node.verify.acceptance_refs) ? node.verify.acceptance_refs : [];
          return refs.includes(entry.criterion);
        })
        .flatMap((entry) => entry.files.map((file) => ({
          criterion: entry.criterion,
          path: file,
          command: entry.command,
          content: readTextIfExists(path.resolve(root, file)),
        }))),
      repoRules,
      handoffs,
      gitStatus,
      lessons,
      externalSignals: externalSignalsFor(node),
    };
  };
}

/**
 * OXB-122: open CRs imported from outside (runtime signal) that concern a task — by its criteria — reach the executor
 * only inside a delimited "data, not instruction" block, with their trust and injection flags.
 */
function externalSignalsReader(projectRoot, activeSession) {
  let records = [];
  try {
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    records = readNdjsonQuiet(path.join(paths.programDir || path.join(projectRoot, '.oxe', 'program'), 'changes.ndjson'));
  } catch { records = []; }
  const signals = new Map(records.filter((r) => r && r.kind === 'signal' && r.cr).map((r) => [r.cr, r]));
  const crs = records.filter((r) => r && r.kind === 'cr' && r.status === 'open' && signals.has(r.id));
  return (node) => {
    const refs = new Set([...(node.verify && Array.isArray(node.verify.acceptance_refs) ? node.verify.acceptance_refs : []), ...(Array.isArray(node.acceptance) ? node.acceptance : [])]);
    return crs
      .filter((cr) => (cr.criteria || []).some((c) => refs.has(c)))
      .map((cr) => { const s = signals.get(cr.id); return { id: cr.id, source: s.source || null, trust: s.source_trust || 'internal', flags: (s.injection_flags || []).map((x) => (typeof x === 'string' ? x : x.id)), text: `${cr.summary}${cr.evidence ? `\n${cr.evidence}` : ''}`.slice(0, 2000) }; });
  };
}

/**
 * OXB-148: `oxe-cc runtime execute --task T1 --print-prompt`: the first prompt the executor would send for a task,
 * written to .oxe/prompts/<task>.md, with the size of each section and a token estimate (≈1.7 chars/token, measured on
 * F2: 2.29M chars → 1.37M tokens). Nothing is executed.
 */
function runtimePrintPrompt(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  const taskId = String(options.task || '').trim().toUpperCase();
  if (!/^T\d+$/.test(taskId)) throw new Error('informe a tarefa: oxe-cc runtime execute --task T1 --print-prompt');
  let current = readRunState(projectRoot, activeSession);
  if (!current || !current.compiled_graph) current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current || {} }).run;
  const graph = runtime.fromSerializable(current.compiled_graph);
  const node = graph.nodes.get ? graph.nodes.get(taskId) : graph.nodes[taskId];
  if (!node) throw new Error(`${taskId} não está no grafo compilado`);
  const lease = { workspace_id: 'print-prompt', root_path: projectRoot };
  const ctx = buildNodeContextProvider(projectRoot, activeSession)(node, lease) || {};
  const base = runtime.buildNodePrompt(node, lease, current.run_id || 'print', 1, { context: null });
  const full = runtime.buildNodePrompt(node, lease, current.run_id || 'print', 1, { context: ctx });
  const sections = [{ name: 'tarefa (sem contexto)', chars: base.length }];
  for (const [key, value] of Object.entries(ctx)) {
    if (value == null || (Array.isArray(value) && !value.length)) continue;
    const rendered = runtime.renderNodeContext({ [key]: value }).join('\n');
    sections.push({ name: key, chars: rendered.length, raw_chars: JSON.stringify(value).length });
  }
  const tokens = (n) => Math.round(n / 1.7);
  const dir = path.join(path.dirname(resolveRuntimeArtifactPaths(projectRoot, activeSession).plan || path.join(projectRoot, '.oxe', 'PLAN.md')), 'prompts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${taskId}.md`);
  const table = sections.map((s) => `| ${s.name} | ${s.chars} | ~${tokens(s.chars)} |${s.raw_chars != null ? ` ${s.raw_chars} |` : ' — |'}`).join('\n');
  fs.writeFileSync(file, [`# Prompt de ${taskId} (1ª chamada)`, '', `Total: ${full.length} chars (~${tokens(full.length)} tokens). O loop de ferramentas soma a isto os resultados (cada um limitado a 40k chars; antigos são omitidos a partir de 600k; acima de 1.2M a chamada nem sai).`, '', '| Seção | chars no prompt | tokens (est.) | dado bruto (chars) |', '|---|---|---|---|', table, '', '---', '', full, ''].join('\n'), 'utf8');
  return { task: taskId, file, total_chars: full.length, est_tokens: tokens(full.length), sections };
}

const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* */ } };

/**
 * OXB-161: the promote state of each dependency of `task` (PLAN.json depends_on): its latest TaskPromoted branch/PR,
 * and whether that is merged into the base — by `gh pr view` when there is a PR, else by git (the branch is an
 * ancestor of the base, or `git cherry` finds every commit already there). A dependency whose promote is still
 * running (TaskPromoteQueued after its last result, from --promote-each) is waited for.
 */
function promoteDependencies(projectRoot, activeSession, task, ctx) {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  if (!deps.length) return [];
  const { remote, options } = ctx;
  const waitUntil = Date.now() + (Number(options.depPromoteWaitMs) >= 0 && options.depPromoteWaitMs != null ? Number(options.depPromoteWaitMs) : 30 * 60_000);
  const scan = () => {
    const events = readEvents(projectRoot, activeSession);
    const state = new Map();
    events.forEach((e, i) => {
      if (!e || !deps.includes(e.work_item_id)) return;
      const st = state.get(e.work_item_id) || {};
      if (e.type === 'TaskPromoteQueued') st.queued = i;
      if (e.type === 'TaskPromoted' || e.type === 'TaskPromoteFailed') st.done = i;
      if (e.type === 'TaskPromoted' && e.payload && e.payload.branch) st.promoted = { index: i, branch: e.payload.branch, pr: e.payload.pr || null };
      state.set(e.work_item_id, st);
    });
    return state;
  };
  let state = scan();
  const running = () => deps.filter((d) => { const st = state.get(d); return st && st.queued != null && (st.done == null || st.done < st.queued); });
  while (running().length && Date.now() < waitUntil) { sleepMs(Math.min(5000, Math.max(0, waitUntil - Date.now()))); state = scan(); }
  const out = [];
  for (const dep of deps) {
    const st = state.get(dep) || {};
    if (!st.promoted) { out.push({ task: dep, promoted: false, running: running().includes(dep) }); continue; }
    const { branch, pr } = st.promoted;
    gitRun(projectRoot, ['fetch', '-q', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
    const ref = gitLines(projectRoot, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`]) ? `refs/remotes/${remote}/${branch}`
      : gitLines(projectRoot, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) ? `refs/heads/${branch}` : null;
    const sha = ref ? (gitLines(projectRoot, ['rev-parse', ref]) || [])[0] : null;
    let merged = null;
    let prState = null;
    if (pr) {
      const gh = (options.ghSpawn || spawnSync)('gh', ['pr', 'view', String(pr), '--json', 'state'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
      if (gh && gh.status === 0) { try { prState = String(JSON.parse(gh.stdout).state || '').toUpperCase(); } catch { prState = null; } }
      if (prState === 'MERGED') merged = true;
    }
    if (merged == null && sha) {
      if (gitRun(projectRoot, ['merge-base', '--is-ancestor', sha, ctx.baseSha]).ok) merged = true;
      else {
        const cherry = (gitRun(projectRoot, ['cherry', ctx.baseSha, sha]).stdout || '').split(/\r?\n/).filter(Boolean);
        merged = cherry.every((l) => l.startsWith('-'));
      }
    }
    if (merged == null) merged = prState === 'MERGED';
    out.push({ task: dep, promoted: true, branch, pr, ref, sha, merged, pr_state: prState, index: st.promoted.index });
  }
  return out;
}

/** OXB-161: which promote branch to stack on (or wait for, with --hold-deps). */
function promoteStack(projectRoot, activeSession, task, ctx) {
  const { options, remote } = ctx;
  let baseSha = ctx.baseSha;
  const warnings = [];
  let deps = promoteDependencies(projectRoot, activeSession, task, { ...ctx, baseSha });
  let unmerged = deps.filter((d) => d.promoted && d.merged === false && d.sha);
  if (unmerged.length && options.holdDeps) {
    const until = Date.now() + (Number(options.holdTimeoutMs) > 0 ? Number(options.holdTimeoutMs) : 6 * 3600_000);
    const baseName = ctx.base.replace(new RegExp(`^${remote}/`), '');
    appendEvent(projectRoot, activeSession, { type: 'TaskPromoteHeld', work_item_id: task.id, payload: { waiting_for: unmerged.map((d) => ({ task: d.task, pr: d.pr, branch: d.branch })) } });
    while (unmerged.length && Date.now() < until) {
      sleepMs(Math.min(Number(options.holdPollMs) > 0 ? Number(options.holdPollMs) : 60_000, Math.max(0, until - Date.now())));
      gitRun(projectRoot, ['fetch', '-q', remote, baseName]);
      baseSha = (gitLines(projectRoot, ['rev-parse', '--verify', `${ctx.base}^{commit}`]) || [])[0] || baseSha;
      deps = promoteDependencies(projectRoot, activeSession, task, { ...ctx, baseSha, options: { ...options, depPromoteWaitMs: 0 } });
      unmerged = deps.filter((d) => d.promoted && d.merged === false && d.sha);
    }
    if (unmerged.length) throw new Error(`${task.id} aguarda o merge de ${unmerged.map((d) => `${d.task}${d.pr ? ` (${d.pr})` : ` (${d.branch})`}`).join(', ')} em ${ctx.base} — --hold-deps esgotou a espera; rode de novo depois do merge, ou sem --hold-deps para empilhar`);
    return { baseSha, stack: null, warnings };
  }
  for (const d of deps) {
    if (!d.promoted) warnings.push(`${task.id} depende de ${d.task}, que ${d.running ? 'ainda está sendo promovida' : 'não foi promovida'}: a branch sai de ${ctx.base}; se ${d.task} não estiver lá, o pr:ready pode falhar`);
    else if (d.merged === false && d.pr_state === 'CLOSED') warnings.push(`o PR de ${d.task} (${d.pr}) foi fechado sem merge — empilhando sobre a branch dele mesmo assim`);
  }
  if (!unmerged.length) return { baseSha, stack: null, warnings };
  // the one branch that already contains the others (a stacked chain), else the latest promoted
  const contains = (a, b) => a.sha === b.sha || gitRun(projectRoot, ['merge-base', '--is-ancestor', b.sha, a.sha]).ok;
  let stack = unmerged.find((c) => unmerged.every((o) => contains(c, o)));
  if (!stack) {
    stack = [...unmerged].sort((a, b) => b.index - a.index)[0];
    const left = unmerged.filter((o) => !contains(stack, o));
    warnings.push(`${task.id} depende de várias tarefas não mergeadas em branches separadas; empilhada sobre ${stack.task} — ${left.map((o) => o.task).join(', ')} fica(m) de fora até o merge (o pr:ready pode falhar)`);
  }
  return { baseSha, stack, warnings };
}

/**
 * OXB-169: tasks whose commits (in range, not in this promote) come BEFORE this promote's first commit and touch the
 * same files — the diff being promoted was made on top of them.
 * @returns {Array<{ task: string, sha: string, files: string[] }>}
 */
function promoteAssumedTasks(projectRoot, range, ordered, idSet, phaseCtx) {
  if (!ordered.length) return [];
  const all = gitLines(projectRoot, ['rev-list', '--reverse', '--topo-order', range]) || [];
  const firstIdx = all.indexOf(ordered[0]);
  if (firstIdx <= 0) return [];
  const filesOf = (sha) => gitLines(projectRoot, ['show', '--name-only', '--format=', sha]) || [];
  const ours = new Set(ordered.flatMap(filesOf));
  const out = [];
  for (const sha of all.slice(0, firstIdx)) {
    const body = (gitRun(projectRoot, ['log', '-1', '--format=%B', sha]).stdout) || '';
    const m = /^OXE-Task: (?:(F\d+)\/)?(T\d+)\s*$/m.exec(body);
    if (!m || idSet.has(m[2])) continue;
    if (phaseCtx && phaseCtx.phase && m[1] && m[1] !== phaseCtx.phase) continue;
    const shared = filesOf(sha).filter((f) => ours.has(f));
    if (shared.length) out.push({ task: m[2], sha, files: shared });
  }
  return out;
}

/**
 * OXB-108: gates the oxe-build adds to a phase verify on its own: the anti-stub check (substantive + wired) over the
 * phase's diff (its base_commit → the tree). Off with config `stub_check: false`.
 */
function implicitPhaseGates(projectRoot, programState, phaseId, projectConfig) {
  if (!projectConfig || projectConfig.stub_check === false || !programState || !phaseId) return [];
  const phase = (programState.phases || []).find((p) => p.id === phaseId);
  const base = phase && phase.base_commit;
  if (!base) return [];
  const script = path.join(__dirname, 'oxe-stub-check.cjs').replace(/\\/g, '/');
  return [{ id: 'stub-check', when: 'phase_verify', command: `node "${script}" --phase --since ${base}`, description: 'anti-stub da fase: stubs e arquivos novos sem ligação (OXB-108)', on_fail: 'cr_defect' }];
}

/**
 * OXB-110: `oxe-cc runtime defects [--waive <id> --reason "…" --by <papel>]` — regenerates .oxe/OPEN-DEFECTS.json for
 * the active phase (its diff from base_commit, its tasks, the open signal / standing CRs) and lists what is open.
 */
function runtimeDefects(projectRoot, activeSession, options = {}) {
  const lib = require('./oxe-open-defects.cjs');
  if (options.waive) {
    const doc = lib.waive(projectRoot, String(options.waive), { reason: options.reason, by: options.by });
    appendEvent(projectRoot, activeSession, { type: 'DefectWaived', payload: { id: options.waive, by: options.by } });
    return { register: doc, open: lib.open(doc) };
  }
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  let program = null;
  try { program = require('./oxe-program.cjs').readProgram(programDir); } catch { program = null; }
  const phaseId = options.phase || (program && program.active_phase) || null;
  const phase = program && phaseId ? (program.phases || []).find((p) => p.id === phaseId) : null;
  let doc = null;
  try { doc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { doc = null; }
  let changes = [];
  try { changes = require('./oxe-change.cjs').listChanges(programDir); } catch { changes = []; }
  const register = lib.collect(projectRoot, {
    phase: phaseId,
    base: options.base || (phase && phase.base_commit) || null,
    doc,
    changes: changes.filter((c) => !phaseId || !c.phase || c.phase === phaseId),
    standing: require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot),
  });
  return { register, open: lib.open(register) };
}

/** OXB-160: the tests' own tree for a frozen test file: up to its tests/test/__tests__/spec/e2e dir, else its own dir. */
function promoteTestRoot(file) {
  const parts = String(file).replace(/\\/g, '/').split('/');
  const i = parts.slice(0, -1).findIndex((p) => /^(tests?|__tests__|specs?|e2e)$/i.test(p));
  return i >= 0 ? parts.slice(0, i + 1).join('/') : parts.slice(0, -1).join('/');
}

/** OXB-160: a relative import resolved like node/TS at `rev` — the file, then with extensions, then dir/index.* — to a blob only. */
function resolveImportAt(projectRoot, rev, base0) {
  const exts = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  const isBlob = (p) => { const r = gitRun(projectRoot, ['cat-file', '-t', `${rev}:${p}`]); return r.ok && r.stdout.trim() === 'blob'; };
  const stripped = base0.replace(/\.(js|jsx|mjs|cjs)$/, ''); // TS: "./helper.js" may be helper.ts
  for (const cand of [base0, ...exts.map((e) => base0 + e), ...(stripped !== base0 ? exts.map((e) => stripped + e) : []), ...exts.map((e) => `${base0}/index${e}`)]) {
    if (isBlob(cand)) return cand;
  }
  return null;
}

/**
 * OXB-160: an existing local branch is the promote's own leftover when it is not on the remote, has no upstream, is
 * not checked out anywhere, and either carries the promote mark (`branch.<b>.oxePromote`) or every commit past the
 * base is a promote commit (cherry-pick -x, or the frozen-tests commit).
 */
function ownUnpushedPromoteBranch(projectRoot, branch, remote, baseSha, opts = {}) {
  const sha = (gitLines(projectRoot, ['rev-parse', `refs/heads/${branch}`]) || [])[0] || null;
  if (!opts.allowRemote) {
    const ls = gitRun(projectRoot, ['ls-remote', '--heads', remote, branch]);
    if (ls.ok && ls.stdout.trim()) return { ok: false, why: `está em ${remote}` };
    if (gitRun(projectRoot, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]).ok) return { ok: false, why: 'tem upstream' };
  }
  const wts = (gitRun(projectRoot, ['worktree', 'list', '--porcelain']).stdout || '').split(/\r?\n/);
  if (wts.includes(`branch refs/heads/${branch}`)) return { ok: false, why: 'está em uso numa worktree' };
  const marked = (gitRun(projectRoot, ['config', '--get', `branch.${branch}.oxePromote`]).stdout || '').trim() === 'true';
  if (marked) return { ok: true, sha };
  const bodies = (gitRun(projectRoot, ['log', '--format=%s%n%b%x00', `${baseSha}..${branch}`]).stdout || '').split('\0').map((x) => x.trim()).filter(Boolean);
  const promoteLike = bodies.every((b) => /\(cherry picked from commit [0-9a-f]{7,40}\)/.test(b) || /^test\(acceptance\): frozen tests of /.test(b));
  return promoteLike ? { ok: true, sha } : { ok: false, why: 'tem commits que não são do promote' };
}

/**
 * OXB-162: a branch on the remote is the promote's own, safe to rebuild with a force-push, when: it was made by a
 * promote (the local mark `branch.<b>.oxePromote`, or a TaskPromoted/TaskPromoteQueued/TaskPromoteFailed of this
 * project naming it), every commit past the base is a promote commit, and it has NO pull request (any state) —
 * checked with `gh pr list --head`; without an answer from gh it is refused.
 */
function ownPushedPromoteBranch(projectRoot, activeSession, branch, remote, remoteSha, baseSha, options = {}) {
  const marked = (gitRun(projectRoot, ['config', '--get', `branch.${branch}.oxePromote`]).stdout || '').trim() === 'true';
  let promoted = false;
  try { promoted = readEvents(projectRoot, activeSession).some((e) => e && /^TaskPromote/.test(String(e.type)) && e.payload && e.payload.branch === branch); } catch { promoted = false; }
  if (!marked && !promoted) return { ok: false, why: 'não foi criada por um promote deste projeto' };
  gitRun(projectRoot, ['fetch', '-q', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  const have = gitRun(projectRoot, ['cat-file', '-e', `${remoteSha}^{commit}`]).ok;
  if (!have) return { ok: false, why: 'não consegui ler a branch remota' };
  const bodies = (gitRun(projectRoot, ['log', '--format=%s%n%b%x00', `${baseSha}..${remoteSha}`]).stdout || '').split('\0').map((x) => x.trim()).filter(Boolean);
  if (!bodies.every((b) => /\(cherry picked from commit [0-9a-f]{7,40}\)/.test(b) || /^test\(acceptance\): frozen tests of /.test(b))) return { ok: false, why: 'tem commits que não são do promote' };
  const gh = (options.ghSpawn || spawnSync)('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,url'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (!gh || gh.status !== 0) return { ok: false, why: 'não consegui confirmar pelo gh que ela não tem PR' };
  let prs = [];
  try { prs = JSON.parse(String(gh.stdout || '[]')); } catch { return { ok: false, why: 'resposta do gh ilegível' }; }
  if (Array.isArray(prs) && prs.length) return { ok: false, why: `tem PR (${prs.map((p) => `#${p.number} ${p.state}`).join(', ')})` };
  return { ok: true };
}

/**
 * OXB-157: the base a task PR is built on. A plain name (`main`) is the REMOTE branch (`origin/main`, fetched first),
 * not a possibly stale local branch; a remote ref (`origin/x`) or a sha is used as given. No base: the remote's default
 * branch. Warns when the local branch of that name is behind its remote.
 * @returns {{ ref: string, requested: string|null, warnings: string[] }}
 */
function resolvePromoteBase(projectRoot, requested, remote = 'origin', options = {}) {
  const warnings = [];
  const remotes = gitLines(projectRoot, ['remote']) || [];
  const hasRemote = remotes.includes(remote);
  let name = requested ? String(requested).trim() : '';
  if (!name) {
    const head = hasRemote ? (gitLines(projectRoot, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]) || [])[0] : null;
    name = head ? head.replace(new RegExp(`^${remote}/`), '') : 'main';
  }
  if (/^[0-9a-f]{7,40}$/i.test(name) || remotes.some((r) => name.startsWith(`${r}/`)) || !hasRemote) return { ref: name, requested: requested || null, warnings };
  if (options.fetch !== false) gitRun(projectRoot, ['fetch', '-q', remote, name]);
  const remoteRef = `${remote}/${name}`;
  if (!gitLines(projectRoot, ['rev-parse', '--verify', '-q', `${remoteRef}^{commit}`])) {
    warnings.push(`${remoteRef} não existe — usando a branch local ${name}`);
    return { ref: name, requested: requested || null, warnings };
  }
  const localSha = (gitLines(projectRoot, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]) || [])[0];
  if (localSha) {
    const behind = Number(((gitLines(projectRoot, ['rev-list', '--count', `${localSha}..${remoteRef}`]) || [])[0]) || 0);
    if (behind > 0) warnings.push(`a branch local ${name} está ${behind} commit(s) atrás de ${remoteRef} — a base usada é ${remoteRef}`);
  }
  return { ref: remoteRef, requested: requested || null, warnings };
}

/**
 * OXB-151: `runtime promote <task> --open-pr` in a detached child (its own worktree: the program tree is untouched),
 * output in .oxe/promote/<task>.log; the PR link lands in the TaskPromoted event.
 */
function spawnPromote(projectRoot, activeSession, taskId, opts = {}, runId = null) {
  const logDir = path.join(projectRoot, '.oxe', 'promote');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `${taskId}.log`), 'a');
  const args = [path.join(__dirname, '..', 'oxe-cc.js'), 'runtime', 'promote', taskId, ...(opts.base ? ['--base', opts.base] : []), '--remote', opts.remote || 'origin', '--open-pr', '--dir', projectRoot];
  if (activeSession) args.push('--session', activeSession);
  if (opts.holdDeps) args.push('--hold-deps');
  const child = spawn(process.execPath, args, { cwd: projectRoot, detached: true, stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, OXE_NO_PROMPT: '1' } });
  child.unref();
  appendEvent(projectRoot, activeSession, { type: 'TaskPromoteQueued', run_id: runId, work_item_id: taskId, payload: { base: opts.base || 'main', log: path.relative(projectRoot, path.join(logDir, `${taskId}.log`)).replace(/\\/g, '/') } });
  return child.pid;
}

/**
 * LlmTaskExecutor sobre um adapter (`claude` = `claude -p` por turno, `http` = OpenAI-compatível).
 * O uso por tentativa vira evento `ExecutorUsage`.
 */
function createAdapterExecutor(runtime, projectRoot, activeSession, options, getRunId) {
  const adapterId = options.adapter || 'http';
  if (typeof runtime.createExecutorAdapter !== 'function') throw new Error('Runtime não exporta createExecutorAdapter.');
  const adapter = runtime.createExecutorAdapter(adapterId, { claude: options.adapterOptions || {} });
  const provider = options.providerConfig || {};
  const progress = (event) => {
    if (event && event.type === 'executor_usage') {
      appendEvent(projectRoot, activeSession, {
        type: 'ExecutorUsage',
        run_id: getRunId(),
        work_item_id: event.nodeId,
        payload: { adapter: adapterId, attempt: event.attempt, ...(event.detail || {}) },
      });
      if (typeof options.onUsage === 'function') options.onUsage(event);
    }
    if (typeof options.onProgress === 'function') options.onProgress(event);
  };
  return new runtime.LlmTaskExecutor(
    {
      baseUrl: provider.baseUrl || '',
      apiKey: provider.apiKey || '',
      model: provider.model || '',
      maxTurns: provider.maxTurns,
      maxTokens: provider.maxTokens,
      timeoutMs: provider.timeoutMs,
    },
    null,
    progress,
    adapter.createCompletion(),
    {
      contextProvider: options.contextProvider === false ? null : buildNodeContextProvider(projectRoot, activeSession),
      protectedPaths: readProtectedAcceptancePaths(projectRoot, activeSession),
    }
  );
}

function normalizeRuntimeEventType(type) {
  const raw = String(type || '').trim();
  if (!raw) return 'RunStarted';
  const directMap = {
    SessionCreated: 'SessionCreated',
    RunStarted: 'RunStarted',
    GraphCompiled: 'GraphCompiled',
    WorkItemReady: 'WorkItemReady',
    WorkspaceAllocated: 'WorkspaceAllocated',
    AttemptStarted: 'AttemptStarted',
    ToolInvoked: 'ToolInvoked',
    ToolCompleted: 'ToolCompleted',
    ToolFailed: 'ToolFailed',
    ExecutorUsage: 'ExecutorUsage',
    EvidenceCollected: 'EvidenceCollected',
    PolicyEvaluated: 'PolicyEvaluated',
    PolicyWarning: 'PolicyWarning',
    GateRequested: 'GateRequested',
    GateResolved: 'GateResolved',
    VerificationStarted: 'VerificationStarted',
    VerificationCompleted: 'VerificationCompleted',
    VerificationSuiteRecompiled: 'VerificationSuiteRecompiled',
    RetryScheduled: 'RetryScheduled',
    WorkItemCompleted: 'WorkItemCompleted',
    WorkItemBlocked: 'WorkItemBlocked',
    RunCompleted: 'RunCompleted',
    RetroPublished: 'RetroPublished',
    LessonPromoted: 'LessonPromoted',
    RunAborted: 'RunAborted',
    RollbackExecuted: 'RollbackExecuted',
    RollbackFailed: 'RollbackFailed',
    TaskErrorBoundaryTripped: 'TaskErrorBoundaryTripped',
    WorkspaceDisposeFailed: 'WorkspaceDisposeFailed',
    ProgramCreated: 'ProgramCreated',
    PhaseStarted: 'PhaseStarted',
    PhaseClosed: 'PhaseClosed',
    PhaseGateFailed: 'PhaseGateFailed',
    ChangeRequested: 'ChangeRequested',
    ChangeResolved: 'ChangeResolved',
    VerifyCommandSuspect: 'VerifyCommandSuspect',
    BudgetExhausted: 'BudgetExhausted',
    ScopeViolation: 'ScopeViolation',
    ScratchIgnored: 'ScratchIgnored',
  };
  if (directMap[raw]) return directMap[raw];
  const lower = raw.toLowerCase();
  const legacyMap = {
    session_created: 'SessionCreated',
    run_started: 'RunStarted',
    graph_compiled: 'GraphCompiled',
    work_item_ready: 'WorkItemReady',
    task_ready: 'WorkItemReady',
    workspace_allocated: 'WorkspaceAllocated',
    attempt_started: 'AttemptStarted',
    tool_invoked: 'ToolInvoked',
    tool_completed: 'ToolCompleted',
    tool_failed: 'ToolFailed',
    evidence_collected: 'EvidenceCollected',
    policy_evaluated: 'PolicyEvaluated',
    gate_requested: 'GateRequested',
    gate_resolved: 'GateResolved',
    checkpoint_opened: 'GateRequested',
    checkpoint_resolved: 'GateResolved',
    verification_started: 'VerificationStarted',
    verification_completed: 'VerificationCompleted',
    verify_complete: 'VerificationCompleted',
    retry_scheduled: 'RetryScheduled',
    work_item_completed: 'WorkItemCompleted',
    task_completed: 'WorkItemCompleted',
    work_item_blocked: 'WorkItemBlocked',
    task_blocked: 'WorkItemBlocked',
    run_completed: 'RunCompleted',
    retro_published: 'RetroPublished',
    lesson_promoted: 'LessonPromoted',
  };
  return legacyMap[lower] || raw;
}

function toRuntimeEventEnvelope(event = {}, activeSession) {
  const type = normalizeRuntimeEventType(event.type);
  const payload = event.payload && typeof event.payload === 'object' ? { ...event.payload } : {};
  const workItemId = event.work_item_id || event.task_id || payload.work_item_id || payload.task_id || null;
  const attemptId = event.attempt_id || payload.attempt_id || null;
  if (type === 'RunStarted') {
    payload.run_id = payload.run_id || event.run_id || null;
    payload.session_id = payload.session_id || activeSession || event.session_id || null;
    payload.graph_version = payload.graph_version || 'legacy';
    payload.started_at = payload.started_at || event.timestamp || new Date().toISOString();
    payload.ended_at = payload.ended_at == null ? null : payload.ended_at;
    payload.status = payload.status || 'running';
    payload.initiator = payload.initiator || 'scheduler';
    payload.mode = payload.mode || 'por_onda';
  } else if (type === 'RunCompleted') {
    payload.run_id = payload.run_id || event.run_id || null;
    payload.status = payload.status || 'completed';
  } else if (type === 'WorkItemReady') {
    payload.work_item_id = payload.work_item_id || workItemId;
    payload.title = payload.title || workItemId || 'work-item';
    payload.type = payload.type || 'task';
    payload.depends_on = Array.isArray(payload.depends_on) ? payload.depends_on : [];
    payload.mutation_scope = Array.isArray(payload.mutation_scope) ? payload.mutation_scope : [];
    payload.policy_ref = payload.policy_ref || null;
    payload.verify_ref = Array.isArray(payload.verify_ref) ? payload.verify_ref : [];
    payload.status = payload.status || 'pending';
    payload.workspace_strategy = payload.workspace_strategy || 'inplace';
    payload.run_id = payload.run_id || event.run_id || null;
  } else if (type === 'AttemptStarted') {
    payload.attempt_number = payload.attempt_number || 1;
  } else if (type === 'WorkspaceAllocated') {
    payload.workspace_id = payload.workspace_id || `ws-${workItemId || 'runtime'}`;
    payload.strategy = payload.strategy || payload.workspace_strategy || 'inplace';
    payload.root_path = payload.root_path || null;
    payload.base_commit = payload.base_commit || null;
    payload.branch = payload.branch || null;
    payload.container_ref = payload.container_ref || null;
    payload.status = payload.status || 'ready';
  }
  return {
    id: String(event.event_id || event.id || ''),
    type,
    timestamp: event.timestamp || new Date().toISOString(),
    session_id: activeSession || event.session_id || null,
    run_id: event.run_id || payload.run_id || null,
    work_item_id: workItemId,
    attempt_id: attemptId,
    causation_id: event.causation_id || payload.causation_id || null,
    correlation_id: event.correlation_id || payload.correlation_id || null,
    payload,
  };
}

function serializeCanonicalState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    run: state.run || null,
    workItems: Array.from((state.workItems && state.workItems.values()) || []),
    attempts: Object.fromEntries(Array.from((state.attempts && state.attempts.entries()) || [])),
    workspaces: Array.from((state.workspaces && state.workspaces.values()) || []),
    completedWorkItems: Array.from(state.completedWorkItems || []),
    failedWorkItems: Array.from(state.failedWorkItems || []),
    blockedWorkItems: Array.from(state.blockedWorkItems || []),
    summary: {
      work_item_count: state.workItems instanceof Map ? state.workItems.size : 0,
      attempt_count: state.attempts instanceof Map
        ? Array.from(state.attempts.values()).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)
        : 0,
      workspace_count: state.workspaces instanceof Map ? state.workspaces.size : 0,
      completed: state.completedWorkItems instanceof Set ? state.completedWorkItems.size : 0,
      failed: state.failedWorkItems instanceof Set ? state.failedWorkItems.size : 0,
      blocked: state.blockedWorkItems instanceof Set ? state.blockedWorkItems.size : 0,
    },
  };
}

function hydrateCanonicalState(serialized) {
  const safe = serialized && typeof serialized === 'object' ? serialized : {};
  return {
    run: safe.run || null,
    workItems: new Map(
      Array.isArray(safe.workItems)
        ? safe.workItems
            .filter((item) => item && item.work_item_id)
            .map((item) => [item.work_item_id, item])
        : []
    ),
    attempts: new Map(Object.entries(safe.attempts && typeof safe.attempts === 'object' ? safe.attempts : {})),
    workspaces: new Map(
      Array.isArray(safe.workspaces)
        ? safe.workspaces
            .filter((item) => item && item.workspace_id)
            .map((item) => [item.workspace_id, item])
        : []
    ),
    completedWorkItems: new Set(Array.isArray(safe.completedWorkItems) ? safe.completedWorkItems : []),
    failedWorkItems: new Set(Array.isArray(safe.failedWorkItems) ? safe.failedWorkItems : []),
    blockedWorkItems: new Set(Array.isArray(safe.blockedWorkItems) ? safe.blockedWorkItems : []),
  };
}

function mergeCanonicalStateWithRunState(serializedState, runState = {}, activeSession, compiledGraph) {
  const live = hydrateCanonicalState(serializedState);
  const runId = runState.run_id || (live.run && live.run.run_id) || null;
  if (!live.run && runId) {
    live.run = {
      run_id: runId,
      session_id: activeSession || null,
      graph_version: (compiledGraph && compiledGraph.metadata && compiledGraph.metadata.plan_hash) || 'legacy',
      started_at: runState.created_at || new Date().toISOString(),
    ended_at: /completed|failed|blocked|aborted|cancelled/.test(String(runState.status || '')) ? (runState.updated_at || null) : null,
      status: runState.status || 'planned',
      initiator: 'scheduler',
      mode: runState.cursor && runState.cursor.mode === 'task'
        ? 'por_tarefa'
        : runState.cursor && runState.cursor.mode === 'wave'
          ? 'por_onda'
          : 'completo',
    };
  }

  // ACTIVE-RUN.status may only advance the reduced status; the event log stays the source of truth.
  if (live.run && runState.status) {
    const rank = { planned: 0, running: 1, replaying: 1, paused: 1, waiting_approval: 1, blocked: 2, failed: 3, completed: 3, aborted: 3 };
    const currentRank = rank[String(live.run.status || 'planned')] ?? 0;
    const nextRank = rank[String(runState.status)] ?? -1;
    if (nextRank > currentRank) {
      live.run = {
        ...live.run,
        status: String(runState.status),
        ended_at: nextRank >= 2 ? (runState.updated_at || live.run.ended_at || null) : (live.run.ended_at || null),
      };
    }
  }

  const compiledNodes = compiledGraph && compiledGraph.nodes && typeof compiledGraph.nodes === 'object'
    ? Object.values(compiledGraph.nodes)
    : [];
  for (const node of compiledNodes) {
    if (!node || !node.id || live.workItems.has(node.id)) continue;
    live.workItems.set(node.id, {
      work_item_id: node.id,
      run_id: runId,
      title: node.title || node.id,
      type: 'task',
      depends_on: Array.isArray(node.depends_on) ? node.depends_on : [],
      mutation_scope: Array.isArray(node.mutation_scope) ? node.mutation_scope : [],
      policy_ref: node.policy && node.policy.requires_human_approval ? 'human_approval' : null,
      verify_ref: node.verify && Array.isArray(node.verify.acceptance_refs) ? node.verify.acceptance_refs : [],
      status: 'pending',
      workspace_strategy: node.workspace_strategy || 'inplace',
    });
  }

  const activeTasks = Array.isArray(runState.active_tasks) ? runState.active_tasks.map(String) : [];
  for (const taskId of activeTasks) {
    const currentItem = live.workItems.get(taskId) || {
      work_item_id: taskId,
      run_id: runId,
      title: taskId,
      type: 'task',
      depends_on: [],
      mutation_scope: [],
      policy_ref: null,
      verify_ref: [],
      status: 'pending',
      workspace_strategy: 'inplace',
    };
    live.workItems.set(taskId, { ...currentItem, status: 'running' });
  }

  for (const blockedId of Array.isArray(runState.pending_checkpoints) ? runState.pending_checkpoints.map(String) : []) {
    if (!live.blockedWorkItems.has(blockedId)) live.blockedWorkItems.add(blockedId);
  }

  if (Array.isArray(runState.failures)) {
    for (const failure of runState.failures) {
      const ref = failure && typeof failure === 'object'
        ? String(failure.work_item_id || failure.task_id || failure.id || '')
        : '';
      if (ref) {
        live.failedWorkItems.add(ref);
        // A task that exhausted its attempts is "failed", not merely "blocked".
        live.blockedWorkItems.delete(ref);
        const item = live.workItems.get(ref);
        if (item) live.workItems.set(ref, { ...item, status: 'failed' });
      }
    }
  }

  if (Array.isArray(runState.evidence) && runState.evidence.length && live.run) {
    live.run = { ...live.run, evidence_count: runState.evidence.length };
  }

  for (const completedId of live.completedWorkItems) {
    const item = live.workItems.get(completedId);
    if (item) live.workItems.set(completedId, { ...item, status: 'completed' });
  }
  for (const failedId of live.failedWorkItems) {
    const item = live.workItems.get(failedId);
    if (item) live.workItems.set(failedId, { ...item, status: 'failed' });
  }
  for (const blockedId of live.blockedWorkItems) {
    const item = live.workItems.get(blockedId);
    if (item) live.workItems.set(blockedId, { ...item, status: 'blocked' });
  }
  return live;
}

/**
 * Drop exact duplicates written by pre-1.17 runtimes (same event forwarded twice with distinct
 * ids). Identity = everything but the id; two real events never share type, scope, timestamp
 * and payload.
 */
function dedupeEventRecords(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const key = [
      event.type,
      event.run_id,
      event.work_item_id || event.task_id || '',
      event.attempt_id || '',
      event.timestamp || '',
      JSON.stringify(event.payload || {}),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

/** Merge a stored canonical snapshot into the live (event-reduced) state without regressing it. */
function unionCanonicalStates(primary, secondary) {
  if (!secondary) return primary;
  for (const [id, item] of secondary.workItems || []) {
    if (!primary.workItems.has(id)) primary.workItems.set(id, item);
  }
  for (const id of secondary.completedWorkItems || []) primary.completedWorkItems.add(id);
  for (const id of secondary.failedWorkItems || []) {
    if (!primary.completedWorkItems.has(id)) primary.failedWorkItems.add(id);
  }
  for (const id of secondary.blockedWorkItems || []) {
    if (!primary.completedWorkItems.has(id) && !primary.failedWorkItems.has(id)) primary.blockedWorkItems.add(id);
  }
  if (!primary.run && secondary.run) primary.run = secondary.run;
  for (const completedId of primary.completedWorkItems) {
    const item = primary.workItems.get(completedId);
    if (item && item.status !== 'completed') primary.workItems.set(completedId, { ...item, status: 'completed' });
  }
  return primary;
}

function reduceCanonicalRunStateLive(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.reduce !== 'function') return null;
  const currentRun = options.runState || readRunState(projectRoot, activeSession) || null;
  const runId = options.runId || (currentRun && currentRun.run_id) || null;
  let events = readEvents(projectRoot, activeSession);
  if (runId) events = events.filter((event) => !event.run_id || event.run_id === runId);
  let reduced;
  try {
    reduced = runtime.reduce(dedupeEventRecords(events).map((event) => toRuntimeEventEnvelope(event, activeSession)));
  } catch (err) {
    // A corrupt or legacy log must degrade to the stored snapshot, never crash verify/project.
    if (process.env.OXE_DEBUG === '1') console.error(`[oxe] reduce falhou: ${err && err.message ? err.message : err}`);
    return null;
  }
  return mergeCanonicalStateWithRunState(
    serializeCanonicalState(reduced),
    currentRun || {},
    activeSession,
    currentRun && currentRun.compiled_graph ? currentRun.compiled_graph : null
  );
}

function reduceCanonicalRunState(projectRoot, activeSession, options = {}) {
  return serializeCanonicalState(reduceCanonicalRunStateLive(projectRoot, activeSession, options));
}

/**
 * Static-analysis lints for common pitfalls detectable before execution.
 * Returns hint strings to be appended to validationErrors (shown at compile time).
 */
function lintPlanForCommonPitfalls(parsedPlan, parsedSpec, projectRoot, rawSpecText = '') {
  const hints = [];
  const specText = (parsedSpec && parsedSpec.objective ? parsedSpec.objective : '') +
    JSON.stringify(parsedSpec && parsedSpec.criteria ? parsedSpec.criteria : []) +
    (rawSpecText || '');
  const planTasks = parsedPlan && Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : [];

  // ── Lint 1: HTML/JS SPA sem restrição de file:// ──────────────────────────
  // Detects: spec mentions HTML/SPA + no files restriction, but no verify command
  // checks for fetch() absence. Warns to add a fetch-detection verify.
  const isHtmlApp = /html|spa|browser|page|frontend|estático|static|aplicação web|web app|web page|interface web|\.html/i.test(specText);
  if (isHtmlApp) {
    const hasFetchGuard = planTasks.some(t =>
      t.verifyCommand && /fetch|XMLHttpRequest|file:\/\//i.test(t.verifyCommand)
    );
    const specMentionsServer = /servidor|server|http-server|localhost|npx serve|vite|webpack/i.test(specText);
    const specMentionsFileProtocol = /file:\/\/|sem servidor|without server|no.server/i.test(specText);
    if (!hasFetchGuard && !specMentionsServer && !specMentionsFileProtocol) {
      hints.push(
        'HINT(html-fetch): SPEC não declara se o app precisa de servidor HTTP. ' +
        'Se abrir em file://, adicione à SPEC: "sem servidor HTTP" e um verify que detecte fetch(): ' +
        '`node -e "if(require(\'fs\').readFileSync(\'app.js\',\'utf8\').includes(\'fetch(\'))throw new Error(\'fetch not allowed in file://\')"`'
      );
    }
  }

  // ── Lint 2: Verify commands que só verificam existência de função, não comportamento ──
  const existenceOnlyVerify = planTasks.filter(t =>
    t.verifyCommand &&
    /s\.includes\(/.test(t.verifyCommand) &&
    !/existsSync|readFileSync.*utf8|require\(/.test(t.verifyCommand)
  );
  if (existenceOnlyVerify.length > 2) {
    hints.push(
      `HINT(verify-depth): ${existenceOnlyVerify.length} tarefa(s) verificam apenas presença de string no código ` +
      `(s.includes). Considere adicionar verificações de comportamento: executar o código, não só inspecioná-lo.`
    );
  }

  // ── Lint 3: Tarefas sem verify command (T-level) ──────────────────────────
  const noVerify = planTasks.filter(t => !t.verifyCommand && !t.done);
  if (noVerify.length > 0) {
    hints.push(
      `HINT(no-verify): ${noVerify.length} tarefa(s) sem Comando de verificação: ${noVerify.map(t => t.id).join(', ')}. ` +
      `Tarefas sem verify não serão testadas inline pelo scheduler.`
    );
  }

  return hints;
}

/**
 * Hash of the artifacts a graph is compiled from (PLAN.json, PLAN.md, SPEC.md, IMPLEMENTATION-PACK.json). A run whose
 * `source_hash` differs runs a graph that no longer matches the plan: in the oxespace 1.5.0 F1 a CR added three files
 * to T4 after the compile, the checkpoint committed only the old scope and done tasks ran again (OXB-052/053).
 */
/** OXB-048: appends the task gates of PLAN.json / config.json to each code task's verify command in the graph. */
function applyTaskGatesToGraph(projectRoot, artifactPaths, compiledGraph) {
  const planJsonLib = require('./oxe-plan-json.cjs');
  const gatesLib = require('./oxe-task-gates.cjs');
  const jsonPath = planJsonLib.planJsonPathFor(artifactPaths.plan);
  if (!jsonPath || !fs.existsSync(jsonPath) || !compiledGraph || !compiledGraph.nodes) return;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return; }
  const config = readProjectConfig(projectRoot) || {};
  const gates = gatesLib.collectTaskGates(config, doc);
  const anySuites = (doc.tasks || []).some((t) => t && Array.isArray(t.affected_suites) && t.affected_suites.length);
  // OXB-172: the related tests that went red at the checkpoint run in the task's verify next time.
  const relatedRed = new Map((doc.tasks || []).filter((t) => t && !t.done && t.checkpoint_failed && t.checkpoint_failed.kind === 'related_tests' && Array.isArray(t.checkpoint_failed.related_red) && t.checkpoint_failed.related_red.length).map((t) => [t.id, t.checkpoint_failed.related_red]));
  if (relatedRed.size) {
    const nodes0 = Array.isArray(compiledGraph.nodes) ? compiledGraph.nodes : Object.values(compiledGraph.nodes);
    for (const node of nodes0) {
      const files = node && relatedRed.get(node.id);
      if (!files) continue;
      const rt0 = (readProjectConfig(projectRoot) || {}).checkpoint_related_tests;
      const runTpl = rt0 && typeof rt0 === 'object' && typeof rt0.run_command === 'string' && rt0.run_command.includes('{files}') ? rt0.run_command : 'npx vitest run {files}';
      const cmd = runTpl.replace('{files}', files.join(' '));
      node.verify = node.verify && typeof node.verify === 'object' ? node.verify : {};
      if (!String(node.verify.command || '').includes(cmd)) node.verify.command = [node.verify.command, cmd].filter(Boolean).join(' && ');
    }
  }
  if (!gates.length && !anySuites) { appendStubCheck(projectRoot, doc, compiledGraph); return; }
  const byId = new Map((doc.tasks || []).filter(Boolean).map((t) => [t.id, t]));
  const nodeList = Array.isArray(compiledGraph.nodes) ? compiledGraph.nodes : Object.values(compiledGraph.nodes);
  for (const node of nodeList) {
    const task = node && byId.get(node.id);
    if (!task) continue;
    const commands = gatesLib.taskGateCommands({ ...task, verifyCommand: node.verify && node.verify.command }, gates, config);
    if (!commands.length) continue;
    node.verify = node.verify && typeof node.verify === 'object' ? node.verify : {};
    node.verify.command = gatesLib.withTaskGates(node.verify.command, commands);
    node.verify.task_gates = commands.map((c) => c.id);
  }
  appendStubCheck(projectRoot, doc, compiledGraph);
}

/** OXB-108: every code task's verify ends with the anti-stub check (exists + substantive, on what the task added). */
function appendStubCheck(projectRoot, doc, compiledGraph) {
  try {
    if ((readProjectConfig(projectRoot) || {}).stub_check === false) return;
    const gatesLib = require('./oxe-task-gates.cjs');
    const stubScript = path.join(__dirname, 'oxe-stub-check.cjs').replace(/\\/g, '/');
    const nodes = Array.isArray(compiledGraph.nodes) ? compiledGraph.nodes : Object.values(compiledGraph.nodes);
    for (const node of nodes) {
      const task = node && (doc.tasks || []).find((t) => t && t.id === node.id);
      if (!task || !gatesLib.taskWritesCode(task)) continue;
      node.verify = node.verify && typeof node.verify === 'object' ? node.verify : {};
      if (!String(node.verify.command || '').includes('oxe-stub-check')) node.verify.command = [node.verify.command, `node "${stubScript}" --task ${node.id}`].filter(Boolean).join(' && ');
    }
  } catch { /* auxiliar */ }
}

function planSourceHash(projectRoot, activeSession) {
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const planJsonPath = require('./oxe-plan-json.cjs').planJsonPathFor(paths.plan);
  const hash = require('crypto').createHash('sha256');
  // OXB-049: REFERENCE-ANCHORS.md feeds the tasks' copy checks — changing it recompiles the graph.
  const anchorsPath = paths.plan ? path.join(path.dirname(paths.plan), 'REFERENCE-ANCHORS.md') : null;
  for (const file of [planJsonPath, paths.plan, paths.spec, paths.implementationPack, anchorsPath]) {
    hash.update(`${file ? path.basename(file) : '-'}\n`);
    hash.update(readTextIfExists(file) || '');
    hash.update('\n\u0000\n');
  }
  // OXB-048: the task gates live partly in config.json; changing them must recompile the graph.
  const config = readProjectConfig(projectRoot) || {};
  hash.update(JSON.stringify({ task_gates: config.task_gates || null, task_suite_command: config.task_suite_command || null }));
  return hash.digest('hex').slice(0, 16);
}

const mergedPrCache = new Map();
/**
 * Drops `blocked_by` refs of the form `owner/repo#123` whose PR is merged (`gh pr view`). Unknown refs, missing `gh`
 * or any error keep the dependency: only a confirmed merge unblocks.
 */
function resolveMergedDependencies(parsedPlan, spawn = spawnSync) {
  for (const task of parsedPlan && Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : []) {
    const meta = task.meta || {};
    if (!Array.isArray(meta.blocked_by) || !meta.blocked_by.length || task.done) continue;
    const still = [];
    const resolved = [];
    for (const ref of meta.blocked_by) {
      const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(ref).trim());
      if (!m) { still.push(ref); continue; }
      let state = mergedPrCache.get(ref);
      if (state === undefined) {
        try {
          const res = spawn('gh', ['pr', 'view', m[2], '-R', m[1], '--json', 'state', '-q', '.state'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
          state = res && res.status === 0 ? String(res.stdout || '').trim() : null;
        } catch {
          state = null;
        }
        mergedPrCache.set(ref, state);
      }
      (state === 'MERGED' ? resolved : still).push(ref);
    }
    if (resolved.length) task.meta = { ...meta, blocked_by: still, external_resolved: resolved };
  }
  return parsedPlan;
}

/**
 * OXB-085: the preconditions of each pending task (PLAN.json `blocked_by` objects: a PR merged, a commit on a branch,
 * a file existing). Unmet ones become `blocked_by` labels of the node, so the scheduler holds only that task with
 * "aguardando <label>"; met ones go to `preconditions_met`. A PR check respects `external_dependency_check: false`
 * (then it stays pending). The task is still this plan's work: never counted as externally delivered.
 */
function resolvePreconditions(projectRoot, parsedPlan, options = {}) {
  const spawn = options.ghSpawn || spawnSync;
  const prCheck = options.prCheck !== false;
  for (const task of parsedPlan && Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : []) {
    const meta = task.meta || {};
    if (!Array.isArray(meta.waits_on) || !meta.waits_on.length || task.done) continue;
    const pending = [];
    const met = [];
    for (const p of meta.waits_on) {
      let ok = false;
      if (p.kind === 'file') ok = fs.existsSync(path.resolve(projectRoot, p.ref));
      else if (p.kind === 'commit') {
        const branches = p.branch ? [p.branch] : ['origin/main', 'main', 'origin/master', 'master'];
        for (const b of branches) {
          if (!gitLines(projectRoot, ['rev-parse', '--verify', '-q', b])) continue;
          const r = spawnSync('git', ['merge-base', '--is-ancestor', p.ref, b], { cwd: projectRoot, windowsHide: true });
          ok = r.status === 0;
          break;
        }
      } else if (p.kind === 'pr' && prCheck) {
        const m = /^(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/|([\w.-]+\/[\w.-]+)?#)(\d+)$/.exec(p.ref);
        if (m) {
          const repo = m[1] || m[2] || null;
          const key = `${repo || projectRoot}#${m[3]}`;
          let state = mergedPrCache.get(key);
          if (state === undefined) {
            try {
              const res = spawn('gh', ['pr', 'view', m[3], ...(repo ? ['-R', repo] : []), '--json', 'state', '-q', '.state'], { cwd: projectRoot, encoding: 'utf8', timeout: 15000, windowsHide: true });
              state = res && res.status === 0 ? String(res.stdout || '').trim() : null;
            } catch { state = null; }
            mergedPrCache.set(key, state);
          }
          ok = p.until === 'closed' ? state === 'MERGED' || state === 'CLOSED' : state === 'MERGED';
        }
      }
      (ok ? met : pending).push(p);
    }
    task.meta = {
      ...meta,
      ...(pending.length ? { blocked_by: [...(meta.blocked_by || []), ...pending.map((p) => p.label)], precondition_pending: pending.map((p) => p.label) } : {}),
      ...(met.length ? { preconditions_met: met.map((p) => p.label) } : {}),
    };
  }
  return parsedPlan;
}

function compileExecutionGraphFromArtifacts(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  const parsers = loadSdkParsers();
  if (!runtime || typeof runtime.compile !== 'function' || typeof runtime.toSerializable !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  if (!parsers) {
    throw new Error('Parsers do SDK indisponíveis para compilar o grafo.');
  }
  const artifactPaths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const specText = readTextIfExists(artifactPaths.spec);
  const planText = readTextIfExists(artifactPaths.plan);
  if (!specText) throw new Error(`SPEC.md ausente em ${artifactPaths.spec}\n  Crie .oxe/SPEC.md com /oxe-spec no seu agente, ou use o template em oxe/templates/SPEC.template.md`);
  if (!planText) throw new Error(`PLAN.md ausente em ${artifactPaths.plan}\n  Crie .oxe/PLAN.md com /oxe-plan no seu agente (requer SPEC.md), ou use o template em oxe/templates/PLAN.template.md`);
  const parsedSpec = parsers.parseSpec(specText);
  const parsedPlan = parsePlanArtifact(parsers, planText, artifactPaths.plan);
  // OXB-047: an external dependency whose PR is already merged no longer blocks its task (checked on every compile).
  const externalCheck = readProjectConfig(projectRoot).external_dependency_check !== false && options.externalCheck !== false;
  if (externalCheck) {
    resolveMergedDependencies(parsedPlan, options.ghSpawn);
  }
  resolvePreconditions(projectRoot, parsedPlan, { ghSpawn: options.ghSpawn, prCheck: externalCheck });
  // PLAN.json marca `done` explicitamente: num replan as tarefas concluídas não voltam a rodar (OXB-017).
  const compilerOptions = { ...(parsedPlan.source === 'PLAN.json' ? { skip_done_tasks: true } : {}), ...(options.compilerOptions || {}) };
  const graph = runtime.compile(parsedPlan, parsedSpec, compilerOptions);
  const validationErrors = typeof runtime.validateGraph === 'function' ? runtime.validateGraph(graph) : [];

  // Static-analysis lints: detect common patterns that cause runtime failures
  const lintHints = lintPlanForCommonPitfalls(parsedPlan, parsedSpec, projectRoot, specText);
  if (lintHints.length) validationErrors.push(...lintHints);

  const compiledGraph = runtime.toSerializable(graph);

  // Gap B: enrich node verify.command from SPEC criteria howToVerify when linked via acceptance_refs.
  // Extracts commands from backtick patterns (e.g. "Run `npm test`") and appends to existing command
  // or sets as command when none exists. Only runs when spec has criteria.
  if (parsedSpec.criteria && parsedSpec.criteria.length > 0 && compiledGraph.nodes) {
    const criteriaMap = new Map(parsedSpec.criteria.map(c => [c.id, c]));
    const nodeList = Array.isArray(compiledGraph.nodes)
      ? compiledGraph.nodes
      : Object.values(compiledGraph.nodes);
    // OXB-053: a criterion's own check runs only in the task that completes it (the others would fail by design).
    const closers = require('./oxe-plan-json.cjs').criterionClosers(parsedPlan.tasks);
    for (const node of nodeList) {
      if (!node || !node.verify) continue;
      const refs = (Array.isArray(node.verify.acceptance_refs) ? node.verify.acceptance_refs : [])
        .filter((ref) => { const c = closers.get(ref); return !c || c.closer === node.id; });
      const criteriaCommands = [];
      const criteriaFiles = [];
      for (const ref of refs) {
        const criterion = criteriaMap.get(ref);
        if (!criterion || !criterion.howToVerify) continue;
        // Only backtick spans that look like shell commands are appended; path-like spans become
        // `verify.expect.files_exist` (a bare `package.json` must never be executed as a command).
        for (const span of extractBacktickSpans(criterion.howToVerify)) {
          if (looksLikeShellCommand(span)) criteriaCommands.push(span);
          else if (looksLikeFilePath(span)) criteriaFiles.push(span);
        }
      }
      if (criteriaFiles.length > 0) {
        const expect = node.verify.expect && typeof node.verify.expect === 'object' ? node.verify.expect : {};
        const existing = Array.isArray(expect.files_exist) ? expect.files_exist : [];
        node.verify.expect = { ...expect, files_exist: [...new Set([...existing, ...criteriaFiles])] };
      }
      if (criteriaCommands.length === 0) continue;
      const unique = [...new Set(criteriaCommands)];
      if (node.verify.command) {
        const extra = unique.filter(c => !node.verify.command.includes(c));
        if (extra.length > 0) node.verify.command += ' && ' + extra.join(' && ');
      } else {
        node.verify.command = unique.join(' && ');
      }
    }
  }

  // OXB-048: light task gates (incremental typecheck, related tests, affected suites) on every code task's verify.
  applyTaskGatesToGraph(projectRoot, artifactPaths, compiledGraph);

  const current = options.runState || readRunState(projectRoot, activeSession) || {};
  const runId = current.run_id || makeRunId();
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    run_id: runId,
    status: current.status || 'planned',
    compiled_graph: compiledGraph,
    // 1.21.1 (OXB-053/052): what the graph was compiled from. execute recompiles when the plan, spec or pack change.
    source_hash: planSourceHash(projectRoot, activeSession),
    acceptance_lock: freezeAcceptanceTests(projectRoot, parsedPlan),
    graph_version: compiledGraph.metadata && compiledGraph.metadata.plan_hash ? compiledGraph.metadata.plan_hash : 'compiled',
    canonical_state: serializeCanonicalState(
      mergeCanonicalStateWithRunState(
        reduceCanonicalRunState(projectRoot, activeSession, { runState: { ...current, run_id: runId } }),
        { ...current, run_id: runId },
        activeSession,
        compiledGraph
      )
    ),
    projections: current.projections || {},
  });
  appendEvent(projectRoot, activeSession, {
    type: 'GraphCompiled',
    run_id: next.run_id,
    payload: {
      node_count: compiledGraph.metadata && compiledGraph.metadata.node_count || 0,
      wave_count: compiledGraph.metadata && compiledGraph.metadata.wave_count || 0,
      plan_hash: compiledGraph.metadata && compiledGraph.metadata.plan_hash || null,
      spec_hash: compiledGraph.metadata && compiledGraph.metadata.spec_hash || null,
    },
  });
  return {
    run: next,
    graph: compiledGraph,
    validationErrors,
    parsedPlan,
    parsedSpec,
    paths: artifactPaths,
  };
}

/**
 * OXB-069: with a program, the phase verify checks the ACTIVE phase's criteria (PROGRAM.json `acceptance`, plus any
 * criterion the plan's tasks reference). With F1 active, VERIFY.md listed 38 "não é executável" gaps for F2–F9
 * criteria that have no plan yet, and the coverage counted them. The rest becomes one "not planned yet" line.
 * @returns {{ spec: object, outOfPhase: { count: number, phases: string[] } | null }}
 */
function scopeSpecToActivePhase(artifactPaths, parsedSpec, parsedPlan) {
  if (!parsedSpec || !Array.isArray(parsedSpec.criteria) || !artifactPaths.programDir) return { spec: parsedSpec, outOfPhase: null };
  let state = null;
  try { state = require('./oxe-program.cjs').readProgram(artifactPaths.programDir); } catch { state = null; }
  const phase = state && state.active_phase ? state.phases.find((p) => p.id === state.active_phase) : null;
  if (!phase || !Array.isArray(phase.acceptance) || !phase.acceptance.length) return { spec: parsedSpec, outOfPhase: null };
  const keep = new Set(phase.acceptance);
  for (const task of (parsedPlan && parsedPlan.tasks) || []) for (const a of task.aceite || []) keep.add(a);
  // OXB-037: the subcriteria of the phase's criteria and the global G* are the phase's too.
  const ids = require('./oxe-criteria-ids.cjs');
  for (const c of parsedSpec.criteria) if (ids.inPhase(c.id, keep)) keep.add(c.id);
  let oxeRoot = path.resolve(artifactPaths.programDir);
  while (path.basename(oxeRoot) !== '.oxe' && path.dirname(oxeRoot) !== oxeRoot) oxeRoot = path.dirname(oxeRoot);
  for (const s of ids.standingAcceptance(path.dirname(oxeRoot))) keep.add(s);
  const dropped = parsedSpec.criteria.filter((c) => !keep.has(c.id));
  if (!dropped.length) return { spec: parsedSpec, outOfPhase: null };
  const phaseOf = new Map();
  for (const p of state.phases) for (const a of p.acceptance || []) if (!phaseOf.has(a)) phaseOf.set(a, p.id);
  const phases = [...new Set(dropped.map((c) => phaseOf.get(c.id) || phaseOf.get(ids.parentOf(c.id)) || 'sem fase'))]
    .sort((a, b) => (Number(String(a).slice(1)) || 999) - (Number(String(b).slice(1)) || 999));
  return { spec: { ...parsedSpec, criteria: parsedSpec.criteria.filter((c) => keep.has(c.id)) }, outOfPhase: { count: dropped.length, phases } };
}

function describePhaseRange(phases) {
  const nums = phases.map((p) => Number(String(p).replace(/^F/, ''))).filter((n) => Number.isInteger(n));
  const contiguous = nums.length === phases.length && nums.length > 1 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous ? `F${nums[0]}–F${nums[nums.length - 1]}` : phases.join(', ');
}

function compileVerificationSuiteFromArtifacts(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  const parsers = loadSdkParsers();
  if (!runtime || typeof runtime.compileVerification !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  if (!parsers) {
    throw new Error('Parsers do SDK indisponíveis para compilar verification suite.');
  }
  const artifactPaths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const specText = readTextIfExists(artifactPaths.spec);
  const planText = readTextIfExists(artifactPaths.plan);
  if (!specText || !planText) {
    throw new Error('SPEC.md e PLAN.md são obrigatórios para compilar a suite de verificação.');
  }
  const current = options.runState || readRunState(projectRoot, activeSession) || {};
  const parsedPlan = attachAcceptanceLock(
    attachImplementationPackContracts(parsePlanArtifact(parsers, planText, artifactPaths.plan), artifactPaths.implementationPack),
    current,
    projectRoot,
  );
  const scoped = scopeSpecToActivePhase(artifactPaths, parsers.parseSpec(specText), parsedPlan);
  const suite = runtime.compileVerification(scoped.spec, parsedPlan, options.compilerOptions || {});
  const runId = current.run_id || makeRunId();
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    run_id: runId,
    status: current.status || 'planned',
    verification_suite: suite,
  });
  appendEvent(projectRoot, activeSession, {
    type: 'verification_suite_compiled',
    run_id: next.run_id,
    payload: {
      total_checks: Array.isArray(suite.checks) ? suite.checks.length : 0,
      spec_hash: suite.spec_hash || null,
      plan_hash: suite.plan_hash || null,
    },
  });
  return { run: next, suite, paths: artifactPaths };
}

function runResultFromRunState(runState) {
  const canonical = runState && runState.canonical_state && typeof runState.canonical_state === 'object'
    ? hydrateCanonicalState(runState.canonical_state)
    : null;
  return {
    run_id: runState && runState.run_id ? runState.run_id : makeRunId(),
    status: String(runState && runState.status || 'planned'),
    completed: canonical ? Array.from(canonical.completedWorkItems || []) : [],
    failed: canonical ? Array.from(canonical.failedWorkItems || []) : [],
    blocked: canonical ? Array.from(canonical.blockedWorkItems || []) : [],
  };
}

function gateStoragePath(projectRoot, activeSession) {
  return activeSession
    ? path.join(projectRoot, '.oxe', ...String(activeSession).split('/'), 'execution', 'GATES.json')
    : path.join(projectRoot, '.oxe', 'execution', 'GATES.json');
}

function readRuntimeGates(projectRoot, activeSession, options = {}) {
  const gatesPath = gateStoragePath(projectRoot, activeSession);
  const raw = readJsonIfExists(gatesPath);
  const gates = Array.isArray(raw) ? raw : [];
  const runId = options.runId || null;
  const gateSlaHours = Number(options.gateSlaHours || options.gate_sla_hours || 24);
  const status = String(options.status || 'all');
  const scope = options.scope ? String(options.scope) : null;
  const workItemId = options.task || options.workItemId || null;
  const action = options.action || null;
  const filtered = gates.filter((gate) => {
    if (runId && gate.run_id && gate.run_id !== runId) return false;
    if (scope && gate.scope !== scope) return false;
    if (workItemId && gate.work_item_id !== workItemId) return false;
    if (action && gate.action !== action) return false;
    if (status !== 'all') {
      const requestedAt = Date.parse(String(gate.requested_at || ''));
      const isStale = gate.status === 'pending'
        && Number.isFinite(requestedAt)
        && Date.now() - requestedAt > gateSlaHours * 60 * 60 * 1000;
      if (status === 'stale') return isStale;
      return gate.status === status;
    }
    return true;
  });
  const pending = filtered.filter((gate) => gate && gate.status === 'pending');
  const stalePending = pending.filter((gate) => {
    const requestedAt = Date.parse(String(gate.requested_at || ''));
    return Number.isFinite(requestedAt) && Date.now() - requestedAt > gateSlaHours * 60 * 60 * 1000;
  });
  const resolvedRecent = filtered.filter((gate) => {
    if (gate.status !== 'resolved') return false;
    const resolvedAt = Date.parse(String(gate.resolved_at || ''));
    return Number.isFinite(resolvedAt) && Date.now() - resolvedAt <= gateSlaHours * 60 * 60 * 1000;
  });
  const byRun = {};
  const byScope = {};
  for (const gate of filtered) {
    const runKey = gate.run_id || 'unscoped';
    const scopeKey = gate.scope || 'unknown';
    byRun[runKey] = (byRun[runKey] || 0) + 1;
    byScope[scopeKey] = (byScope[scopeKey] || 0) + 1;
  }
  return {
    path: gatesPath,
    total: filtered.length,
    gateSlaHours,
    pending,
    stalePending,
    staleCount: stalePending.length,
    resolvedRecent,
    byRun,
    byScope,
    all: filtered,
    filters: { runId, status, scope, workItemId, action },
  };
}

async function resolveRuntimeGate(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.GateManager !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  const current = readRunState(projectRoot, activeSession);
  const runId = options.runId || (current && current.run_id);
  if (!runId) throw new Error('Nenhum run ativo para resolver gates.');
  const manager = new runtime.GateManager(projectRoot, activeSession || null, runId);
  const gate = manager.get(String(options.gateId || ''));
  if (!gate) throw new Error(`Gate ${options.gateId} não encontrado.`);
  const mappedDecision = options.decision === 'approve'
    ? 'approved'
    : options.decision === 'reject'
      ? 'rejected'
      : 'approved_with_caveats';
  const resolved = await runtime.resolveGate(manager, gate.gate_id, {
    decision: mappedDecision,
    actor: String(options.actor || ''),
    reason: options.reason ? String(options.reason) : undefined,
  });
  const queue = readRuntimeGates(projectRoot, activeSession, {
    runId,
    gateSlaHours: options.gateSlaHours || options.gate_sla_hours || 24,
  });
  return {
    gate: resolved,
    queue,
    impact: {
      pendingRemaining: queue.pending.length,
      staleRemaining: queue.staleCount || 0,
      runId,
    },
  };
}

  // Gap 5: route execution to MultiAgentCoordinator when plan-agents.json exists
function buildRuntimeExecutePreflight(projectRoot, activeSession, runState, options = {}) {
    const health = loadProjectHealth();
    const blockers = [];
    const warnings = [];
    let report = null;
    // 1.21 (OXB-006): the machine's toolchain against the project's engines/.nvmrc/packageManager, before any paid turn.
    // `project_env_check`: true/"block" (default) blocks; "warn" reports only (a mismatch accepted on purpose); false skips.
    // OXB-111: a plan review of THIS plan with an unwaived FAIL blocks the execute.
    try {
      const { doc: pjr } = readPlanJsonDoc(projectRoot, activeSession);
      const rb = require('./oxe-plan-review.cjs').blockingFails(projectRoot, pjr);
      for (const f of rb.fails) blockers.push(`plan_review:${f.dimension} — ${(f.findings[0] && f.findings[0].text) || 'FAIL'} (oxe-cc plan lint --review; dispensa: --waive ${f.dimension} --by --reason)`);
      if (rb.stale) warnings.push('plan_review: .oxe/PLAN-REVIEW.md é de outra versão do plano — rode oxe-cc plan lint --review de novo');
    } catch { /* auxiliar */ }
    const envMode = readProjectConfig(projectRoot).project_env_check;
    if (envMode !== false) {
      try {
        const env = require('./oxe-project-env.cjs').checkProjectEnvironment(projectRoot, { nativeCheck: options.nativeCheck !== false });
        for (const problem of env.problems) (envMode === 'warn' ? warnings : blockers).push(`project_env:${problem}`);
        for (const warning of env.warnings) warnings.push(`project_env:${warning}`);
      } catch { /* a leitura do ambiente nunca derruba o preflight */ }
    }
    // OXB-147: never run a verify that reinstalls packages or changes git state, or a sentence as a command.
    try {
      const parsers = loadSdkParsers();
      const p = resolveRuntimeArtifactPaths(projectRoot, activeSession);
      const planDoc = parsers ? require('./oxe-plan-json.cjs').readPlanArtifact(p.plan, readTextIfExists(p.plan) || '', parsers.parsePlan) : null;
      const unsafe = require('./oxe-unsafe-commands.cjs');
      const split = require('./oxe-vitest-batch.cjs').splitSegments;
      for (const task of (planDoc && planDoc.tasks) || []) {
        if (task.done || !task.verifyCommand) continue;
        for (const problem of unsafe.verifyCommandProblems(task.id, task.verifyCommand, split)) blockers.push(`unsafe_verify:${problem}`);
      }
    } catch { /* plan reading problems are reported by the lint */ }
    if (health && typeof health.buildHealthReport === 'function') {
      report = health.buildHealthReport(projectRoot);
      if (report.planSelfEvaluation && report.planSelfEvaluation.executable === false) {
        const confidence = report.planSelfEvaluation.confidence;
        const threshold = report.planConfidenceThreshold || 90;
        // The gate also fails on an incomplete self-evaluation (rubric, vector): say which, or "91%<=90%" reads as a bug.
        const evaluationWarnings = Array.isArray(report.planSelfEvaluation.warnings) ? report.planSelfEvaluation.warnings : [];
        const belowThreshold = confidence == null || confidence <= threshold;
        // OXB-007: below the threshold, the way forward is a spike that answers the open question, not a blind execute.
        // OXB-044: both, when both apply — reporting only the confidence hid the incomplete rubric until the next round.
        const confidenceIssue = confidence == null
          ? (evaluationWarnings.length ? null : `plan_confidence:missing<=${threshold}%`)
          : belowThreshold ? `plan_confidence:${confidence}%<=${threshold}% — reduza a incerteza com uma tarefa "kind": "spike" (pergunta + evidência em .oxe/spikes/) e reavalie o plano` : null;
        if (confidenceIssue) blockers.push(confidenceIssue);
        if (evaluationWarnings.length) blockers.push(`plan_self_evaluation_incomplete:${evaluationWarnings.length} — ${evaluationWarnings.join('; ')}`);
        if (!confidenceIssue && !evaluationWarnings.length) blockers.push(`plan_confidence:${confidence == null ? 'missing' : `${confidence}%`}<=${threshold}%`);
      }
      if (report.executionRationality && report.executionRationality.applicable && !report.executionRationalityReady) {
        const gaps = Array.isArray(report.criticalExecutionGaps) ? report.criticalExecutionGaps : [];
        blockers.push(`execution_rationality:${gaps[0] || 'not_ready'}`);
      }
      if (report.fallbackMode && report.fallbackMode !== 'none') {
        warnings.push(`fallback_mode:${report.fallbackMode}`);
      }
    } else {
      warnings.push('health_report_unavailable');
    }
    const runId = runState && runState.run_id ? runState.run_id : null;
    const queue = readRuntimeGates(projectRoot, activeSession, { runId });
    // OXB-047: gates older versions created for external-dependency / verify-only tasks are not human decisions and
    // never block the run (they were recreated as "security" gates on every execute).
    const graphNodes = runState && runState.compiled_graph && runState.compiled_graph.nodes ? runState.compiled_graph.nodes : {};
    const nodeOf = (id) => (Array.isArray(graphNodes) ? graphNodes.find((n) => n && n.id === id) : graphNodes[id]) || null;
    const humanPending = queue.pending.filter((gate) => {
      const node = nodeOf(gate.work_item_id);
      const policy = node && node.policy ? node.policy : {};
      return !(policy.verify_only || (Array.isArray(policy.external_dependency) && policy.external_dependency.length));
    });
    if (humanPending.length < queue.pending.length) {
      warnings.push(`external_gates_ignored:${queue.pending.length - humanPending.length} (tarefas com dependência externa não usam gate humano; rejeite-os quando quiser limpar a fila)`);
    }
    if (humanPending.length > 0) {
      blockers.push(`pending_gates:${humanPending.length}`);
    }
    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      runId,
      gateQueue: {
        pending: queue.pending.length,
        stale: queue.staleCount || 0,
      },
      confidence: report && report.planSelfEvaluation ? report.planSelfEvaluation.confidence : null,
      confidenceThreshold: report ? report.planConfidenceThreshold || 90 : 90,
      executionRationalityReady: report ? Boolean(report.executionRationalityReady) : false,
    };
  }

  async function runRuntimeExecute(projectRoot, activeSession, options = {}) {
    applyChildEnvPolicy(projectRoot);
    const runtime = loadRuntimeModule();
    if (!runtime) throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  const parsers = loadSdkParsers();
  if (!parsers) throw new Error('SDK parsers não disponíveis.');

  // Auto-wire LlmTaskExecutor (via adapter) if providerConfig or adapter is supplied
  let executor = options.executor || null;
  let usageRunId = null;
  // 1.21 (OXB-023): the run's turn/cost ledger, fed by every attempt's usage.
  const budgetLib = require('./oxe-budget.cjs');
  let budgetLedger = null;
  const onUsage = (event) => {
    if (!budgetLedger || !event || event.type !== 'executor_usage') return;
    const detail = event.detail || {};
    budgetLib.recordUsage(projectRoot, budgetLedger, { turns: detail.turns, cost_usd: detail.cost_usd, task: event.nodeId, attempt: event.attempt });
  };
  if (!executor && (options.providerConfig || options.adapter)) {
    if (typeof runtime.LlmTaskExecutor !== 'function') throw new Error('Runtime não exporta LlmTaskExecutor.');
    executor = createAdapterExecutor(runtime, projectRoot, activeSession, { ...options, onUsage }, () => usageRunId);
  }
  // Auto-wire InplaceWorkspaceManager as default
  let workspaceManager = options.workspaceManager || null;
  if (!workspaceManager) {
    if (typeof runtime.InplaceWorkspaceManager === 'function') {
      workspaceManager = new runtime.InplaceWorkspaceManager(projectRoot);
    }
  }

  // OXB-167: a task whose verify passed but whose checkpoint commit failed (a hook, a lock) gets the commit retried
  // first — no executor turn, no new verify; done only if the commit lands with its scope's changes.
  const checkpointRetry = retryFailedCheckpoints(projectRoot, activeSession, options);
  // OXB-170: an interrupted task's leftovers are ITS work when it runs again (not "dirty before it").
  const interruptedWork = new Map((checkpointRetry.interrupted || []).filter((w) => w.task).map((w) => [w.task, w.files]));
  // OXB-174: plus the task's own leftovers from its earlier failed/interrupted attempts (any run).
  try {
    for (const [id, files] of ownLeftoversByTask(projectRoot, activeSession, checkpointRetry.interrupted || [])) {
      interruptedWork.set(id, [...new Set([...(interruptedWork.get(id) || []), ...files])]);
    }
    if (interruptedWork.size) appendEvent(projectRoot, activeSession, { type: 'OwnLeftoversAttributed', payload: { tasks: [...interruptedWork].map(([task, files]) => ({ task, files })) } });
  } catch { /* auxiliar */ }

  // Resolve compiled graph from run state or compile on demand
  let current = options.runState || readRunState(projectRoot, activeSession);
    // A run de uma fase já fechada nunca é reaproveitada: a fase nova compila o seu próprio PLAN.
    // `{}` (não null) força run nova: null faria o compile reler a run antiga do disco.
    if (current && isClosedPhaseRun(projectRoot, activeSession, current.run_id)) current = {};
    // OXB-053/052: a graph compiled from another version of the plan is recompiled (same run, done tasks skipped),
    // never executed as is — it re-ran done tasks and checkpointed the old write set.
    if (current && current.compiled_graph && !options.runState) {
      const nowHash = planSourceHash(projectRoot, activeSession);
      if (current.source_hash !== nowHash) {
        appendEvent(projectRoot, activeSession, {
          type: 'VerificationSuiteRecompiled',
          run_id: current.run_id,
          payload: { reason: 'plan_changed_since_compile', previous: current.source_hash || null, current: nowHash, scope: 'graph' },
        });
        current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current }).run;
      }
    }
    if (!current || !current.compiled_graph) {
      current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current }).run;
    }
    if (!current || !current.compiled_graph) {
      throw new Error('Nenhum grafo compilado encontrado. Execute oxe-cc runtime compile primeiro.');
    }
    usageRunId = current.run_id;
    let planBudget = null;
    const runPaths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    let runPlan = null;
    try {
      runPlan = parsePlanArtifact(parsers, readTextIfExists(runPaths.plan) || '', runPaths.plan);
      planBudget = runPlan && runPlan.budget ? runPlan.budget : null;
    } catch {
      runPlan = null;
      planBudget = null;
    }
    const planTaskById = new Map(((runPlan && runPlan.tasks) || []).map((task) => [task.id, task]));
    // OXB-051: files already changed before this execute are the person's work — never reverted by isolation.
    const allPlanFiles = [...new Set(((runPlan && runPlan.tasks) || []).flatMap((t) => (t.files || []).map((f) => String(f).replace(/\\/g, '/'))))].filter((f) => f && !f.includes('*'));
    const preDirty = new Set(allPlanFiles.length
      ? (gitLines(projectRoot, ['status', '--porcelain', '-uall', '--', ...allPlanFiles]) || []).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop())
      : []);
    const isolateFailures = readProjectConfig(projectRoot).isolate_failed_attempts !== false;
    // OXB-067/068: per-task and per-attempt tree snapshots, and the paths each task touched outside its scope.
    const gitRepo = Boolean(gitLines(projectRoot, ['rev-parse', '--is-inside-work-tree']));
    const taskBaseline = new Map();
    const scratchLib = require('./oxe-scratch.cjs');
    const isScratchPath = scratchLib.makeScratchMatcher(projectRoot);
    const attemptBaseline = new Map();
    const scopeViolations = new Map();
    const graphNodeOf = (id) => {
      const nodes = current && current.compiled_graph && current.compiled_graph.nodes;
      return nodes ? (Array.isArray(nodes) ? nodes.find((n) => n && n.id === id) : nodes[id]) || null : null;
    };
    const isVerifyOnlyNode = (id) => {
      const node = graphNodeOf(id);
      return Boolean(node && node.policy && node.policy.verify_only);
    };
    const scopeOfTask = (id) => {
      if (isVerifyOnlyNode(id)) return []; // enforced empty scope (OXB-068)
      const planTask = planTaskById.get(id);
      const planFiles = planTask && Array.isArray(planTask.files) ? planTask.files.map((p) => String(p).replace(/\\/g, '/')) : [];
      return [...new Set([...taskScopeFiles(current, id), ...planFiles])].filter((p) => p && !p.includes('*'));
    };
    // OXB-036: the program's budget policy applies to every phase without editing each PLAN.json.
    let programBudgetPolicy = null;
    try {
      const programState = runPaths.programDir ? require('./oxe-program.cjs').readProgram(runPaths.programDir) : null;
      programBudgetPolicy = programState && programState.budget_policy && programState.budget_policy.mode ? programState.budget_policy : null;
    } catch { programBudgetPolicy = null; }
    budgetLedger = budgetLib.openBudget(projectRoot, current.run_id, {
      turns: options.budgetTurns,
      usd: options.budgetUsd,
      reset: Boolean(options.budgetReset),
      plan: planBudget,
      policy: programBudgetPolicy,
    });
    const maxRetriesOverride = options.maxRetries != null && Number.isInteger(Number(options.maxRetries)) && Number(options.maxRetries) >= 0
      ? Number(options.maxRetries)
      : planBudget && Number.isInteger(planBudget.max_retries) && planBudget.max_retries >= 0 ? planBudget.max_retries : null;
    if (budgetLedger && budgetLib.exhaustedReason(budgetLedger)) {
      const reason = budgetLib.exhaustedReason(budgetLedger);
      appendEvent(projectRoot, activeSession, { type: 'BudgetExhausted', run_id: current.run_id, payload: { reason, before_start: true } });
      return {
        mode: 'budget',
        agentPlan: null,
        result: { run_id: current.run_id, status: 'blocked', completed: [], failed: [], blocked: ['budget_exhausted'], reason },
        run: current,
        preflight: null,
        budget: budgetLedger,
      };
    }
    touchProgramPhase(projectRoot, activeSession, 'executing', { run_id: current.run_id });
    const checkpointCommits = Boolean(options.checkpointCommits || readProjectConfig(projectRoot).checkpoint_commits);
    const checkpointFailures = [];
    const schedulerRef = { current: null };
    const phaseCtxForCommits = taskPhaseContext(projectRoot, activeSession);
    const preflight = buildRuntimeExecutePreflight(projectRoot, activeSession, current);
    if (!preflight.ok && !options.skipPreflight) {
      const reason = preflight.blockers[0] || 'runtime_execute_preflight_failed';
      appendEvent(projectRoot, activeSession, {
        type: 'WorkItemBlocked',
        run_id: current.run_id,
        payload: {
          reason: 'runtime_execute_preflight_failed',
          blockers: preflight.blockers,
        },
      });
      return {
        mode: 'preflight',
        agentPlan: null,
        result: {
          run_id: current.run_id,
          status: 'blocked',
          completed: [],
          failed: [],
          blocked: ['runtime_execute_preflight'],
          reason,
        },
        run: current,
        preflight,
      };
    }
    const graph = runtime.fromSerializable
      ? runtime.fromSerializable(current.compiled_graph)
      : current.compiled_graph;
    // OXB-051: `--wave N` runs only that wave (it used to run every pending wave and paid for the next one too).
    if (options.wave != null && graph && Array.isArray(graph.waves)) {
      const only = Number(options.wave);
      graph.waves = graph.waves.filter((w) => Number(w.wave_number) === only);
    }
    // OXB-023: `--max-retries` / PLAN.json budget.max_retries replace the compile default (2) for this execution.
    if (maxRetriesOverride != null && graph && graph.nodes) {
      const nodes = typeof graph.nodes.values === 'function' ? [...graph.nodes.values()] : Object.values(graph.nodes);
      for (const node of nodes) if (node && node.policy) node.policy.max_retries = maxRetriesOverride;
    }
    // OXB-050: `--parallel-mutating` — refused before any paid turn unless it is safe (see oxe-parallel.cjs).
    let parallelOptions = null;
    if (options.parallelMutating) {
      const parallelLib = require('./oxe-parallel.cjs');
      const pcfg = parallelLib.parallelConfig(projectRoot, options);
      const allNodes = graph && graph.nodes ? (typeof graph.nodes.values === 'function' ? [...graph.nodes.values()] : Object.values(graph.nodes)) : [];
      const inWaves = new Set((graph.waves || []).flatMap((w) => w.node_ids || []));
      const mutating = allNodes.filter((n) => n && inWaves.has(n.id) && Array.isArray(n.mutation_scope) && n.mutation_scope.length);
      const errors = parallelLib.parallelPreconditions(projectRoot, pcfg, {
        nodes: mutating,
        checkpointCommits: Boolean(options.checkpointCommits || readProjectConfig(projectRoot).checkpoint_commits),
        dirty: dirtyProjectPaths(projectRoot),
      });
      if (errors.length) throw new Error(`--parallel-mutating recusado:\n  - ${errors.join('\n  - ')}`);
      // Leftovers of a crashed run: links removed first, then the worktree (never a forced remove over a junction).
      if (typeof runtime.sweepStaleWorkspaces === 'function') runtime.sweepStaleWorkspaces(projectRoot);
      parallelOptions = parallelLib.createParallelOptions(runtime, projectRoot, pcfg, { workingTreeChanges });
    }

  // Detect plan-agents.json: explicit override > session path > root path
  const rootAgentPlan = path.join(projectRoot, '.oxe', 'plan-agents.json');
  const sessAgentPlan = activeSession
    ? path.join(projectRoot, '.oxe', activeSession, 'plan', 'plan-agents.json')
    : null;
  const agentPlanPath = (options.agentsPlanPath && fs.existsSync(options.agentsPlanPath))
    ? options.agentsPlanPath
    : (sessAgentPlan && fs.existsSync(sessAgentPlan))
      ? sessAgentPlan
      : (fs.existsSync(rootAgentPlan) ? rootAgentPlan : null);

  // Build ctx with GateManager (Gap 1)
  // OXB-155: the per-task verify of execute honors --verify-timeout-ms > config verify_timeout_ms > 10 min (it was a
  // fixed 60 s: F2-T2's `npm run typecheck` timed out twice with verify_timeout_ms: 900000 in the config).
  // OXB-171: frozen tests that need files outside their task's scope — a failure on them stops at attempt 1.
  let execScopeGaps = {};
  try {
    const { doc: pj } = readPlanJsonDoc(projectRoot, activeSession);
    const cfgExec = (readProjectConfig(projectRoot) || {}).executor || {};
    if (pj && cfgExec.scope_insufficient !== 'retry') execScopeGaps = require('./oxe-test-scope.cjs').scopeGaps(projectRoot, pj);
  } catch { execScopeGaps = {}; }
  const execMaxRunMs = Number(options.maxRunMs) > 0
    ? Number(options.maxRunMs)
    : Number(((readProjectConfig(projectRoot) || {}).executor || {}).max_run_ms) > 0 ? Number(readProjectConfig(projectRoot).executor.max_run_ms) : Number.MAX_SAFE_INTEGER;
  const execVerifyTimeoutMs = Number(options.verifyTimeoutMs) > 0
    ? Number(options.verifyTimeoutMs)
    : Number(readProjectConfig(projectRoot).verify_timeout_ms) > 0 ? Number(readProjectConfig(projectRoot).verify_timeout_ms) : 600_000;
  const ctx = createExecutionContext(projectRoot, activeSession, {
    runId: current.run_id,
    executor,
    workspaceManager,
    pluginRegistry: options.pluginRegistry || buildRuntimePluginRegistry(projectRoot),
    // OXB-165: no run-level timeout by default (the scheduler's 30 min aborted at the first wave past it); the
    // stale-progress guard covers hangs. --max-run-ms > config executor.max_run_ms.
    schedulerOptions: { verifyTimeoutMs: execVerifyTimeoutMs, maxRunDurationMs: execMaxRunMs, outOfScopeRequirements: execScopeGaps, ...(options.schedulerOptions || {}) },
    // The scheduler already persists every event through the runtime bus (events/bus.ts →
    // appendEvent). This hook only forwards progress; writing here again duplicated the log.
    onEvent: (event) => {
      options.onProgress?.(event);
      // OXB-051: the output of every failed attempt goes to its own log (the journal kept only the state, not why).
      if (event && event.work_item_id && (event.type === 'RetryScheduled' || event.type === 'WorkItemBlocked') && event.payload && event.payload.output_tail) {
        try {
          const attempt = event.type === 'RetryScheduled' ? Number(event.payload.next_attempt) - 1 : Number(event.payload.max_attempts) || 'final';
          const logFile = path.join(projectRoot, '.oxe', 'runs', current.run_id, 'attempts', `${event.work_item_id}-${attempt}.log`);
          ensureDirForFile(logFile);
          // OXB-066: the retry text (failing segment only) plus every verify segment's output under its own header.
          const segmentsLog = event.payload.verify_log ? `\n\n--- verify: saída de cada segmento ---\n${event.payload.verify_log}` : '';
          fs.writeFileSync(logFile, `${event.payload.output_tail}${segmentsLog}\n`, 'utf8');
        } catch { /* log auxiliar */ }
      }
      // OXB-067/068: what each attempt touched outside the task's files. Snapshots when the task starts and when each
      // attempt starts; at the end of an attempt, any path changed outside the scope is a ScopeViolation (reported
      // whether the attempt passed or not). A verify_only / external_delivery task has an enforced EMPTY scope.
      const taskId = event && event.work_item_id;
      // OXB-050: with --parallel-mutating the mutating tasks run in worktrees and only in-scope files are integrated
      // (scope enforced by the integration); snapshots of the shared checkout would see other tasks' integrations.
      const inplaceRun = !parallelOptions && Boolean(runtime.InplaceWorkspaceManager && workspaceManager instanceof runtime.InplaceWorkspaceManager);
      let outsideNow = [];
      // OXB-159: each task's scratch dir (.oxe/tmp/<task>, named in the prompt); removed when the task passes.
      if (taskId && event.type === 'WorkItemReady') scratchLib.ensureScratchDir(projectRoot, taskId);
      if (taskId && inplaceRun && gitRepo) {
        try {
          if (event.type === 'WorkItemReady') {
            const snap = treeSnapshot(projectRoot);
            for (const f of interruptedWork.get(taskId) || []) snap.delete(f);
            taskBaseline.set(taskId, snap);
          }
          if (event.type === 'AttemptStarted') attemptBaseline.set(taskId, treeSnapshot(projectRoot));
          const attemptEnded = event.type === 'RetryScheduled' || event.type === 'WorkItemCompleted' || event.type === 'WorkItemBlocked';
          if (attemptEnded && taskBaseline.has(taskId)) {
            const scope = new Set(scopeOfTask(taskId));
            const base = event.type === 'RetryScheduled' ? attemptBaseline.get(taskId) || taskBaseline.get(taskId) : taskBaseline.get(taskId);
            outsideNow = changedSinceSnapshot(projectRoot, base).filter((p) => !scope.has(p));
            // OXB-159: scratch an attempt left in the repo root (*.log, *.tsbuildinfo, executor.scratch_ignore) is not
            // a scope violation; the files it created are removed.
            const split = scratchLib.splitScratch(projectRoot, outsideNow, taskBaseline.get(taskId), isScratchPath);
            outsideNow = split.outside;
            if (split.scratch.length) {
              appendEvent(projectRoot, activeSession, { type: 'ScratchIgnored', run_id: current.run_id, work_item_id: taskId, payload: { task: taskId, paths: split.scratch, removed: split.removed } });
            }
            if (outsideNow.length) {
              const all = new Set([...(scopeViolations.get(taskId) || []), ...outsideNow]);
              scopeViolations.set(taskId, [...all].sort());
              appendEvent(projectRoot, activeSession, {
                type: 'ScopeViolation',
                run_id: current.run_id,
                work_item_id: taskId,
                payload: { task: taskId, paths: outsideNow, outcome: event.type === 'WorkItemCompleted' ? 'passed' : 'failed', verify_only: isVerifyOnlyNode(taskId) },
              });
            }
          }
        } catch { /* rastreio de escopo nunca derruba a execução */ }
      }
      // OXB-051/067: a task that failed for good is isolated (inplace): its attempt is saved and restored — its files AND
      // anything it changed outside them that was clean before the task — so the next task does not run on top of it.
      // Files that were dirty before (this execute or the task) are never reverted; they are copied for review.
      if (taskId && event.type === 'WorkItemCompleted') scratchLib.removeScratchDir(projectRoot, taskId);
      const failedForGood = event && event.type === 'WorkItemBlocked' && event.payload && (event.payload.max_attempts != null || isVerifyOnlyNode(taskId));
      const verifyOnlyWrote = event && event.type === 'WorkItemCompleted' && isVerifyOnlyNode(taskId) && outsideNow.length > 0;
      if (isolateFailures && inplaceRun && taskId && (failedForGood || verifyOnlyWrote)) {
        try {
          const base = taskBaseline.get(taskId) || new Map();
          const outside = (scopeViolations.get(taskId) || []).filter((p) => !preDirty.has(p));
          const extraPaths = outside.filter((p) => !base.has(p));
          const dirtyBefore = outside.filter((p) => base.has(p));
          const scopeFor = isVerifyOnlyNode(taskId) ? { files: [] } : planTaskById.get(taskId);
          const iso = isolateFailedTask(projectRoot, current, taskId, { task: scopeFor, preDirty, inplace: inplaceRun, extraPaths, dirtyBefore, verifyOnly: isVerifyOnlyNode(taskId) });
          if (iso.files.length || iso.notRestored.length) {
            appendEvent(projectRoot, activeSession, { type: 'RollbackExecuted', run_id: current.run_id, work_item_id: taskId, payload: { reason: verifyOnlyWrote ? 'verify_only_wrote_files' : 'failed_attempt_isolated', files: iso.files, outside_scope: extraPaths, not_restored: iso.notRestored, saved_to: iso.savedTo } });
          }
        } catch { /* isolamento nunca derruba a execução */ }
      }
      if (event && event.type === 'WorkItemCompleted' && event.work_item_id) {
        let checkpoint = null;
        // OXB-167: with checkpoint commits on, a task is done only when its checkpoint exists and holds its scope's
        // changes (T4/T5 of oxe-run-mw83vtdy-8uzesq: done, done_commit null, the changes left staged in the tree).
        let checkpointFailure = null;
        // 1.20c: checkpoint de filesystem por tarefa concluída (opt-in), na convenção de commit do projeto (OXB-021).
        if (checkpointCommits) {
          try {
            const cp = commitTaskCheckpoint(projectRoot, current, event.work_item_id, { task: planTaskById.get(event.work_item_id), phase: phaseCtxForCommits.phase, baseline: taskBaseline.get(event.work_item_id) || null });
            if (cp.committed) {
              checkpoint = cp.commit;
              appendEvent(projectRoot, activeSession, { type: 'GateResolved', run_id: current.run_id, work_item_id: event.work_item_id, payload: { gate: 'checkpoint', commit: cp.commit, files: cp.files, leftover: cp.leftover } });
              if (cp.leftover && cp.leftover.length) {
                appendEvent(projectRoot, activeSession, { type: 'PolicyWarning', run_id: current.run_id, work_item_id: event.work_item_id, payload: { reason: 'checkpoint_incomplete', leftover: cp.leftover, commit: cp.commit } });
                checkpointFailure = { reason: `checkpoint incompleto: ${cp.leftover.length} arquivo(s) do escopo fora do commit (${cp.leftover.slice(0, 5).join(', ')})`, commit: cp.commit, leftover: cp.leftover };
              }
            } else if (!cp.failed) {
              // OXB-176: the attempt added nothing. Done only with an earlier checkpoint of this task (its work is
              // already committed); otherwise empty_checkpoint — never "completed with no commit" and on to the next.
              const earlier = findTaskCheckpoint(projectRoot, event.work_item_id, phaseCtxForCommits);
              const planTaskNow = planTaskById.get(event.work_item_id) || {};
              const scopeNow = (planTaskNow.files || []).map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*'));
              const dirtyNow = scopeNow.length ? changedPathsUnder(projectRoot, scopeNow) : [];
              if (!scopeNow.length || isVerifyOnlyNode(event.work_item_id) || planTaskNow.kind === 'external_delivery' || (planTaskNow.meta && ['external_delivery', 'spike'].includes(planTaskNow.meta.kind))) {
                // no file scope (verify-only / external / spike): nothing to commit, done as before
              } else if (earlier && !dirtyNow.length) {
                checkpoint = earlier;
                appendEvent(projectRoot, activeSession, { type: 'GateResolved', run_id: current.run_id, work_item_id: event.work_item_id, payload: { gate: 'checkpoint', commit: earlier, reused: true } });
              } else {
                checkpointFailure = {
                  kind: 'empty_checkpoint',
                  reason: dirtyNow.length
                    ? `empty_checkpoint: a tentativa não acrescentou diff, e as mudanças no escopo (${dirtyNow.slice(0, 6).join(', ')}) estavam na árvore antes dela sem serem atribuídas à tarefa — o próximo execute as atribui (restos da própria tarefa) e commita`
                    : 'empty_checkpoint: a tarefa completou sem nenhuma mudança e sem checkpoint anterior dela — confira se o trabalho já está na base (oxe-cc plan done Tn --commit <sha>) ou reabra',
                };
              }
            } else if (cp.failed) {
              checkpointFailure = { reason: cp.reason, ...(cp.snapshot ? { snapshot: cp.snapshot } : {}), ...(cp.kind ? { kind: cp.kind } : {}), ...(cp.related_red ? { related_red: cp.related_red } : {}) };
              if (cp.kind === 'scope_insufficient') appendEvent(projectRoot, activeSession, { type: 'ScopeInsufficient', run_id: current.run_id, work_item_id: event.work_item_id, payload: { task: event.work_item_id, reason: 'related_tests_outside_scope', tests: cp.related_red || [], at: 'checkpoint' } });
            }
          } catch (err) {
            checkpointFailure = { reason: `checkpoint falhou: ${err && err.message ? err.message : err}` };
          }
          if (checkpointFailure) {
            // OXB-175: the chain stops here — the next task would start with this task's work uncommitted in the tree.
            try { if (schedulerRef.current && typeof schedulerRef.current.cancel === 'function') schedulerRef.current.cancel(); } catch { /* */ }
            checkpointFailures.push({ task: event.work_item_id, ...checkpointFailure });
            appendEvent(projectRoot, activeSession, { type: 'CheckpointFailed', run_id: current.run_id, work_item_id: event.work_item_id, payload: { task: event.work_item_id, ...checkpointFailure } });
          }
        }
        // OXB-067: a passing task that also edited files outside its scope — never committed silently, never dropped.
        const outsideAtCompletion = scopeViolations.get(event.work_item_id) || [];
        if (outsideAtCompletion.length && !isVerifyOnlyNode(event.work_item_id)) {
          appendEvent(projectRoot, activeSession, { type: 'PolicyWarning', run_id: current.run_id, work_item_id: event.work_item_id, payload: { reason: 'checkpoint_incomplete', scope_violation: outsideAtCompletion, commit: checkpoint } });
        }
        // OXB-007: a spike's answer becomes an append-only decision the dossier shows.
        const planTask = planTaskById.get(event.work_item_id);
        if (planTask && planTask.meta && planTask.meta.kind === 'spike') {
          try {
            const decision = require('./oxe-spike.cjs').recordSpikeDecision(projectRoot, runPaths.programDir || path.join(projectRoot, '.oxe', 'program'), planTask);
            if (decision) appendEvent(projectRoot, activeSession, { type: 'GateResolved', run_id: current.run_id, work_item_id: event.work_item_id, payload: { gate: 'spike', decision: decision.id, answer: decision.title } });
          } catch { /* a decisão é auxiliar; o relatório do spike fica em .oxe/spikes/ */ }
        }
        // OXB-025: a tarefa concluída fica `done` no PLAN.json — o próximo compile não a paga de novo.
        // OXB-167: … unless its checkpoint failed: then `checkpoint_failed` (the next execute retries the commit first).
        try {
          if (checkpointFailure) require('./oxe-plan-json.cjs').markPlanTaskCheckpointFailed(runPaths.plan, event.work_item_id, { ...checkpointFailure, run_id: current.run_id, title: (planTaskById.get(event.work_item_id) || {}).title || null });
          else require('./oxe-plan-json.cjs').markPlanTaskDone(runPaths.plan, event.work_item_id, { commit: checkpoint });
        } catch { /* o done é auxiliar; o journal continua sendo a verdade da run */ }
        // OXB-151: --promote-each — the task enters the merge train at once, without waiting for the whole plan.
        if (options.promoteEach) {
          try { spawnPromote(projectRoot, activeSession, event.work_item_id, options.promoteEach, current.run_id); } catch { /* o promote é auxiliar */ }
        }
      }
    },
  });

  if (budgetLedger) ctx.budget = budgetLib.schedulerBudget(budgetLedger);

  // Gap 5: multi-agent path if plan-agents.json exists
  if (agentPlanPath) {
    let agentPlan;
    try {
      agentPlan = JSON.parse(fs.readFileSync(agentPlanPath, 'utf8'));
    } catch (err) {
      throw new Error(`plan-agents.json inválido: ${err.message}`);
    }
    const planErrors = validateMultiAgentPlan(agentPlan);
    if (planErrors.length > 0) {
      throw new Error(`plan-agents.json inválido: ${planErrors.join('; ')}`);
    }
    if (typeof runtime.MultiAgentCoordinator !== 'function') {
      throw new Error('Runtime não exporta MultiAgentCoordinator. Verifique a versão do runtime.');
    }
    if (typeof runtime.GitWorktreeManager !== 'function' && !options.workspaceManager) {
      throw new Error('Runtime não exporta GitWorktreeManager. Multi-agent real exige backend git_worktree.');
    }
    const agents = agentPlan.agents.map((spec) => ({
      id: spec.id,
      executor: options.executorFactory ? options.executorFactory(spec) : (options.executor || executor),
      workspaceManager: options.workspaceManager || new runtime.GitWorktreeManager(projectRoot),
      assignedTaskIds: Array.isArray(spec.tasks) ? spec.tasks : [],
    }));
    const coordinator = new runtime.MultiAgentCoordinator();
    const result = await coordinator.run(graph, {
      mode: agentPlan.mode || 'parallel',
      agents,
      projectRoot,
      sessionId: activeSession || null,
      runId: current.run_id,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 120000,
      applyWorkspaceMerges: true,
      onEvent: ctx.onEvent,
    });
      const syncedRun = syncRunStateAfterExecute(projectRoot, activeSession, current, result, agentPlan.mode || 'parallel');
      return { mode: agentPlan.mode || 'parallel', agentPlan, result, run: syncedRun, preflight };
    }

  // Single-agent fallback
  if (typeof runtime.Scheduler !== 'function') {
    throw new Error('Runtime não exporta Scheduler. Verifique a versão do runtime.');
  }
  const scheduler = new runtime.Scheduler();
  schedulerRef.current = scheduler;
  if (parallelOptions) ctx.parallel = parallelOptions;
  const result = await scheduler.run(graph, ctx);
  classifyBlockedResult(result, graph);
  if (checkpointFailures.length) {
    // OXB-167: fail loud — the task passed its verify but is NOT done: its work is not in a commit.
    result.checkpoint_failed = checkpointFailures;
    result.completed = (result.completed || []).filter((id) => !checkpointFailures.some((f) => f.task === id));
    if (['completed', 'completed_with_external_pending', 'cancelled'].includes(result.status)) result.status = 'checkpoint_failed';
    result.stopped_after_checkpoint_failure = true;
  }
  const syncedRun = syncRunStateAfterExecute(projectRoot, activeSession, current, result, 'single');
    return { mode: 'single', agentPlan: null, result, run: syncedRun, preflight, budget: budgetLedger };
  }

const EXECUTE_RESULT_STATUS = {
  completed: 'completed',
  // OXB-064: everything runnable done; external deliveries still pending (the run stays open for them).
  completed_with_external_pending: 'blocked',
  failed: 'failed',
  blocked: 'blocked',
  paused: 'paused',
  aborted: 'aborted',
  cancelled: 'aborted',
};

/**
 * Persist the outcome of Scheduler/Coordinator.run into ACTIVE-RUN and runs/<id>.json.
 * Without this the run stayed `planned` forever and every projection showed zero progress.
 */
function syncRunStateAfterExecute(projectRoot, activeSession, current, result, mode) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const mapped = EXECUTE_RESULT_STATUS[String(safeResult.status || '')] || 'running';
  const status = VALID_RUN_STATUSES.has(mapped) ? mapped : 'running';
  const completed = Array.isArray(safeResult.completed) ? safeResult.completed.map(String) : [];
  const failed = Array.isArray(safeResult.failed) ? safeResult.failed.map(String) : [];
  const blocked = Array.isArray(safeResult.blocked) ? safeResult.blocked.map(String) : [];
  const now = new Date().toISOString();
  const previousFailures = Array.isArray(current.failures) ? current.failures : [];
  const knownFailed = new Set(previousFailures.map((f) => f && (f.work_item_id || f.task_id)).filter(Boolean));
  const failures = [
    ...previousFailures,
    ...failed.filter((id) => !knownFailed.has(id)).map((id) => ({ work_item_id: id, reason: 'execute_failed', at: now })),
  ];
  // `failures` must be in the state handed to the reducer: the scheduler reports an exhausted
  // task as WorkItemBlocked, so the failed set comes from here, not from the event log.
  const base = { ...current, status, updated_at: now, failures, active_tasks: [] };
  const canonical = reduceCanonicalRunState(projectRoot, activeSession, { runState: base, runId: current.run_id })
    || current.canonical_state
    || null;
  return writeRunState(projectRoot, activeSession, {
    ...base,
    canonical_state: canonical,
    metrics: {
      ...(current.metrics && typeof current.metrics === 'object' ? current.metrics : {}),
      last_execute: {
        mode,
        status: safeResult.status || null,
        completed: completed.length,
        failed: failed.length,
        blocked: blocked.length,
        pending_gates: Array.isArray(safeResult.pending_gates) ? safeResult.pending_gates.length : 0,
        reason: safeResult.reason || null,
        finished_at: now,
      },
    },
  });
}

function readRuntimeMultiAgentStatus(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  const current = readRunState(projectRoot, activeSession);
  const runId = options.runId || (current && current.run_id) || null;
  if (!runId) {
    return {
      path: null,
      enabled: false,
      runId: null,
      mode: null,
      workspaceIsolationEnforced: false,
      agents: [],
      ownership: [],
      orphanReassignments: [],
      handoffs: [],
      arbitrationResults: [],
      workspaceMergeReport: null,
      worktrees: [],
      mergeBlockers: [],
      mergeReadiness: null,
      arbitrationRequired: false,
      health: 'unknown',
      nextAction: 'Execute ou compile uma run antes de inspecionar status multi-agent.',
      summary: null,
    };
  }
  const runDir = path.join(projectRoot, '.oxe', 'runs', runId);
  const statePath = path.join(runDir, 'multi-agent-state.json');
  const summaryPath = path.join(runDir, 'multi-agent-summary.json');
  const handoffsPath = path.join(runDir, 'handoffs.json');
  const arbitrationPath = path.join(runDir, 'arbitration-results.json');
  const workspaceMergePath = path.join(runDir, 'workspace-merge-report.json');
  const state = runtime && typeof runtime.loadMultiAgentState === 'function'
    ? runtime.loadMultiAgentState(projectRoot, runId)
    : readJsonIfExists(statePath);
  const summary = runtime && typeof runtime.loadMultiAgentSummary === 'function'
    ? runtime.loadMultiAgentSummary(projectRoot, runId)
    : readJsonIfExists(summaryPath);
  const workspaceMergeReport = runtime && typeof runtime.loadWorkspaceMergeReport === 'function'
    ? runtime.loadWorkspaceMergeReport(projectRoot, runId)
    : readJsonIfExists(workspaceMergePath);
  const handoffs = readJsonIfExists(handoffsPath);
  const arbitrationResults = readJsonIfExists(arbitrationPath);
  const mergeBlockers = workspaceMergeReport && Array.isArray(workspaceMergeReport.blockers) ? workspaceMergeReport.blockers : [];
  const mergeReadiness = workspaceMergeReport && workspaceMergeReport.merge_readiness ? workspaceMergeReport.merge_readiness : null;
  let nextAction = null;
  if (!state) {
    nextAction = 'Execute runtime com plan-agents.json válido para materializar o estado multi-agent.';
  } else if (mergeBlockers.length > 0) {
    nextAction = 'Resolva os merge blockers do workspace antes de promover ou aplicar novos resultados.';
  } else if (mergeReadiness === 'partial') {
    nextAction = 'Conclua verify/evidence pós-merge ou aplique os worktrees pendentes antes de fechar a run.';
  } else if (mergeReadiness === 'ready') {
    nextAction = 'Multi-agent merge pronto; avance para runtime verify ou promotion conforme o ciclo.';
  }
  return {
    path: statePath,
    enabled: Boolean(state),
    runId,
    mode: state && state.mode ? state.mode : null,
    workspaceIsolationEnforced: Boolean(state && state.workspace_isolation_enforced),
    agents: state && Array.isArray(state.agent_results) ? state.agent_results : [],
    ownership: state && Array.isArray(state.ownership) ? state.ownership : [],
    orphanReassignments: state && Array.isArray(state.orphan_reassignments) ? state.orphan_reassignments : [],
    handoffs: Array.isArray(handoffs) ? handoffs : [],
    arbitrationResults: Array.isArray(arbitrationResults) ? arbitrationResults : [],
    workspaceMergeReport: workspaceMergeReport || null,
    worktrees: workspaceMergeReport && Array.isArray(workspaceMergeReport.records) ? workspaceMergeReport.records : [],
    mergeBlockers,
    mergeReadiness,
    arbitrationRequired: Boolean(workspaceMergeReport && workspaceMergeReport.arbitration_required),
    health: summary && summary.health ? summary.health : (mergeBlockers.length > 0 ? 'degraded' : 'unknown'),
    nextAction,
    summary: summary || null,
  };
}

function validateMultiAgentPlan(agentPlan) {
  const errors = [];
  const allowedModes = new Set(['parallel', 'competitive', 'cooperative']);
  const mode = agentPlan && agentPlan.mode ? String(agentPlan.mode) : 'parallel';
  if (!allowedModes.has(mode)) errors.push(`mode inválido: ${mode}`);
  if (!Array.isArray(agentPlan && agentPlan.agents) || agentPlan.agents.length === 0) {
    errors.push('campo "agents" vazio ou ausente');
    return errors;
  }
  // Real files (schema + template) declare the version as `oxePlanAgentsSchema`.
  const schemaVersion = Number(agentPlan.oxePlanAgentsSchema || agentPlan.schema_version || agentPlan.schema || 0);
  const seen = new Set();
  for (const [idx, spec] of agentPlan.agents.entries()) {
    const id = spec && spec.id ? String(spec.id) : '';
    if (!id) errors.push(`agents[${idx}].id ausente`);
    if (id && seen.has(id)) errors.push(`agent duplicado: ${id}`);
    if (id) seen.add(id);
    if (schemaVersion >= 3 && !spec.persona) errors.push(`${id || `agents[${idx}]`}.persona ausente`);
    if (schemaVersion >= 3 && !spec.model_hint) errors.push(`${id || `agents[${idx}]`}.model_hint ausente`);
    if (spec.tasks != null && !Array.isArray(spec.tasks)) errors.push(`${id || `agents[${idx}]`}.tasks deve ser array`);
  }
  if ((mode === 'competitive' || mode === 'cooperative') && agentPlan.agents.length < 2) {
    errors.push(`${mode} exige pelo menos 2 agentes`);
  }
  return errors;
}

function loadRuntimeVerificationArtifacts(projectRoot, runState) {
  const runtime = loadRuntimeModule();
  if (!runtime || !runState || !runState.run_id) {
    return {
      manifest: null,
      residualRisks: null,
      evidenceCoverage: null,
    };
  }
  const manifest = runState.verification_manifest
    || (typeof runtime.loadManifest === 'function' ? runtime.loadManifest(projectRoot, runState.run_id) : null)
    || null;
  const residualRisks = runState.residual_risks
    || (typeof runtime.loadRiskLedger === 'function' ? runtime.loadRiskLedger(projectRoot, runState.run_id) : null)
    || null;
  const evidenceCoverage = runState.verification_evidence_coverage
    || (typeof runtime.loadEvidenceCoverage === 'function' ? runtime.loadEvidenceCoverage(projectRoot, runState.run_id) : null)
    || (manifest && typeof runtime.summarizeEvidenceCoverage === 'function'
      ? runtime.summarizeEvidenceCoverage(manifest)
      : null)
    || null;
  return { manifest, residualRisks, evidenceCoverage };
}

function countVerificationEvidenceRefs(runState, verificationArtifacts) {
  if (verificationArtifacts && verificationArtifacts.manifest && Array.isArray(verificationArtifacts.manifest.checks)) {
    return verificationArtifacts.manifest.checks.reduce((sum, check) => {
      return sum + (Array.isArray(check.evidence_refs) ? check.evidence_refs.length : 0);
    }, 0);
  }
  if (Array.isArray(runState && runState.verification_results)) {
    return runState.verification_results.reduce((sum, result) => {
      return sum + (Array.isArray(result.evidence_refs) ? result.evidence_refs.length : 0);
    }, 0);
  }
  return 0;
}

function detectOrphanWorktrees(projectRoot, runId) {
  const workspacesDir = path.join(projectRoot, '.oxe', 'workspaces');
  if (!fs.existsSync(workspacesDir)) return [];
  const active = new Set();
  const mergeReport = readJsonIfExists(path.join(projectRoot, '.oxe', 'runs', runId, 'workspace-merge-report.json'));
  for (const record of (mergeReport && Array.isArray(mergeReport.records) ? mergeReport.records : [])) {
    if (record && record.workspace_id) active.add(String(record.workspace_id));
  }
  return fs.readdirSync(workspacesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !active.has(name))
    .map((name) => ({
      workspace_id: name,
      path: path.join(workspacesDir, name),
      next_action: 'inspecione o worktree órfão; depois remova com git worktree remove --force se não houver diffs úteis',
    }));
}

function buildRuntimeModeStatus(runState) {
  if (!runState) {
    return {
      runtime_mode: 'legacy',
      fallback_mode: 'legacy',
      source: 'absent',
      reason: 'Nenhum ACTIVE-RUN encontrado para o escopo atual.',
      enterprise_available: false,
      fallback_recorded: true,
    };
  }
  const hasEnterpriseArtifacts = Boolean(
    runState.compiled_graph
      || runState.canonical_state
      || runState.verification_manifest
      || runState.verification_evidence_coverage
      || runState.delivery
      || runState.recovery_summary
  );
  return {
    runtime_mode: hasEnterpriseArtifacts ? 'enterprise' : 'legacy',
    fallback_mode: hasEnterpriseArtifacts ? 'none' : 'legacy',
    source: hasEnterpriseArtifacts ? 'canonical_state' : 'legacy_state',
    reason: hasEnterpriseArtifacts
      ? 'Run com artefatos canónicos do runtime enterprise persistidos.'
      : 'Run sem artefatos canónicos do runtime; fluxo degradado para legado.',
    enterprise_available: hasEnterpriseArtifacts,
    fallback_recorded: !hasEnterpriseArtifacts,
  };
}

function buildRuntimeProviderCatalog(projectRoot) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.PluginRegistry !== 'function') {
    return {
      available: false,
      plugin_dir: path.join(projectRoot, '.oxe', 'plugins'),
      loaded_capabilities: [],
      loaded_plugins: [],
      load_errors: ['Runtime package não está disponível. Rode npm run build:runtime.'],
      summary: null,
      matrix: null,
    };
  }
  const registry = new runtime.PluginRegistry();
  const pluginDir = path.join(projectRoot, '.oxe', 'plugins');
  const loadedCapabilities = typeof registry.registerProjectCapabilities === 'function'
    ? registry.registerProjectCapabilities(projectRoot)
    : [];
  const loadedPlugins = typeof registry.loadFromDirectory === 'function'
    ? registry.loadFromDirectory(pluginDir)
    : [];
  const loadErrors = typeof registry.loadErrorsSnapshot === 'function'
    ? registry.loadErrorsSnapshot()
    : [];
  const summary = typeof runtime.registrySummary === 'function'
    ? runtime.registrySummary(registry)
    : (typeof registry.summary === 'function' ? registry.summary() : null);
  const matrix = typeof runtime.resolveCapabilityMatrix === 'function'
    ? runtime.resolveCapabilityMatrix(registry)
    : (typeof registry.capabilityMatrix === 'function' ? registry.capabilityMatrix() : null);
  return {
    available: true,
    plugin_dir: pluginDir,
    loaded_capabilities: loadedCapabilities,
    loaded_plugins: loadedPlugins,
    load_errors: loadErrors,
    summary,
    matrix,
  };
}

function buildRecoveryConsistency(projectRoot, activeSession, runState, journal, verificationArtifacts) {
  const op = operationalPaths(projectRoot, activeSession);
  const activeRunRef = readJsonIfExists(op.activeRun);
  const runFile = runState && runState.run_id ? path.join(op.runsDir, `${runState.run_id}.json`) : null;
  const runDir = runState && runState.run_id ? path.join(projectRoot, '.oxe', 'runs', runState.run_id) : null;
  const allEvents = readEvents(projectRoot, activeSession);
  const runEvents = runState && runState.run_id ? allEvents.filter((event) => event.run_id === runState.run_id) : [];
  // Detect if execution has ever started (at least one attempt recorded)
  const attemptCount = runState && runState.canonical_state && runState.canonical_state.summary
    ? (runState.canonical_state.summary.attempt_count || 0)
    : 0;
  const executionStarted = attemptCount > 0;
  const issues = [];
  if (!activeRunRef || activeRunRef.run_id !== (runState && runState.run_id)) {
    issues.push('ACTIVE-RUN.json não referencia o mesmo run persistido em .oxe/runs/.');
  }
  if (!runFile || !fs.existsSync(runFile)) {
    issues.push('Arquivo canónico da run ausente em .oxe/runs/<run>.json.');
  }
  // Journal is only created after execution starts — skip this check pre-execution
  if (!journal && executionStarted) {
    issues.push('Journal ausente para recover/replay.');
  }
  // Events for this run only exist after execution — skip pre-execution
  if (runEvents.length === 0 && executionStarted) {
    issues.push('Nenhum evento NDJSON encontrado para a run ativa.');
  }
  if (!runState || !runState.canonical_state) {
    issues.push('canonical_state ausente no ACTIVE-RUN.');
  }
  const pendingGates = readRuntimeGates(projectRoot, activeSession, { runId: runState && runState.run_id ? runState.run_id : null });
  const policyDecisionPath = runState && runState.run_id ? path.join(projectRoot, '.oxe', 'runs', runState.run_id, 'policy-decisions.json') : null;
  const policyDecisions = policyDecisionPath && fs.existsSync(policyDecisionPath)
    ? (Array.isArray(readJsonIfExists(policyDecisionPath)) ? readJsonIfExists(policyDecisionPath) : [])
    : [];
  const promotionRecordPath = runDir ? path.join(runDir, 'promotion-record.json') : null;
  const promotionRecord = promotionRecordPath ? readJsonIfExists(promotionRecordPath) : null;
  const attempts = runState && runState.canonical_state && runState.canonical_state.attempts && typeof runState.canonical_state.attempts === 'object'
    ? runState.canonical_state.attempts
    : {};
  const incompleteAttempts = Object.entries(attempts)
    .flatMap(([workItemId, entries]) => Array.isArray(entries) ? entries.map((entry) => ({ workItemId, entry })) : [])
    .filter(({ entry }) => {
      const outcome = entry && typeof entry === 'object' ? String(entry.outcome || '') : '';
      return !outcome || outcome === 'running' || outcome === 'pending';
    });
  if (incompleteAttempts.length > 0) {
    issues.push(`${incompleteAttempts.length} tentativa(s) incompleta(s) ainda persistida(s) no estado canônico.`);
  }
  return {
    active_run_path: op.activeRun,
    run_file_path: runFile,
    run_dir: runDir,
    journal_path: runDir ? path.join(runDir, 'journal.json') : null,
    events_path: op.events,
    gates_path: op.gates,
    policy_decisions_path: policyDecisionPath,
    verification_manifest_path: runDir ? path.join(runDir, 'verification-manifest.json') : null,
    residual_risk_path: runDir ? path.join(runDir, 'residual-risk-ledger.json') : null,
    evidence_coverage_path: runDir ? path.join(runDir, 'evidence-coverage.json') : null,
    promotion_record_path: promotionRecordPath,
    run_id: runState && runState.run_id ? runState.run_id : null,
    active_run_synced: Boolean(activeRunRef && runState && activeRunRef.run_id === runState.run_id),
    run_file_exists: Boolean(runFile && fs.existsSync(runFile)),
    journal_exists: Boolean(journal),
    event_count: runEvents.length,
    issues,
    pending_gates_rehydrated: pendingGates.pending.length,
    policy_decisions_rehydrated: Array.isArray(policyDecisions) ? policyDecisions.length : 0,
    evidence_refs_tracked: countVerificationEvidenceRefs(runState, verificationArtifacts),
    verification_artifacts_present: Boolean(verificationArtifacts && verificationArtifacts.manifest),
    promotion_attempt_present: Boolean(promotionRecord),
    promotion_status: promotionRecord && promotionRecord.status ? promotionRecord.status : null,
    incomplete_attempts: incompleteAttempts.map(({ workItemId, entry }) => ({
      work_item_id: workItemId,
      attempt_id: entry && typeof entry === 'object' ? entry.attempt_id || null : null,
      outcome: entry && typeof entry === 'object' ? entry.outcome || null : null,
    })),
  };
}

function writeRecoverySummaryMarkdown(projectRoot, activeSession, runState, recoverySummary) {
  const op = operationalPaths(projectRoot, activeSession);
  const summaryPath = path.join(op.executionRoot, 'RECOVERY-SUMMARY.md');
  const lines = [
    '# OXE — Recovery Summary',
    '',
    `- **Data:** ${new Date().toISOString()}`,
    `- **Run:** ${runState && runState.run_id ? runState.run_id : '—'}`,
    `- **Estado pós-recover:** ${runState && runState.status ? runState.status : '—'}`,
    `- **Journal:** ${recoverySummary.journal_state || '—'}`,
    `- **Pending gates reidratados:** ${recoverySummary.consistency && recoverySummary.consistency.pending_gates_rehydrated != null ? recoverySummary.consistency.pending_gates_rehydrated : 0}`,
    `- **Policy decisions reidratadas:** ${recoverySummary.consistency && recoverySummary.consistency.policy_decisions_rehydrated != null ? recoverySummary.consistency.policy_decisions_rehydrated : 0}`,
    `- **Evidence refs rastreados:** ${recoverySummary.consistency && recoverySummary.consistency.evidence_refs_tracked != null ? recoverySummary.consistency.evidence_refs_tracked : 0}`,
    `- **Promotion attempt:** ${recoverySummary.consistency && recoverySummary.consistency.promotion_status ? recoverySummary.consistency.promotion_status : '—'}`,
    '',
    '## Work items órfãos',
    '',
    ...(Array.isArray(recoverySummary.orphan_work_items) && recoverySummary.orphan_work_items.length
      ? recoverySummary.orphan_work_items.map((item) => `- ${item}`)
      : ['- Nenhum']),
    '',
    '## Worktrees órfãos',
    '',
    ...(Array.isArray(recoverySummary.orphan_worktrees) && recoverySummary.orphan_worktrees.length
      ? recoverySummary.orphan_worktrees.map((item) => `- ${item.workspace_id} · ${item.next_action}`)
      : ['- Nenhum']),
    '',
    '## Tentativas incompletas',
    '',
    ...(recoverySummary.consistency && Array.isArray(recoverySummary.consistency.incomplete_attempts) && recoverySummary.consistency.incomplete_attempts.length
      ? recoverySummary.consistency.incomplete_attempts.map((item) => `- ${item.work_item_id} · ${item.attempt_id || 'attempt'} · ${item.outcome || 'unknown'}`)
      : ['- Nenhuma']),
    '',
    '## Consistência',
    '',
    ...(recoverySummary.consistency && Array.isArray(recoverySummary.consistency.issues) && recoverySummary.consistency.issues.length
      ? recoverySummary.consistency.issues.map((issue) => `- ${issue}`)
      : ['- Sem inconsistências críticas detectadas.']),
  ];
  ensureDirForFile(summaryPath);
  fs.writeFileSync(summaryPath, lines.join('\n') + '\n', 'utf8');
  return summaryPath;
}

/** 1.21.1 (OXB-042): the project's env policy for every child process of this execute/verify. */
function applyChildEnvPolicy(projectRoot) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.configureChildEnv !== 'function') return;
  const cfg = readProjectConfig(projectRoot);
  runtime.configureChildEnv({
    // OXB-118: `{ kind: "env", strip: "OXESPACE_" }` policy rules strip the prefix from every child process.
    scrub: [...(Array.isArray(cfg.env_scrub) ? cfg.env_scrub : []), ...require('./oxe-policy-rules.cjs').envStripPatterns(cfg.policy_rules)],
    allow: Array.isArray(cfg.env_allow) ? cfg.env_allow : [],
  });
}

async function runRuntimeVerify(projectRoot, activeSession, options = {}) {
  applyChildEnvPolicy(projectRoot);
  const runtime = loadRuntimeModule();
  const parsers = loadSdkParsers();
  if (!runtime || typeof runtime.verifyRun !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  if (!parsers) {
    throw new Error('Parsers do SDK indisponíveis para executar verification suite.');
  }
  let current = options.runState || readRunState(projectRoot, activeSession);
  if (current && isClosedPhaseRun(projectRoot, activeSession, current.run_id)) {
    current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: {} }).run;
  }
  if (!current) {
    current = compileExecutionGraphFromArtifacts(projectRoot, activeSession).run;
  }
  if (!current.verification_suite) {
    current = compileVerificationSuiteFromArtifacts(projectRoot, activeSession, { runState: current }).run;
  }
  const artifactPaths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const specText = readTextIfExists(artifactPaths.spec);
  const planText = readTextIfExists(artifactPaths.plan);
  if (!specText || !planText) {
    throw new Error('SPEC.md e PLAN.md são obrigatórios para runtime verify.');
  }
  const parsedPlan = attachAcceptanceLock(
    attachImplementationPackContracts(parsePlanArtifact(parsers, planText, artifactPaths.plan), artifactPaths.implementationPack),
    current,
    projectRoot,
  );
  // OXB-069: only the active phase's criteria (the rest is one "not planned yet" line).
  const phaseScope = scopeSpecToActivePhase(artifactPaths, parsers.parseSpec(specText), parsedPlan);
  const parsedSpec = phaseScope.spec;
  // A suíte persistida no compile fica velha se SPEC/PLAN mudarem depois: recompila pelo hash.
  const freshSuite = runtime.compileVerification(parsedSpec, parsedPlan, options.compilerOptions || {});
  const persistedSuite = current.verification_suite;
  const suiteStale = Boolean(persistedSuite)
    && (persistedSuite.spec_hash !== freshSuite.spec_hash || persistedSuite.plan_hash !== freshSuite.plan_hash);
  const suite = persistedSuite && !suiteStale ? persistedSuite : freshSuite;
  if (suiteStale) {
    appendEvent(projectRoot, activeSession, {
      type: 'VerificationSuiteRecompiled',
      run_id: current.run_id,
      payload: {
        reason: 'source_hash_changed',
        previous: { spec_hash: persistedSuite.spec_hash || null, plan_hash: persistedSuite.plan_hash || null },
        current: { spec_hash: freshSuite.spec_hash, plan_hash: freshSuite.plan_hash },
        total_checks: Array.isArray(freshSuite.checks) ? freshSuite.checks.length : 0,
      },
    });
  }
  // Programa por fases: a suíte da fase N carrega a regressão congelada das fases fechadas antes.
  const programLib = require('./oxe-program.cjs');
  const programState = artifactPaths.programDir ? programLib.readProgram(artifactPaths.programDir) : null;
  const programPhaseId = programState ? (programState.active_phase || null) : null;
  const regressionChecks = programState && options.regression !== false
    ? programLib.loadRegressionChecks(artifactPaths.programDir, programState, programPhaseId)
    : [];
  // 1.21 (OXB-020): the project's own gates (typecheck, lint, governance suite, CI) run once per phase verify.
  const gatesLib = require('./oxe-phase-gates.cjs');
  const projectConfig = readProjectConfig(projectRoot);
  const phaseGates = options.gates === false ? [] : [...gatesLib.readPhaseGates({ phase_gates: parsedPlan.phaseGates }, projectConfig), ...implicitPhaseGates(projectRoot, programState, programPhaseId, projectConfig)];
  const gateCheckList = gatesLib.gateChecks(phaseGates, 'phase_verify', {
    programDir: artifactPaths.programDir || path.join(projectRoot, '.oxe', 'program'),
    phase: programPhaseId,
    defaultRunner: projectConfig.phase_gates_runner || null,
  });
  const runSuite = regressionChecks.length || gateCheckList.length
    ? { ...suite, checks: [...(suite.checks || []).filter((check) => !check.regression_phase && !check.phase_gate), ...regressionChecks, ...gateCheckList] }
    : suite;
  touchProgramPhase(projectRoot, activeSession, 'verifying', { run_id: current.run_id || null });
  const registry = buildRuntimePluginRegistry(projectRoot);
  const evidenceStore = new runtime.EvidenceStore(projectRoot);
  const targetWorkItem = options.workItemId
    || options.task
    || (current.cursor && current.cursor.task)
    || (Array.isArray(current.active_tasks) && current.active_tasks[0])
    || 'run';
  appendEvent(projectRoot, activeSession, {
    type: 'VerificationStarted',
    run_id: current.run_id,
    work_item_id: targetWorkItem,
    payload: {
      total_checks: Array.isArray(runSuite.checks) ? runSuite.checks.length : 0,
      regression_checks: regressionChecks.length,
    },
  });
  const report = await runtime.verifyRun({
    projectRoot,
    runId: current.run_id,
    workItemId: String(targetWorkItem),
    cwd: options.cwd || projectRoot,
    suite: runSuite,
    pluginRegistry: registry || undefined,
    evidenceStore,
    attemptNumber: options.attemptNumber || 1,
    // OXB-072: --timeout-ms > config verify_timeout_ms > 10 min. The runtime's 60 s default timed out Electron suites.
    timeoutMs: options.timeoutMs || (Number(projectConfig.verify_timeout_ms) > 0 ? Number(projectConfig.verify_timeout_ms) : 600_000),
  });
  // A passing re-verify of a fully executed run restores `completed` (a previous failed verify
  // must not leave it stuck in `running`).
  const graphNodes = current.compiled_graph && current.compiled_graph.nodes
    ? Object.keys(current.compiled_graph.nodes).length
    : 0;
  const doneNodes = current.canonical_state && Array.isArray(current.canonical_state.completedWorkItems)
    ? current.canonical_state.completedWorkItems.length
    : 0;
  // OXB-079: `completed_with_external_pending` (OXB-064) is a finished execute too — `=== 'completed'` sent a passed
  // verify back to `running`, and program close then said "verify não concluído (status: running)".
  // The execute stores `completed_with_external_pending` as `blocked`: the plan's work (PLAN.json, OXB-059) decides.
  let planWorkComplete = false;
  try { planWorkComplete = runtimePhaseWork(projectRoot, activeSession).complete; } catch { planWorkComplete = false; }
  const executionDone = /^completed/.test(String(current.status || '')) || (graphNodes > 0 && doneNodes >= graphNodes) || planWorkComplete;
  const nextStatus = report.status === 'passed'
    ? executionDone ? 'completed' : 'running'
    : report.status === 'failed'
      ? 'failed'
      : 'blocked';
  if (phaseScope.outOfPhase) {
    report.gaps = [...(report.gaps || []), `Fora da fase ${programPhaseId}: ${phaseScope.outOfPhase.count} critério(s) de ${describePhaseRange(phaseScope.outOfPhase.phases)} ainda não planejados — não verificados nesta fase`];
  }
  const regressionSummary = summarizeRegression(regressionChecks, report.check_results);
  // 1.20b: um CR aberto fecha só com evidência — o teste congelado que o declara em `resolves` ficou verde.
  try {
    const changeLib = require('./oxe-change.cjs');
    if (artifactPaths.programDir) {
      // OXB-078: the gates the plan/config declare now (read even with --no-gates), so an orphaned gate CR closes.
      const declaredGates = [...gatesLib.readPhaseGates({ phase_gates: parsedPlan.phaseGates }, projectConfig), ...implicitPhaseGates(projectRoot, programState, programPhaseId, projectConfig)].map((g) => g.id);
      const reconciled = changeLib.reconcileChanges(artifactPaths.programDir, programPhaseId, parsedPlan, report.check_results, { declaredGates });
      for (const id of reconciled.resolved) appendEvent(projectRoot, activeSession, { type: 'ChangeResolved', run_id: current.run_id, payload: { id } });
    }
  } catch { /* reconciliação é auxiliar ao verify */ }
  // A red project gate becomes a CR with its output (one open CR per gate; it closes when the gate goes green).
  const gateSummary = summarizeGates(gateCheckList, report.check_results);
  if (gateSummary.failed.length) {
    try {
      const recorded = gatesLib.recordGateFailures({
        programDir: artifactPaths.programDir || path.join(projectRoot, '.oxe', 'program'),
        program: programState,
        plan: parsedPlan,
        checkResults: report.check_results,
      });
      gateSummary.changes = recorded.created.map((cr) => cr.id);
      for (const cr of recorded.created) {
        appendEvent(projectRoot, activeSession, { type: 'ChangeRequested', run_id: current.run_id, payload: { id: cr.id, class: cr.class, phase: cr.phase, criteria: [], gate: cr.gate, by: cr.by } });
      }
    } catch { /* o CR é auxiliar; o gate vermelho já reprova o verify */ }
  }
  // OXB-118: the project's ACTION rules (kind command / path) checked against what this run's executor recorded.
  // A violation becomes a constraint CR naming the rule and the command/path (one open CR per rule + action).
  try {
    const policy = require('./oxe-policy-rules.cjs');
    const rules = projectConfig.policy_rules;
    if (Array.isArray(rules) && rules.length && artifactPaths.programDir) {
      const events = readNdjsonQuiet(operationalPaths(projectRoot, activeSession).events);
      const violations = policy.checkActionRules(rules, policy.actionsFromEvents(events, current.run_id));
      if (violations.length) {
        const changeLib = require('./oxe-change.cjs');
        const open = changeLib.listChanges(artifactPaths.programDir).filter((cr) => cr.status === 'open' && /^policy_rule:/.test(String(cr.by || '')));
        for (const v of violations) {
          const by = `policy_rule:${v.rule}`;
          if (open.some((cr) => cr.by === by && String(cr.evidence || '').includes(v.what))) continue;
          const out = changeLib.recordChange({
            programDir: artifactPaths.programDir, program: programState, plan: parsedPlan,
            class: 'constraint',
            summary: `regra do projeto '${v.rule}' violada${v.task ? ` em ${v.task}` : ''}: ${v.kind === 'command' ? 'comando' : v.kind === 'path_read' ? 'leitura de' : 'escrita em'} ${v.what.slice(0, 120)}`,
            by,
            evidence: `${v.kind}: ${v.what}\nregra: ${v.message}`,
          });
          open.push(out.cr);
          appendEvent(projectRoot, activeSession, { type: 'ChangeRequested', run_id: current.run_id, payload: { id: out.cr.id, class: 'constraint', phase: out.cr.phase, criteria: [], by } });
        }
      }
    }
  } catch { /* the policy check is auxiliary to the verify */ }
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    status: nextStatus,
    verification_suite: suite,
    verification_results: report.verification_results,
    verification_check_results: report.check_results,
    verification_manifest: report.manifest,
    residual_risks: report.risk_ledger,
    verification_evidence_coverage: report.evidence_coverage,
    verification_gaps: report.gaps,
    // OXB-079: the verify's own outcome, apart from the run status (which stays `running` while a graph node — an
    // external delivery still pending, say — is not completed). The phase close reads this.
    verification_status: report.status,
    verified_at: new Date().toISOString(),
    verification_regression: regressionSummary,
    verification_gates: gateSummary,
  });
  appendEvent(projectRoot, activeSession, {
    type: 'VerificationCompleted',
    run_id: next.run_id,
    work_item_id: targetWorkItem,
    payload: {
      status: report.status,
      total_checks: report.manifest && report.manifest.summary ? report.manifest.summary.total : 0,
      fail: report.manifest && report.manifest.summary ? report.manifest.summary.fail : 0,
      error: report.manifest && report.manifest.summary ? report.manifest.summary.error : 0,
      gaps: report.gaps,
      regression: regressionSummary,
      gates: gateSummary,
      // OXB-006: the evidence says which toolchain produced it.
      toolchain: { node: process.versions.node, platform: process.platform, arch: process.arch },
    },
  });
  const projected = projectRuntimeArtifacts(projectRoot, activeSession, { runState: next, write: true });
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  return {
    run: projected.run,
    report,
    regression: regressionSummary,
    gates: gateSummary,
    projected,
  };
}

/**
 * Gate reasons for `program close` (1.21): every `phase_verify` gate green in the run's last verify, and every
 * `program_close` gate (CI, slow suites) green now. Red close gates open their CR like the verify ones.
 */
function programCloseGateReasons(projectRoot, activeSession, ctx) {
  const out = { reasons: [], results: [] };
  if (ctx.skip) return out;
  const gatesLib = require('./oxe-phase-gates.cjs');
  const config = readProjectConfig(projectRoot);
  const parsers = loadSdkParsers();
  const planText = readTextIfExists(ctx.paths.plan);
  let plan = null;
  try {
    plan = parsers && planText ? parsePlanArtifact(parsers, planText, ctx.paths.plan) : null;
  } catch {
    plan = null;
  }
  const gates = gatesLib.readPhaseGates({ phase_gates: plan && plan.phaseGates }, config);
  // OXB-078: a CR of a gate no longer declared is withdrawn before the close counts open CRs.
  try {
    const orphanDir = ctx.paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const withdrawn = require('./oxe-change.cjs').reconcileChanges(orphanDir, ctx.phase.id, plan, [], { declaredGates: gates.map((g) => g.id) });
    for (const id of withdrawn.resolved) appendEvent(projectRoot, activeSession, { type: 'ChangeResolved', run_id: ctx.run && ctx.run.run_id, payload: { id, reason: 'gate_removed' } });
  } catch { /* auxiliar */ }
  if (!gates.length) return out;
  const verifyGates = gates.filter((g) => g.when === 'phase_verify');
  const ran = (ctx.run && ctx.run.verification_gates) || null;
  for (const g of verifyGates) {
    if (!ran || !(ran.passed || []).includes(g.id)) {
      out.reasons.push(ran && (ran.failed || []).includes(g.id)
        ? `gate do projeto vermelho no último verify: ${g.id}`
        : `gate do projeto não rodou no verify da fase: ${g.id} (rode oxe-cc runtime verify)`);
    }
  }
  const programDir = ctx.paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const checks = gatesLib.gateChecks(gates, 'program_close', { programDir, phase: ctx.phase.id, defaultRunner: config.phase_gates_runner || null });
  for (const check of checks) {
    // Same env policy as every runtime child (OXB-042): no node:test context, no live-app tokens or secrets.
    applyChildEnvPolicy(projectRoot);
    const rt = loadRuntimeModule();
    const gateEnv = rt && typeof rt.childProcessEnv === 'function'
      ? rt.childProcessEnv(process.env)
      : (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();
    const res = spawnSync(check.command, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: check.timeout_ms, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: gateEnv });
    const result = { check_id: check.id, status: res.status === 0 ? 'pass' : 'fail', stdout: res.stdout || '', stderr: res.stderr || '', error: res.error ? String(res.error) : null };
    out.results.push(result);
    if (result.status !== 'pass') out.reasons.push(`gate do projeto vermelho no close: ${check.phase_gate} — ${gatesLib.firstErrorLines(result, 3).split(/\r?\n/).join(' · ') || 'sem saída'}`);
  }
  if (out.results.some((r) => r.status === 'pass')) {
    try {
      const reconciled = require('./oxe-change.cjs').reconcileChanges(programDir, ctx.phase.id, plan, out.results);
      for (const id of reconciled.resolved) appendEvent(projectRoot, activeSession, { type: 'ChangeResolved', run_id: ctx.run && ctx.run.run_id, payload: { id } });
    } catch { /* auxiliar */ }
  }
  if (out.results.some((r) => r.status !== 'pass')) {
    try {
      const recorded = gatesLib.recordGateFailures({ programDir, program: ctx.state, plan, checkResults: out.results });
      for (const cr of recorded.created) appendEvent(projectRoot, activeSession, { type: 'ChangeRequested', run_id: ctx.run && ctx.run.run_id, payload: { id: cr.id, class: cr.class, phase: cr.phase, criteria: [], gate: cr.gate, by: cr.by } });
    } catch { /* o close já está bloqueado pelo gate */ }
  }
  return out;
}

/** `oxe-cc runtime scorecard [--write]` (1.21): maturity metrics from the project's own records. */
function runtimeScorecard(projectRoot, activeSession, options = {}) {
  const card = require('./oxe-scorecard.cjs').scorecardForProject(projectRoot, () => readEvents(projectRoot, activeSession), { since: options.since || null });
  if (options.write) {
    const file = path.join(projectRoot, '.oxe', 'release', 'scorecard-report.json');
    ensureDirForFile(file);
    fs.writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`, 'utf8');
    card.path = file;
  }
  // The release report of the OXE package: one result per real project (upsert by name).
  if (options.releaseReport) {
    const file = path.resolve(options.releaseReport);
    const name = options.name || path.basename(path.resolve(projectRoot));
    const doc = readJsonQuiet(file) || { schema_version: 1, results: [] };
    if (!Array.isArray(doc.results)) doc.results = [];
    doc.results = doc.results.filter((r) => r && r.name !== name);
    doc.results.push({ name, ok: card.ok, project_root: path.resolve(projectRoot), report: card });
    doc.generated_at = new Date().toISOString();
    doc.oxe_version = readJsonQuiet(path.join(__dirname, '..', '..', 'package.json')).version;
    ensureDirForFile(file);
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    card.release_report = file;
  }
  return card;
}

/** `oxe-cc runtime ci --attach <run|url>` (1.21): ties a CI run to the active phase for `kind: ci` gates. */
function runtimeCiAttach(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const program = programLib.readProgram(programDir);
  const phase = options.phase || (program && program.active_phase) || null;
  return require('./oxe-phase-gates.cjs').attachCiRun(programDir, { run: options.run, repo: options.repo, head: options.head, phase });
}

/**
 * OXB-093: `oxe-cc runtime deploy --attach <env> --version <v> --ref <tag|url> [--check "<cmd>"]… [--phase Fn]`.
 * Records the deploy as evidence of the phase and runs the post-deploy checks (each with exit, id and time). Never
 * deploys. A `phase_gates` entry `{ kind: "deploy", env, version?, checks? }` makes the close require it.
 */
function runtimeDeployAttach(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const program = programLib.readProgram(programDir);
  const phase = options.phase || (program && program.active_phase) || null;
  applyChildEnvPolicy(projectRoot);
  const rt = loadRuntimeModule();
  const envVars = rt && typeof rt.childProcessEnv === 'function' ? rt.childProcessEnv(process.env) : { ...process.env };
  const record = require('./oxe-phase-gates.cjs').attachDeploy(programDir, { env: options.env, version: options.version, ref: options.ref, phase, by: options.by || null, checks: options.checks || [], cwd: projectRoot, spawn: options.spawn, env_vars: envVars });
  appendEvent(projectRoot, activeSession, { type: 'DeployAttached', payload: { phase, env: record.env, version: record.version, ref: record.ref, ok: record.ok, checks: record.checks.map((c) => ({ id: c.id, ok: c.ok, exit: c.exit })) } });
  return record;
}

/** Pass/fail of the phase gates in one verify (1.21). */
function summarizeGates(gateChecks, checkResults) {
  const byId = new Map((checkResults || []).map((r) => [r.check_id, r]));
  const summary = { total: gateChecks.length, passed: [], failed: [], changes: [] };
  for (const check of gateChecks) {
    const result = byId.get(check.id);
    if (result && result.status === 'pass') summary.passed.push(check.phase_gate);
    else summary.failed.push(check.phase_gate);
  }
  return summary;
}


/**
 * Testes de aceite do plano: hash congelado no compile do grafo. O verify compara com este lock,
 * então uma edição feita durante a execução (por qualquer ferramenta) reprova como adulterada.
 */
function freezeAcceptanceTests(projectRoot, parsedPlan) {
  const tests = parsedPlan && Array.isArray(parsedPlan.acceptanceTests) ? parsedPlan.acceptanceTests : [];
  if (!tests.length) return null;
  const runtime = loadRuntimeModule();
  const hash = (rel) => (runtime && typeof runtime.sha256File === 'function' ? runtime.sha256File(path.resolve(projectRoot, rel)) : null);
  return {
    frozen_at: new Date().toISOString(),
    tests: tests.map((entry) => ({
      id: entry.id || null,
      criterion: entry.criterion,
      command: entry.command,
      files: entry.files.map((file) => ({ path: file, sha256: hash(file) })),
    })),
  };
}

/** Anexa ao plano os testes de aceite com os hashes do lock da run (ou o hash atual, sem lock). */
function attachAcceptanceLock(parsedPlan, runState, projectRoot) {
  if (!parsedPlan || !Array.isArray(parsedPlan.acceptanceTests) || !parsedPlan.acceptanceTests.length) return parsedPlan;
  const lock = runState && runState.acceptance_lock && Array.isArray(runState.acceptance_lock.tests)
    ? runState.acceptance_lock
    : freezeAcceptanceTests(projectRoot, parsedPlan);
  // OXB-071: the lock is looked up by FILE. Keyed by id/criterion, two tests of the same criterion without an id
  // collapsed (A8 ×2), and a test the plan gained after the run's first compile (a CR's test, a plan edit + recompile)
  // was "acceptance_not_frozen … (não existia no compile)" although it is in PLAN.json acceptance_tests.
  const hashes = new Map();
  for (const t of lock.tests) for (const f of t.files || []) if (f && f.path && !hashes.has(f.path)) hashes.set(f.path, f.sha256);
  const runtime = loadRuntimeModule();
  const lateFrozen = [];
  for (const entry of parsedPlan.acceptanceTests) {
    for (const file of entry.files || []) {
      if (hashes.has(file)) continue;
      // Declared by the current plan but unknown to this run's lock: frozen NOW (later edits count as tampering).
      const sha = runtime && typeof runtime.sha256File === 'function' ? runtime.sha256File(path.resolve(projectRoot, file)) : null;
      hashes.set(file, sha);
      if (sha) lateFrozen.push({ id: entry.id || null, criterion: entry.criterion, command: entry.command, files: [{ path: file, sha256: sha }], late_frozen_at: new Date().toISOString() });
    }
  }
  if (lateFrozen.length && runState && runState.acceptance_lock && Array.isArray(runState.acceptance_lock.tests)) {
    runState.acceptance_lock = { ...runState.acceptance_lock, tests: [...runState.acceptance_lock.tests, ...lateFrozen] };
  }
  parsedPlan.acceptanceTests = parsedPlan.acceptanceTests.map((entry) => ({
    id: entry.id || null,
    criterion: entry.criterion,
    command: entry.command,
    files: entry.files.map((file) => ({ path: file, sha256: hashes.has(file) ? hashes.get(file) : null })),
    proves: Array.isArray(entry.proves) ? entry.proves : [],
    // OXB-019: o lock reconstrói a entrada — sem estes campos o CR nunca fechava e a emenda nunca era vista.
    resolves: Array.isArray(entry.resolves) ? entry.resolves : [],
    version: Number.isInteger(entry.version) ? entry.version : 1,
    ...(entry.timeout_ms ? { timeout_ms: entry.timeout_ms } : {}),
  }));
  return parsedPlan;
}

/** Arquivos que o executor não pode escrever: aceite do plano atual + aceite congelado das fases fechadas. */
function readProtectedAcceptancePaths(projectRoot, activeSession) {
  const out = new Set();
  try {
    const parsers = loadSdkParsers();
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const plan = parsers ? parsePlanArtifact(parsers, readTextIfExists(paths.plan) || '', paths.plan) : null;
    for (const entry of (plan && plan.acceptanceTests) || []) for (const file of entry.files) out.add(file);
    const programLib = require('./oxe-program.cjs');
    const state = paths.programDir ? programLib.readProgram(paths.programDir) : null;
    for (const check of state ? programLib.loadRegressionChecks(paths.programDir, state, state.active_phase) : []) {
      for (const file of check.frozen_files || []) out.add(file.path);
    }
  } catch {
    // proteção é best-effort; o hash do verify continua valendo
  }
  return [...out];
}

/** PLAN.json canônico (1.19) quando existir ao lado do PLAN.md; senão o parser markdown. */
function parsePlanArtifact(parsers, planText, planPath) {
  // OXB-049: a reference anchor with action copy becomes part of its task's verify (copy matches the source).
  const plan = require('./oxe-anchor-copy.cjs').attachAnchorCopyChecks(require('./oxe-plan-json.cjs').readPlanArtifact(planPath, planText, parsers.parsePlan), planPath);
  // OXB-094: a task's vitest segments with the same runner + flags run as one process (same meaning: all must pass).
  return require('./oxe-vitest-batch.cjs').batchPlanVerifies(plan);
}

/**
 * `oxe-cc plan lint`: schema do PLAN.json + regras estruturais (ids, dependências, escopo por onda,
 * cobertura de A*, pack para tarefas mutáveis, A* restritos à fase ativa do programa).
 */
function runtimePlanLint(projectRoot, activeSession, options = {}) {
  const planJson = require('./oxe-plan-json.cjs');
  const parsers = loadSdkParsers();
  if (!parsers) throw new Error('Parsers do SDK indisponíveis.');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const planText = readTextIfExists(paths.plan);
  const jsonPath = planJson.planJsonPathFor(paths.plan);
  const hasJson = Boolean(jsonPath && fs.existsSync(jsonPath));
  if (!planText && !hasJson) throw new Error(`PLAN ausente em ${paths.plan}`);
  let plan;
  try {
    plan = planJson.readPlanArtifact(paths.plan, planText, parsers.parsePlan);
  } catch (err) {
    return { ok: false, errors: [err.message], warnings: [], source: hasJson ? 'PLAN.json' : 'PLAN.md', tasks: 0, phase: null };
  }
  // OXB-049: copy anchors join the task's verify (the dry-verify runs the effective command); unusable ones warn.
  const anchorCopy = require('./oxe-anchor-copy.cjs');
  anchorCopy.attachAnchorCopyChecks(plan, paths.plan);
  // OXB-088: the removal checks of the pack join the task's verify (the dry-verify runs the effective command).
  attachImplementationPackContracts(plan, paths.implementationPack);
  const anchorWarnings = anchorCopy.lintCopyAnchors(readTextIfExists(path.join(path.dirname(paths.plan), 'REFERENCE-ANCHORS.md')) || '', plan.tasks.map((t) => t.id));
  const specText = readTextIfExists(paths.spec);
  const spec = specText ? parsers.parseSpec(specText) : null;
  const pack = readJsonQuiet(paths.implementationPack);
  const programLib = require('./oxe-program.cjs');
  const program = paths.programDir ? programLib.readProgram(paths.programDir) : null;
  const phase = program && program.active_phase
    ? program.phases.find((p) => p.id === program.active_phase) || null
    : null;
  const config = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json')) || {};
  const maxTasksPerWave = Number(options.maxTasksPerWave || config.plan_max_tasks_per_wave || 0) || 0;
  // OXB-090: the plan of the active phase answers only for amendments of ITS criteria. F2's lint failed on 14 v2
  // amendments (CR-21..32) of criteria of F1 (closed), F3, F8, F9, F11 …: their tests are written when their phase is
  // planned. Without a program, every amendment counts (as before).
  let amendments = paths.programDir ? require('./oxe-change.cjs').amendmentRequirements(paths.programDir) : new Map();
  if (phase && Array.isArray(phase.acceptance) && phase.acceptance.length) {
    const critIds = require('./oxe-criteria-ids.cjs');
    const own = new Set(phase.acceptance);
    amendments = new Map([...amendments].filter(([criterion]) => critIds.inPhase(criterion, own) && !critIds.isGlobal(criterion) || own.has(criterion)));
  }
  const result = planJson.lintPlan({
    plan, spec, pack, phase, maxTasksPerWave, projectRoot,
    standing: require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot),
    amendments,
    requireAcceptanceTests: Boolean(options.requireAcceptanceTests || config.acceptance_tests_required),
  });
  if (spec) result.warnings.push(...lintPlanForCommonPitfalls(plan, spec, projectRoot, specText));
  // OXB-048: task_gates shape; a task touching a suite rule's paths without that suite.
  try {
    const rawPlan = JSON.parse(fs.readFileSync(require('./oxe-plan-json.cjs').planJsonPathFor(paths.plan), 'utf8'));
    const gateLint = require('./oxe-task-gates.cjs').lintTaskGates(rawPlan, config);
    result.errors.push(...gateLint.errors);
    result.warnings.push(...gateLint.warnings);
    if (gateLint.errors.length) result.ok = false;
  } catch { /* sem PLAN.json: nada a checar */ }
  // OXB-053/046: when each criterion's check runs, and the planner error of putting a criterion-wide acceptance test
  // in the verify of a task that does not complete the criterion (it can only fail there).
  {
    const closers = planJson.criterionClosers(plan.tasks);
    const acceptanceCommands = new Map();
    for (const a of plan.acceptanceTests || []) if (a.criterion && a.command) acceptanceCommands.set(a.command.trim(), a.criterion);
    for (const [criterion, info] of closers) {
      if (info.tasks.length < 2) continue;
      result.warnings.push(info.closer
        ? `${criterion}: a verificação do critério roda só em ${info.closer} (a última das ${info.tasks.length} tarefas dele); nas outras, só o verify próprio`
        : `${criterion}: ${info.sinks.join(', ')} terminam o critério em paralelo — a verificação dele roda no verify da fase`);
    }
    for (const task of plan.tasks) {
      if (task.done || !task.verifyCommand) continue;
      for (const [command, criterion] of acceptanceCommands) {
        const info = closers.get(criterion);
        if (task.verifyCommand.includes(command) && info && info.tasks.length > 1 && info.closer !== task.id) {
          // A warning, not an error: an already-green criterion test can be a legitimate regression check here; the
          // --dry-verify still fails the plan when it is red for the wrong reason.
          result.warnings.push(`${task.id}: o verify roda o teste de aceite de ${criterion} (${command}), mas ${task.id} não completa o critério — se ele depende de ${info.closer || 'todas as tarefas do critério'}, só pode falhar aqui. Prefira um teste da própria tarefa (OXB-046).`);
        }
      }
    }
    result.ok = result.errors.length === 0;
  }
  // OXB-030: a criterion's verifiable terms (status codes, `code`, "literals") must be exercised by its frozen test.
  // Strict (error) when the project requires acceptance tests; a warning otherwise.
  if (spec) {
    const uncovered = require('./oxe-criterion-coverage.cjs').uncoveredCriterionTerms({ spec, plan, projectRoot });
    (config.acceptance_tests_required || options.requireAcceptanceTests ? result.errors : result.warnings).push(...uncovered);
    result.ok = result.errors.length === 0;
  }
  result.warnings.push(...anchorWarnings);
  // OXB-147: a verify that would change node_modules / git, or a sentence instead of a command, is a structural error.
  {
    const unsafe = require('./oxe-unsafe-commands.cjs');
    const split = require('./oxe-vitest-batch.cjs').splitSegments;
    for (const task of plan.tasks || []) {
      if (task.done || !task.verifyCommand) continue;
      result.errors.push(...unsafe.verifyCommandProblems(task.id, task.verifyCommand, split));
    }
    for (const at of plan.acceptanceTests || []) result.errors.push(...unsafe.verifyCommandProblems(`teste de aceite ${at.criterion || at.id || '?'}`, at.command, split));
    // OXB-154: a whole-project compile (gradle/maven/tsc without file args) shared by several pending tasks: every task's
    // frozen tests compile together, so one task cannot go green while another's symbols are missing.
    {
      const coupled = new Map();
      for (const task of plan.tasks || []) {
        if (task.done) continue;
        for (const seg of String(task.verifyCommand || '').split('&&').map((x) => x.trim())) {
          if (/\b(gradlew(\.bat)?|gradle|mvnw?(\.cmd)?)\b/.test(seg) || /\btsc\b(?![^&|]*\.(ts|tsx)\b)/.test(seg)) {
            const key = seg.replace(/--tests\s+\S+/g, '').replace(/\s+/g, ' ');
            if (!coupled.has(key)) coupled.set(key, []);
            coupled.get(key).push(task.id);
          }
        }
      }
      for (const [cmd, ids] of coupled) {
        if (ids.length > 1) result.warnings.push(`acoplamento de compilação: ${ids.join(', ')} compilam juntos em \`${cmd.slice(0, 80)}\` — os testes congelados de uma tarefa não compilam enquanto faltarem os símbolos das outras; commite antes um esqueleto (stubs com TODO) dos symbols do pack`);
      }
    }
    // OXB-152: on Windows a `./script.sh` verify needs a .cmd/.bat sibling (gradlew/mvnw are mapped automatically).
    if (process.platform === 'win32' || options.platform === 'win32') {
      for (const task of plan.tasks || []) {
        for (const seg of String(task.verifyCommand || '').split('&&').map((x) => x.trim())) {
          const m = /^(?:\.\/)?((?:[\w.@-]+\/)*[\w.@-]+)\.sh\b/.exec(seg);
          if (!m) continue;
          const base = path.resolve(projectRoot, m[1]);
          if (!fs.existsSync(`${base}.cmd`) && !fs.existsSync(`${base}.bat`)) result.warnings.push(`${task.id}: ${m[1]}.sh não roda no cmd do Windows e não há ${m[1].replace(/\//g, '\\')}.cmd/.bat — use um script node/npm ou crie o .cmd`);
        }
      }
    }
  }
  // OXB-118: rules that look guarded but are only text.
  try {
    const pol = require('./oxe-policy-rules.cjs').summary(config.policy_rules);
    if (pol.advisory.length) result.warnings.push(`policy_rule_advisory: ${pol.advisory.length} de ${pol.total} regra(s) do projeto são só texto, nada as checa (${pol.advisory.slice(0, 3).map((r) => `"${r.text.slice(0, 50)}"`).join('; ')}${pol.advisory.length > 3 ? '…' : ''}) — converta para { id, kind: "command", deny } / { kind: "path", deny_read|deny_write } / { kind: "env", strip } / { id, forbid } (oxe-cc policy list)`);
    for (const r of pol.invalid) result.errors.push(`policy_rules: ${r.id} — ${r.problem}`);
  } catch { /* auxiliar */ }
  // OXB-038: phase criteria the SPEC does not declare, and input documents reusing the SPEC's A ids.
  try {
    const programState = paths.programDir ? require('./oxe-program.cjs').readProgram(paths.programDir) : null;
    const activeOnly = programState && programState.active_phase ? { ...programState, phases: programState.phases.filter((p) => p.id === programState.active_phase) } : null;
    if (activeOnly) result.warnings.push(...roadmapCriteriaWarnings(specText || '', activeOnly));
    result.warnings.push(...specInputCollisions(projectRoot, specText || ''));
  } catch { /* aviso auxiliar */ }
  // 1.21 (OXB-020): a repo with gate scripts or governance tests but no phase_gates gets a warning.
  const gatesLib = require('./oxe-phase-gates.cjs');
  result.warnings.push(...gatesLib.lintPhaseGates(projectRoot, gatesLib.readPhaseGates({ phase_gates: plan.phaseGates }, config)));
  let dryVerify = null;
  // OXB-021: checkpoint messages follow the project's commit convention.
  result.errors.push(...require('./oxe-commit-convention.cjs').lintCommitConvention(plan, config));
  // OXB-028: the execute preflight's execution-rationality gaps (anchors, fixture pack, pack coverage, visual inputs)
  // are lint errors too — a greenfield plan without REFERENCE-ANCHORS/FIXTURE-PACK passed lint and blocked execute.
  try {
    const health = require('./oxe-project-health.cjs');
    const p = health.oxePaths(projectRoot);
    const rationality = require('./oxe-rationality.cjs').buildExecutionRationality({
      plan: paths.plan || p.plan,
      planAgents: p.planAgents,
      implementationPackJson: paths.implementationPack || p.implementationPackJson,
      implementationPackMd: p.implementationPackMd,
      referenceAnchors: p.referenceAnchors,
      fixturePackJson: p.fixturePackJson,
      fixturePackMd: p.fixturePackMd,
      spec: paths.spec || p.spec,
      visualInputsJson: p.visualInputsJson,
      visualInputsMd: p.visualInputsMd,
    });
    // OXB-041: the preflight blocks on these whenever it applies (a PLAN.md exists), pack or not — so lint does too.
    // (Before, without an IMPLEMENTATION-PACK they were warnings: lint said "ok" and execute refused.)
    const target = rationality.applicable || pack ? result.errors : result.warnings;
    for (const gap of rationality.criticalExecutionGaps || []) {
      if (!result.errors.includes(gap) && !result.warnings.includes(gap)) target.push(`preflight: ${gap}`);
    }
  } catch { /* a racionalidade é do preflight; o lint só antecipa */ }
  // OXB-041/044: "lint ok" means "execute will not refuse". The same preflight the execute runs, in dry mode, with
  // every blocker listed at once (self-evaluation rubric and confidence_vector included).
  if (options.preflight !== false && config.plan_lint_preflight !== false) {
    if (!planText) {
      result.errors.push(`preflight: PLAN.md ausente — o runtime execute recusa sem ele (ele traz a autoavaliação); gere-o no /oxe-plan junto com o PLAN.json`);
    }
    try {
      const pre = buildRuntimeExecutePreflight(projectRoot, activeSession, readRunState(projectRoot, activeSession), { nativeCheck: false });
      for (const blocker of pre.blockers) {
        if (/^execution_rationality:/.test(blocker)) continue; // listed in full above
        if (/^pending_gates:/.test(blocker)) { result.warnings.push(`preflight: ${blocker} (gates humanos pendentes no run atual — o execute para neles)`); continue; }
        result.errors.push(`preflight: ${blocker}`);
      }
    } catch { /* o preflight nunca derruba o lint */ }
  }
  // OXB-089: the dry-verify runs LAST, and only when the structural checks pass — 78 structural errors (acceptance
  // files in a task's scope, two tasks writing one file, tasks missing from the pack) came out after 97 minutes of
  // dry-verify. --dry-verify-anyway runs it regardless.
  const structuralErrors = result.errors.length;
  if (options.dryVerify && structuralErrors && !options.dryVerifyAnyway) {
    result.dry_verify_skipped = `${structuralErrors} erro(s) estrutura(is); dry-verify não rodou (corrija-os ou use --dry-verify-anyway)`;
    result.warnings.push(result.dry_verify_skipped);
    if (typeof options.onProgress === 'function') options.onProgress(`dry-verify: não rodou — ${result.dry_verify_skipped}`);
  }
  if (options.dryVerify && (!structuralErrors || options.dryVerifyAnyway)) {
    // OXB-063: a dependency whose PR is already merged no longer counts as pending (same check as the compile).
    if (config.external_dependency_check !== false && options.externalCheck !== false) {
      try { resolveMergedDependencies(plan, options.ghSpawn); } catch { /* sem gh: a dependência continua pendente */ }
    }
    resolvePreconditions(projectRoot, plan, { ghSpawn: options.ghSpawn, prCheck: config.external_dependency_check !== false && options.externalCheck !== false });
    // OXB-009: cada verify deve estar vermelho pelo motivo certo (alvo ausente), não por comando quebrado.
    // OXB-018: roda o comando EFETIVO do nó — o da tarefa mais o "Como verificar" dos critérios dela, que o compile
    // anexa (gap B). Um "Como verificar" velho na SPEC quebrava o verify inline sem o dry-run perceber.
    const criteriaById = new Map(((spec && spec.criteria) || []).map((c) => [c.id, c]));
    const closersForDry = planJson.criterionClosers(plan.tasks);
    const effective = {
      ...plan,
      tasks: plan.tasks.map((task) => {
        const extra = [];
        for (const ref of task.aceite || []) {
          const closing = closersForDry.get(ref);
          if (closing && closing.closer !== task.id) continue; // OXB-053: only the closing task runs the criterion check
          const criterion = criteriaById.get(ref);
          for (const span of criterion ? extractBacktickSpans(criterion.howToVerify || '') : []) {
            if (looksLikeShellCommand(span) && !(task.verifyCommand || '').includes(span) && !extra.includes(span)) extra.push(span);
          }
        }
        if (!extra.length) return task;
        return { ...task, verifyCommand: [task.verifyCommand, ...extra].filter(Boolean).join(' && ') };
      }),
    };
    // OXB-084: progress per command, a resume cache keyed by the tree, and --only / --changed.
    const cacheDir = paths.programDir ? path.dirname(paths.programDir) : path.join(projectRoot, '.oxe');
    dryVerify = require('./oxe-verify-dryrun.cjs').dryRunVerifyCommands(projectRoot, effective, {
      timeoutMs: options.dryVerifyTimeoutMs,
      onProgress: options.onProgress,
      cachePath: options.dryVerifyCache === false ? null : path.join(cacheDir, 'cache', 'dry-verify.json'),
      resume: Boolean(options.resume),
      only: options.only,
      changed: Boolean(options.changed),
      depsCheck: true,
      // OXB-095: config parallel.max / min_free_mb (OXB-050) bound the concurrent dry-verify commands.
      parallel: (() => { const pc = require('./oxe-parallel.cjs').parallelConfig(projectRoot, { maxParallel: options.dryVerifyParallel }); return { max: pc.maxParallel, minFreeMb: pc.minFreeMb }; })(),
    });
    result.errors.push(...dryVerify.errors);
    result.warnings.push(...dryVerify.warnings);
    // OXB-025: a pending task whose verify already passes AND that has a checkpoint is finished work the run
    // would pay for again — an error with the fix, not a warning.
    for (const entry of dryVerify.results || []) {
      if (entry.verdict !== 'already_green') continue;
      const sha = findTaskCheckpoint(projectRoot, entry.task);
      if (sha) result.errors.push(`${entry.task}: já tem checkpoint ${sha.slice(0, 8)} e o verify passa — marque "done": true (oxe-cc plan done ${entry.task}); senão o execute paga a tarefa de novo`);
    }
    result.ok = result.errors.length === 0;
  }
  // OXB-169: a task committed BEFORE a task it depends on — the promote stacks by plan order and its cherry-pick
  // conflicts; promote them together (--tasks) in commit order.
  try {
    const { doc: pj } = readPlanJsonDoc(projectRoot, activeSession);
    const done = new Map(((pj && pj.tasks) || []).filter((t) => t && t.done && t.done_commit).map((t) => [t.id, t]));
    for (const t of done.values()) {
      for (const dep of t.depends_on || []) {
        const d = done.get(dep);
        if (!d || d.done_commit === t.done_commit) continue;
        if (gitRun(projectRoot, ['merge-base', '--is-ancestor', t.done_commit, d.done_commit]).ok) {
          result.warnings.push(`${t.id} depende de ${dep}, mas o commit de ${t.id} (${String(t.done_commit).slice(0, 8)}) veio antes do de ${dep} (${String(d.done_commit).slice(0, 8)}) — o promote encadeado pode conflitar; promova junto: oxe-cc runtime promote --tasks ${dep},${t.id}`);
        }
      }
    }
  } catch { /* auxiliar */ }
  // OXB-173: ids are positional; a pending task whose title changed since the run compiled it was renumbered — the
  // run's attempts, interrupted work and checkpoint snapshots are keyed by id.
  try {
    const rs = readRunState(projectRoot, activeSession);
    const nodes = rs && rs.compiled_graph && rs.compiled_graph.nodes;
    const titles = {};
    for (const n of nodes ? (Array.isArray(nodes) ? nodes : Object.values(nodes)) : []) if (n && n.id) titles[n.id] = n.title || '';
    const { doc: pj0 } = readPlanJsonDoc(projectRoot, activeSession);
    for (const t of (pj0 && pj0.tasks) || []) {
      if (!t || t.done || titles[t.id] == null) continue;
      if (String(titles[t.id]).trim().toLowerCase() !== String(t.title || '').trim().toLowerCase()) {
        const moved = Object.entries(titles).find(([, ti]) => String(ti).trim().toLowerCase() === String(t.title || '').trim().toLowerCase());
        result.warnings.push(`${t.id}: o título mudou desde a run ${rs.run_id} ("${titles[t.id]}" → "${t.title}")${moved ? `; "${t.title}" era ${moved[0]}` : ''} — ids renumerados: tentativas, trabalho interrompido e snapshots são por id. Prefira ids estáveis (acrescente tarefas no fim, ex.: T${(pj0.tasks || []).length + 1}); o execute atribui o trabalho interrompido pelo título`);
      }
    }
  } catch { /* auxiliar */ }
  // OXB-111: adversarial review of the plan (--review): PLAN-REVIEW.md, one verdict per dimension; FAIL blocks.
  if (options.review || options.reviewWaive) {
    try {
      const reviewLib = require('./oxe-plan-review.cjs');
      if (options.reviewWaive) {
        reviewLib.waive(projectRoot, String(options.reviewWaive), { reason: options.reason, by: options.by });
      }
      const { doc: pjv } = readPlanJsonDoc(projectRoot, activeSession);
      if (pjv) {
        const paths0 = resolveRuntimeArtifactPaths(projectRoot, activeSession);
        const programDir0 = paths0.programDir || path.join(projectRoot, '.oxe', 'program');
        let program0 = null;
        try { program0 = require('./oxe-program.cjs').readProgram(programDir0); } catch { program0 = null; }
        const phase0 = program0 && program0.active_phase ? (program0.phases || []).find((p) => p.id === program0.active_phase) : null;
        const rev = reviewLib.review(projectRoot, pjv, {
          phase: phase0 ? phase0.id : (pjv.phase || null),
          phaseCriteria: phase0 ? phase0.acceptance || [] : [],
          standing: require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot),
          pack: readJsonQuiet(paths0.implementationPack),
          decisions: readNdjsonQuiet(path.join(programDir0, 'decisions.ndjson')).filter((d) => d && d.kind === 'decision'),
        });
        const written = reviewLib.writeReview(projectRoot, rev);
        const waived = new Set((written.waivers || []).map((w) => w.dimension));
        for (const d of reviewLib.DIMENSIONS) {
          for (const f of rev.dimensions[d].findings) {
            const line = `revisão do plano · ${reviewLib.LABEL[d]}: ${f.text}`;
            if (f.level === 'FAIL' && !waived.has(d)) result.errors.push(`${line} (dispense com plan lint --review --waive ${d} --by <papel> --reason "…")`);
            else result.warnings.push(line);
          }
        }
        result.review = { file: '.oxe/PLAN-REVIEW.md', plan_hash: rev.plan_hash, verdicts: Object.fromEntries(reviewLib.DIMENSIONS.map((d) => [d, rev.dimensions[d].verdict])), waivers: written.waivers };
      }
    } catch (err) { result.errors.push(`revisão do plano: ${err && err.message ? err.message : err}`); }
  }
  // OXB-109: rigor of the frozen tests — a test that only reads product source as text needs a declared exception;
  // --mutation samples mutants of the files each done task's test imports (temporary worktree at HEAD).
  try {
    const { doc: pjr } = readPlanJsonDoc(projectRoot, activeSession);
    if (pjr) {
      const rigor = require('./oxe-test-rigor.cjs');
      const cfgLint = (readProjectConfig(projectRoot) || {}).lint || {};
      const findings = rigor.sourceAssertionFindings(projectRoot, pjr);
      (cfgLint.test_rigor === 'error' ? result.errors : result.warnings).push(...rigor.rigorMessages(findings));
      result.test_rigor = { source_assertions: findings };
      if (options.mutation) {
        const report = rigor.mutationSample(projectRoot, pjr, { max: options.mutationMax });
        result.test_rigor.mutation = report;
        result.warnings.push(...rigor.mutationMessages(report));
      }
    }
  } catch { /* auxiliar */ }
  // OXB-171: the product files a task's frozen tests import/read must be in its scope (or a dependency's); T8 of F2
  // retried 3× a test on shared/types/ipc.ts that was outside its files. config lint.test_scope: "error" makes it fatal.
  try {
    const { doc: pj } = readPlanJsonDoc(projectRoot, activeSession);
    if (pj) {
      const testScope = require('./oxe-test-scope.cjs');
      const msgs = testScope.scopeGapMessages(testScope.scopeGaps(projectRoot, pj));
      const cfgLint = (readProjectConfig(projectRoot) || {}).lint || {};
      (cfgLint.test_scope === 'error' ? result.errors : result.warnings).push(...msgs);
    }
  } catch { /* auxiliar */ }
  result.ok = result.errors.length === 0;
  return { ...result, source: plan.source, tasks: plan.tasks.length, phase: phase ? phase.id : null, plan_json: hasJson ? jsonPath : null, dry_verify: dryVerify ? dryVerify.results : null };
}

// ─── Dossiê vivo verificado + STATE projetado (1.20) ─────────────────────────

function gitLines(projectRoot, args) {
  const res = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return res.status === 0 ? String(res.stdout || '').split(/\r?\n/).filter(Boolean) : null;
}

/** Arquivos tocados desde a base da fase: commits (`diff --name-status base`) + working tree (inclui não rastreados). */
function phaseChanges(projectRoot, base) {
  const changes = new Map();
  if (base) {
    // OXB-077: files that arrived by MERGING the base (runtime sync --from origin/main, a hand merge) are not the
    // phase's work. Only paths touched by a non-merge commit of the phase's own (first-parent) history count; without
    // merges in the range this is the plain diff, as before.
    const merges = gitLines(projectRoot, ['rev-list', '--merges', '--first-parent', `${base}..HEAD`]) || [];
    let own = null;
    if (merges.length) {
      own = new Set(gitLines(projectRoot, ['log', '--first-parent', '--no-merges', '--relative', '--name-only', '--format=', `${base}..HEAD`, '--', '.']) || []);
    }
    // --relative: paths relative to the project directory, only under it (a project inside a bigger repository).
    for (const line of gitLines(projectRoot, ['diff', '--relative', '--name-status', base, 'HEAD']) || []) {
      const [status, ...rest] = line.split('\t');
      const file = rest[rest.length - 1];
      if (own && !own.has(file)) continue;
      changes.set(file, status.charAt(0));
    }
  }
  for (const change of workingTreeChanges(projectRoot)) {
    if (!changes.has(change.path)) changes.set(change.path, change.status);
  }
  return [...changes.entries()].map(([file, status]) => ({ path: file.replace(/\\/g, '/'), status }));
}

function resolvePhaseBase(projectRoot, phase, explicit) {
  if (explicit) return explicit;
  if (phase && phase.base_commit) return phase.base_commit;
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    const mb = gitLines(projectRoot, ['merge-base', 'HEAD', ref]);
    if (mb && mb[0]) return mb[0];
  }
  return null;
}

function readNdjsonQuiet(file) {
  const text = readTextIfExists(file);
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * `oxe-cc runtime dossier`: projeta `.oxe/dossier/<fase>/` e devolve os problemas que bloqueiam o fechamento
 * (drift de arquitetura, prova não executada, aceite alterado), os pendentes (sign-off UAT) e se o handoff foi escrito.
 */
function runtimeDossier(projectRoot, activeSession, options = {}) {
  const dossierLib = require('./oxe-dossier.cjs');
  const programLib = require('./oxe-program.cjs');
  const parsers = loadSdkParsers();
  if (!parsers) throw new Error('Parsers do SDK indisponíveis.');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const program = paths.programDir ? programLib.readProgram(paths.programDir) : null;
  const phaseId = options.phase || (program && program.active_phase) || null;
  const phase = program && phaseId ? program.phases.find((p) => p.id === phaseId) || null : null;
  const run = options.runState || readRunState(projectRoot, activeSession) || {};
  const planText = readTextIfExists(paths.plan) || '';
  const plan = attachAcceptanceLock(parsePlanArtifact(parsers, planText, paths.plan), run, projectRoot);
  const events = readEvents(projectRoot, activeSession).filter((e) => !run.run_id || e.run_id === run.run_id);
  const base = resolvePhaseBase(projectRoot, phase, options.base);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const built = dossierLib.buildDossier({
    phase,
    specText: readTextIfExists(paths.spec) || '',
    plan,
    pack: readJsonQuiet(paths.implementationPack),
    run,
    events,
    changes: phaseChanges(projectRoot, base),
    // OXB-080: frozen tests parked for later phases (config `parked_tests`, default tests/acceptance/**) and the phase's
    // audited drift waivers (`program close --accept-drift <glob> --by --reason`).
    parkedGlobs: (() => {
      const cfg = readProjectConfig(projectRoot) || {};
      return Array.isArray(cfg.parked_tests) ? cfg.parked_tests.map(String) : ['tests/acceptance/**'];
    })(),
    waivedGlobs: readNdjsonQuiet(path.join(programDir, 'changes.ndjson'))
      .filter((r) => r && r.kind === 'drift_waiver' && (!phaseId || r.phase === phaseId))
      .flatMap((r) => r.globs || []),
    hashFile: (rel) => { const rt = loadRuntimeModule(); return rt && typeof rt.sha256File === 'function' ? rt.sha256File(path.resolve(projectRoot, rel)) : null; },
    decisions: readNdjsonQuiet(path.join(programDir, 'decisions.ndjson')),
    notes: readNdjsonQuiet(path.join(programDir, 'notes.ndjson')).filter((n) => !phaseId || !n.phase || n.phase === phaseId),
    signoffs: readNdjsonQuiet(path.join(programDir, 'signoffs.ndjson')).filter((s) => !phaseId || s.phase === phaseId),
    deploys: readNdjsonQuiet(path.join(programDir, 'deploy.ndjson')).filter((d) => !phaseId || !d.phase || d.phase === phaseId),
  });
  // Gatekeeper: regras do projeto (config.json policy_rules) sobre os arquivos tocados na fase.
  const changeLib = require('./oxe-change.cjs');
  const touchedFiles = phaseChanges(projectRoot, base).map((c) => c.path).filter((p) => !p.startsWith('.oxe/'));
  for (const v of changeLib.checkPolicyRules(projectRoot, readProjectConfig(projectRoot).policy_rules, touchedFiles)) {
    built.issues.push(`policy_violation: ${v.rule} em ${v.file} — ${v.message}`);
  }
  const openChanges = changeLib.listChanges(programDir).filter((cr) => cr.status === 'open' && cr.class !== 'new_scope' && (!phaseId || !cr.phase || cr.phase === phaseId));
  for (const cr of openChanges) built.issues.push(`change_open: ${cr.id} (${cr.class}) ${cr.summary}`);
  const dir = path.join(path.dirname(paths.plan || path.join(projectRoot, '.oxe', 'PLAN.md')), 'dossier', phaseId || 'run');
  let handoffFilled = false;
  if (options.write !== false) {
    for (const [name, content] of Object.entries(built.files)) {
      const written = dossierLib.writeDossierFile(path.join(dir, name), content, { withHandoff: name === 'plan.md' });
      if (name === 'plan.md') handoffFilled = dossierLib.handoffFilled(dossierLib.humanPart(written));
    }
  } else {
    handoffFilled = dossierLib.handoffFilled(dossierLib.humanPart(readTextIfExists(path.join(dir, 'plan.md')) || ''));
  }
  try {
    projectStateMd(projectRoot, activeSession);
  } catch {
    // STATE é projeção auxiliar; nunca falha o dossiê.
  }
  return { dir, phase: phaseId, base, issues: built.issues, pending: built.pending, untouched: built.untouched, handoff_filled: handoffFilled, totals: built.totals };
}

const STATE_PHASE_BY_STATUS = { pending: 'spec_ready', planning: 'spec_ready', executing: 'executing', verifying: 'executing', closed: 'verify_complete', reopened: 'executing' };

/** STATE.md como projeção (fase, programa, run, próximo passo, bloqueios); o texto humano fora dos marcadores fica. */
function projectStateMd(projectRoot, activeSession) {
  const dossierLib = require('./oxe-dossier.cjs');
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const statePath = paths.state || path.join(projectRoot, '.oxe', 'STATE.md');
  if (!fs.existsSync(path.dirname(statePath))) return null;
  const program = paths.programDir ? programLib.readProgram(paths.programDir) : null;
  const run = readRunState(projectRoot, activeSession) || {};
  let phaseLabel = 'initial';
  let programLine = '_(sem programa)_';
  if (program) {
    const runtime = loadRuntimeModule();
    const progress = runtime && typeof runtime.programProgress === 'function' ? runtime.programProgress(program) : null;
    const phase = progress && progress.phase;
    if (phase) phaseLabel = run.status === 'failed' ? 'verify_failed' : run.status === 'completed' && phase.status === 'verifying' ? 'verify_complete' : (STATE_PHASE_BY_STATUS[phase.status] || 'executing');
    else phaseLabel = 'verify_complete';
    programLine = program.phases.map((p) => `${p.status === 'closed' ? '✓' : p.id === program.active_phase ? '▶' : '·'} ${p.id} ${p.title} (${p.status})`).join(' · ');
  } else if (run.status) {
    phaseLabel = run.status === 'completed' ? 'verify_complete' : run.status === 'failed' ? 'verify_failed' : 'executing';
  }
  let next = null;
  try {
    const health = require('./oxe-project-health.cjs');
    next = health.suggestNextStep(projectRoot, {});
  } catch {
    next = null;
  }
  const checks = Array.isArray(run.verification_check_results) ? run.verification_check_results : [];
  const failing = checks.filter((c) => c.status === 'fail' || c.status === 'error').map((c) => `${c.check_id}: ${c.error || c.status}`);
  const manual = checks.filter((c) => c.status === 'skip' && c.skip_reason === 'needs_structured_check').map((c) => `${c.check_id}: UAT/sign-off pendente`);
  const block = [
    '# OXE — Estado (projeção)',
    '',
    '## Fase atual',
    '',
    `\`${phaseLabel}\``,
    '',
    '## Sessão ativa (opcional — `/oxe-session`)',
    '',
    `- **active_session:** ${activeSession || '—'}`,
    '',
    '## Programa',
    '',
    programLine,
    '',
    '## Run',
    '',
    `- **run:** \`${run.run_id || '—'}\` · **status:** ${run.status || '—'} · checks ${checks.filter((c) => c.status === 'pass').length}/${checks.length} verdes`,
    '',
    '## Próximo passo sugerido',
    '',
    next ? `- Comando: \`${next.cursorCmd || next.step}\`\n- Motivo: ${next.reason}` : '- —',
    '',
    '## Bloqueios',
    '',
    [...failing, ...manual].length ? [...failing, ...manual].map((b) => `- ${b}`).join('\n') : '- nenhum',
  ].join('\n');
  const existing = readTextIfExists(statePath);
  // O template do init-oxe (fase `initial`, placeholders) é substituído; texto humano real é preservado fora do bloco.
  const isTemplate = !existing || /Porta de entrada enxuta/.test(existing);
  if (isTemplate) fs.writeFileSync(statePath, `${dossierLib.BEGIN}\n${block}\n${dossierLib.END}\n\n## Decisões persistentes\n\n- (bullet: D-NN: decisão → data)\n`, 'utf8');
  else dossierLib.writeDossierFile(statePath, block);
  return statePath;
}

/** Sign-off humano de critérios manuais/UAT de uma fase (append-only). */
function runtimeSignoff(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const program = programLib.readProgram(paths.programDir);
  const phaseId = options.phase || (program && program.active_phase);
  if (!phaseId) throw new Error('Informe --phase (sem fase ativa).');
  const by = String(options.by || '').trim();
  if (!by) throw new Error('Sign-off exige --by <quem aceitou>.');
  const criteria = (Array.isArray(options.criteria) ? options.criteria : String(options.criteria || '').split(','))
    .map((c) => c.trim().toUpperCase()).filter((c) => /^(?:A\d+(?:\.\d+)?|G\d+)$/.test(c));
  if (!criteria.length) throw new Error('Sign-off exige --criteria A8[,A9].');
  const record = { phase: phaseId, criteria, by, at: new Date().toISOString(), note: options.note || null, evidence: options.evidence || null };
  const file = path.join(paths.programDir, 'signoffs.ndjson');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  appendEvent(projectRoot, activeSession, { type: 'GateResolved', payload: { gate: 'signoff', ...record } });
  return record;
}

// ─── Ciclo de correção: Change Requests (1.20b) ───────────────────────────────

function readProjectConfig(projectRoot) {
  return readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json')) || {};
}

/**
 * `oxe-cc runtime feedback`: registra a pushback como CR-NN, reabre a fase fechada quando a classe pede e devolve a
 * rota (o que fazer, em ordem) e as tarefas impactadas pela rastreabilidade A* → T.
 */
function runtimeFeedback(projectRoot, activeSession, options = {}) {
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const parsers = loadSdkParsers();
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const program = programLib.readProgram(programDir);
  const planText = readTextIfExists(paths.plan) || '';
  const plan = parsers && planText ? parsePlanArtifact(parsers, planText, paths.plan) : { tasks: [] };
  const result = changeLib.recordChange({
    programDir, program, plan,
    class: options.class, summary: options.summary, criteria: options.criteria, by: options.by,
    phase: options.phase, amendTo: options.amendTo, evidence: options.evidence, additive: Boolean(options.additive),
    specEdit: options.specEdit || null,
    tasks: options.tasks ? (Array.isArray(options.tasks) ? options.tasks : String(options.tasks).split(',')).map((t) => String(t).trim().toUpperCase()).filter((t) => /^T\d+$/.test(t)) : [],
  });
  if (result.reopened && result.program) programLib.writeProgram(programDir, result.program);
  // 1.21.1: a defect or spec_gap reopens tasks (done → open), so the next execute redoes exactly them.
  // OXB-061: only what the CR targets. `--tasks T7` names them; without it, the criterion's closer task (the one that
  // proves it). The other impacted tasks are listed as "impacted, not reopened". A task delivered by another path
  // (external_delivery / verify_only / blocked_by an external PR) is never reopened: its work is not in this repo.
  const reopenedTasks = [];
  const selection = selectTasksToReopen(paths.plan, plan, result, options.tasks);
  // OXB-173: `--tasks` LINKS the CR to the tasks; it reopens them only with `--reopen` (F2 CR-36 flipped T5, done with
  // 335fc004, to open in silence — the next execute would have paid for merge-ready work again).
  const explicitTasks = Boolean(options.tasks && String(options.tasks).trim());
  const mayReopen = !explicitTasks || options.reopen === true;
  if ((result.cr.class === 'defect' || result.cr.class === 'spec_gap') && mayReopen) {
    const planJsonLib = require('./oxe-plan-json.cjs');
    for (const taskId of selection.targets) {
      if (planJsonLib.markPlanTaskOpen(paths.plan, taskId, { by: result.cr.id })) reopenedTasks.push(taskId);
    }
  }
  if (explicitTasks && !mayReopen) result.linked_tasks = selection.targets;
  result.reopened_tasks = reopenedTasks;
  result.impacted_not_reopened = (result.impacted || []).filter((id) => !reopenedTasks.includes(id) && !selection.external.includes(id));
  result.external_not_reopened = selection.external;
  if (selection.unknown.length) result.unknown_tasks = selection.unknown;
  appendEvent(projectRoot, activeSession, {
    type: 'ChangeRequested',
    payload: { id: result.cr.id, class: result.cr.class, phase: result.cr.phase, criteria: result.cr.criteria, reopened: result.reopened, impacted: result.impacted, reopened_tasks: reopenedTasks, impacted_not_reopened: result.impacted_not_reopened, external_not_reopened: selection.external },
  });
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  return result;
}

/**
 * OXB-092 (minimal): `oxe-cc runtime signal --from <HML report file>|<GitHub issue URL>|github:<owner/repo>`.
 * Each finding becomes a CR in ITS phase (HML-F<n>-x → F<n>), tied to the criterion it names, or found through
 * A* → T → files, or the standing criteria (A70). A finding of a CLOSED phase is not turned into a CR here (that would
 * reopen the phase): it is listed for `runtime feedback` (a "reopen?" suggestion comes after 1.5.0). Idempotent by
 * signal id. --dry-run shows what would be created.
 */
function runtimeSignal(projectRoot, activeSession, options = {}) {
  const signal = require('./oxe-signal.cjs');
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const from = String(options.from || '').trim();
  if (!from) throw new Error('use: oxe-cc runtime signal --from <relatório do HML>|<url de issue>|github:<owner/repo> [--by <papel>] [--dry-run]');
  let findings = signal.githubFindings(from, { ghSpawn: options.ghSpawn, anyLabel: options.anyLabel });
  if (!findings) {
    const file = path.resolve(projectRoot, from);
    if (!fs.existsSync(file)) throw new Error(`--from ${from}: arquivo não encontrado (ou use uma URL de issue / github:<owner/repo>)`);
    findings = signal.parseReport(fs.readFileSync(file, 'utf8'));
  }
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const program = programLib.readProgram(programDir);
  const parsers = loadSdkParsers();
  const planText = readTextIfExists(paths.plan) || '';
  let plan = { tasks: [] };
  try { plan = parsers && (planText || fs.existsSync(require('./oxe-plan-json.cjs').planJsonPathFor(paths.plan) || '')) ? parsePlanArtifact(parsers, planText, paths.plan) : plan; } catch { plan = { tasks: [] }; }
  const standing = require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot);
  const existing = changeLib.listChanges(programDir);
  const already = new Set(changeLib.readNdjson(changeLib.changesFile(programDir)).filter((r) => r && r.kind === 'signal').map((r) => r.signal_id));
  const by = options.by || 'signal';
  const out = { created: [], duplicates: [], closed_phase: [], triage: [], suspicious: [], dry_run: Boolean(options.dryRun) };
  // OXB-122: provenance. github issues are external by default; a local report is internal unless config says otherwise.
  const trustCfg = ((readProjectConfig(projectRoot) || {}).signal || {}).trust || {};
  const isGithub = /^github:|github\.com\//.test(from);
  const sourceTrust = isGithub ? (trustCfg.github || 'external') : (trustCfg.file || 'internal');
  for (const f of findings) {
    if (already.has(f.id) || existing.some((cr) => String(cr.summary || '').startsWith(`${f.id}:`))) { out.duplicates.push(f.id); continue; }
    const phase = f.phase || (program && program.active_phase) || null;
    const phaseState = program && phase ? program.phases.find((p) => p.id === phase) : null;
    let criteria = f.criteria.filter((c) => /^(?:A\d+(?:\.\d+)?|G\d+)$/.test(c));
    let source = criteria.length ? 'finding' : null;
    let tasks = [];
    if (!criteria.length && f.files.length) {
      const traced = signal.criteriaFromFiles(plan, f.files);
      if (traced.criteria.length) { criteria = traced.criteria; tasks = traced.tasks; source = 'traceability'; }
    }
    if (!criteria.length && standing.length) { criteria = standing; source = 'standing'; }
    if (!criteria.length) { out.triage.push({ id: f.id, phase, summary: f.summary, reason: 'sem critério: nomeie o A* no achado, cite os arquivos (`src/x.tsx`) ou configure program.standing_acceptance' }); continue; }
    if (phaseState && phaseState.status === 'closed') { out.closed_phase.push({ id: f.id, phase, summary: f.summary, criteria, suggestion: `oxe-cc runtime feedback --class ${f.class} --phase ${phase} --criteria ${criteria.join(',')} --summary "${f.id}: ${f.summary.slice(0, 80)}" (reabre a fase)` }); continue; }
    const injection = signal.scanInjection(`${f.summary}\n${f.body || ''}`);
    if (injection.length) out.suspicious.push({ id: f.id, flags: injection });
    const entry = { id: f.id, phase, class: f.class, criteria, criteria_source: source, tasks, summary: `${f.id}: ${f.summary}`, source_trust: sourceTrust, injection_flags: injection.map((x) => x.id) };
    if (options.dryRun) { out.created.push(entry); continue; }
    const res = changeLib.recordChange({
      programDir, program, plan,
      class: f.class, summary: entry.summary, criteria, by, phase,
      evidence: [f.source_url || from, f.files.length ? `arquivos: ${f.files.join(', ')}` : null, f.body && f.body !== f.summary ? f.body.slice(0, 1500) : null].filter(Boolean).join('\n'),
    });
    // The signal id makes re-imports idempotent (append-only: a tag record, the CR line stays as written).
    changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'signal', signal_id: f.id, cr: res.cr.id, source: f.source_url || from, phase, criteria_source: source, source_trust: sourceTrust, injection_flags: injection, by, at: new Date().toISOString() });
    if (res.reopened && res.program) programLib.writeProgram(programDir, res.program);
    appendEvent(projectRoot, activeSession, { type: 'ChangeRequested', payload: { id: res.cr.id, class: res.cr.class, phase, criteria, signal: f.id, by } });
    out.created.push({ ...entry, cr: res.cr.id });
  }
  return out;
}

// ── OXB-058: SPEC / ROADMAP / PROGRAM edits with an audit trail ─────────────────────────────────────────────

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function requireEditReason(options) {
  const by = String(options.by || '').trim();
  const reason = String(options.reason || '').trim();
  if (!by) throw new Error('informe quem pede a mudança (--by <papel>)');
  if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "...")');
  return { by, reason };
}

/** Phase of the program whose acceptance lists `criterion` (any status), or null. */
function phaseOfCriterion(program, criterion) {
  if (!program || !Array.isArray(program.phases)) return null;
  const hit = program.phases.find((p) => Array.isArray(p.acceptance) && p.acceptance.includes(criterion));
  return hit ? hit.id : null;
}

/** Export configured in config.json (`program.export_dir`, relative to the project), or null. */
function programExportDir(projectRoot) {
  const config = readProjectConfig(projectRoot) || {};
  const dir = config.program && typeof config.program.export_dir === 'string' ? config.program.export_dir.trim() : '';
  return dir || null;
}

/**
 * `oxe-cc program export [<dir>]`: copies SPEC.md, ROADMAP.md, PROGRAM.json and changes.ndjson to a tracked folder
 * (same file names), so a project that gitignores .oxe/ keeps a versioned trail. Default dir: `program.export_dir`.
 */
function runtimeProgramExport(projectRoot, activeSession, options = {}) {
  const dirArg = options.dir || programExportDir(projectRoot);
  if (!dirArg) throw new Error('informe a pasta: oxe-cc program export --out <pasta> (ou configure "program": { "export_dir": "…" } no .oxe/config.json)');
  const target = path.resolve(projectRoot, dirArg);
  // OXB-083: never drop SPEC/ROADMAP/PROGRAM/changes into the project root (it dirtied the program worktree).
  if (path.relative(path.resolve(projectRoot), target) === '') throw new Error('a pasta de export não pode ser a raiz do projeto: use uma subpasta versionada (ex.: --out docs/oxe)');
  const rel = path.relative(path.join(projectRoot, '.oxe'), target);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('a pasta de export não pode ficar dentro de .oxe/ (ela existe para ser versionada)');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const sources = [
    ['SPEC.md', paths.spec],
    ['ROADMAP.md', paths.roadmap],
    ['PROGRAM.json', path.join(programDir, 'PROGRAM.json')],
    ['changes.ndjson', path.join(programDir, 'changes.ndjson')],
  ];
  fs.mkdirSync(target, { recursive: true });
  const written = [];
  const missing = [];
  for (const [name, src] of sources) {
    if (src && fs.existsSync(src)) {
      // OXB-032: with spec_ref/roadmap_ref pointing into the export dir, the file already is the versioned copy.
      if (path.resolve(src) !== path.resolve(path.join(target, name))) fs.copyFileSync(src, path.join(target, name));
      written.push(path.relative(projectRoot, path.join(target, name)).replace(/\\/g, '/'));
    } else {
      missing.push(name);
    }
  }
  return { dir: path.relative(projectRoot, target).replace(/\\/g, '/') || '.', written, missing };
}

/** After an edit: refresh the configured export (never fails the edit). */
function autoExportProgram(projectRoot, activeSession) {
  if (!programExportDir(projectRoot)) return null;
  try { return runtimeProgramExport(projectRoot, activeSession, {}); } catch (err) { return { error: err.message }; }
}

/**
 * `oxe-cc spec amend <A-id> --by <papel> --reason <texto> (--text|--append|--verify) [--additive]`: edits the criterion
 * row in SPEC.md, for a criterion of ANY phase (planned or not), and records a spec_gap CR with the version bump and the
 * row before/after. `--additive` has the OXB-062 semantics (the earlier acceptance tests stay valid).
 */
function runtimeSpecAmend(projectRoot, activeSession, options = {}) {
  const specEdit = require('./oxe-spec-edit.cjs');
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const { by, reason } = requireEditReason(options);
  const id = String(options.id || '').trim().toUpperCase();
  if (!/^A\d+$/.test(id)) throw new Error('informe o critério: oxe-cc spec amend A<n> …');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const specText = readTextIfExists(paths.spec);
  if (!specText) throw new Error(`SPEC.md não encontrada (${paths.spec})`);
  const edit = specEdit.amendCriterion(specText, id, { text: options.text, append: options.append, verify: options.verify });
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const program = programLib.readProgram(programDir);
  const current = changeLib.amendmentRequirements(programDir).get(id);
  const version = (current ? current.required : 1) + 1;
  const phase = options.phase || phaseOfCriterion(program, id) || (program && program.active_phase) || null;
  const result = runtimeFeedback(projectRoot, activeSession, {
    class: 'spec_gap', summary: reason, criteria: id, by, phase, amendTo: version, additive: Boolean(options.additive),
    specEdit: { file: path.relative(projectRoot, paths.spec).replace(/\\/g, '/'), before: edit.before, after: edit.after },
  });
  writeTextAtomic(paths.spec, edit.text);
  appendEvent(projectRoot, activeSession, { type: 'SpecAmended', payload: { id, version, cr: result.cr.id, additive: Boolean(options.additive), phase } });
  return { ...result, id, version, phase, before: edit.before, after: edit.after, export: autoExportProgram(projectRoot, activeSession) };
}

/**
 * `oxe-cc spec add criterion A42 --text … --verify …` / `spec add requirement R14 --text … [--criteria A42,A43]
 * [--before "### Fora do escopo"]`: new ids, checked for uniqueness and gaps, each recorded in changes.ndjson.
 */
function runtimeSpecAdd(projectRoot, activeSession, options = {}) {
  const specEdit = require('./oxe-spec-edit.cjs');
  const changeLib = require('./oxe-change.cjs');
  const { by, reason } = requireEditReason(options);
  const kind = String(options.kind || '').toLowerCase();
  if (kind !== 'criterion' && kind !== 'requirement') throw new Error('use: oxe-cc spec add criterion A<n> … | spec add requirement R<n> …');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const specText = readTextIfExists(paths.spec);
  if (!specText) throw new Error(`SPEC.md não encontrada (${paths.spec})`);
  const edit = kind === 'criterion'
    ? specEdit.addCriterion(specText, options.id, { text: options.text, verify: options.verify, allowGap: options.allowGap })
    : specEdit.addRequirement(specText, options.id, { text: options.text, version: options.version, criteria: options.criteria, before: options.before, allowGap: options.allowGap });
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const record = {
    kind: 'spec_edit',
    action: kind === 'criterion' ? 'add_criterion' : 'add_requirement',
    id: edit.id,
    by,
    reason,
    at: new Date().toISOString(),
    file: path.relative(projectRoot, paths.spec).replace(/\\/g, '/'),
    before: null,
    after: edit.after,
  };
  writeTextAtomic(paths.spec, edit.text);
  // OXB-091: --standing makes the new criterion hold at every phase close (program.standing_acceptance).
  if (options.standing && kind === 'criterion') {
    const cfgPath = path.join(projectRoot, '.oxe', 'config.json');
    const cfg = readJsonQuiet(cfgPath) || {};
    cfg.program = cfg.program && typeof cfg.program === 'object' ? cfg.program : {};
    cfg.program.standing_acceptance = [...new Set([...(cfg.program.standing_acceptance || []), edit.id])];
    writeTextAtomic(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    record.standing = true;
  }
  changeLib.appendNdjson(changeLib.changesFile(programDir), record);
  appendEvent(projectRoot, activeSession, { type: 'SpecEdited', payload: { action: record.action, id: edit.id, by } });
  return { ...record, export: autoExportProgram(projectRoot, activeSession) };
}

/**
 * `oxe-cc program phase add --after Fn --title … --requirements R14 --acceptance A42,A43 [--scope …]`: inserts phase
 * F(n+1) in ROADMAP.md and PROGRAM.json and renumbers the later phases (+1). It refuses when a phase it would renumber
 * has started (status ≠ pending, plan_ref, run_id or started_at). Change records that pointed at a renumbered phase
 * follow it; leftover textual mentions in SPEC, ROADMAP and LESSONS are reported.
 */
function runtimeProgramPhaseAdd(projectRoot, activeSession, options = {}) {
  const specEdit = require('./oxe-spec-edit.cjs');
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const { by, reason } = requireEditReason({ by: options.by, reason: options.reason || `nova fase depois de ${options.after}: ${options.title || ''}` });
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const state = programLib.readProgram(programDir);
  if (!state) throw new Error('Sem programa. Rode `oxe-cc runtime program init`.');
  const afterId = String(options.after || '').trim().toUpperCase().replace(/^(?:FASE|PHASE)\s*/, 'F');
  const afterNorm = /^\d+$/.test(afterId) ? `F${afterId}` : afterId;
  const idx = state.phases.findIndex((p) => p.id.toUpperCase() === afterNorm);
  if (idx < 0) throw new Error(`fase ${options.after} não existe no programa`);
  const title = String(options.title || '').trim();
  if (!title) throw new Error('informe --title <nome da fase>');
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const requirements = list(options.requirements);
  const acceptance = list(options.acceptance);
  const later = state.phases.slice(idx + 1);
  const started = later.filter((p) => p.status !== 'pending' || p.plan_ref || p.run_id || p.started_at || state.active_phase === p.id);
  if (started.length) {
    throw new Error(`não dá para inserir depois de ${afterNorm}: ${started.map((p) => `${p.id} (${p.status}${p.plan_ref ? ', com plano' : ''}${p.run_id ? ', com run' : ''})`).join(', ')} já começou — renumerar quebraria plano, runs e regressão. Insira depois da última fase iniciada.`);
  }
  const roadmapText = readTextIfExists(paths.roadmap);
  if (!roadmapText) throw new Error(`ROADMAP.md não encontrado (${paths.roadmap})`);
  const roadmapEdit = specEdit.insertRoadmapPhase(roadmapText, afterNorm, { title, requirements, acceptance, scope: options.scope });
  const n = Number(afterNorm.slice(1));
  const newId = `F${n + 1}`;
  const renumbered = [];
  const next = JSON.parse(JSON.stringify(state));
  for (const p of next.phases.slice(idx + 1)) {
    const to = `F${Number(p.id.slice(1)) + 1}`;
    renumbered.push({ from: p.id, to });
    p.id = to;
  }
  // OXB-033: dependencies follow the renumbering.
  const depMap = new Map(renumbered.map((r) => [r.from, r.to]));
  for (const p of next.phases) if (Array.isArray(p.depends_on)) p.depends_on = p.depends_on.map((d) => depMap.get(d) || d);
  if (depMap.size) {
    roadmapEdit.text = roadmapEdit.text.replace(/^(\*\*(?:Depende de|Depends on|Dependências|Dependencies):\*\*)(.*)$/gim, (_m, label, rest) => `${label}${rest.replace(/\bF(\d+)\b/g, (id) => depMap.get(id) || id)}`);
  }
  next.phases.splice(idx + 1, 0, {
    id: newId, title, requirements, acceptance, scope: options.scope ? String(options.scope) : null,
    status: 'pending', plan_ref: null, run_id: null, started_at: null, closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null,
  });
  next.updated_at = new Date().toISOString();
  // Ids the new phase cites must exist in the SPEC (add them with `spec add`).
  const specText = readTextIfExists(paths.spec) || '';
  const warnings = [];
  const knownA = new Set(specEdit.criteriaIds(specText));
  const knownR = new Set(specEdit.requirementIds(specText));
  for (const a of acceptance) if (!knownA.has(a)) warnings.push(`${a} não está na tabela de critérios da SPEC (oxe-cc spec add criterion ${a} …)`);
  if (knownR.size) for (const r of requirements) if (!knownR.has(r)) warnings.push(`${r} não está na tabela de requisitos da SPEC (oxe-cc spec add requirement ${r} …)`);
  // Change records follow their phase (rewritten in place: the phase id is a reference, not history).
  const changesPath = changeLib.changesFile(programDir);
  const map = new Map(renumbered.map((r) => [r.from, r.to]));
  let movedRecords = 0;
  if (map.size && fs.existsSync(changesPath)) {
    const records = changeLib.readNdjson(changesPath);
    const rewritten = records.map((r) => {
      if (r && r.phase && map.has(r.phase)) { movedRecords += 1; return { ...r, phase: map.get(r.phase) }; }
      return r;
    });
    if (movedRecords) writeTextAtomic(changesPath, rewritten.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  programLib.writeProgram(programDir, next);
  writeTextAtomic(paths.roadmap, roadmapEdit.text);
  changeLib.appendNdjson(changesPath, { kind: 'program_edit', action: 'phase_add', phase: newId, after: afterNorm, title, requirements, acceptance, renumbered, by, reason, at: new Date().toISOString() });
  const lessonsPath = path.join(projectRoot, '.oxe', 'LESSONS.md');
  const leftovers = [
    ...specEdit.leftoverPhaseMentions(specText, renumbered, 'SPEC.md'),
    ...specEdit.leftoverPhaseMentions(roadmapEdit.text, renumbered, 'ROADMAP.md'),
    ...specEdit.leftoverPhaseMentions(readTextIfExists(lessonsPath) || '', renumbered, 'LESSONS.md'),
  ];
  appendEvent(projectRoot, activeSession, { type: 'ProgramPhaseAdded', payload: { phase: newId, after: afterNorm, renumbered, by } });
  return { phase: newId, after: afterNorm, renumbered, moved_change_records: movedRecords, warnings, leftovers, export: autoExportProgram(projectRoot, activeSession) };
}

// ── OXB-060: keep the program branch in step with main; promote a task by cherry-pick ─────────────────────────

function gitRun(projectRoot, args, extra = {}) {
  const res = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...extra });
  return { ok: res.status === 0, status: res.status, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), error: res.error || null };
}

/** Dirty paths of the project outside .oxe/ (the runtime's own state never blocks a sync or promote). */
function dirtyProjectPaths(projectRoot) {
  return projectStatusPaths(projectRoot).filter((p) => !p.startsWith('.oxe/'));
}

/** runChildCommand, plus the whole (bounded) output — OXB-172 reads the failing test files from it. */
function runChildCommandFull(projectRoot, command, timeoutMs = 600_000) {
  applyChildEnvPolicy(projectRoot);
  const rt = loadRuntimeModule();
  const env = rt && typeof rt.childProcessEnv === 'function' ? rt.childProcessEnv(process.env) : (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();
  const res = spawnSync(command, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env });
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  return { ok: res.status === 0, status: res.status, tail: output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n'), output: output.slice(-200_000) };
}

function runChildCommand(projectRoot, command, timeoutMs = 600_000) {
  applyChildEnvPolicy(projectRoot);
  const rt = loadRuntimeModule();
  const env = rt && typeof rt.childProcessEnv === 'function'
    ? rt.childProcessEnv(process.env)
    : (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();
  const res = spawnSync(command, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env });
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  return { ok: res.status === 0, status: res.status, tail: output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n') };
}

/**
 * OXB-162: a long project command with progress on stderr (one line per npm script that starts, plus a heartbeat),
 * through bin/lib/oxe-progress-run.cjs. `quiet` keeps the progress off the terminal (tests, --json).
 */
function runProgressCommand(cwd, command, timeoutMs = 1_800_000, options = {}) {
  applyChildEnvPolicy(cwd);
  const rt = loadRuntimeModule();
  const env = rt && typeof rt.childProcessEnv === 'function'
    ? rt.childProcessEnv(process.env)
    : (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();
  const heartbeat = Number(options.heartbeatMs || process.env.OXE_PROGRESS_HEARTBEAT_MS) || 60_000;
  const res = spawnSync(process.execPath, [path.join(__dirname, 'oxe-progress-run.cjs'), options.label || 'pr:ready', String(timeoutMs), String(heartbeat), '--', command], {
    cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs + 120_000,
    stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
  });
  try {
    const out = JSON.parse(String(res.stdout || '').trim());
    return { ok: out.status === 0, status: out.status, tail: out.tail, timed_out: out.timed_out, scripts: out.scripts };
  } catch {
    return runChildCommand(cwd, command, timeoutMs);
  }
}

/**
 * OXB-162: promote worktrees a killed promote left behind (`.oxe/promote-ws/<task>-*`). A live promote writes
 * `<dir>.pid` next to its worktree; a dir whose pid is gone (or with no pid file, older than 30 min) is swept:
 * external links (the node_modules junction) unlinked FIRST, then the worktree removed, then pruned.
 */
function sweepStalePromoteWorkspaces(projectRoot, options = {}) {
  const root = path.join(projectRoot, '.oxe', 'promote-ws');
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return removed; }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); } };
  for (const name of names) {
    const dir = path.join(root, name);
    const pidFile = `${dir}.pid`;
    let pid = null;
    try { pid = Number(JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid) || null; } catch { pid = null; }
    if (pid && pid !== process.pid && alive(pid)) continue;
    if (!pid) {
      let age = 0;
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch { age = 0; }
      if (age < (options.minAgeMs != null ? options.minAgeMs : 30 * 60_000)) continue;
    }
    try {
      const rt = loadRuntimeModule();
      if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(dir);
      else { const nm = path.join(dir, 'node_modules'); if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm); }
    } catch { /* */ }
    let linkLeft = false;
    try { linkLeft = fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
    if (linkLeft) continue; // never a forced removal with the junction in place
    const rm = gitRun(projectRoot, ['worktree', 'remove', '--force', dir]);
    if (!rm.ok) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { continue; } }
    try { fs.rmSync(pidFile, { force: true }); } catch { /* */ }
    removed.push(path.relative(projectRoot, dir).replace(/\\/g, '/'));
  }
  if (removed.length) gitRun(projectRoot, ['worktree', 'prune']);
  return removed;
}

function readPlanJsonDoc(projectRoot, activeSession) {
  const planJsonLib = require('./oxe-plan-json.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
  if (!jsonPath || !fs.existsSync(jsonPath)) return { jsonPath: null, doc: null, paths };
  return { jsonPath, doc: JSON.parse(fs.readFileSync(jsonPath, 'utf8')), paths };
}

/**
 * `oxe-cc runtime sync --from origin/main [--no-fetch] [--no-verify]`: merges the base into the program branch
 * (local merge, never a push; stops and aborts on a conflict). Every done task whose `files` changed upstream is
 * marked `needs_reverify` and its verify rerun with no executor: green clears the mark, red reopens the task.
 */
function runtimeSync(projectRoot, activeSession, options = {}) {
  const from = String(options.from || '').trim();
  if (!from) throw new Error('informe a base: oxe-cc runtime sync --from origin/main');
  if (!gitLines(projectRoot, ['rev-parse', '--git-dir'])) throw new Error('runtime sync exige um repositório git');
  const dirty = dirtyProjectPaths(projectRoot);
  if (dirty.length) throw new Error(`working tree com mudanças fora de .oxe/ (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? '…' : ''}) — faça commit ou stash antes do sync`);
  const fetched = { attempted: false, ok: null };
  const remoteMatch = /^([^/\s]+)\/(.+)$/.exec(from);
  if (options.fetch !== false && remoteMatch && (gitLines(projectRoot, ['remote']) || []).includes(remoteMatch[1])) {
    fetched.attempted = true;
    fetched.ok = gitRun(projectRoot, ['fetch', '-q', remoteMatch[1], remoteMatch[2]]).ok;
  }
  const head = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
  const target = (gitLines(projectRoot, ['rev-parse', '--verify', `${from}^{commit}`]) || [])[0];
  if (!target) throw new Error(`base desconhecida: ${from}`);
  const mergeBase = (gitLines(projectRoot, ['merge-base', 'HEAD', target]) || [])[0] || null;
  const upstream = mergeBase ? (gitLines(projectRoot, ['diff', '--relative', '--name-only', mergeBase, target]) || []) : [];
  const result = { from, head_before: head, target, merge_base: mergeBase, fetched, upstream_files: upstream, merged: false, conflicts: [], needs_reverify: [], reverified: [], reopened: [], table: [], up_to_date: false };
  if (mergeBase === target) {
    result.up_to_date = true;
    return result;
  }
  const merge = gitRun(projectRoot, ['merge', '--no-edit', '--no-ff', '-m', `Merge ${from} into program branch (oxe-cc runtime sync)`, target]);
  if (!merge.ok) {
    result.conflicts = (gitLines(projectRoot, ['diff', '--name-only', '--diff-filter=U']) || []);
    gitRun(projectRoot, ['merge', '--abort']);
    result.error = result.conflicts.length
      ? `conflito ao mergear ${from}: ${result.conflicts.join(', ')} — merge abortado; resolva à mão (git merge ${from}) e rode runtime sync de novo`
      : `merge de ${from} falhou: ${(merge.stderr || merge.stdout).trim().split(/\r?\n/).slice(-3).join(' · ')}`;
    appendEvent(projectRoot, activeSession, { type: 'ProgramSyncFailed', payload: { from, conflicts: result.conflicts } });
    return result;
  }
  result.merged = true;
  result.head_after = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
  // OXB-147: the merge brought new dependencies (F2: 195 files incl. a new package-lock.json; nothing reinstalled and
  // the dry-verify ran on a stale node_modules). config `sync_deps`: "install" runs a NON-destructive install (npm
  // install / pnpm install / yarn — never `npm ci`, which deletes node_modules) + `post_install`; "stop" (default)
  // does not re-verify on the stale tree and tells what to run.
  const depFiles = upstream.filter((f) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f) && !/node_modules\//.test(f));
  let depsStale = false;
  if (depFiles.length) {
    const cfg = readProjectConfig(projectRoot) || {};
    const manager = fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ? 'pnpm install' : fs.existsSync(path.join(projectRoot, 'yarn.lock')) ? 'yarn install' : 'npm install';
    const post = typeof cfg.post_install === 'string' && cfg.post_install.trim() ? cfg.post_install.trim() : null;
    const command = [manager, post].filter(Boolean).join(' && ');
    if (cfg.sync_deps === 'install') {
      let ok = true;
      let tail = '';
      for (const c of [manager, post].filter(Boolean)) {
        const r = runChildCommand(projectRoot, c);
        if (!r.ok) { ok = false; tail = r.tail; break; }
      }
      result.deps = { changed: depFiles, action: 'installed', command, ok, ...(ok ? {} : { tail }) };
      if (!ok) { depsStale = true; result.error = `dependências mudaram (${depFiles.join(', ')}) e \`${command}\` falhou — corrija e rode oxe-cc runtime verify`; }
    } else {
      depsStale = true;
      result.deps = { changed: depFiles, action: 'stop', command };
      result.error = `dependências mudaram: rode ${command} (${depFiles.join(', ')} vieram no merge) e depois oxe-cc runtime verify — o re-verify não rodou num node_modules velho`;
    }
    appendEvent(projectRoot, activeSession, { type: 'ProgramSyncDepsChanged', payload: { from, files: depFiles, action: result.deps.action, ok: result.deps.ok !== false } });
  }
  if (depsStale) options = { ...options, verify: false };
  const { jsonPath, doc, paths } = readPlanJsonDoc(projectRoot, activeSession);
  if (doc && Array.isArray(doc.tasks)) {
    const changed = new Set(upstream);
    const planJsonLib = require('./oxe-plan-json.cjs');
    for (const task of doc.tasks) {
      if (!task || task.done !== true) continue;
      const touched = (task.files || []).filter((f) => changed.has(String(f).replace(/\\/g, '/')));
      if (!touched.length) continue;
      task.needs_reverify = { since: from, files: touched, at: new Date().toISOString() };
      result.needs_reverify.push(task.id);
    }
    if (result.needs_reverify.length) writeTextAtomic(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
    if (options.verify !== false) {
      for (const id of result.needs_reverify) {
        const task = doc.tasks.find((t) => t.id === id);
        const commands = task.verify && Array.isArray(task.verify.commands) ? task.verify.commands.filter(Boolean) : [];
        if (!commands.length) continue;
        // Same per-segment runner as the task verify (OXB-066): each `a && b` segment alone, the first red one named.
        const rt = loadRuntimeModule();
        const split = rt && typeof rt.splitVerifySegments === 'function' ? rt.splitVerifySegments : (c) => [c];
        const segments = commands.flatMap((c) => split(c));
        let run = { ok: true };
        for (let i = 0; i < segments.length; i += 1) {
          const r = runChildCommand(projectRoot, segments[i]);
          if (!r.ok) { run = { ok: false, tail: r.tail, failed_segment: { index: i + 1, total: segments.length, command: segments[i], exit_code: r.status } }; break; }
        }
        result.table.push({ task: id, status: run.ok ? 'still_green' : 'now_red', ...(run.failed_segment ? { failed_segment: run.failed_segment } : {}) });
        const fresh = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const t = fresh.tasks.find((x) => x.id === id);
        if (run.ok) {
          delete t.needs_reverify;
          t.reverified = { at: new Date().toISOString(), since: from };
          writeTextAtomic(jsonPath, `${JSON.stringify(fresh, null, 2)}\n`);
          result.reverified.push(id);
        } else {
          writeTextAtomic(jsonPath, `${JSON.stringify(fresh, null, 2)}\n`);
          if (planJsonLib.markPlanTaskOpen(paths.plan, id, { by: `runtime sync ${from}` })) result.reopened.push({ task: id, tail: run.tail, failed_segment: run.failed_segment });
        }
      }
    }
  }
  appendEvent(projectRoot, activeSession, { type: 'ProgramSynced', payload: { from, target, upstream_files: upstream.length, needs_reverify: result.needs_reverify, reverified: result.reverified, reopened: result.reopened.map((r) => r.task) } });
  return result;
}

/**
 * `oxe-cc runtime promote <Tn> --base main [--branch name] [--open-pr] [--remote origin]`: a branch from the base with
 * the task's checkpoint commits (OXE-Task trailer / done_commit) and the commits of its frozen acceptance tests,
 * cherry-picked with -x in history order. Stops (and cleans up) on a conflict; runs the project's `pr:ready` script
 * when there is one; writes the PR body from the task and its CRs. Push + `gh pr create` only with `--open-pr`.
 */
function runtimePromote(projectRoot, activeSession, options = {}) {
  // OXB-169: `--tasks T4,T5,T6,T7` builds ONE branch from the tasks' commits in commit order (the execute may commit
  // them out of plan order — a checkpoint retry committed T4/T5 after T6/T7, and T4's diff assumed theirs).
  const taskIds = [...new Set((options.tasks ? (Array.isArray(options.tasks) ? options.tasks : String(options.tasks).split(',')) : [options.task])
    .map((t) => String(t || '').trim().toUpperCase()).filter(Boolean))];
  if (!taskIds.length || !taskIds.every((t) => /^T\d+$/.test(t))) throw new Error('informe a tarefa: oxe-cc runtime promote T<n> --base main  (ou --tasks T4,T5,…)');
  const taskId = taskIds.join('-');
  if (!gitLines(projectRoot, ['rev-parse', '--git-dir'])) throw new Error('runtime promote exige um repositório git');
  // OXB-157: `--base main` used the LOCAL main (11 days old) — the PR conflicted on files identical on origin/main.
  const resolvedBase = resolvePromoteBase(projectRoot, options.base, String(options.remote || 'origin'), options);
  const base = resolvedBase.ref;
  // OXB-151: by default promote works in its OWN temporary worktree — the program tree (checkout, index, node_modules)
  // is never touched, so it is safe while `runtime execute` runs there. --in-place keeps the old behavior.
  const inPlace = options.inPlace === true;
  if (inPlace) {
    const dirty = dirtyProjectPaths(projectRoot);
    if (dirty.length) throw new Error(`working tree com mudanças fora de .oxe/ (${dirty.slice(0, 5).join(', ')}) — faça commit ou stash antes do promote`);
  }
  let baseSha = (gitLines(projectRoot, ['rev-parse', '--verify', `${base}^{commit}`]) || [])[0];
  if (!baseSha) throw new Error(`base desconhecida: ${base}`);
  const { doc } = readPlanJsonDoc(projectRoot, activeSession);
  const planTasks = taskIds.map((id) => {
    const t = doc && Array.isArray(doc.tasks) ? doc.tasks.find((x) => x && x.id === id) : null;
    if (!t) throw new Error(`${id} não está no PLAN.json`);
    if (t.done !== true) throw new Error(`${id} não está done — só uma tarefa concluída e verde é promovida`);
    return t;
  });
  const idSet = new Set(taskIds);
  // One task: itself. Several: their union — files, criteria, and the dependencies OUTSIDE the set (for stacking).
  const task = planTasks.length === 1 ? planTasks[0] : {
    id: taskId,
    title: planTasks.map((t) => `${t.id} ${t.title || ''}`.trim()).join(' · '),
    files: [...new Set(planTasks.flatMap((t) => t.files || []))],
    acceptance: [...new Set(planTasks.flatMap((t) => t.acceptance || []))],
    depends_on: [...new Set(planTasks.flatMap((t) => t.depends_on || []))].filter((d) => !idSet.has(d)),
    done: true,
  };
  // Commits of the task not yet in the base: its checkpoints and the frozen tests of its criteria.
  const range = `${baseSha}..HEAD`;
  // OXB-166: by phase + task; with a done_commit, the phase-less legacy trailers are not searched at all.
  const phaseCtx = taskPhaseContext(projectRoot, activeSession);
  const shas = new Set();
  const inRangeAll = gitLines(projectRoot, ['rev-list', range]) || [];
  for (const t of planTasks) {
    const own = t.done_commit && phaseCtx.phase
      ? (gitLines(projectRoot, ['log', '--format=%H', '-E', `--grep=^OXE-Task: ${phaseCtx.phase}/${t.id}$`, range]) || [])
      : taskCommitShas(projectRoot, t.id, range, phaseCtx);
    for (const sha of own) shas.add(sha);
    if (t.done_commit) {
      const full = (gitLines(projectRoot, ['rev-parse', '--verify', `${t.done_commit}^{commit}`]) || [])[0];
      if (full && inRangeAll.includes(full)) shas.add(full);
    }
  }
  const criteria = new Set(Array.isArray(task.acceptance) ? task.acceptance : []);
  // OXB-156: the PR carries (a) the task's OWN commits (OXE-Task trailer / done_commit) and (b) the frozen tests it
  // proves, taken as FILES from the program tip (+ the local fixtures they import) — never the program branch's import
  // commits, which also carry other tasks' and parked tests (F2-T1: a conflict on tests/acceptance/parked-f3/…).
  const testFiles = [...new Set((Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [])
    .filter((a) => a && ((a.task && idSet.has(a.task)) || (!a.task && criteria.has(a.criterion))))
    .flatMap((a) => a.files || []))];
  if (!shas.size && !testFiles.length) throw new Error(`${taskId}: nenhum commit da tarefa fora de ${base} (sem trailer OXE-Task/done_commit em ${base}..HEAD) — já está na base?`);
  const programTip = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
  // local fixtures the frozen tests import (relative specifiers), one level deep — OXB-160: only what resolves INSIDE
  // the tests' own tree (fixtures, helpers), resolved like node/TS (file, extensions, then dir/index.*) and only to a
  // file: product modules the test imports (`../../../shared/types/ipc`, a directory) are never copied.
  const withFixtures = (() => {
    const out = new Set(testFiles);
    for (const file of testFiles) {
      const root = promoteTestRoot(file);
      const text = (gitRun(projectRoot, ['show', `${programTip}:${file}`]).stdout) || '';
      for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const cand = resolveImportAt(projectRoot, programTip, path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
        if (cand && (cand + '/').startsWith(root + '/') && !/\/src\//.test(`/${cand}`)) out.add(cand);
      }
    }
    return [...out];
  })();
  const ordered = (gitLines(projectRoot, ['rev-list', '--reverse', '--topo-order', range]) || []).filter((sha) => shas.has(sha));
  // OXB-169: other tasks' unpromoted commits BEFORE this task's, on the same files — this diff assumes them; the
  // cherry-pick will likely conflict. Name them and the combined promote.
  const assumed = promoteAssumedTasks(projectRoot, range, ordered, idSet, phaseCtx);
  const original = (gitLines(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || [])[0];
  const originalSha = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
  const branch = String(options.branch || `oxe/promote-${taskId.toLowerCase()}`).trim();
  // Never a force-push: a branch already on the remote with commits we do not have is refused before anything changes.
  const remote = String(options.remote || 'origin');
  // OXB-160: a local branch an earlier (failed) promote left behind — created by the promote, never pushed — is
  // reused: dropped and rebuilt. Any other existing branch is refused, as before.
  let replacedBranch = null;
  // OXB-162: the promote's own branch already on the remote with NO PR (a run that died, or pr:ready red) is rebuilt
  // and force-pushed with a lease on the sha it has now. A branch with a PR, or with commits that are not the
  // promote's, is refused as before.
  const remoteHead0 = gitRun(projectRoot, ['ls-remote', '--heads', remote, branch]);
  const remoteSha = remoteHead0.ok ? remoteHead0.stdout.trim().split(/\s+/)[0] : '';
  let forceLease = null;
  if (remoteSha) {
    const own = ownPushedPromoteBranch(projectRoot, activeSession, branch, remote, remoteSha, baseSha, options);
    if (!own.ok) throw new Error(`a branch ${branch} já existe em ${remote} (${remoteSha.slice(0, 8)}) — ${own.why}; o promote não sobrescreve; use --branch <outra>`);
    forceLease = remoteSha;
  }
  if (gitLines(projectRoot, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])) {
    const own = ownUnpushedPromoteBranch(projectRoot, branch, remote, baseSha, { allowRemote: Boolean(forceLease) });
    if (!own.ok) throw new Error(`a branch ${branch} já existe${own.why ? ` (${own.why})` : ''} — use --branch <outra> ou apague-a`);
    const del = gitRun(projectRoot, ['branch', '-D', branch]);
    if (!del.ok) throw new Error(`a branch ${branch} (de um promote anterior) não pôde ser recriada: ${del.stderr.trim()}`);
    replacedBranch = own.sha;
  }
  const pushArgs = () => ['push', ...(forceLease ? [`--force-with-lease=${branch}:${forceLease}`] : []), '-u', remote, branch];
  // OXB-161: a dependency promoted but not merged yet → the branch is built ON TOP of its promote branch (stacked);
  // the PR still targets the base, carrying the dependency's commits until it merges. --hold-deps waits instead.
  const stackInfo = promoteStack(projectRoot, activeSession, task, { base, baseSha, remote, options });
  baseSha = stackInfo.baseSha;
  const stack = stackInfo.stack;
  const buildSha = stack ? stack.sha : baseSha;
  resolvedBase.warnings = [...(resolvedBase.warnings || []), ...stackInfo.warnings];
  if (assumed.length && !stack) {
    resolvedBase.warnings.push(`${taskId} vem depois de ${assumed.map((a) => `${a.task} (${a.sha.slice(0, 8)})`).join(', ')} no histórico e mexe nos mesmos arquivos (${[...new Set(assumed.flatMap((a) => a.files))].slice(0, 4).join(', ')}) — o cherry-pick pode conflitar; promova junto: oxe-cc runtime promote --tasks ${[...new Set([...assumed.map((a) => a.task), ...taskIds])].join(',')}`);
  }
  const result = { task: taskId, base, base_sha: baseSha, ...(stack ? { stacked_on: { task: stack.task, branch: stack.branch, pr: stack.pr || null, sha: stack.sha } } : {}), base_requested: resolvedBase.requested, warnings: resolvedBase.warnings, branch, commits: ordered, conflict: null, pr_ready: null, body_file: null, pr: null, commands: [], worktree: null, ...(replacedBranch ? { replaced_branch: replacedBranch } : {}), ...(forceLease ? { replaced_remote: forceLease } : {}) };
  // Where the branch is built: a temporary worktree (default) or, with --in-place, the program checkout.
  let work = projectRoot;
  let cleanup = () => {};
  if (inPlace) {
    const back = () => gitRun(projectRoot, ['checkout', '-q', original && original !== 'HEAD' ? original : originalSha]);
    const co = gitRun(projectRoot, ['checkout', '-q', '-b', branch, buildSha]);
    if (!co.ok) throw new Error(`não foi possível criar ${branch}: ${co.stderr.trim()}`);
    gitRun(projectRoot, ['config', `branch.${branch}.oxePromote`, 'true']);
    cleanup = back;
  } else {
    const wt = path.join(projectRoot, '.oxe', 'promote-ws', `${taskId.toLowerCase()}-${Date.now().toString(36)}`);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    // OXB-162: worktrees of killed promotes (their junction unlinked first), and this one's pid for the next sweep.
    result.swept = sweepStalePromoteWorkspaces(projectRoot);
    fs.writeFileSync(`${wt}.pid`, JSON.stringify({ pid: process.pid, task: taskId, at: new Date().toISOString() }));
    const add = gitRun(projectRoot, ['worktree', 'add', '-q', '-b', branch, wt, buildSha]);
    if (!add.ok) throw new Error(`não foi possível criar a worktree de ${branch}: ${add.stderr.trim()}`);
    gitRun(projectRoot, ['config', `branch.${branch}.oxePromote`, 'true']);
    work = wt;
    // OXB-163: machine-local files (worktree.copy_local) pr:ready needs (gradle's local.properties, .env.local).
    try { result.local_copied = require('./oxe-local-config.cjs').copyLocalFiles(projectRoot, wt).copied; } catch { /* auxiliar */ }
    result.worktree = path.relative(projectRoot, wt).replace(/\\/g, '/');
    // pr:ready needs the dependencies: a junction to the program's node_modules (or deps_link_from), never an install.
    let linked = false;
    try {
      const pc = require('./oxe-parallel.cjs').parallelConfig(projectRoot);
      const from = pc.deps && pc.deps.from ? pc.deps.from : projectRoot;
      const src = path.join(from, 'node_modules');
      if (fs.existsSync(src) && !fs.existsSync(path.join(wt, 'node_modules'))) {
        fs.symlinkSync(fs.realpathSync(src), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        linked = true;
      }
    } catch { /* pr:ready reports the missing deps */ }
    cleanup = () => {
      // Links first (a junction must never be followed by a recursive delete), then the worktree — never --force.
      try {
        const rt = loadRuntimeModule();
        if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(wt);
        else if (linked) fs.unlinkSync(path.join(wt, 'node_modules'));
      } catch { /* */ }
      const rm = gitRun(projectRoot, ['worktree', 'remove', wt]);
      if (rm.ok) { try { fs.rmSync(`${wt}.pid`, { force: true }); } catch { /* */ } }
      if (!rm.ok) result.cleanup_warning = `worktree ${result.worktree} não removida (${rm.stderr.trim().split(/\r?\n/).pop()}) — remova à mão depois de conferir que não há links dentro`;
      gitRun(projectRoot, ['worktree', 'prune']);
    };
  }
  // OXB-162: Ctrl+C / SIGTERM while the promote runs still unlinks and removes its worktree (a hard kill is swept by
  // the next promote).
  const onSignal = (sig) => { try { cleanup(); } catch { /* */ } process.exit(sig === 'SIGINT' ? 130 : 143); };
  const signals = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) process.once(sig, onSignal);
  try {
    for (const sha of ordered) {
      const pick = gitRun(work, ['cherry-pick', '-x', sha]);
      if (!pick.ok) {
        const files = gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [];
        gitRun(work, ['cherry-pick', '--abort']);
        result.conflict = { commit: sha, files };
        result.error = `conflito no cherry-pick de ${sha.slice(0, 8)} (${files.join(', ') || 'sem arquivos'}) — branch ${branch} descartada; ${assumed.length ? `a tarefa depende de commits de ${assumed.map((a) => a.task).join(', ')} feitos antes dela: promova junto (--tasks ${[...new Set([...assumed.map((a) => a.task), ...taskIds])].join(',')}) — ` : ''}ou resolva à mão / rode runtime sync --from ${base} antes`;
        break;
      }
    }
    // OXB-156 (b): the task's frozen tests as files from the program tip; identical-on-base ones are skipped.
    if (!result.conflict && withFixtures.length) {
      const added = [];
      for (const file of withFixtures) {
        const tip = gitRun(projectRoot, ['show', `${programTip}:${file}`]);
        if (!tip.ok) continue;
        const onBase = gitRun(projectRoot, ['show', `${baseSha}:${file}`]);
        const current = fs.existsSync(path.join(work, file)) ? fs.readFileSync(path.join(work, file), 'utf8') : null;
        if ((onBase.ok && onBase.stdout === tip.stdout) || current === tip.stdout) continue;
        const r = spawnSync('git', ['show', `${programTip}:${file}`], { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
        fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
        fs.writeFileSync(path.join(work, file), r.stdout);
        added.push(file);
      }
      if (added.length) {
        gitRun(work, ['add', '--', ...added]);
        const c = gitRun(work, ['commit', '-q', '-m', `test(acceptance): frozen tests of ${taskId}`, '-m', `From the program branch at ${String(programTip).slice(0, 10)}: ${added.join(', ')}`]);
        if (!c.ok) result.error = `commit dos testes congelados falhou: ${c.stderr.trim().split(/\r?\n/).pop()}`;
      }
      result.frozen_tests = added;
    }
    // OXB-158: with --open-pr the branch is pushed FIRST — pr:ready posts its GitHub status on the pushed sha (before,
    // it passed its checks, failed to post "… is not on GitHub yet: push it first", and the PR was never opened).
    if (!result.conflict && options.openPr && !result.error) {
      const push = gitRun(work, pushArgs());
      if (!push.ok) result.error = `push falhou: ${push.stderr.trim().split(/\r?\n/).slice(-2).join(' · ')}`;
      else result.pushed = true;
    }
    // The project's own PR checks, on the promoted branch.
    if (!result.conflict && !result.error) {
      let pkg = null;
      try { pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')); } catch { pkg = null; }
      if (pkg && pkg.scripts && pkg.scripts['pr:ready'] && options.prReady !== false) {
        const ready = runProgressCommand(work, 'npm run pr:ready', 1_800_000, { quiet: options.quietProgress === true || process.env.OXE_PROGRESS === '0' });
        // OXB-158: "the checks failed" is not "only posting the status failed".
        // Only the status post failed when the output says so AND, without those lines, nothing else reports a failure.
        const tail = String(ready.tail || '');
        const STATUS_LINE = /not on GitHub yet|push it first|(post|create|set)\w*\s+(the\s+)?(commit\s+)?status/i;
        // npm's own wrapper lines ("npm error Lifecycle script … failed", "npm error code 1") say "failed" for ANY
        // non-zero exit: they are not a check result.
        const otherLines = tail.split(/\r?\n/).filter((l) => !STATUS_LINE.test(l) && !/^\s*npm (ERR!|error|warn)\b/i.test(l)).join('\n');
        const statusOnly = !ready.ok && STATUS_LINE.test(tail) && !/\bFAIL\b|\bfailed\b|✗|×|error TS\d+|\d+ (failing|failed)/i.test(otherLines);
        result.pr_ready = { ok: ready.ok || statusOnly, tail: ready.tail, ...(statusOnly ? { status_post_failed: true } : {}) };
      }
    }
  } finally {
    for (const sig of signals) process.removeListener(sig, onSignal);
    cleanup();
  }
  if (result.conflict) {
    gitRun(projectRoot, ['branch', '-D', branch]);
    appendEvent(projectRoot, activeSession, { type: 'TaskPromoteFailed', work_item_id: taskId, payload: { base, reason: result.error || 'conflict', commit: result.conflict.commit, files: result.conflict.files } });
    return result;
  }
  // PR body: the task, its files and criteria, the CRs on those criteria.
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const crs = require('./oxe-change.cjs').listChanges(paths.programDir || path.join(projectRoot, '.oxe', 'program'))
    .filter((cr) => (cr.criteria || []).some((a) => criteria.has(a)));
  const body = [
    `## ${taskId} — ${task.title || ''}`.trim(),
    '',
    `Promovida de \`${original}\` por \`oxe-cc runtime promote\` (cherry-pick -x de ${ordered.length} commit(s)).`,
    '',
    ...(stack ? [
      `> **Empilhada sobre ${stack.task}** (${stack.pr ? `PR ${stack.pr}, ` : ''}branch \`${stack.branch}\`), ainda não mergeada em \`${base}\`: este PR traz os commits dela até ela entrar. Mergeie ${stack.task} primeiro; depois disso o diff deste PR encolhe para os commits de ${taskId}.`,
      '',
    ] : []),
    '### Arquivos',
    ...(task.files || []).map((f) => `- \`${f}\``),
    '',
    `### Critérios: ${[...criteria].join(', ') || '—'}`,
    ...(crs.length ? ['', '### Change requests', ...crs.map((cr) => `- ${cr.id} (${cr.class}, ${cr.status}): ${cr.summary}`)] : []),
    '',
    '### Commits da tarefa',
    ...(ordered.length ? ordered.map((sha) => `- ${sha.slice(0, 10)} ${(gitLines(projectRoot, ['log', '-1', '--format=%s', sha]) || [''])[0]}`) : ['- —']),
    '',
    '### Testes congelados (arquivos do tip do programa)',
    ...((result.frozen_tests || []).length ? result.frozen_tests.map((f) => `- \`${f}\``) : ['- — (já na base, ou nenhum)']),
    ...(result.pr_ready ? ['', `### pr:ready: ${result.pr_ready.ok ? 'verde' : 'VERMELHO'}`] : []),
    '',
  ].join('\n');
  const bodyFile = path.join(projectRoot, '.oxe', 'promote', `${taskId}.md`);
  writeTextAtomic(bodyFile, body);
  result.body_file = path.relative(projectRoot, bodyFile).replace(/\\/g, '/');
  const title = `${taskId}: ${task.title || 'promote'}`;
  // OXB-157: the PR targets the branch NAME on the remote (`main`), not the local tracking ref (`origin/main`).
  const prBase = base.replace(new RegExp(`^${remote}/`), '');
  result.commands = [
    `git push -u ${remote} ${branch}`,
    `gh pr create --base ${prBase} --head ${branch} --title ${JSON.stringify(title)} --body-file ${result.body_file}`,
  ];
  if (options.openPr && !result.error) {
    if (result.pr_ready && !result.pr_ready.ok) {
      result.error = `pr:ready vermelho em ${branch} — PR não aberto (a branch já está em ${remote}; corrija e rode os comandos abaixo — o PR vai contra ${prBase}${stack ? `, não contra a branch de ${stack.task}` : ''})`;
    } else {
      // pushed before pr:ready (OXB-158); --in-place pushes here as before
      const push = result.pushed ? { ok: true } : gitRun(projectRoot, pushArgs());
      if (!push.ok) result.error = `push falhou: ${push.stderr.trim().split(/\r?\n/).slice(-2).join(' · ')}`;
      else {
        const gh = (options.ghSpawn || spawnSync)('gh', ['pr', 'create', '--base', prBase, '--head', branch, '--title', title, '--body-file', bodyFile], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
        if (gh.status === 0) result.pr = String(gh.stdout || '').trim().split(/\r?\n/).pop();
        else result.error = `gh pr create falhou: ${String(gh.stderr || gh.stdout || '').trim().split(/\r?\n/).slice(-2).join(' · ')}`;
      }
    }
  }
  appendEvent(projectRoot, activeSession, { type: 'TaskPromoted', work_item_id: taskId, payload: { base, branch, commits: ordered, pr_ready: result.pr_ready ? result.pr_ready.ok : null, pr: result.pr, ...(stack ? { stacked_on: result.stacked_on } : {}) } });
  return result;
}

/**
 * OXB-076: what removing criteria from the CURRENT plan means — their acceptance tests go, they leave the tasks'
 * `acceptance`, and a pending task left with no criterion goes too. Refused when another pending task depends on a
 * task that would go, or when such a task has a checkpoint (its work exists). Returns the new doc (not written).
 */
function planWithoutCriteria(doc, criteria) {
  const drop = new Set(criteria);
  const next = JSON.parse(JSON.stringify(doc));
  next.acceptance_tests = (next.acceptance_tests || []).filter((t) => !t || !drop.has(t.criterion));
  const removedTasks = [];
  for (const task of next.tasks || []) {
    if (!Array.isArray(task.acceptance) || !task.acceptance.some((a) => drop.has(a))) continue;
    task.acceptance = task.acceptance.filter((a) => !drop.has(a));
    if (!task.acceptance.length && task.done !== true) removedTasks.push(task.id);
  }
  const blockers = [];
  for (const id of removedTasks) {
    const task = next.tasks.find((t) => t.id === id);
    if (task.done_commit) blockers.push(`${id} tem checkpoint (${String(task.done_commit).slice(0, 8)})`);
    const dependents = next.tasks.filter((t) => t.id !== id && !removedTasks.includes(t.id) && (t.depends_on || t.dependsOn || []).includes(id));
    if (dependents.length) blockers.push(`${dependents.map((t) => t.id).join(', ')} depende(m) de ${id}`);
  }
  if (blockers.length) throw new Error(`não dá para tirar ${criteria.join(', ')} do plano atual: ${blockers.join('; ')} — ajuste o plano (/oxe-plan) antes`);
  next.tasks = (next.tasks || []).filter((t) => !removedTasks.includes(t.id));
  return { doc: next, removedTasks, removedTests: (doc.acceptance_tests || []).filter((t) => t && drop.has(t.criterion)).map((t) => t.id || t.criterion) };
}

/**
 * OXB-076: `oxe-cc program phase edit Fn [--title] [--add-requirements] [--remove-requirements] [--add-acceptance]
 * [--remove-acceptance] [--scope] --by …`: edits PROGRAM.json and the ROADMAP section together, logs a program_edit
 * and refreshes the export. Adding goes only into a phase that has not started (pending, no plan/run). Removing from
 * the active phase also takes the criterion out of the current plan (planWithoutCriteria); a closed phase is refused.
 */
function runtimeProgramPhaseEdit(projectRoot, activeSession, options = {}, internal = {}) {
  const specEdit = require('./oxe-spec-edit.cjs');
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const { by, reason } = requireEditReason({ by: options.by, reason: options.reason || `edição da fase ${options.phase}` });
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const state = internal.state || programLib.readProgram(programDir);
  if (!state) throw new Error('Sem programa. Rode `oxe-cc runtime program init`.');
  const norm = (id) => { const k = String(id || '').trim().toUpperCase().replace(/^(?:FASE|PHASE)\s*/, 'F'); return /^\d+$/.test(k) ? `F${k}` : k; };
  const phaseId = norm(options.phase);
  const next = JSON.parse(JSON.stringify(state));
  const phase = next.phases.find((p) => p.id.toUpperCase() === phaseId);
  if (!phase) throw new Error(`fase ${options.phase} não existe no programa`);
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const addReq = list(options.addRequirements);
  const remReq = list(options.removeRequirements);
  const addAcc = list(options.addAcceptance);
  const remAcc = list(options.removeAcceptance);
  // OXB-082: --scope-file scope.md gives the scope line and its bullets in one go.
  let scopeBullets = null;
  if (options.scopeFile) {
    const file = path.resolve(projectRoot, String(options.scopeFile));
    if (!fs.existsSync(file)) throw new Error(`--scope-file não encontrado: ${options.scopeFile}`);
    const parsed = specEdit.parseScopeFile(fs.readFileSync(file, 'utf8'));
    if (!parsed.scope && !parsed.bullets.length) throw new Error(`--scope-file vazio: ${options.scopeFile}`);
    options = { ...options, scope: parsed.scope || (options.scope != null ? options.scope : (phase.scope || '')) };
    scopeBullets = parsed.bullets;
  }
  // OXB-033: --depends-on F1,F3 (or "none": no dependency; "roadmap": back to the serial default).
  let dependsOn;
  if (options.dependsOn != null) {
    const raw = String(options.dependsOn).trim().toLowerCase();
    dependsOn = raw === 'roadmap' ? null : raw === 'none' || raw === '' ? [] : [...new Set(String(options.dependsOn).split(',').map((x) => norm(x)).filter(Boolean))];
  }
  if (!addReq.length && !remReq.length && !addAcc.length && !remAcc.length && options.title == null && options.scope == null && dependsOn === undefined) {
    throw new Error('nada a editar: use --title, --scope, --add-requirements, --remove-requirements, --add-acceptance ou --remove-acceptance');
  }
  const notStarted = phase.status === 'pending' && !phase.plan_ref && !phase.run_id && !phase.started_at && state.active_phase !== phase.id;
  if (phase.status === 'closed') throw new Error(`${phase.id} está fechada — mude o escopo de uma fase fechada com um CR (runtime feedback), não editando a fase`);
  if ((addReq.length || addAcc.length) && !notStarted) throw new Error(`${phase.id} já começou (${phase.status}${phase.plan_ref ? ', com plano' : ''}) — critérios e requisitos novos entram numa fase ainda não iniciada (ou via CR)`);
  const standingIds = require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot);
  for (const a of addAcc) if (standingIds.includes(a)) throw new Error(`${a} é permanente (program.standing_acceptance): vale em todo close de fase, por sign-off com evidência — não se adiciona a uma fase`);
  for (const a of addAcc) {
    const other = next.phases.find((p) => p.id !== phase.id && (p.acceptance || []).includes(a));
    if (other && !internal.moving) throw new Error(`${a} já pertence a ${other.id} — use oxe-cc program criterion move ${a} --from ${other.id} --to ${phase.id}`);
  }
  const missingRem = remAcc.filter((a) => !(phase.acceptance || []).includes(a));
  if (missingRem.length) throw new Error(`${missingRem.join(', ')} não está(ão) em ${phase.id}`);
  // Removing from a phase that already has a plan: the criterion leaves the current plan as well.
  let planChange = null;
  if (remAcc.length && !notStarted && state.active_phase === phase.id) {
    const jsonPath = require('./oxe-plan-json.cjs').planJsonPathFor(paths.plan);
    if (jsonPath && fs.existsSync(jsonPath)) {
      planChange = { jsonPath, ...planWithoutCriteria(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), remAcc) };
    }
  }
  const before = { title: phase.title, requirements: [...(phase.requirements || [])], acceptance: [...(phase.acceptance || [])], scope: phase.scope || null };
  if (options.title != null) phase.title = String(options.title).trim();
  if (options.scope != null) phase.scope = String(options.scope).trim() || null;
  if (dependsOn !== undefined) {
    if (phase.status !== 'pending' || phase.started_at) throw new Error(`${phase.id} já começou — dependências mudam só em fase não iniciada`);
    if (dependsOn === null) delete phase.depends_on; else phase.depends_on = dependsOn;
    const depErrors = requireProgramRuntime().validatePhaseDependencies(next.phases);
    if (depErrors.length) throw new Error(depErrors.join('; '));
  }
  phase.requirements = [...new Set([...(phase.requirements || []).filter((r) => !remReq.includes(r)), ...addReq])];
  phase.acceptance = [...new Set([...(phase.acceptance || []).filter((a) => !remAcc.includes(a)), ...addAcc])];
  next.updated_at = new Date().toISOString();
  const specText = readTextIfExists(paths.spec) || '';
  const warnings = [];
  const knownA = new Set(specEdit.criteriaIds(specText));
  const knownR = new Set(specEdit.requirementIds(specText));
  for (const a of addAcc) if (knownA.size && !knownA.has(a)) warnings.push(`${a} não está na tabela de critérios da SPEC (oxe-cc spec add criterion ${a} …)`);
  for (const r of addReq) if (knownR.size && !knownR.has(r)) warnings.push(`${r} não está nos requisitos da SPEC (oxe-cc spec add requirement ${r} …)`);
  const roadmapText = internal.roadmapText != null ? internal.roadmapText : readTextIfExists(paths.roadmap);
  if (!roadmapText) throw new Error(`ROADMAP.md não encontrado (${paths.roadmap})`);
  const roadmap = specEdit.editRoadmapPhase(roadmapText, phase.id, {
    ...(options.title != null ? { title: phase.title } : {}),
    ...(addReq.length || remReq.length ? { requirements: phase.requirements } : {}),
    ...(addAcc.length || remAcc.length ? { acceptance: phase.acceptance } : {}),
    ...(options.scope != null ? { scope: phase.scope || '', keepBullets: Boolean(options.keepBullets), scopeBullets } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
  });
  if (roadmap.removed_bullets && roadmap.removed_bullets.length) warnings.push(`escopo antigo substituído: ${roadmap.removed_bullets.length} bullet(s) removido(s) do ROADMAP (${roadmap.removed_bullets.map((b) => b.slice(0, 50)).join(' | ')}) — use --keep-bullets para mantê-los`);
  const record = { kind: 'program_edit', action: internal.action || 'phase_edit', phase: phase.id, before, after: { title: phase.title, requirements: phase.requirements, acceptance: phase.acceptance, scope: phase.scope || null }, ...(roadmap.removed_bullets && roadmap.removed_bullets.length ? { scope_bullets_removed: roadmap.removed_bullets } : {}), ...(scopeBullets ? { scope_bullets: scopeBullets } : {}), ...(planChange ? { plan_removed_tasks: planChange.removedTasks, plan_removed_tests: planChange.removedTests } : {}), by, reason, at: new Date().toISOString() };
  if (internal.dryRun) return { state: next, roadmapText: roadmap.text, planChange, record, warnings };
  programLib.writeProgram(programDir, next);
  writeTextAtomic(paths.roadmap, roadmap.text);
  if (planChange) writeTextAtomic(planChange.jsonPath, `${JSON.stringify(planChange.doc, null, 2)}\n`);
  changeLib.appendNdjson(changeLib.changesFile(programDir), record);
  appendEvent(projectRoot, activeSession, { type: 'ProgramPhaseEdited', payload: { phase: phase.id, by } });
  return { phase: phase.id, before: record.before, after: record.after, plan_removed_tasks: planChange ? planChange.removedTasks : [], plan_removed_tests: planChange ? planChange.removedTests : [], warnings, export: autoExportProgram(projectRoot, activeSession) };
}

/**
 * OXB-076: `oxe-cc program criterion move A3 --from F1 --to F11 --by …`: both edits are checked before anything is
 * written (remove from --from, with the plan clean-up when it is the active phase; add to --to, which must not have
 * started), then PROGRAM.json, ROADMAP and the plan are written together, with one program_edit record.
 */
function runtimeProgramCriterionMove(projectRoot, activeSession, options = {}) {
  const changeLib = require('./oxe-change.cjs');
  const programLib = require('./oxe-program.cjs');
  const id = String(options.id || '').trim().toUpperCase();
  if (!/^A\d+$/.test(id)) throw new Error('informe o critério: oxe-cc program criterion move A<n> --from Fn --to Fm');
  const { by, reason } = requireEditReason({ by: options.by, reason: options.reason || `mover ${id} de ${options.from} para ${options.to}` });
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const removal = runtimeProgramPhaseEdit(projectRoot, activeSession, { phase: options.from, removeAcceptance: id, by, reason }, { dryRun: true, moving: true });
  const addition = runtimeProgramPhaseEdit(projectRoot, activeSession, { phase: options.to, addAcceptance: id, by, reason }, { dryRun: true, moving: true, state: removal.state, roadmapText: removal.roadmapText });
  programLib.writeProgram(programDir, addition.state);
  writeTextAtomic(paths.roadmap, addition.roadmapText);
  if (removal.planChange) writeTextAtomic(removal.planChange.jsonPath, `${JSON.stringify(removal.planChange.doc, null, 2)}\n`);
  // The criterion's open CRs follow it to the new phase.
  const from = removal.record.phase;
  const to = addition.record.phase;
  const changesPath = changeLib.changesFile(programDir);
  let moved = 0;
  if (fs.existsSync(changesPath)) {
    const records = changeLib.readNdjson(changesPath).map((r) => {
      if (r && r.kind === 'cr' && r.phase === from && Array.isArray(r.criteria) && r.criteria.length === 1 && r.criteria[0] === id) { moved += 1; return { ...r, phase: to }; }
      return r;
    });
    if (moved) writeTextAtomic(changesPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  changeLib.appendNdjson(changesPath, { kind: 'program_edit', action: 'criterion_move', criterion: id, from, to, ...(removal.planChange ? { plan_removed_tasks: removal.planChange.removedTasks, plan_removed_tests: removal.planChange.removedTests } : {}), moved_change_records: moved, by, reason, at: new Date().toISOString() });
  appendEvent(projectRoot, activeSession, { type: 'ProgramCriterionMoved', payload: { criterion: id, from, to, by } });
  return { criterion: id, from, to, plan_removed_tasks: removal.planChange ? removal.planChange.removedTasks : [], plan_removed_tests: removal.planChange ? removal.planChange.removedTests : [], moved_change_records: moved, warnings: [...removal.warnings, ...addition.warnings], export: autoExportProgram(projectRoot, activeSession) };
}

/**
 * OXB-087: `oxe-cc plan append --from extra.json --by <papel> --reason "…"`: adds a batch of tasks to the active
 * phase's PLAN.json, also while an execute is running. The batch's own ids are renumbered after the plan's last T<n>
 * (its internal depends_on follow; a depends_on that is not a batch id must be a task of the plan); its waves are
 * shifted after the plan's last wave, so they run after the tasks in flight. Its acceptance_tests are appended. The
 * merged plan must pass the same `plan lint` (preflight off) or nothing is written. The running execute keeps its
 * graph; the next `runtime execute` recompiles the same run (done tasks skipped) and runs the batch. The phase closes
 * only when every task of every batch is done (PLAN.json is the source of truth, OXB-059).
 */
function runtimePlanAppend(projectRoot, activeSession, options = {}) {
  const planJsonLib = require('./oxe-plan-json.cjs');
  const changeLib = require('./oxe-change.cjs');
  const { by, reason } = requireEditReason({ by: options.by, reason: options.reason });
  if (!options.from) throw new Error('informe o lote: oxe-cc plan append --from extra.json --by <papel> --reason "…"');
  const fromFile = path.resolve(projectRoot, String(options.from));
  let extra;
  try { extra = JSON.parse(fs.readFileSync(fromFile, 'utf8')); } catch (err) { throw new Error(`--from ${options.from}: ${err.code === 'ENOENT' ? 'arquivo não encontrado' : `JSON inválido (${err.message})`}`); }
  const batchTasks = Array.isArray(extra) ? extra : Array.isArray(extra && extra.tasks) ? extra.tasks : null;
  if (!batchTasks || !batchTasks.length) throw new Error(`--from ${options.from}: sem tarefas ("tasks": [ … ])`);
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
  if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('sem PLAN.json na fase ativa — o primeiro lote é o plano (oxe-cc plan merge / /oxe-plan)');
  return planJsonLib.withPlanLock(jsonPath, () => {
    const originalText = fs.readFileSync(jsonPath, 'utf8');
    const doc = JSON.parse(originalText);
    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    const existing = new Set(tasks.map((t) => t && t.id));
    const num = (id) => Number(String(id || '').replace(/^T/, '')) || 0;
    let nextId = Math.max(0, ...tasks.map((t) => num(t && t.id))) + 1;
    const lastWave = Math.max(0, ...tasks.map((t) => (t && Number.isInteger(t.wave) ? t.wave : 0)));
    const minBatchWave = Math.min(...batchTasks.map((t) => (Number.isInteger(t && t.wave) && t.wave >= 1 ? t.wave : 1)));
    const idMap = new Map();
    batchTasks.forEach((t, i) => {
      const own = t && t.id != null ? String(t.id) : `#${i}`;
      if (idMap.has(own)) throw new Error(`lote: id repetido ${own}`);
      idMap.set(own, `T${nextId++}`);
    });
    const errors = [];
    const appended = batchTasks.map((t, i) => {
      const own = t && t.id != null ? String(t.id) : `#${i}`;
      const deps = (Array.isArray(t.depends_on) ? t.depends_on : []).map(String).map((d) => {
        if (idMap.has(d)) return idMap.get(d);
        if (existing.has(d)) return d;
        errors.push(`lote ${own}: depends_on "${d}" não é do lote nem do plano`);
        return d;
      });
      const wave = lastWave + ((Number.isInteger(t.wave) && t.wave >= 1 ? t.wave : 1) - minBatchWave) + 1;
      const { id: _drop, done: _d, done_at: _da, done_commit: _dc, ...rest } = t;
      return { ...rest, id: idMap.get(own), wave, ...(deps.length ? { depends_on: deps } : {}), batch: (doc.batches ? doc.batches.length : 1) + 1, ...(own !== idMap.get(own) && t.id != null ? { batch_ref: own } : {}) };
    });
    if (errors.length) throw new Error(errors.join('\n'));
    const batchNo = (doc.batches ? doc.batches.length : 1) + 1;
    const next = {
      ...doc,
      tasks: [...tasks, ...appended],
      ...(Array.isArray(extra.acceptance_tests) && extra.acceptance_tests.length ? { acceptance_tests: [...(doc.acceptance_tests || []), ...extra.acceptance_tests] } : {}),
      batches: [
        ...(doc.batches || [{ batch: 1, tasks: tasks.map((t) => t.id), at: null, from: 'PLAN.json' }]),
        { batch: batchNo, tasks: appended.map((t) => t.id), from: path.relative(projectRoot, fromFile).replace(/\\/g, '/'), by, reason, at: new Date().toISOString() },
      ],
    };
    const schemaErrors = planJsonLib.validatePlanJson(next);
    if (schemaErrors.length) throw new Error(`o lote não passa no schema do PLAN.json:\n  ${schemaErrors.join('\n  ')}`);
    // The same lint as the first batch: an error the batch INTRODUCES rolls the append back (errors the plan already
    // had — e.g. a missing pack the TL waived — are not the batch's and do not block it; they stay in the warnings).
    const runLint = () => {
      try {
        return runtimePlanLint(projectRoot, activeSession, { preflight: false, ...(options.lintOptions || {}) });
      } catch (err) {
        return { ok: false, errors: [err.message], warnings: [] };
      }
    };
    const baseline = new Set(runLint().errors || []);
    const tmp = `${jsonPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, jsonPath);
    const after = runLint();
    const introduced = (after.errors || []).filter((e) => !baseline.has(e));
    const lint = { ok: introduced.length === 0, errors: introduced, warnings: [...(after.warnings || []), ...[...baseline].filter((e) => (after.errors || []).includes(e)).map((e) => `já existia antes do lote: ${e}`)] };
    if (!lint.ok) {
      fs.writeFileSync(tmp, originalText, 'utf8');
      fs.renameSync(tmp, jsonPath);
      const e = new Error(`plan lint reprovou o lote (nada foi gravado):\n  ${lint.errors.join('\n  ')}`);
      e.lint = lint;
      throw e;
    }
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    if (fs.existsSync(programDir)) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'program_edit', action: 'plan_append', batch: batchNo, tasks: appended.map((t) => t.id), from: next.batches[next.batches.length - 1].from, by, reason, at: new Date().toISOString() });
    }
    appendEvent(projectRoot, activeSession, { type: 'PlanBatchAppended', payload: { batch: batchNo, tasks: appended.map((t) => t.id), by } });
    return { batch: batchNo, tasks: appended.map((t) => ({ id: t.id, wave: t.wave, title: t.title, ...(t.batch_ref ? { from_id: t.batch_ref } : {}) })), warnings: lint.warnings || [] };
  });
}

/**
 * OXB-036: `oxe-cc runtime program budget --mode cap|track_only [--budget-usd N] [--budget-turns N] --by <papel>
 * --reason "…"`: the program's budget policy (PROGRAM.json `budget_policy`), with the history of who decided what and
 * when. Without --mode it only reports the policy. `track_only` keeps the loop guards (suspicion rule, max turns per
 * attempt) and the spend record, with no cap; `cap` with usd/turns caps every run of every phase.
 */
function runtimeProgramBudget(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const changeLib = require('./oxe-change.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const state = programLib.readProgram(paths.programDir);
  if (!state) throw new Error('Sem programa. Rode `oxe-cc runtime program init`.');
  if (!options.mode) return { policy: state.budget_policy || null, changed: false };
  const mode = String(options.mode).trim();
  if (!['cap', 'track_only'].includes(mode)) throw new Error('--mode cap | track_only');
  const { by, reason } = requireEditReason({ by: options.by, reason: options.reason });
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const usd = num(options.usd);
  const turns = num(options.turns);
  if (mode === 'cap' && !(usd > 0) && !(turns > 0)) throw new Error('--mode cap exige --budget-usd N e/ou --budget-turns N');
  if (mode === 'track_only' && (usd != null || turns != null)) throw new Error('track_only não tem teto — tire --budget-usd/--budget-turns (ou use --mode cap)');
  const at = new Date().toISOString();
  const prev = state.budget_policy || null;
  const entry = { mode, usd: mode === 'cap' ? usd : null, turns: mode === 'cap' ? turns : null, by, reason, at };
  const next = { ...state, budget_policy: { mode, usd: entry.usd, turns: entry.turns, decided_by: by, decided_at: at, history: [...((prev && prev.history) || []), entry] }, updated_at: at };
  programLib.writeProgram(paths.programDir, next);
  changeLib.appendNdjson(changeLib.changesFile(paths.programDir), { kind: 'program_edit', action: 'budget_policy', before: prev ? { mode: prev.mode, usd: prev.usd, turns: prev.turns } : null, after: { mode, usd: entry.usd, turns: entry.turns }, by, reason, at });
  appendEvent(projectRoot, activeSession, { type: 'BudgetPolicyChanged', payload: { mode, usd: entry.usd, turns: entry.turns, by } });
  return { policy: next.budget_policy, changed: true, export: autoExportProgram(projectRoot, activeSession) };
}

/**
 * OXB-033: is a closed phase's work on `base`? Its own commits (first-parent, non-merge, base_commit..closed_commit, not
 * only .oxe/) must each be on base — as an ancestor, as a `cherry picked from commit <sha>` trailer (how
 * `runtime promote` delivers through PRs), or as an equivalent patch (`git cherry`). F1's close commit is never an
 * ancestor of main in the promote flow, so ancestry alone is the wrong test.
 * @returns {{ checked: number, delivered: string[], missing: Array<{sha:string, subject:string}>, note: string|null }}
 */
function phaseDeliveredOn(repoRoot, phase, base, options = {}) {
  const out = { checked: 0, delivered: [], missing: [], skipped_frozen: 0, note: null };
  // Frozen acceptance tests imported into the program branch (config parked_tests, default tests/acceptance/**) are the
  // plan's evidence, not work to promote: main gets the PR's own version of them.
  const cfg = readProjectConfig(repoRoot) || {};
  const frozenGlobs = (options.frozenGlobs || (Array.isArray(cfg.parked_tests) ? cfg.parked_tests : ['tests/acceptance/**'])).map((g) => require('./oxe-policy-rules.cjs').globToRegex(g));
  const isFrozen = (f) => frozenGlobs.some((re) => re.test(f));
  if (!phase.base_commit || !phase.closed_commit) { out.note = `${phase.id} sem base_commit/closed_commit — entrega não verificável`; return out; }
  const commits = (gitLines(repoRoot, ['rev-list', '--first-parent', '--no-merges', `${phase.base_commit}..${phase.closed_commit}`]) || []);
  const picked = new Set();
  for (const line of gitLines(repoRoot, ['log', base, '--format=%B', '--grep=cherry picked from commit']) || []) {
    const m = /cherry picked from commit ([0-9a-f]{7,40})/.exec(line);
    if (m) picked.add(m[1]);
  }
  const equivalent = new Set((gitLines(repoRoot, ['cherry', base, phase.closed_commit, phase.base_commit]) || []).filter((l) => l.startsWith('-')).map((l) => l.slice(2).trim()));
  for (const sha of commits) {
    const files = (gitLines(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]) || []).filter((f) => !f.startsWith('.oxe/'));
    if (!files.length) continue;
    if (files.every(isFrozen)) { out.skipped_frozen += 1; continue; }
    out.checked += 1;
    const ok = spawnSync('git', ['merge-base', '--is-ancestor', sha, base], { cwd: repoRoot, windowsHide: true }).status === 0
      || [...picked].some((p) => sha.startsWith(p) || p.startsWith(sha))
      || equivalent.has(sha);
    if (ok) out.delivered.push(sha);
    else out.missing.push({ sha, subject: ((gitLines(repoRoot, ['log', '-1', '--format=%s', sha]) || [])[0] || '').slice(0, 80) });
  }
  return out;
}

/**
 * OXB-033: `oxe-cc runtime program init --from <program worktree> [--phase Fn] [--base <ref>] [--allow-undelivered]`, run
 * in a NEW worktree: prepares its own .oxe/ from the program's one, to run an independent phase in parallel.
 *   copied:  SPEC/ROADMAP (unless spec_ref/roadmap_ref point to tracked files), config.json, program/PROGRAM.json (with
 *            NO active phase), changes/signoffs/decisions ndjson, regression/ and interfaces/ of closed phases, and their
 *            dossier (the handoffs "O que a próxima fase deve saber").
 *   never:   PLAN/pack/runs/events/caches/workspaces (all per worktree).
 * With --phase, each dependency of the phase must be closed there AND delivered on --base (default HEAD): every commit
 * of the dependency on base by ancestry, cherry-pick trailer or equivalent patch (phaseDeliveredOn); then the phase
 * starts here.
 */
function runtimeProgramInitFrom(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const changeLib = require('./oxe-change.cjs');
  if (!options.from) throw new Error('informe a worktree do programa: oxe-cc runtime program init --from <pasta> [--phase Fn]');
  const fromRoot = path.resolve(projectRoot, String(options.from));
  if (path.resolve(fromRoot) === path.resolve(projectRoot)) throw new Error('--from é a worktree do programa; rode o init na worktree NOVA');
  const src = resolveRuntimeArtifactPaths(fromRoot, activeSession);
  const srcState = programLib.readProgram(src.programDir);
  if (!srcState) throw new Error(`${options.from} não tem programa (.oxe/program/PROGRAM.json)`);
  const dstOxe = path.join(projectRoot, '.oxe');
  const dstProgramDir = path.join(dstOxe, 'program');
  if (programLib.readProgram(dstProgramDir) && !options.force) throw new Error('esta worktree já tem programa — use --force para recriar a partir de --from');
  const runtime = requireProgramRuntime();
  const wanted = options.phase ? runtime.findPhase(srcState, options.phase) : null;
  if (options.phase && !wanted) throw new Error(`fase ${options.phase} não existe no programa de ${options.from}`);
  // Delivery of the dependencies on this worktree's base.
  const base = String(options.base || 'HEAD');
  const delivery = [];
  if (wanted) {
    if (srcState.active_phase === wanted.id) throw new Error(`${wanted.id} está ativa em ${options.from} — uma fase roda numa worktree só`);
    if (wanted.status === 'closed') throw new Error(`${wanted.id} já está fechada`);
    for (const dep of runtime.phaseDependencies(srcState, wanted)) {
      if (dep.status !== 'closed') throw new Error(`${wanted.id} depende de ${dep.id}, que não está fechada em ${options.from}`);
      const d = phaseDeliveredOn(projectRoot, dep, base);
      delivery.push({ phase: dep.id, ...d });
      // Commits that reached the base through other PRs (different patch) cannot be matched: the report lists them, and
      // the safety net is the frozen regression of the closed phases, which runs in this phase's verify. --strict-delivery blocks.
      if (d.missing.length && options.strictDelivery && !options.allowUndelivered) {
        throw new Error(`${dep.id} não está toda em ${base}: ${d.missing.length} de ${d.checked} commit(s) da fase sem equivalente (${d.missing.slice(0, 4).map((m) => `${m.sha.slice(0, 8)} ${m.subject}`).join('; ')}) — mergeie os PRs promovidos, ou rode sem --strict-delivery (a regressão congelada da fase roda no verify desta)`);
      }
    }
  }
  const copyFile = (from, to) => { if (from && fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); return true; } return false; };
  const copyDir = (from, to) => { if (from && fs.existsSync(from)) { fs.mkdirSync(to, { recursive: true }); fs.cpSync(from, to, { recursive: true }); return true; } return false; };
  fs.mkdirSync(dstProgramDir, { recursive: true });
  const copied = [];
  const srcConfig = readProjectConfig(fromRoot) || {};
  if (copyFile(path.join(fromRoot, '.oxe', 'config.json'), path.join(dstOxe, 'config.json'))) copied.push('config.json');
  if (!srcConfig.spec_ref && copyFile(src.spec, path.join(dstOxe, 'SPEC.md'))) copied.push('SPEC.md');
  if (!srcConfig.roadmap_ref && copyFile(src.roadmap, path.join(dstOxe, 'ROADMAP.md'))) copied.push('ROADMAP.md');
  if (!fs.existsSync(path.join(dstOxe, 'STATE.md'))) fs.writeFileSync(path.join(dstOxe, 'STATE.md'), `# STATE\n\nWorktree de fase paralela (de ${fromRoot}).\n`);
  // OXB-163: machine-local files (gitignored) the new worktree needs to build: worktree.copy_local.
  const localCopy = require('./oxe-local-config.cjs').copyLocalFiles(fromRoot, projectRoot);
  for (const f of localCopy.copied) copied.push(`${f} (local da máquina)`);
  for (const name of ['changes.ndjson', 'signoffs.ndjson', 'decisions.ndjson']) if (copyFile(path.join(src.programDir, name), path.join(dstProgramDir, name))) copied.push(`program/${name}`);
  const closed = srcState.phases.filter((p) => p.status === 'closed').map((p) => p.id);
  for (const sub of ['regression', 'interfaces']) {
    for (const id of closed) if (copyFile(path.join(src.programDir, sub, `${id}.json`), path.join(dstProgramDir, sub, `${id}.json`))) copied.push(`program/${sub}/${id}.json`);
  }
  const srcDossier = path.join(path.dirname(src.plan || path.join(fromRoot, '.oxe', 'PLAN.md')), 'dossier');
  for (const id of closed) if (copyDir(path.join(srcDossier, id), path.join(dstOxe, 'dossier', id))) copied.push(`dossier/${id}`);
  const state = JSON.parse(JSON.stringify(srcState));
  state.active_phase = null;
  state.forked_from = { root: fromRoot, active_there: srcState.active_phase || null, at: new Date().toISOString() };
  state.updated_at = new Date().toISOString();
  programLib.writeProgram(dstProgramDir, state);
  copied.push('program/PROGRAM.json (sem fase ativa)');
  changeLib.appendNdjson(changeLib.changesFile(dstProgramDir), { kind: 'program_edit', action: 'program_fork', from: fromRoot, phase: wanted ? wanted.id : null, base, delivery: delivery.map((d) => ({ phase: d.phase, checked: d.checked, missing: d.missing.map((m) => m.sha) })), allow_undelivered: Boolean(options.allowUndelivered), by: options.by || 'program init --from', at: new Date().toISOString() });
  appendEvent(projectRoot, activeSession, { type: 'ProgramForked', payload: { from: fromRoot, phase: wanted ? wanted.id : null } });
  let started = null;
  if (wanted) started = runtimeProgramStart(projectRoot, activeSession, wanted.id);
  return { copied, delivery, started: started ? started.state.active_phase : null, ...runtimeProgramStatus(projectRoot, activeSession) };
}

/**
 * OXB-033: `oxe-cc runtime program adopt --from <worktree>`: an independent phase ran and closed in another worktree
 * (its own .oxe/); adopt brings its close into this program — status, close data, frozen regression and interfaces —
 * so the phases that depend on it can start here, and its regression joins theirs. Only phases closed THERE and not
 * closed HERE; an active phase here is never overwritten.
 */
function runtimeProgramAdopt(projectRoot, activeSession, options = {}) {
  const programLib = require('./oxe-program.cjs');
  const changeLib = require('./oxe-change.cjs');
  const { by, reason } = requireEditReason({ by: options.by || 'program adopt', reason: options.reason || `fases fechadas em ${options.from}` });
  if (!options.from) throw new Error('informe a worktree: oxe-cc runtime program adopt --from <pasta> [--phase Fn]');
  const fromRoot = path.resolve(projectRoot, String(options.from));
  const theirsPaths = resolveRuntimeArtifactPaths(fromRoot, activeSession);
  const theirs = programLib.readProgram(theirsPaths.programDir);
  if (!theirs) throw new Error(`${options.from} não tem programa (.oxe/program/PROGRAM.json)`);
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const ours = programLib.readProgram(paths.programDir);
  if (!ours) throw new Error('Sem programa aqui. Rode `oxe-cc runtime program init`.');
  const wanted = options.phase ? String(options.phase).toUpperCase() : null;
  const next = JSON.parse(JSON.stringify(ours));
  const adopted = [];
  const skipped = [];
  for (const tp of theirs.phases) {
    if (tp.status !== 'closed' || (wanted && tp.id !== wanted)) continue;
    const mine = next.phases.find((p) => p.id === tp.id);
    if (!mine) { skipped.push(`${tp.id}: não existe neste programa`); continue; }
    if (mine.status === 'closed') continue;
    if (next.active_phase === tp.id) { skipped.push(`${tp.id}: está ativa aqui — feche ou abandone aqui antes`); continue; }
    if (mine.title !== tp.title || JSON.stringify(mine.acceptance || []) !== JSON.stringify(tp.acceptance || [])) { skipped.push(`${tp.id}: o ROADMAP diverge entre as worktrees (título ou critérios) — alinhe antes de adotar`); continue; }
    for (const key of ['status', 'plan_ref', 'run_id', 'started_at', 'closed_at', 'closed_commit', 'base_commit', 'regression_ref', 'interfaces_ref']) if (tp[key] !== undefined) mine[key] = tp[key];
    mine.adopted_from = path.relative(projectRoot, fromRoot).replace(/\\/g, '/') || '.';
    // the phase's dossier (handoff for the phases that depend on it)
    try {
      const fromDossier = path.join(path.dirname(theirsPaths.plan || path.join(fromRoot, '.oxe', 'PLAN.md')), 'dossier', tp.id);
      if (fs.existsSync(fromDossier)) fs.cpSync(fromDossier, path.join(path.dirname(paths.plan || path.join(projectRoot, '.oxe', 'PLAN.md')), 'dossier', tp.id), { recursive: true });
    } catch { /* auxiliar */ }
    for (const sub of ['regression', 'interfaces']) {
      const src = path.join(theirsPaths.programDir, sub, `${tp.id}.json`);
      if (fs.existsSync(src)) {
        const dst = path.join(paths.programDir, sub, `${tp.id}.json`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
    adopted.push(tp.id);
  }
  if (!adopted.length) return { adopted, skipped, state: ours };
  // OXB-159: the adopted worktree's CRs come along; an id already taken here by another CR is renamed CR-<fase>-n and
  // the copied regression/interfaces/dossier of the adopted phases follow the rename.
  const fromRel = path.relative(projectRoot, fromRoot).replace(/\\/g, '/') || '.';
  const crMerge = changeLib.mergeChanges(paths.programDir, theirsPaths.programDir, { phase: adopted[0], from: fromRel });
  if (Object.keys(crMerge.renamed).length) {
    const dossierRoot = path.join(path.dirname(paths.plan || path.join(projectRoot, '.oxe', 'PLAN.md')), 'dossier');
    const walk = (dir) => { let out = []; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) out = out.concat(e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); } catch { /* */ } return out; };
    for (const id of adopted) {
      for (const sub of ['regression', 'interfaces']) changeLib.renameCrRefs(path.join(paths.programDir, sub, `${id}.json`), crMerge.renamed);
      for (const f of walk(path.join(dossierRoot, id))) if (/\.(md|json)$/i.test(f)) changeLib.renameCrRefs(f, crMerge.renamed);
    }
  }
  next.updated_at = new Date().toISOString();
  programLib.writeProgram(paths.programDir, next);
  changeLib.appendNdjson(changeLib.changesFile(paths.programDir), { kind: 'program_edit', action: 'phase_adopt', phases: adopted, from: next.phases.find((p) => p.id === adopted[0]).adopted_from, crs_merged: crMerge.merged, crs_renamed: crMerge.renamed, by, reason, at: new Date().toISOString() });
  appendEvent(projectRoot, activeSession, { type: 'PhaseAdopted', payload: { phases: adopted, from: options.from } });
  return { adopted, skipped, crs_merged: crMerge.merged, crs_renamed: crMerge.renamed, state: next, export: autoExportProgram(projectRoot, activeSession) };
}

/** OXB-058: doctor — .oxe/ gitignored with no versioned export means SPEC/ROADMAP/PROGRAM edits leave no history. */
function oxeHistoryWarning(projectRoot) {
  if (programExportDir(projectRoot)) return null;
  if (!fs.existsSync(path.join(projectRoot, '.oxe'))) return null;
  const res = spawnSync('git', ['check-ignore', '-q', '.oxe/SPEC.md'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return null;
  return '.oxe/ está no .gitignore e não há export versionado: emendas de SPEC/ROADMAP/PROGRAM ficam sem histórico. Rode `oxe-cc program export --out docs/oxe` e configure "program": { "export_dir": "docs/oxe" } no .oxe/config.json';
}

/**
 * OXB-059: where the phase's work stands, from PLAN.json (the source of truth), not from the last run. When every task
 * is done or waits only on an external delivery, the next step is closing the phase, whatever the last run said.
 * @returns {{ total: number, done: string[], external_pending: string[], pending: string[], complete: boolean,
 *   program: boolean, phase: string|null, multi_agent: boolean, next_steps: string[] }}
 */
function runtimePhaseWork(projectRoot, activeSession) {
  const planJsonLib = require('./oxe-plan-json.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
  let tasks = [];
  if (jsonPath && fs.existsSync(jsonPath)) {
    try { tasks = (JSON.parse(fs.readFileSync(jsonPath, 'utf8')).tasks || []).filter(Boolean); } catch { tasks = []; }
  }
  const done = [];
  const external = [];
  const pending = [];
  const waiting = {};
  for (const t of tasks) {
    if (t.done === true) done.push(t.id);
    // Waiting on another path (an external PR); a verify_only task still has a check to run, so it is pending.
    // OXB-085: a precondition object in blocked_by keeps the task pending (it is this plan's work), listed in `waiting`.
    else if (t.kind === 'external_delivery' || planJsonLib.externalRefs(t).length || (t.policy && Array.isArray(t.policy.external_dependency) && t.policy.external_dependency.length)) external.push(t.id);
    else {
      pending.push(t.id);
      const pre = planJsonLib.taskPreconditions(t);
      if (pre.length) waiting[t.id] = pre.map((p) => p.label);
    }
  }
  let program = null;
  try {
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    program = require('./oxe-program.cjs').readProgram(programDir);
  } catch { program = null; }
  const phase = program && program.active_phase ? program.active_phase : null;
  const agentPlans = [path.join(projectRoot, '.oxe', 'plan-agents.json')];
  if (activeSession) agentPlans.push(path.join(projectRoot, '.oxe', activeSession, 'plan', 'plan-agents.json'));
  const multiAgent = agentPlans.some((p) => fs.existsSync(p));
  const complete = tasks.length > 0 && pending.length === 0;
  const nextSteps = [];
  if (complete) {
    nextSteps.push('oxe-cc runtime verify');
    if (program) {
      nextSteps.push(`oxe-cc runtime dossier${phase ? ` --phase ${phase}` : ''}`);
      nextSteps.push(`oxe-cc runtime program close${phase ? ` --phase ${phase}` : ''}`);
    }
  } else if (pending.length) {
    nextSteps.push(`oxe-cc runtime execute  (pendentes: ${pending.join(', ')})`);
  }
  // OXB-157: a task the run completed (or with a checkpoint trailer) that PLAN.json does not mark done — e.g. a
  // regenerated PLAN.json that dropped the done writeback.
  const runDoneNotInPlan = [];
  try {
    const run = readRunState(projectRoot, activeSession) || {};
    const completed = new Set([...(Array.isArray(run.completed) ? run.completed : []), ...((run.canonical_state && run.canonical_state.completedWorkItems) || [])]);
    for (const id of pending) if (completed.has(id)) runDoneNotInPlan.push(id);
  } catch { /* auxiliar */ }
  return { total: tasks.length, done, external_pending: external, pending, waiting, complete, program: Boolean(program), phase, multi_agent: multiAgent, next_steps: nextSteps, run_done_not_in_plan: runDoneNotInPlan };
}

/** A task whose work was delivered outside this repo's executor (another PR, a check only). */
function isExternallyDelivered(rawTask, parsedTask) {
  const raw = rawTask || {};
  const meta = (parsedTask && parsedTask.meta) || {};
  if (raw.kind === 'external_delivery' || raw.kind === 'verify_only') return true;
  // OXB-085: only string entries mean "delivered by another path"; a precondition object is a wait, not a delivery.
  if (require('./oxe-plan-json.cjs').externalRefs(raw).length) return true;
  const pendingLabels = new Set(meta.precondition_pending || []);
  if (Array.isArray(meta.blocked_by) && meta.blocked_by.some((ref) => !pendingLabels.has(ref))) return true;
  if (Array.isArray(meta.external_resolved) && meta.external_resolved.length) return true;
  const policy = raw.policy || {};
  return Boolean(policy.verify_only || (Array.isArray(policy.external_dependency) && policy.external_dependency.length));
}

/**
 * OXB-061: which done tasks a CR reopens. Explicit `--tasks` wins; otherwise the closer of each criterion (or, when a
 * criterion has no single closer, its sink tasks). External deliveries are filtered out in both cases.
 * @returns {{ targets: string[], external: string[], unknown: string[] }}
 */
function selectTasksToReopen(planMdPath, parsedPlan, changeResult, requested) {
  const planJsonLib = require('./oxe-plan-json.cjs');
  let rawTasks = [];
  const jsonPath = planJsonLib.planJsonPathFor(planMdPath);
  if (jsonPath && fs.existsSync(jsonPath)) {
    try { rawTasks = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).tasks || []; } catch { rawTasks = []; }
  }
  const rawById = new Map(rawTasks.filter(Boolean).map((t) => [t.id, t]));
  const parsedTasks = (parsedPlan && Array.isArray(parsedPlan.tasks)) ? parsedPlan.tasks : [];
  const parsedById = new Map(parsedTasks.map((t) => [t.id, t]));
  const explicit = (Array.isArray(requested) ? requested : String(requested || '').split(','))
    .map((t) => String(t).trim().toUpperCase()).filter((t) => /^T\d+$/.test(t));
  let candidates;
  const unknown = [];
  if (explicit.length) {
    candidates = explicit.filter((id) => {
      const known = rawById.has(id) || parsedById.has(id);
      if (!known) unknown.push(id);
      return known;
    });
  } else {
    const closers = planJsonLib.criterionClosers(rawTasks.length ? rawTasks : parsedTasks);
    const set = new Set();
    for (const criterion of (changeResult.cr && changeResult.cr.criteria) || []) {
      const entry = closers.get(criterion);
      if (!entry) continue;
      if (entry.closer) set.add(entry.closer);
      else for (const id of entry.sinks || []) set.add(id);
    }
    candidates = [...set];
  }
  const external = [];
  const targets = [];
  const impactedExternal = new Set();
  for (const id of new Set([...candidates, ...((changeResult.impacted) || [])])) {
    if (isExternallyDelivered(rawById.get(id), parsedById.get(id))) impactedExternal.add(id);
  }
  for (const id of candidates) {
    if (impactedExternal.has(id)) continue;
    targets.push(id);
  }
  for (const id of impactedExternal) external.push(id);
  return { targets, external, unknown };
}

/**
 * OXB-078: `oxe-cc runtime feedback resolve|withdraw CR-n --by <papel> --reason "…"` — for a CR that can no longer
 * close by evidence (its gate was removed, its scope dropped). Logged like every status change (who, why, when).
 */
function runtimeChangeSetStatus(projectRoot, activeSession, options = {}) {
  const changeLib = require('./oxe-change.cjs');
  const id = String(options.id || '').trim().toUpperCase();
  if (!require('./oxe-criteria-ids.cjs').CR_ID_RE.test(id)) throw new Error('informe o CR: oxe-cc runtime feedback resolve|withdraw CR-<n> --by <papel> --reason "…"');
  const status = options.status === 'resolved' ? 'resolved' : 'withdrawn';
  const by = String(options.by || '').trim();
  const reason = String(options.reason || '').trim();
  if (!by) throw new Error('informe quem decide (--by <papel>)');
  if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "…") — fica no registro do CR');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
  const cr = changeLib.listChanges(programDir).find((c) => c.id === id);
  if (!cr) throw new Error(`${id} não existe`);
  if (cr.status !== 'open') throw new Error(`${id} já está ${cr.status}`);
  changeLib.setChangeStatus(programDir, id, status, { resolution: `${status === 'resolved' ? 'resolvido' : 'retirado'} manualmente: ${reason}`, by, manual: true });
  appendEvent(projectRoot, activeSession, { type: 'ChangeResolved', payload: { id, status, by, manual: true } });
  return { id, status, by, reason, export: autoExportProgram(projectRoot, activeSession) };
}

function runtimeChanges(projectRoot, activeSession) {
  const changeLib = require('./oxe-change.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  return changeLib.listChanges(paths.programDir || path.join(projectRoot, '.oxe', 'program'));
}

// ─── Checkpoint por tarefa e rollback (1.20c) ─────────────────────────────────

/** Arquivos declarados de uma tarefa: mutation_scope do nó compilado (sem curingas). */
function taskScopeFiles(runState, taskId) {
  const nodes = runState && runState.compiled_graph && runState.compiled_graph.nodes;
  const node = nodes ? (Array.isArray(nodes) ? nodes.find((n) => n && n.id === taskId) : nodes[taskId]) : null;
  const scope = node && Array.isArray(node.mutation_scope) ? node.mutation_scope : [];
  return scope.map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*'));
}

/**
 * Commit local só dos arquivos da tarefa concluída (`oxe(T3): título`), nunca `add -A`. Um checkpoint de filesystem
 * por passo: a tentativa seguinte (ou outra tarefa) pode ser revertida sem perder o que já foi entregue.
 */
/**
 * OXB-051: saves a failed task's changes (tracked diff as a patch, new files as copies) under
 * `.oxe/runs/<run>/attempts/<task>-failed/` and restores its scope, inplace only. `preDirty` files are left alone.
 */
/**
 * 1.21.2 (OXB-067/068): working-tree snapshot (path → content hash) of every changed path, `.oxe/` excluded. Taken when
 * a task starts and when each attempt starts, so the runtime knows exactly which paths an attempt touched — including
 * those outside the task's `files` (oxespace 1.5.0 T13 left ThreadView.tsx edited after its rollback).
 */
/**
 * Changed paths under the project directory only, relative to it. `git status` prints paths relative to the
 * repository root and, without a pathspec, scans the whole repository: a project inside a big repository (a monorepo,
 * or a home directory under git) made every snapshot scan all of it — minutes per event.
 */
/**
 * Changes in the working tree against HEAD, by CONTENT (project-scoped, paths relative to the project).
 * `git status` compares stat data: with core.autocrlf=true a file restored by `git checkout` (CRLF) and rewritten
 * with LF shows "M" with an empty diff — a phantom change that the dossier read as architecture drift and that
 * blocked the phase close. `git diff HEAD` normalizes EOL; untracked files come from `ls-files --others`.
 * @returns {Array<{ path: string, status: string }>}
 */
function workingTreeChanges(projectRoot) {
  const out = new Map();
  const hasHead = Boolean(gitLines(projectRoot, ['rev-parse', '--verify', '-q', 'HEAD']));
  if (!hasHead) {
    const prefix = ((gitLines(projectRoot, ['rev-parse', '--show-prefix']) || [])[0] || '').replace(/\\/g, '/');
    for (const line of gitLines(projectRoot, ['status', '--porcelain', '-uall', '--', '.']) || []) {
      const status = line.slice(0, 2).trim() || 'M';
      let file = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop().replace(/\\/g, '/');
      if (prefix && file.startsWith(prefix)) file = file.slice(prefix.length);
      out.set(file, status === '??' ? 'A' : status.charAt(0));
    }
    return [...out.entries()].map(([p, st]) => ({ path: p, status: st }));
  }
  for (const line of gitLines(projectRoot, ['diff', '--relative', '--name-status', 'HEAD', '--', '.']) || []) {
    const [status, ...rest] = line.split('\t');
    out.set(rest[rest.length - 1].replace(/\\/g, '/'), status.charAt(0));
  }
  for (const file of gitLines(projectRoot, ['ls-files', '--others', '--exclude-standard', '--', '.']) || []) {
    const rel = file.replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (!out.has(rel)) out.set(rel, 'A');
  }
  return [...out.entries()].map(([p, st]) => ({ path: p, status: st }));
}

function projectStatusPaths(projectRoot) {
  return workingTreeChanges(projectRoot).map((c) => c.path);
}

function treeSnapshot(projectRoot) {
  const snapshot = new Map();
  const files = projectStatusPaths(projectRoot).filter((f) => f && !f.startsWith('.oxe/'));
  const present = [];
  for (const f of files) {
    let isFile = false;
    try { isFile = fs.statSync(path.join(projectRoot, f)).isFile(); } catch { isFile = false; }
    if (isFile) present.push(f);
    else snapshot.set(f, 'deleted');
  }
  for (let i = 0; i < present.length; i += 200) {
    const chunk = present.slice(i, i + 200);
    const res = spawnSync('git', ['hash-object', '-w', '--', ...chunk], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const hashes = String(res.stdout || '').split(/\r?\n/).filter(Boolean);
    chunk.forEach((f, k) => snapshot.set(f, hashes[k] || 'unknown'));
  }
  return snapshot;
}

/** Paths whose state differs from `before` (new changes, further edits, or reverted to HEAD). */
function changedSinceSnapshot(projectRoot, before) {
  const now = treeSnapshot(projectRoot);
  const changed = new Set();
  for (const [f, h] of now) if (!before || before.get(f) !== h) changed.add(f);
  if (before) for (const f of before.keys()) if (!now.has(f)) changed.add(f);
  return [...changed].sort();
}

function isolateFailedTask(projectRoot, runState, taskId, options = {}) {
  const nodes = runState && runState.compiled_graph && runState.compiled_graph.nodes;
  const node = nodes ? (Array.isArray(nodes) ? nodes.find((n) => n && n.id === taskId) : nodes[taskId]) : null;
  // Only where the attempt ran in the shared checkout (the execute's real workspace, not the node's nominal strategy).
  if (options.inplace === false) return { files: [], savedTo: null, notRestored: [] };
  void node;
  if (!gitLines(projectRoot, ['rev-parse', '--is-inside-work-tree'])) return { files: [], savedTo: null, notRestored: [] };
  const planFiles = options.task && Array.isArray(options.task.files) ? options.task.files.map((p) => String(p).replace(/\\/g, '/')) : [];
  // OXB-067: paths the task changed OUTSIDE its files (clean before the task) are saved and restored as well.
  const extra = Array.isArray(options.extraPaths) ? options.extraPaths : [];
  const scope = [...new Set([...taskScopeFiles(runState, taskId), ...planFiles, ...extra])].filter((p) => p && !p.includes('*'));
  if (!scope.length) return { files: [], savedTo: null, notRestored: [] };
  const preDirty = options.preDirty || new Set();
  const changed = (gitLines(projectRoot, ['status', '--porcelain', '-uall', '--', ...scope]) || [])
    .map((line) => ({ code: line.slice(0, 2), file: line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() }))
    .filter((c) => !preDirty.has(c.file));
  if (!changed.length) return { files: [], savedTo: null, notRestored: [] };
  const dir = path.join(projectRoot, '.oxe', 'runs', runState.run_id || 'run', 'attempts', `${taskId}-failed`);
  fs.mkdirSync(dir, { recursive: true });
  const tracked = changed.filter((c) => c.code !== '??').map((c) => c.file);
  const untracked = changed.filter((c) => c.code === '??').map((c) => c.file);
  if (tracked.length) {
    const diff = spawnSync('git', ['diff', 'HEAD', '--', ...tracked], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(path.join(dir, 'changes.patch'), diff.stdout || '', 'utf8');
    spawnSync('git', ['checkout', 'HEAD', '--', ...tracked], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  }
  for (const rel of untracked) {
    const from = path.join(projectRoot, rel);
    try {
      ensureDirForFile(path.join(dir, 'new', rel));
      fs.copyFileSync(from, path.join(dir, 'new', rel));
      fs.rmSync(from, { force: true });
    } catch { /* best effort */ }
  }
  // Paths the task touched that were already dirty before it: copied for review, never reverted (they hold other work).
  const notRestored = (Array.isArray(options.dirtyBefore) ? options.dirtyBefore : []).filter((rel) => {
    try {
      ensureDirForFile(path.join(dir, 'dirty-before', rel));
      fs.copyFileSync(path.join(projectRoot, rel), path.join(dir, 'dirty-before', rel));
      return true;
    } catch {
      return true;
    }
  });
  return { files: changed.map((c) => c.file), savedTo: path.relative(projectRoot, dir).replace(/\\/g, '/'), notRestored };
}

/**
 * OXB-166: the phase whose tasks the commits belong to — PLAN.json `phase` or the program's active phase — and when
 * that phase started (its runs). T-ids restart per phase: F1's T4 and F2's T4 are different tasks.
 */
function taskPhaseContext(projectRoot, activeSession) {
  let phase = null;
  let since = null;
  try {
    const { doc } = readPlanJsonDoc(projectRoot, activeSession);
    if (doc && typeof doc.phase === 'string' && /^F\d+$/.test(doc.phase)) phase = doc.phase;
  } catch { /* sem PLAN.json */ }
  try {
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const program = require('./oxe-program.cjs').readProgram(paths.programDir || path.join(projectRoot, '.oxe', 'program'));
    if (program) {
      phase = phase || program.active_phase || null;
      const p = phase ? (program.phases || []).find((x) => x.id === phase) : null;
      if (p) since = p.started_at || null;
    }
  } catch { /* sem programa */ }
  return { phase, since };
}

/**
 * OXB-166: commits of a task in `range` (default: the whole history). The phase-qualified trailer
 * (`OXE-Task: F2/T4`) always counts; a phase-less one (`OXE-Task: T4`, rc ≤ 26, or the legacy `oxe(T4):` subject)
 * counts only with no phase in play, or when committed after the phase started (its own runs) — F2's promote of T4
 * picked F1's T4 of 2026-11-04 and conflicted.
 * @returns {string[]} newest first
 */
function taskCommitShas(projectRoot, taskId, range, ctx = {}) {
  const log = (grep) => (gitLines(projectRoot, ['log', '--format=%H %ct', '-E', `--grep=${grep}`, ...(range ? [range] : [])]) || [])
    .map((l) => l.split(' ')).filter((x) => x[0]);
  const out = [];
  if (ctx.phase) for (const [sha] of log(`^OXE-Task: ${ctx.phase}/${taskId}$`)) out.push(sha);
  const sinceMs = ctx.since ? Date.parse(ctx.since) : NaN;
  if (!ctx.phase || Number.isFinite(sinceMs)) {
    for (const grep of [`^OXE-Task: ${taskId}$`, ...(ctx.legacySubject ? [`^oxe\\(${taskId}\\):`] : [])]) {
      for (const [sha, ct] of log(grep)) {
        if (ctx.phase && Number(ct) * 1000 + 1000 < sinceMs) continue;
        if (!out.includes(sha)) out.push(sha);
      }
    }
  }
  return out;
}

/** Latest checkpoint commit of a task: the `OXE-Task` trailer (1.21; with the phase from OXB-166) or the legacy `oxe(Tn):` subject. */
function findTaskCheckpoint(projectRoot, taskId, ctx = null) {
  if (!/^T\d+$/.test(String(taskId || ''))) return null;
  const c = ctx || taskPhaseContext(projectRoot, null);
  const shas = taskCommitShas(projectRoot, taskId, null, { ...c, legacySubject: true });
  if (!shas.length) return null;
  // newest of all candidates
  const order = gitLines(projectRoot, ['rev-list', '--no-walk=sorted', ...shas]) || shas;
  return order[0] || null;
}

/** `oxe-cc plan done Tn [--commit sha]`: marks a finished task in PLAN.json (default commit: its checkpoint). */
function runtimePlanDone(projectRoot, activeSession, options = {}) {
  const taskId = String(options.task || '').trim();
  if (!/^T\d+$/.test(taskId)) throw new Error('Informe a tarefa: oxe-cc plan done T<n>');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const planJsonLib = require('./oxe-plan-json.cjs');
  const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
  if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan done exige PLAN.json (o PLAN.md não guarda done por tarefa).');
  const commit = options.commit || findTaskCheckpoint(projectRoot, taskId);
  const changed = planJsonLib.markPlanTaskDone(paths.plan, taskId, { commit });
  return { task: taskId, commit: commit || null, changed };
}

/**
 * 1.21.2 (OXB-064): splits the scheduler's `blocked` into what really blocked this execute and what was never its
 * job — tasks outside `--wave N` (`out_of_scope`) and tasks waiting on external work (`external_pending`). `--wave 2`
 * ended "Completados: 1 · Bloqueados: 3 — T1, T3, T12" with exit 1 although everything runnable had completed.
 */
function classifyBlockedResult(result, graph) {
  if (!result || !Array.isArray(result.blocked)) return result;
  const selected = new Set((graph && Array.isArray(graph.waves) ? graph.waves : []).flatMap((w) => w.node_ids || []));
  const nodeOf = (id) => (graph && graph.nodes && typeof graph.nodes.get === 'function' ? graph.nodes.get(id) : graph && graph.nodes ? graph.nodes[id] : null);
  const outOfScope = [];
  const external = [];
  const real = [];
  for (const id of result.blocked) {
    const node = nodeOf(id);
    const policy = node && node.policy ? node.policy : {};
    if (selected.size && !selected.has(id)) outOfScope.push(id);
    else if (policy.verify_only || (Array.isArray(policy.external_dependency) && policy.external_dependency.length)) external.push(id);
    else real.push(id);
  }
  result.blocked = real;
  result.external_pending = external;
  result.out_of_scope = outOfScope;
  if (!real.length && !(result.failed || []).length && result.status === 'blocked') result.status = external.length ? 'completed_with_external_pending' : 'completed';
  return result;
}

/** `oxe-cc plan reopen Tn`: reopens a done task so the next execute redoes it (rework without a CR). */
function runtimePlanReopen(projectRoot, activeSession, options = {}) {
  const taskId = String(options.task || '').trim();
  if (!/^T\d+$/.test(taskId)) throw new Error('Informe a tarefa: oxe-cc plan reopen T<n>');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const changed = require('./oxe-plan-json.cjs').markPlanTaskOpen(paths.plan, taskId, { by: options.by || 'plan reopen' });
  return { task: taskId, changed };
}

/**
 * OXB-170: work an interrupted task left in the tree (a run killed while T8 was in progress). The last run's tasks with
 * an AttemptStarted and no completion/block after it, and the dirty paths in their scope. Reported before any
 * checkpoint retry, and those paths are never folded into another task's commit.
 * @returns {Array<{ task: string, run_id: string|null, files: string[] }>}
 */
function interruptedTaskWork(projectRoot, activeSession) {
  let events = [];
  try { events = readEvents(projectRoot, activeSession); } catch { events = []; }
  const lastRun = [...events].reverse().find((e) => e && e.run_id && e.type === 'AttemptStarted');
  if (!lastRun) return [];
  const runId = lastRun.run_id;
  const state = new Map();
  for (const e of events) {
    if (!e || e.run_id !== runId || !e.work_item_id) continue;
    if (e.type === 'AttemptStarted') state.set(e.work_item_id, 'running');
    else if (['WorkItemCompleted', 'WorkItemBlocked', 'WorkItemFailed', 'RetryScheduled'].includes(e.type)) state.set(e.work_item_id, 'ended');
  }
  const running = [...state].filter(([, s]) => s === 'running').map(([id]) => id);
  if (!running.length) return [];
  let doc = null;
  try { doc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { doc = null; }
  // OXB-173: ids are positional — inserting a task mid-chain renumbers the later ones. The title the interrupted run
  // compiled for the id decides which task of the CURRENT plan owns the leftovers (F2: CR36 landed as T8 while T8 = R4
  // had interrupted work in the tree).
  let runTitles = {};
  try {
    const rs = readRunState(projectRoot, activeSession);
    const nodes = rs && rs.run_id === runId && rs.compiled_graph && rs.compiled_graph.nodes;
    for (const n of nodes ? (Array.isArray(nodes) ? nodes : Object.values(nodes)) : []) if (n && n.id) runTitles[n.id] = n.title || null;
  } catch { runTitles = {}; }
  const norm = (x) => String(x || '').trim().toLowerCase();
  const out = [];
  for (const runningId of running) {
    const tasks = doc && Array.isArray(doc.tasks) ? doc.tasks.filter(Boolean) : [];
    let t = tasks.find((x) => x.id === runningId) || null;
    const was = runTitles[runningId];
    let renumbered = null;
    if (was && t && norm(t.title) !== norm(was)) {
      const same = tasks.filter((x) => norm(x.title) === norm(was));
      renumbered = { from: runningId, title: was, to: same.length === 1 ? same[0].id : null };
      t = same.length === 1 ? same[0] : null;
    }
    if (!t || t.done === true) {
      if (renumbered && !renumbered.to) out.push({ task: null, run_id: runId, files: [], renumbered, unattributed: true });
      continue;
    }
    const id = t.id;
    const scope = (t.files || []).map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*'));
    const files = scope.length ? changedPathsUnder(projectRoot, scope) : [];
    if (files.length) out.push({ task: id, run_id: runId, files, ...(renumbered ? { renumbered } : {}) });
  }
  return out;
}

/**
 * OXB-174: a task's OWN leftovers from its earlier attempts that never completed (failed 3× and left its edits, or
 * interrupted), in any run. At its next start those in-scope dirty paths are its work, not "dirty before it": F10's T3
 * failed 3× on rc.30, the relaunch completed it without touching desktop.ts / filters.ts again, and its checkpoint left
 * them out. A path counts when the task wrote it in those attempts (ExecutorUsage.writes) or no other pending task's
 * scope claims it — never a path another task's interrupted work holds (OXB-170).
 * @returns {Map<string, string[]>}
 */
function ownLeftoversByTask(projectRoot, activeSession, interrupted = []) {
  const out = new Map();
  let events = [];
  try { events = readEvents(projectRoot, activeSession); } catch { events = []; }
  let doc = null;
  try { doc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { doc = null; }
  const tasks = doc && Array.isArray(doc.tasks) ? doc.tasks.filter(Boolean) : [];
  if (!tasks.length || !events.length) return out;
  const lastStart = new Map();
  const lastDone = new Map();
  const writes = new Map();
  events.forEach((e, i) => {
    if (!e || !e.work_item_id) return;
    if (e.type === 'AttemptStarted') lastStart.set(e.work_item_id, i);
    if (e.type === 'WorkItemCompleted') lastDone.set(e.work_item_id, i);
    if (e.type === 'ExecutorUsage' && e.payload && Array.isArray(e.payload.writes)) {
      if (!writes.has(e.work_item_id)) writes.set(e.work_item_id, new Set());
      for (const w of e.payload.writes) writes.get(e.work_item_id).add(String(w).replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  });
  const claimed = new Map();
  for (const w of interrupted || []) for (const f of w.files || []) claimed.set(f, w.task);
  const scopes = new Map(tasks.filter((t) => t.done !== true).map((t) => [t.id, (t.files || []).map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*'))]));
  const inScope = (scope, p) => scope.some((e) => e === p || p.startsWith(`${e.replace(/\/$/, '')}/`));
  for (const t of tasks) {
    if (t.done === true) continue;
    // OXB-176: PLAN.json is the authority — a task that ran before and is not done now (failed, interrupted, or
    // completed and then reopened: F4's T4 on rc.32) owns its in-scope leftovers.
    const started = lastStart.get(t.id);
    if (started == null) continue; // never ran
    void lastDone;
    const scope = scopes.get(t.id) || [];
    if (!scope.length) continue;
    const dirty = changedPathsUnder(projectRoot, scope);
    const wrote = writes.get(t.id) || new Set();
    const own = dirty.filter((p) => {
      const holder = claimed.get(p);
      if (holder && holder !== t.id) return false;
      if (wrote.has(p)) return true;
      return ![...scopes].some(([id, sc]) => id !== t.id && inScope(sc, p));
    });
    if (own.length) out.set(t.id, own);
  }
  return out;
}

/** OXB-167/170: retries the checkpoint of tasks marked `checkpoint_failed` in PLAN.json. */
function retryFailedCheckpoints(projectRoot, activeSession, options = {}) {
  const out = [];
  let doc = null;
  try { doc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { doc = null; }
  // OXB-172: a related-tests red is work for the task (or a scope gap), not a commit to retry.
  const pending = doc && Array.isArray(doc.tasks) ? doc.tasks.filter((t) => t && t.done !== true && t.checkpoint_failed && !t.checkpoint_failed.related_red) : [];
  // OXB-170: an interrupted task's leftovers are attributed first (event), whatever is retried.
  const interrupted = interruptedTaskWork(projectRoot, activeSession).filter((w) => !pending.some((t) => t.id === w.task));
  if (interrupted.length) appendEvent(projectRoot, activeSession, { type: 'InterruptedWorkFound', payload: { tasks: interrupted } });
  out.interrupted = interrupted;
  if (!pending.length) return out;
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const ctx = taskPhaseContext(projectRoot, activeSession);
  const planJsonLib = require('./oxe-plan-json.cjs');
  const foreign = new Map();
  for (const w of interrupted) for (const f of w.files) foreign.set(f, w.task || 'tarefa interrompida');
  // the scope of every other pending task: with no snapshot, a path shared with one of them is not ours to commit
  const otherScopes = (id) => new Map((doc.tasks || []).filter((t) => t && t.id !== id && t.done !== true)
    .flatMap((t) => (t.files || []).map((f) => [String(f).replace(/\\/g, '/'), t.id])));
  for (const task of pending) {
    let cp = null;
    const snapshot = task.checkpoint_failed.snapshot || null;
    // OXB-173: the snapshot belongs to the task with that TITLE; a renumbered id must not commit another task's work.
    if (task.checkpoint_failed.title && String(task.checkpoint_failed.title).trim().toLowerCase() !== String(task.title || '').trim().toLowerCase()) {
      out.push({ task: task.id, ok: false, reason: `id renumerado: o checkpoint pendente era de "${task.checkpoint_failed.title}", e ${task.id} agora é "${task.title}" — não commitado; mova o checkpoint_failed para a tarefa certa ou rode plan reopen` });
      continue;
    }
    try {
      if (snapshot) {
        // the task's OWN content, saved when its checkpoint failed — whatever the tree holds now
        cp = commitExactContent(projectRoot, snapshot, checkpointMessageFor(projectRoot, { run_id: task.checkpoint_failed.run_id || null }, task.id, task, ctx.phase), {});
      } else {
        // legacy record (rc ≤ 29, no snapshot): refuse paths another task may own (interrupted, or in its scope)
        const scope = (task.files || []).map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*'));
        const changed = changedPathsUnder(projectRoot, scope);
        const others = otherScopes(task.id);
        const shared = changed.filter((p) => foreign.has(p) || others.has(p) || [...others.keys()].some((k) => p.startsWith(`${k.replace(/\/$/, '')}/`)));
        if (shared.length) {
          cp = { committed: false, failed: true, reason: `retry recusado: ${shared.slice(0, 6).map((p) => `${p} (${foreign.get(p) || others.get(p) || 'outra tarefa'})`).join(', ')} também ${shared.length > 1 ? 'são' : 'é'} de outra tarefa pendente/interrompida — o commit misturaria o trabalho dela (OXB-170); revise e rode oxe-cc plan done ${task.id} --commit <sha> depois de commitar à mão` };
        } else {
          cp = commitTaskCheckpoint(projectRoot, { run_id: task.checkpoint_failed.run_id || null }, task.id, { task, phase: ctx.phase });
        }
      }
    } catch (err) { cp = { committed: false, failed: true, reason: String(err && err.message || err) }; }
    const earlier = task.checkpoint_failed.commit || null;
    if (cp.committed && !(cp.leftover && cp.leftover.length)) {
      planJsonLib.markPlanTaskDone(paths.plan, task.id, { commit: cp.commit });
      out.push({ task: task.id, commit: cp.commit, ok: true });
    } else if (!cp.committed && !cp.failed && earlier) {
      planJsonLib.markPlanTaskDone(paths.plan, task.id, { commit: earlier });
      out.push({ task: task.id, commit: earlier, ok: true });
    } else {
      out.push({ task: task.id, ok: false, reason: cp.reason || 'checkpoint incompleto' });
    }
  }
  if (out.length) appendEvent(projectRoot, activeSession, { type: 'CheckpointRetried', payload: { results: out, interrupted } });
  if (typeof options.onCheckpointRetry === 'function') options.onCheckpointRetry(out, interrupted);
  return out;
}

/**
 * OXB-168: paths changed under `files` (git status -z: new, modified, deleted, both sides of a rename). git status
 * accepts pathspecs that match nothing; `git add`/`git commit -- <path>` do not.
 */
function changedPathsUnder(projectRoot, files) {
  return [...new Set(changedEntriesUnder(projectRoot, files).map((e) => e.path))];
}

/** OXB-168: the same, with each path's two-letter status (`D ` = deletion already staged). */
function changedEntriesUnder(projectRoot, files) {
  const res = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall', '--', ...files], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const parts = String(res.stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    out.push({ path: entry.slice(3), code });
    if (/[RC]/.test(code) && parts[i + 1]) { out.push({ path: parts[i + 1], code: 'D ' }); i += 1; } // rename/copy: the source follows
  }
  return out;
}

const gitOut = (projectRoot, args, input) => spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...(input != null ? { input } : {}) });

/** A blob for the current file content (stored), or null when the file does not exist. */
function storeBlob(projectRoot, rel) {
  if (!fs.existsSync(path.join(projectRoot, rel))) return null;
  const r = gitOut(projectRoot, ['hash-object', '-w', '--', rel]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * OXB-170: what THIS task wrote, per changed path: `{ path: blob | 'deleted' }`. A path that was clean when the task
 * started is the task's as it is now. A path that was already dirty (another task's interrupted edits) carries only
 * the task's own diff: HEAD + (content at task start → content now), by git merge-file. A path the task did not touch
 * after its start is not the task's. A merge conflict there is an error — never folded.
 */
function taskOwnContent(projectRoot, changed, baseline) {
  const entries = {};
  const problems = [];
  for (const rel of changed) {
    const before = baseline && baseline.has(rel) ? baseline.get(rel) : undefined;
    const nowBlob = storeBlob(projectRoot, rel);
    if (before === undefined) { entries[rel] = nowBlob || 'deleted'; continue; }
    // dirty before the task started
    if ((before === 'deleted' && !nowBlob) || (nowBlob && before === nowBlob)) continue; // untouched by the task
    if (!nowBlob) { entries[rel] = 'deleted'; continue; }
    if (before === 'deleted' || before === 'unknown') { problems.push(`${rel}: estava apagado/ilegível antes da tarefa e foi recriado — não dá para separar`); continue; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-own-'));
    try {
      const headFile = path.join(tmp, 'head');
      const baseFile = path.join(tmp, 'base');
      const nowFile = path.join(tmp, 'now');
      const head = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      fs.writeFileSync(headFile, head.status === 0 ? head.stdout : Buffer.alloc(0));
      fs.writeFileSync(baseFile, spawnSync('git', ['cat-file', 'blob', before], { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout || Buffer.alloc(0));
      fs.copyFileSync(path.join(projectRoot, rel), nowFile);
      const merged = spawnSync('git', ['merge-file', '-p', headFile, baseFile, nowFile], { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      if (merged.status !== 0) { problems.push(`${rel}: a mudança da tarefa sobrepõe edições de outra tarefa que já estavam na árvore — não dá para separar`); continue; }
      const blob = gitOut(projectRoot, ['hash-object', '-w', '--stdin'], merged.stdout);
      entries[rel] = blob.stdout.trim();
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    }
  }
  return { entries, problems };
}

function modeFor(projectRoot, rel) {
  const ls = gitOut(projectRoot, ['ls-tree', 'HEAD', '--', rel]).stdout.trim();
  if (ls) return ls.split(/\s+/)[0];
  try { if (process.platform !== 'win32' && (fs.statSync(path.join(projectRoot, rel)).mode & 0o111)) return '100755'; } catch { /* */ }
  return '100644';
}

/** OXB-170: the checkpoint message (convention + phase/run trailers). */
function checkpointMessageFor(projectRoot, runState, taskId, planTask, phase, config = null) {
  const node = (runState && runState.compiled_graph && runState.compiled_graph.nodes && runState.compiled_graph.nodes[taskId]) || {};
  const t = planTask || {};
  return require('./oxe-commit-convention.cjs').checkpointMessage({
    id: taskId,
    title: t.title || node.title || taskId,
    commit: t.meta && t.meta.commit ? t.meta.commit : t.commit,
    phase: phase || null,
    run_id: (runState && runState.run_id) || null,
  }, config || readProjectConfig(projectRoot));
}

/**
 * OXB-170: commits EXACTLY `entries` ({ path: blob | 'deleted' }) on top of HEAD, through the index — the working tree
 * is never touched (another task's partial edits stay there for its retry). The person's staged changes on other
 * paths are kept. Hooks run (a plain `git commit`). With config `checkpoint_check`, the command runs on the new
 * commit's own tree (a temporary worktree); red → the commit is undone and the checkpoint fails.
 */
function commitExactContent(projectRoot, entries, message, options = {}) {
  const paths = Object.keys(entries || {});
  if (!paths.length) return { committed: false, reason: 'nada da tarefa para commitar' };
  const oldHead = gitOut(projectRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const saved = gitOut(projectRoot, ['write-tree']);
  if (saved.status !== 0) return { committed: false, failed: true, reason: `índice com conflito: ${saved.stderr.trim()}` };
  const restore = () => {
    gitOut(projectRoot, ['read-tree', saved.stdout.trim()]);
    // these paths in the index follow the (new) HEAD, so nothing appears staged/reverted
    const known = paths.filter((p) => gitOut(projectRoot, ['ls-files', '--error-unmatch', '--', p]).status === 0 || gitOut(projectRoot, ['cat-file', '-e', `HEAD:${p}`]).status === 0);
    if (known.length) gitOut(projectRoot, ['reset', '-q', 'HEAD', '--', ...known]);
  };
  const rt = gitOut(projectRoot, ['read-tree', 'HEAD']);
  if (rt.status !== 0) return { committed: false, failed: true, reason: `read-tree falhou: ${rt.stderr.trim()}` };
  for (const p of paths) {
    const v = entries[p];
    const r = v === 'deleted'
      ? gitOut(projectRoot, ['update-index', '--force-remove', '--', p])
      : gitOut(projectRoot, ['update-index', '--add', '--cacheinfo', `${modeFor(projectRoot, p)},${v},${p}`]);
    if (r.status !== 0) { restore(); return { committed: false, failed: true, reason: `update-index ${p}: ${r.stderr.trim()}` }; }
  }
  const commit = gitOut(projectRoot, ['commit', '-q', '-F', '-'], message);
  if (commit.status !== 0) {
    restore();
    return { committed: false, failed: true, reason: `git commit falhou: ${String(commit.stderr || commit.stdout).trim().split(/\r?\n/).slice(-8).join(' · ')}`, snapshot: entries };
  }
  const head = gitOut(projectRoot, ['rev-parse', 'HEAD']).stdout.trim();
  let check = checkpointCheck(projectRoot, head, { ...options, changedFiles: paths.filter((p) => entries[p] !== 'deleted') });
  // OXB-175: a related red is the task's only when (1) the test is not a frozen acceptance test of a pending task,
  // another phase or a parked folder, and (2) it was green on the parent commit. T9 (CR37) of F2 had e98c9d54 undone
  // by three tests red by design (a parked F3 test, a CR repro, a later F2 task's frozen test).
  if (check && !check.ok && check.kind === 'related' && Array.isArray(check.failing_tests) && check.failing_tests.length) {
    const own = relatedRedsOfTask(projectRoot, oldHead, check.failing_tests, options);
    if (!own.length) check = { ...check, ok: true, ignored_reds: check.failing_tests.map((t) => t.file) };
    else check = { ...check, failing_tests: own, ignored_reds: check.failing_tests.filter((t) => !own.some((o) => o.file === t.file)).map((t) => t.file) };
  }
  if (check && !check.ok) {
    gitOut(projectRoot, ['update-ref', '-m', 'oxe: checkpoint_check vermelho', 'HEAD', oldHead, head]);
    restore();
    if (check.kind === 'related') {
      // OXB-172: tests that import the task's changed files went red. In the task's scope → its work (the next execute
      // runs them in its verify); outside it → scope_insufficient, naming the test (OXB-171).
      const scope = (options.scope || []).map((p) => String(p).replace(/\\/g, '/'));
      const inScope = (f) => scope.some((e) => e === f || f.startsWith(`${e.replace(/\/$/, '')}/`));
      const failing = check.failing_tests || [];
      const outside = failing.filter((t) => !inScope(t.file));
      const named = failing.map((t) => `${t.file}${t.names.length ? ` (${t.names.slice(0, 2).join('; ')})` : ''}`).join(', ') || check.tail;
      return {
        committed: false,
        failed: true,
        kind: outside.length ? 'scope_insufficient' : 'related_tests',
        related_red: failing.map((t) => t.file),
        reason: outside.length
          ? `scope_insufficient: testes que importam os arquivos da tarefa ficaram vermelhos fora do escopo dela — ${named}. Inclua ${outside.map((t) => t.file).join(', ')} nos files (ou abra um CR/tarefa), depois rode oxe-cc plan reopen`
          : `testes relacionados vermelhos (\`${check.command.slice(0, 120)}\`): ${named} — entram no verify da tarefa no próximo execute`,
        snapshot: entries,
      };
    }
    return { committed: false, failed: true, reason: `checkpoint_check vermelho na árvore do commit (\`${check.command}\`): ${check.tail}`, snapshot: entries };
  }
  restore();
  // what went in is what was meant to
  const leftover = paths.filter((p) => {
    const inCommit = gitOut(projectRoot, ['rev-parse', '-q', '--verify', `HEAD:${p}`]).stdout.trim();
    return entries[p] === 'deleted' ? Boolean(inCommit) : inCommit !== entries[p];
  });
  const committedFiles = (gitOut(projectRoot, ['show', '--name-only', '--format=', 'HEAD']).stdout || '').split(/\r?\n/).filter(Boolean);
  return { committed: true, commit: head, files: committedFiles, leftover, ...(check ? { check: { command: check.command, ok: true, ...(check.ignored_reds && check.ignored_reds.length ? { ignored_reds: check.ignored_reds } : {}) } } : {}) };
}

/**
 * OXB-170: config `checkpoint_check` (e.g. "npm run typecheck"): runs on the commit's own tree — a temporary detached
 * worktree with a junction to node_modules (unlinked before removal, never a forced removal with it in place).
 */
function checkpointCheck(projectRoot, sha, options = {}) {
  const cfg = readProjectConfig(projectRoot) || {};
  const typecheck = options.checkpointCheck != null ? options.checkpointCheck : cfg.checkpoint_check;
  // OXB-172: the tests that import the task's OWN changed files (vitest related), not only the task's verify.
  const related = relatedTestsCommand(cfg, options.changedFiles || []);
  const commands = [...(typecheck && typeof typecheck === 'string' ? [{ kind: 'check', command: typecheck, timeout: Number(cfg.checkpoint_check_timeout_ms) > 0 ? Number(cfg.checkpoint_check_timeout_ms) : 900_000 }] : []), ...(related ? [related] : [])];
  if (!commands.length) return null;
  const command = commands.map((c) => c.command).join(' ; ');
  const wt = path.join(projectRoot, '.oxe', 'checkpoint-ws', `${String(sha).slice(0, 10)}-${Date.now().toString(36)}`);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const add = gitOut(projectRoot, ['worktree', 'add', '-q', '--detach', wt, sha]);
  if (add.status !== 0) return { ok: false, command, tail: `worktree add falhou: ${add.stderr.trim()}` };
  let res = null;
  try {
    const nm = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    try { require('./oxe-local-config.cjs').copyLocalFiles(projectRoot, wt); } catch { /* */ }
    for (const c of commands) {
      const r = runChildCommandFull(wt, c.command, c.timeout);
      res = { ok: r.ok, tail: r.tail, kind: c.kind, command: c.command, output: r.output, skipped: c.skipped || [] };
      if (!r.ok) break;
    }
  } finally {
    try {
      const rt = loadRuntimeModule();
      if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(wt);
      else if (fs.existsSync(path.join(wt, 'node_modules'))) fs.unlinkSync(path.join(wt, 'node_modules'));
    } catch { /* */ }
    let linkLeft = false;
    try { linkLeft = fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
    if (!linkLeft) gitOut(projectRoot, ['worktree', 'remove', '--force', wt]);
    gitOut(projectRoot, ['worktree', 'prune']);
  }
  const out = { ok: Boolean(res && res.ok), command: (res && res.command) || command, kind: res && res.kind, tail: String((res && res.tail) || '').split(/\r?\n/).slice(-6).join(' · ') };
  if (res && !res.ok && res.kind === 'related') out.failing_tests = failingTestFiles(res.output || res.tail || '');
  if (res && res.skipped && res.skipped.length) out.related_skipped = res.skipped;
  return out;
}

/**
 * OXB-172: config `checkpoint_related_tests`: true | { command, max_files, timeout_ms }. The command gets the task's own
 * changed code files ({files}); default `npx vitest related --run {files}`; at most max_files (40) files.
 */
function relatedTestsCommand(cfg, changedFiles) {
  const opt = cfg && cfg.checkpoint_related_tests;
  if (!opt) return null;
  const o = typeof opt === 'object' ? opt : {};
  const code = [...new Set((changedFiles || []).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(c|m)?[jt]sx?$/.test(f)))];
  if (!code.length) return null;
  const max = Number(o.max_files) > 0 ? Number(o.max_files) : 40;
  const files = code.slice(0, max);
  const template = typeof o.command === 'string' && o.command.includes('{files}') ? o.command : 'npx vitest related --run {files}';
  const quote = (f) => (/[\s"']/.test(f) ? JSON.stringify(f) : f);
  return { kind: 'related', command: template.replace('{files}', files.map(quote).join(' ')), timeout: Number(o.timeout_ms) > 0 ? Number(o.timeout_ms) : 600_000, skipped: code.slice(max) };
}

/**
 * OXB-175: of the related tests that failed on the task's commit, the ones that are the task's: not a frozen acceptance
 * test owned by a PENDING task (or with no owner in this plan — another phase), not under a parked folder, and green on
 * the parent commit (run_command on the parent's tree). A test red before and after is not this task's red.
 */
function relatedRedsOfTask(projectRoot, parentSha, failing, options = {}) {
  let doc = null;
  try { doc = readPlanJsonDoc(projectRoot, null).doc; } catch { doc = null; }
  const taskId = options.task && options.task.id;
  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const doneIds = new Set(tasks.filter((t) => t.done === true).map((t) => t.id));
  const owners = new Map(); // acceptance file → owning task ids
  for (const a of (doc && Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [])) {
    if (!a) continue;
    const ids = a.task ? [a.task] : tasks.filter((t) => (t.acceptance || []).includes(a.criterion)).map((t) => t.id);
    for (const f of a.files || []) {
      const p = String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/');
      owners.set(p, [...(owners.get(p) || []), ...ids]);
    }
  }
  const isAcceptanceDir = (p) => /(^|\/)acceptance\//.test(p);
  const parked = (p) => /(^|\/)parked[^/]*\//i.test(p);
  const candidates = failing.filter((t) => {
    if (parked(t.file)) return false;
    const own = owners.get(t.file);
    if (own) return own.includes(taskId) || own.every((id) => doneIds.has(id)); // pending owner → red by design
    return !isAcceptanceDir(t.file); // a frozen test of another phase / a CR repro not in this plan
  });
  if (!candidates.length || !parentSha) return candidates;
  // red on the parent too → not this task's
  const cfg = readProjectConfig(projectRoot) || {};
  const rt0 = cfg.checkpoint_related_tests;
  const runTpl = rt0 && typeof rt0 === 'object' && typeof rt0.run_command === 'string' && rt0.run_command.includes('{files}') ? rt0.run_command : 'npx vitest run {files}';
  const cmd = runTpl.replace('{files}', candidates.map((t) => t.file).join(' '));
  const before = runInCommitWorktree(projectRoot, parentSha, cmd, Number(rt0 && rt0.timeout_ms) > 0 ? Number(rt0.timeout_ms) : 600_000);
  if (!before) return candidates;
  if (before.ok) return candidates; // all green before: every red is this task's
  const redBefore = new Set(failingTestFiles(before.output || '').map((t) => t.file));
  return candidates.filter((t) => !redBefore.has(t.file));
}

/** OXB-175: runs a command on a commit's own tree (temporary detached worktree; junction unlinked before removal). */
function runInCommitWorktree(projectRoot, sha, command, timeoutMs) {
  const wt = path.join(projectRoot, '.oxe', 'checkpoint-ws', `p-${String(sha).slice(0, 10)}-${Date.now().toString(36)}`);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const add = gitOut(projectRoot, ['worktree', 'add', '-q', '--detach', wt, sha]);
  if (add.status !== 0) return null;
  let r = null;
  try {
    const nm = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    try { require('./oxe-local-config.cjs').copyLocalFiles(projectRoot, wt); } catch { /* */ }
    r = runChildCommandFull(wt, command, timeoutMs);
  } finally {
    try {
      const rt = loadRuntimeModule();
      if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(wt);
      else if (fs.existsSync(path.join(wt, 'node_modules'))) fs.unlinkSync(path.join(wt, 'node_modules'));
    } catch { /* */ }
    let linkLeft = false;
    try { linkLeft = fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
    if (!linkLeft) gitOut(projectRoot, ['worktree', 'remove', '--force', wt]);
    gitOut(projectRoot, ['worktree', 'prune']);
  }
  return r;
}

/** OXB-172: the test files a vitest/jest run reports as failing (FAIL / × / ❯ lines). */
function failingTestFiles(output) {
  const out = new Map();
  for (const m of String(output).matchAll(/^\s*(?:FAIL|×|✗|❯)\s+([\w./\\@-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s*>\s*([^\n]+))?/gm)) {
    const file = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
    if (!out.has(file)) out.set(file, []);
    if (m[2] && !/\(\d+ tests?/.test(m[2])) out.get(file).push(m[2].trim().slice(0, 120));
  }
  return [...out].map(([file, names]) => ({ file, names: [...new Set(names)].slice(0, 5) }));
}

function commitTaskCheckpoint(projectRoot, runState, taskId, options = {}) {
  // OXB-052: the scope is the graph's AND the current plan's (a CR may have added files after the compile).
  const planFiles = options.task && Array.isArray(options.task.files) ? options.task.files.map((p) => String(p).replace(/\\/g, '/')).filter((p) => p && !p.includes('*')) : [];
  const files = [...new Set([...taskScopeFiles(runState, taskId), ...planFiles])];
  if (!files.length) return { committed: false, reason: 'tarefa sem escopo declarado' };
  if (!gitLines(projectRoot, ['rev-parse', '--is-inside-work-tree'])) return { committed: false, reason: 'sem repositório git' };
  // OXB-168: built from what CHANGED under the scope, never from the scope as pathspecs (a path another task already
  // removed made git reject the whole commit).
  const changed = changedPathsUnder(projectRoot, files);
  const scopeAbsent = files.filter((p) => !fs.existsSync(path.join(projectRoot, p)) && !(gitLines(projectRoot, ['ls-files', '--', p]) || []).length && !changed.some((c) => c === p || c.startsWith(`${p.replace(/\/$/, '')}/`)));
  if (!changed.length) return { committed: false, reason: 'nada mudou no escopo da tarefa', scope_absent: scopeAbsent };
  // OXB-170: only what THIS task wrote — paths already dirty when it started carry only its own diff.
  const own = taskOwnContent(projectRoot, changed, options.baseline || null);
  if (own.problems.length) return { committed: false, failed: true, reason: own.problems.join(' · '), snapshot: own.entries, scope_absent: scopeAbsent };
  if (!Object.keys(own.entries).length) return { committed: false, reason: 'nada mudou no escopo da tarefa (o que está sujo já estava antes dela)', scope_absent: scopeAbsent };
  const message = checkpointMessageFor(projectRoot, runState, taskId, options.task || {}, options.phase, options.config || null);
  const res = commitExactContent(projectRoot, own.entries, message, { ...options, scope: files });
  return { ...res, scope: files, ...(scopeAbsent.length ? { scope_absent: scopeAbsent } : {}), snapshot: res.committed ? undefined : own.entries };
}

/**
 * `oxe-cc runtime rollback --task T3 [--yes]`: devolve os arquivos da tarefa ao último checkpoint (HEAD) e remove
 * os criados por ela. Só o escopo declarado; dry-run por padrão.
 */
function runtimeRollback(projectRoot, activeSession, options = {}) {
  const taskId = String(options.task || '').trim();
  if (!/^T\d+$/.test(taskId)) throw new Error('Informe --task T<n>.');
  const run = readRunState(projectRoot, activeSession);
  const files = taskScopeFiles(run, taskId);
  if (!files.length) throw new Error(`Tarefa ${taskId} sem escopo declarado — rollback recusado (não sei o que é dela).`);
  const status = gitLines(projectRoot, ['status', '--porcelain', '-uall', '--', ...files]) || [];
  const actions = status.map((line) => {
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
    return { file, action: code === '??' ? 'delete' : 'restore' };
  });
  if (!options.yes) return { dry_run: true, task: taskId, actions };
  for (const a of actions) {
    if (a.action === 'delete') fs.rmSync(path.join(projectRoot, a.file), { force: true });
    else spawnSync('git', ['checkout', 'HEAD', '--', a.file], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  }
  appendEvent(projectRoot, activeSession, { type: 'RollbackExecuted', run_id: run && run.run_id, work_item_id: taskId, payload: { actions } });
  return { dry_run: false, task: taskId, actions };
}

// ─── Programa por fases (1.19) ───────────────────────────────────────────────

function requireProgramRuntime() {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.createProgram !== 'function') {
    throw new Error('Runtime sem suporte a programa por fases. Rode npm run build:runtime.');
  }
  return runtime;
}

/** A run pertence a uma fase fechada do programa (não deve ser reaproveitada pela fase seguinte). */
function isClosedPhaseRun(projectRoot, activeSession, runId) {
  if (!runId) return false;
  try {
    const programLib = require('./oxe-program.cjs');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const state = paths.programDir ? programLib.readProgram(paths.programDir) : null;
    return Boolean(state && state.phases.some((phase) => phase.status === 'closed' && phase.run_id === runId));
  } catch {
    return false;
  }
}

/** Avança o status da fase ativa sem nunca falhar a operação principal (execute/verify). */
function touchProgramPhase(projectRoot, activeSession, status, patch = {}) {
  try {
    const programLib = require('./oxe-program.cjs');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const state = paths.programDir ? programLib.readProgram(paths.programDir) : null;
    if (!state || !state.active_phase) return null;
    const runtime = requireProgramRuntime();
    const phase = runtime.findPhase(state, state.active_phase);
    if (!phase || phase.status === 'closed') return null;
    let next = state;
    // planning → executing → verifying; execute após verify volta a `executing`.
    if (status === 'executing' && (phase.status === 'planning' || phase.status === 'verifying')) {
      next = runtime.setPhaseStatus(next, phase.id, 'executing', patch);
    } else if (status === 'verifying' && phase.status === 'executing') {
      next = runtime.setPhaseStatus(next, phase.id, 'verifying', patch);
    } else if (status === phase.status && Object.keys(patch).length) {
      next = runtime.setPhaseStatus(next, phase.id, status, patch);
    }
    if (next !== state) programLib.writeProgram(paths.programDir, next);
    return next;
  } catch {
    return null;
  }
}

function runtimeProgramStatus(projectRoot, activeSession) {
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const state = programLib.readProgram(paths.programDir);
  const where = { roadmap: paths.roadmap, programDir: paths.programDir, plan: paths.plan };
  if (!state) return { exists: false, state: null, progress: null, paths: where };
  const runtime = requireProgramRuntime();
  // OXB-090: a SPEC amendment to a criterion of a closed phase, recorded after its close, is reported here (once),
  // not as a plan error of the active phase: the closed phase may need reopening (runtime feedback).
  const amendedClosed = [];
  try {
    const reqs = require('./oxe-change.cjs').amendmentRequirements(paths.programDir);
    for (const p of state.phases) {
      if (p.status !== 'closed') continue;
      for (const a of p.acceptance || []) {
        const r = reqs.get(a);
        if (r && r.required > 1 && (!p.closed_at || !r.last_at || r.last_at > p.closed_at)) amendedClosed.push({ phase: p.id, criterion: a, version: r.required, crs: r.crs || [] });
      }
    }
  } catch { /* auxiliar */ }
  return { exists: true, state, progress: runtime.programProgress(state), paths: where, amended_closed: amendedClosed };
}

function runtimeProgramInit(projectRoot, activeSession, options = {}) {
  const runtime = requireProgramRuntime();
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const roadmapText = readTextIfExists(paths.roadmap);
  if (!roadmapText) {
    throw new Error(`ROADMAP.md não encontrado (${paths.roadmap}). Rode /oxe-spec até a fase de roteiro.`);
  }
  const existing = programLib.readProgram(paths.programDir);
  if (existing && !options.force) {
    throw new Error('Programa já existe. Use --force para recriar a partir do ROADMAP (perde o estado das fases).');
  }
  const state = runtime.createProgram(roadmapText, programLib.relativeRef(projectRoot, paths.roadmap));
  programLib.writeProgram(paths.programDir, state);
  appendEvent(projectRoot, activeSession, {
    type: 'ProgramCreated',
    payload: { phases: state.phases.map((phase) => phase.id), roadmap: state.roadmap_ref },
  });
  return { ...runtimeProgramStatus(projectRoot, activeSession), warnings: roadmapCriteriaWarnings(readTextIfExists(paths.spec) || '', state) };
}

/**
 * OXB-038: a phase criterion the SPEC does not declare is a phantom (an id of another document, e.g. the DESIGN's
 * per-screen A1–A12, read as a SPEC criterion). Reported by program init and plan lint.
 */
function roadmapCriteriaWarnings(specText, state) {
  const known = new Set(require('./oxe-spec-edit.cjs').criteriaIds(specText));
  if (!known.size || !state || !Array.isArray(state.phases)) return [];
  const out = [];
  for (const phase of state.phases) {
    const phantom = (phase.acceptance || []).filter((a) => !known.has(a));
    if (phantom.length) out.push(`${phase.id}: ${phantom.join(', ')} não ${phantom.length > 1 ? 'são critérios' : 'é critério'} da SPEC — id de outro documento? Na linha **Critérios de aceite:** ficam só ids da tabela da SPEC; referências a outros documentos vão entre parênteses`);
  }
  return out;
}

/**
 * OXB-038: the SPEC's input documents (`inputs:` in its front matter) that use the same A<n> ids as the SPEC criteria.
 * The DESIGN's UI acceptance used A1–A12 per screen; they had to be renamed (UA1…) before reaching plans and proves.
 */
function specInputCollisions(projectRoot, specText) {
  const text = String(specText || '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return [];
  const inputs = [];
  const inline = /^inputs:\s*\[(.*)\]\s*$/m.exec(fm[1]);
  if (inline) inputs.push(...inline[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  const block = /^inputs:\s*\r?\n((?:\s+-\s+.*\r?\n?)+)/m.exec(fm[1]);
  if (block) inputs.push(...block[1].split(/\r?\n/).map((l) => l.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  const known = new Set(require('./oxe-spec-edit.cjs').criteriaIds(text).filter((id) => /^A\d+$/.test(id)));
  if (!known.size) return [];
  const out = [];
  for (const input of inputs) {
    if (/^[a-z]+:\/\//i.test(input)) continue;
    let doc = '';
    try { doc = fs.readFileSync(path.resolve(projectRoot, input), 'utf8'); } catch { continue; }
    const used = [...new Set((doc.match(/\bA\d+\b/g) || []).filter((id) => known.has(id)))];
    if (used.length) out.push(`${input} usa ${used.slice(0, 8).join(', ')}${used.length > 8 ? ` (+${used.length - 8})` : ''}, os mesmos ids de critérios da SPEC — renomeie lá (ex.: UA1) para não virarem critérios fantasma em planos e proves`);
  }
  return out;
}

function runtimeProgramStart(projectRoot, activeSession, phaseId = null) {
  const runtime = requireProgramRuntime();
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const state = programLib.readProgram(paths.programDir);
  if (!state) throw new Error('Sem programa. Rode `oxe-cc runtime program init` (lê o ROADMAP aprovado).');
  const next = runtime.startPhase(state, phaseId);
  const phase = runtime.activePhase(next);
  // Base da fase: o dossiê compara o diff real com o contrato a partir daqui.
  if (!phase.base_commit) {
    const head = gitLines(projectRoot, ['rev-parse', 'HEAD']);
    if (head && head[0]) phase.base_commit = head[0];
  }
  programLib.writeProgram(paths.programDir, next);
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  appendEvent(projectRoot, activeSession, {
    type: 'PhaseStarted',
    payload: { phase: phase.id, title: phase.title, acceptance: phase.acceptance },
  });
  return runtimeProgramStatus(projectRoot, activeSession);
}

/** Classifica os resultados do último verify para o gate de fase. */
function phaseGateInputFromRun(run) {
  const results = Array.isArray(run && run.verification_check_results) ? run.verification_check_results : [];
  const ids = results
    .filter((result) => result && (result.status === 'fail' || result.status === 'error'))
    .map((result) => result.check_id);
  return {
    verify_status: !run ? null : results.length === 0 ? 'not_verified' : run.status,
    regression_failed: ids.filter((id) => /^reg-/.test(id)),
    contract_failed: ids.filter((id) => /^check-pack-/.test(id)),
    checks_failed: ids.filter((id) => !/^reg-/.test(id) && !/^check-pack-/.test(id)),
  };
}

/**
 * Gate de fase: verify `completed`, regressão verde e contratos ok. Passando, congela a regressão,
 * grava as interfaces reais, faz o commit local da fase (sem push) e fecha a fase.
 */
function runtimeProgramClose(projectRoot, activeSession, options = {}) {
  const runtime = requireProgramRuntime();
  const programLib = require('./oxe-program.cjs');
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const state = programLib.readProgram(paths.programDir);
  if (!state) throw new Error('Sem programa. Rode `oxe-cc runtime program init`.');
  const phase = options.phase ? runtime.findPhase(state, options.phase) : runtime.activePhase(state);
  if (!phase) throw new Error('Nenhuma fase ativa. Rode `oxe-cc runtime program start`.');
  const run = options.runState || readRunState(projectRoot, activeSession);
  const gateInput = phaseGateInputFromRun(run);
  // OXB-079: "verify não concluído (status: running)" right after a passed verify — the run stays `running` while an
  // external task of the graph is pending. A passed verify counts when the plan's work is done or external-only.
  if (gateInput.verify_status !== 'completed' && run && run.verification_status === 'passed') {
    let work = null;
    try { work = runtimePhaseWork(projectRoot, activeSession); } catch { work = null; }
    if (work && work.complete) gateInput.verify_status = 'completed';
  }
  // 1.21 (OXB-020): the phase verify must have run every declared project gate green, and the close-time gates
  // (e.g. CI) run now — before the dossier, so a gate CR that just went green no longer counts as open.
  // OXB-080: an audited waiver for files outside the contract (logged before the dossier reads it).
  const acceptDrift = (Array.isArray(options.acceptDrift) ? options.acceptDrift : options.acceptDrift ? [options.acceptDrift] : []).map(String).filter(Boolean);
  if (acceptDrift.length) {
    const by = String(options.by || '').trim();
    const reason = String(options.reason || '').trim();
    if (!by || reason.length < 8) throw new Error('--accept-drift exige --by <papel> e --reason "…" (a exceção fica registrada)');
    const changeLib = require('./oxe-change.cjs');
    changeLib.appendNdjson(changeLib.changesFile(paths.programDir || path.join(projectRoot, '.oxe', 'program')), { kind: 'drift_waiver', phase: phase.id, globs: acceptDrift, by, reason, at: new Date().toISOString() });
    appendEvent(projectRoot, activeSession, { type: 'DriftWaived', payload: { phase: phase.id, globs: acceptDrift, by } });
  }
  const closeGates = programCloseGateReasons(projectRoot, activeSession, { phase, run, paths, state, skip: options.gates === false });
  // OXB-110: open defects (stubs, TODO/FIXME, skipped tests, verify missing, open signal/standing CRs) block the close
  // — and the deploy gate the close evaluates — unless waived with a reason.
  if (options.defects !== false) {
    try {
      const defects = runtimeDefects(projectRoot, activeSession, { phase: phase.id });
      const lib = require('./oxe-open-defects.cjs');
      for (const it of defects.open.slice(0, 15)) closeGates.reasons.push(`defeito aberto ${lib.describe(it)} — corrija, ou oxe-cc runtime defects --waive ${it.id} --by <papel> --reason "…"`);
      if (defects.open.length > 15) closeGates.reasons.push(`e mais ${defects.open.length - 15} defeito(s) aberto(s) em .oxe/OPEN-DEFECTS.json`);
    } catch { /* auxiliar */ }
  }
  // OXB-091: every standing criterion needs a sign-off of this phase with evidence (not deferrable: "erros na
  // interface não serão admitidos" holds at every close).
  const standing = require('./oxe-criteria-ids.cjs').standingAcceptance(projectRoot);
  if (standing.length) {
    const signoffs = readNdjsonQuiet(path.join(paths.programDir, 'signoffs.ndjson')).filter((s) => s && s.phase === phase.id);
    for (const criterion of standing) {
      const ok = signoffs.some((s) => (s.criteria || []).includes(criterion) && s.evidence);
      if (!ok) closeGates.reasons.push(`critério permanente ${criterion}: falta o sign-off da fase ${phase.id} com evidência (oxe-cc runtime signoff --phase ${phase.id} --criteria ${criterion} --by <papel> --evidence <relatório/link>)`);
    }
  }
  // 1.20: um critério UAT com sign-off conta como verificado; o dossiê precisa estar sem drift e com handoff.
  const dossier = options.dossier === false ? null : runtimeDossier(projectRoot, activeSession, { phase: phase.id, runState: run });
  if (dossier && gateInput.verify_status === 'blocked' && dossier.pending.length === 0) {
    const onlyManual = (run.verification_check_results || []).every((c) => c.status === 'pass' || (c.status === 'skip' && c.skip_reason === 'needs_structured_check'));
    if (onlyManual) gateInput.verify_status = 'completed';
  }
  const gate = runtime.evaluatePhaseGate(gateInput);
  if (dossier) {
    for (const issue of dossier.issues) gate.reasons.push(`dossiê: ${issue}`);
    const deferred = [];
    for (const pending of dossier.pending) {
      const criterion = pending.replace(/^signoff_pending: /, '');
      // ADIADO declarado (dono + risco), como no workflow de engenharia: não bloqueia, mas fica no programa.
      if (options.deferSignoff && options.by && options.risk) deferred.push({ criterion, owner: options.by, risk: options.risk, at: new Date().toISOString() });
      else gate.reasons.push(`sign-off pendente: ${criterion} (ou adie: --defer-signoff --by <dono> --risk "<risco assumido>")`);
    }
    if (deferred.length) gate.deferred = deferred;
    if (!dossier.handoff_filled) gate.reasons.push(`handoff vazio: preencha "O que a próxima fase deve saber" em ${path.relative(projectRoot, path.join(dossier.dir, 'plan.md'))}`);
    gate.ok = gate.reasons.length === 0;
  }
  if (closeGates.reasons.length) {
    gate.reasons.push(...closeGates.reasons);
    gate.ok = false;
  }
  if (!gate.ok) {
    appendEvent(projectRoot, activeSession, {
      type: 'PhaseGateFailed',
      run_id: run && run.run_id,
      payload: { phase: phase.id, reasons: gate.reasons },
    });
    return { closed: false, phase: phase.id, gate, commit: null };
  }

  const regressionChecks = programLib.freezeRegressionChecks(run.verification_check_results, run.verification_suite);
  const regressionFile = programLib.writeRegression(paths.programDir, phase.id, regressionChecks, { run_id: run.run_id || null });

  const parsers = loadSdkParsers();
  const planText = readTextIfExists(paths.plan);
  const parsedPlan = parsers && planText
    ? attachImplementationPackContracts(parsePlanArtifact(parsers, planText, paths.plan), paths.implementationPack)
    : { tasks: [] };
  const modules = programLib.buildInterfaces(projectRoot, runtime, programLib.contractedFiles(parsedPlan));
  const interfacesFile = programLib.writeInterfaces(paths.programDir, phase.id, modules);

  const commit = options.commit === false
    ? { commit: null, committed: false, reason: 'commit desativado (--no-commit)' }
    : programLib.commitPhase(projectRoot, options.message || `feat(phase-${phase.id.toLowerCase()}): ${phase.title}`);

  if (gate.deferred && gate.deferred.length && gateInput.verify_status === 'blocked') {
    const onlyManual = (run.verification_check_results || []).every((c) => c.status === 'pass' || (c.status === 'skip' && c.skip_reason === 'needs_structured_check'));
    if (onlyManual) gateInput.verify_status = 'completed';
  }
  const closed = runtime.closePhase(state, phase.id, gateInput, {
    closed_commit: commit.commit,
    regression_ref: programLib.relativeRef(projectRoot, regressionFile),
    interfaces_ref: programLib.relativeRef(projectRoot, interfacesFile),
    run_id: run.run_id || null,
    plan_ref: paths.plan ? programLib.relativeRef(projectRoot, paths.plan) : null,
  });
  if (gate.deferred && gate.deferred.length) {
    const target = closed.state.phases.find((p) => p.id === phase.id);
    if (target) target.deferred = [...(target.deferred || []), ...gate.deferred];
  }
  programLib.writeProgram(paths.programDir, closed.state);
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  appendEvent(projectRoot, activeSession, {
    type: 'PhaseClosed',
    run_id: run.run_id,
    payload: {
      phase: phase.id,
      commit: commit.commit,
      committed: commit.committed,
      commit_note: commit.reason,
      regression_checks: regressionChecks.length,
      interface_modules: modules.length,
    },
  });
  return {
    closed: true,
    phase: phase.id,
    gate,
    commit,
    regression_checks: regressionChecks.length,
    interface_modules: modules.length,
    next: runtime.nextOpenPhase(closed.state),
  };
}

/** Resumo da regressão de fases anteriores: aparece separado no VERIFY e no gate de fase. */
function summarizeRegression(regressionChecks, checkResults) {
  if (!regressionChecks.length) return null;
  const ids = new Set(regressionChecks.map((check) => check.id));
  const results = (Array.isArray(checkResults) ? checkResults : []).filter((result) => ids.has(result.check_id));
  const failed = results.filter((result) => result.status === 'fail' || result.status === 'error');
  return {
    phases: [...new Set(regressionChecks.map((check) => check.regression_phase))],
    total: regressionChecks.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: failed.map((result) => ({ check_id: result.check_id, error: result.error || null })),
  };
}

// Marks SPEC.md checklist items as [x] when the run is completed.
// Finds **DoD Wave N:** blocks and numbered checklist sections (e.g. "21.1 MVP"),
// marks unchecked items only within sections whose waves are fully completed.
function applySpecChecklistSync(specPath, canonicalLive, compiledGraph) {
  if (!canonicalLive || (canonicalLive.run && canonicalLive.run.status !== 'completed')) return;
  if (!specPath || !fs.existsSync(specPath)) return;

  const completedIds = new Set(
    canonicalLive.completedWorkItems instanceof Set
      ? [...canonicalLive.completedWorkItems]
      : Array.isArray(canonicalLive.completedWorkItems)
        ? canonicalLive.completedWorkItems
        : []
  );
  if (completedIds.size === 0) return;

  const waves = Array.isArray(compiledGraph && compiledGraph.waves) ? compiledGraph.waves : [];

  // Which wave numbers are fully completed (all node_ids in completedIds)?
  const completedWaveNums = new Set();
  for (const wave of waves) {
    if (Array.isArray(wave.node_ids) && wave.node_ids.length > 0 &&
        wave.node_ids.every(id => completedIds.has(id))) {
      completedWaveNums.add(wave.wave_number);
    }
  }

  // Are ALL waves completed? (run is complete = yes, since status === 'completed')
  const allWavesDone = waves.length === 0 || waves.every(w =>
    Array.isArray(w.node_ids) && w.node_ids.every(id => completedIds.has(id))
  );

  const lines = fs.readFileSync(specPath, 'utf8').split('\n');
  let changed = false;

  // Tracking state: which section type are we marking?
  // 'none' | 'dod_wave' | 'checklist_mvp' | 'checklist_full'
  let markMode = 'none';

  const result = lines.map((line, i) => {
    // Detect DoD Wave block header: **DoD Wave N:** or **DoD Wave N:** (with optional emoji/text)
    const dodMatch = line.match(/\*\*DoD Wave\s+(\d+):/i);
    if (dodMatch) {
      const waveNum = parseInt(dodMatch[1], 10);
      markMode = completedWaveNums.has(waveNum) ? 'dod_wave' : 'none';
      return line;
    }

    // Detect numbered checklist section headers (e.g. "### 21.1 MVP", "### 21.2 v1.0.0")
    const checklistMatch = line.match(/^#{2,4}\s+\d+\.\d+\s+(.+)/i);
    if (checklistMatch) {
      const sectionTitle = checklistMatch[1].toLowerCase();
      // MVP / v0.x.x → mark when run is fully complete (pre-release milestones)
      // v1.0.0 or any X.Y.Z ≥ 1.0.0 → never auto-mark (requires explicit human sign-off)
      if (/mvp|v?0\.\d+\.\d+/i.test(sectionTitle) && allWavesDone) {
        markMode = 'checklist_mvp';
      } else {
        markMode = 'none';
      }
      return line;
    }

    // Exit section on any top-level heading (##, ###) that isn't a checklist header
    if (/^#{1,3}\s/.test(line) && !checklistMatch) {
      markMode = 'none';
      return line;
    }

    // Exit DoD section on **Limite técnico or **Condição para replanejar etc.
    if (markMode === 'dod_wave' && /^\*\*(?:Limite|Condição|Nota|Atenção|Warning)/.test(line)) {
      markMode = 'none';
      return line;
    }

    // Mark unchecked items in active section
    if (markMode !== 'none' && /^- \[ \]/.test(line)) {
      changed = true;
      return line.replace(/^- \[ \]/, '- [x]');
    }

    return line;
  });

  if (changed) {
    fs.writeFileSync(specPath, result.join('\n'), 'utf8');
  }
}

const PROJECTION_BEGIN = '<!-- oxe:runtime:begin -->';
const PROJECTION_END = '<!-- oxe:runtime:end -->';
const LEGACY_PROJECTION_MARK = 'Gerado automaticamente pelo Projection Engine';

/** Demote a projected document so it nests under the human file: H1 dropped, `##` → `###`. */
function demoteProjection(content) {
  return String(content || '')
    .split('\n')
    .filter((line) => !/^# /.test(line) && !line.includes(LEGACY_PROJECTION_MARK))
    .map((line) => (/^#{2,5} /.test(line) ? `#${line}` : line))
    .join('\n')
    .replace(/^\n+/, '');
}

/**
 * Write a runtime projection into a human-owned markdown file without destroying it.
 * - file with markers → only the block between them is replaced;
 * - missing file or a legacy full projection → the projection is written whole, wrapped in markers;
 * - human file without markers → a demoted block is appended at the end.
 */
function writeProjectedBlock(filePath, content, heading) {
  const existing = readTextIfExists(filePath);
  const full = `${PROJECTION_BEGIN}\n${String(content).trimEnd()}\n${PROJECTION_END}\n`;
  if (existing == null || !existing.trim() || existing.includes(LEGACY_PROJECTION_MARK) && !existing.includes(PROJECTION_BEGIN)) {
    fs.writeFileSync(filePath, full, 'utf8');
    return 'replaced';
  }
  const begin = existing.indexOf(PROJECTION_BEGIN);
  const end = existing.indexOf(PROJECTION_END);
  if (begin !== -1 && end > begin) {
    const inner = existing.slice(0, begin).trim() ? `## ${heading}\n\n${demoteProjection(content).trimEnd()}` : String(content).trimEnd();
    const next = `${existing.slice(0, begin)}${PROJECTION_BEGIN}\n${inner}\n${existing.slice(end)}`;
    fs.writeFileSync(filePath, next, 'utf8');
    return 'block';
  }
  const block = `${PROJECTION_BEGIN}\n## ${heading}\n\n${demoteProjection(content).trimEnd()}\n${PROJECTION_END}\n`;
  fs.writeFileSync(filePath, `${existing.trimEnd()}\n\n${block}`, 'utf8');
  return 'appended';
}

/**
 * OXB-121 (contradiction): the runtime block of STATE.md states the RUN's status (run state) and the task progress from
 * PLAN.json (the source of truth, OXB-059): a task done in PLAN.json is never listed as failed because an earlier
 * attempt failed in the event log.
 */
function coherentStateProjection(projectRoot, activeSession, text, run) {
  let out = String(text || '');
  const status = run && run.status ? String(run.status) : null;
  if (status) {
    out = out.replace(/(- \*\*Status da run:\*\*) [^\n]*/, `$1 ${status}`).replace(/(- \*\*runtime_status:\*\*) [^\n]*/, `$1 ${status}`);
  }
  let work = null;
  try { work = runtimePhaseWork(projectRoot, activeSession); } catch { work = null; }
  if (work && work.total) {
    const done = new Set(work.done);
    const listOf = (re) => { const m = re.exec(out); return m && m[2] && m[2].trim() !== '—' ? m[2].split(',').map((x) => x.trim()).filter(Boolean) : []; };
    const failed = listOf(/(- \*\*Falhos \(\d+\):\*\*) ([^\n]*)/).filter((id) => !done.has(id));
    const fmt = (list) => (list.length ? list.join(', ') : '—');
    out = out
      .replace(/- \*\*Concluídos \(\d+\):\*\* [^\n]*/, `- **Concluídos (${work.done.length}):** ${fmt(work.done)}`)
      .replace(/- \*\*Falhos \(\d+\):\*\* [^\n]*/, `- **Falhos (${failed.length}):** ${fmt(failed)}`);
    if (work.external_pending.length && !/Aguardando entrega externa/.test(out)) out = out.replace(/(- \*\*Bloqueados \(\d+\):\*\* [^\n]*)/, `$1\n- **Aguardando entrega externa (${work.external_pending.length}):** ${work.external_pending.join(', ')}`);
  }
  return out;
}

function projectRuntimeArtifacts(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.ProjectionEngine !== 'function' || typeof runtime.fromSerializable !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  let current = options.runState || readRunState(projectRoot, activeSession);
  if (!current) {
    current = writeRunState(projectRoot, activeSession, {});
  }
  if (!current.compiled_graph) {
    current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current }).run;
  }
  const graph = runtime.fromSerializable(current.compiled_graph);
  // Always re-reduce from the event log: the canonical_state frozen at compile time is stale after
  // execute/verify and used to project "planned / 0 concluídos" over real progress. The stored
  // snapshot is only merged in as a fallback for progress recorded without events.
  let canonicalLive = reduceCanonicalRunStateLive(projectRoot, activeSession, { runState: current });
  if (current.canonical_state) {
    const stored = mergeCanonicalStateWithRunState(current.canonical_state, current, activeSession, current.compiled_graph);
    canonicalLive = canonicalLive ? unionCanonicalStates(canonicalLive, stored) : stored;
  }
  if (!canonicalLive) {
    throw new Error('Não foi possível reconstruir o estado canônico da run.');
  }
  const canonicalState = serializeCanonicalState(canonicalLive);
  const projector = new runtime.ProjectionEngine();
  const verificationResults = Array.isArray(current.verification_results) ? current.verification_results : [];
  const verificationCheckResults = Array.isArray(current.verification_check_results) ? current.verification_check_results : [];
  const verificationArtifacts = loadRuntimeVerificationArtifacts(projectRoot, current);
  const projections = {
    plan: projector.projectPlan(canonicalLive, graph),
    verify: projector.projectVerify(
      canonicalLive,
      verificationResults,
      verificationCheckResults,
      verificationArtifacts.manifest,
      verificationArtifacts.residualRisks,
      verificationArtifacts.evidenceCoverage
    ),
    state: projector.projectState(canonicalLive),
    runSummary: projector.projectRunSummary(canonicalLive, readExecutorUsageRows(projectRoot, activeSession, current.run_id)),
    commitSummary: typeof projector.projectCommitSummary === 'function'
      ? projector.projectCommitSummary(canonicalLive, graph)
      : projector.projectRunSummary(canonicalLive),
    promotionSummary: typeof projector.projectPromotionSummary === 'function'
      ? projector.projectPromotionSummary(canonicalLive, graph)
      : projector.projectPRSummary(canonicalLive, graph),
    prSummary: projector.projectPRSummary(canonicalLive, graph),
  };
  const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
  const op = operationalPaths(projectRoot, activeSession);
  const projectionRefs = {
    plan_ref: path.relative(projectRoot, paths.plan.replace(/PLAN\.md$/, 'PLAN-STATUS.md')).replace(/\\/g, '/'),
    verify_ref: path.relative(projectRoot, paths.verify).replace(/\\/g, '/'),
    state_ref: path.relative(projectRoot, paths.state).replace(/\\/g, '/'),
    run_summary_ref: path.relative(projectRoot, path.join(op.executionRoot, 'RUN-SUMMARY.md')).replace(/\\/g, '/'),
    commit_summary_ref: path.relative(projectRoot, path.join(op.executionRoot, 'COMMIT-SUMMARY.md')).replace(/\\/g, '/'),
    promotion_summary_ref: path.relative(projectRoot, path.join(op.executionRoot, 'PROMOTION-SUMMARY.md')).replace(/\\/g, '/'),
    pr_summary_ref: path.relative(projectRoot, path.join(op.executionRoot, 'PR-SUMMARY.md')).replace(/\\/g, '/'),
    generated_at: new Date().toISOString(),
  };
  if (options.write !== false) {
    // Write plan projection to PLAN-STATUS.md — never overwrite the source PLAN.md
    const planStatusPath = paths.plan.replace(/PLAN\.md$/, 'PLAN-STATUS.md');
    ensureDirForFile(planStatusPath);
    ensureDirForFile(paths.verify);
    ensureDirForFile(paths.state);
    fs.writeFileSync(planStatusPath, projections.plan + '\n', 'utf8');
    // STATE.md and VERIFY.md are curated by people and workflows: only the marked block is ours.
    writeProjectedBlock(paths.verify, projections.verify, 'Verificação do runtime (projetado)');
    // OXB-121 (contradiction): the top block of STATE.md is written first (a template STATE.md is replaced whole), then the runtime block,, from the same run state, so
    // the two blocks never disagree ("completed 38/38" above, "failed · 0 concluídos · 7 falhos" below).
    try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
    writeProjectedBlock(paths.state, coherentStateProjection(projectRoot, activeSession, projections.state, current), 'Runtime (projetado)');
    fs.writeFileSync(path.join(op.executionRoot, 'RUN-SUMMARY.md'), projections.runSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'COMMIT-SUMMARY.md'), projections.commitSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'PROMOTION-SUMMARY.md'), projections.promotionSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'PR-SUMMARY.md'), projections.prSummary + '\n', 'utf8');
    // Sync SPEC.md checklist: mark completed wave DoD sections and MVP checklist when run closes
    applySpecChecklistSync(paths.spec, canonicalLive, current.compiled_graph);
  }
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    canonical_state: canonicalState,
    verification_manifest: verificationArtifacts.manifest,
    residual_risks: verificationArtifacts.residualRisks,
    verification_evidence_coverage: verificationArtifacts.evidenceCoverage,
    projections: projectionRefs,
  });
  return {
    run: next,
    projections,
    paths: {
      ...paths,
      runSummary: path.join(op.executionRoot, 'RUN-SUMMARY.md'),
      commitSummary: path.join(op.executionRoot, 'COMMIT-SUMMARY.md'),
      promotionSummary: path.join(op.executionRoot, 'PROMOTION-SUMMARY.md'),
      prSummary: path.join(op.executionRoot, 'PR-SUMMARY.md'),
    },
  };
}

async function runRuntimeCiChecks(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.runCIChecks !== 'function' || typeof runtime.summarizeCIResults !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  let current = options.runState || readRunState(projectRoot, activeSession);
  if (!current) {
    current = compileExecutionGraphFromArtifacts(projectRoot, activeSession).run;
  }
  const runId = options.runId || (current && current.run_id) || null;
  const results = await runtime.runCIChecks({
    projectRoot,
    sessionId: activeSession || null,
    runId,
  });
  const summary = runtime.summarizeCIResults(results);
  const ciResultsPath = path.join(projectRoot, '.oxe', 'runs', runId || makeRunId(), 'ci-results.json');
  ensureDirForFile(ciResultsPath);
  fs.writeFileSync(ciResultsPath, JSON.stringify({
    run_id: runId,
    generated_at: new Date().toISOString(),
    summary,
    results,
  }, null, 2), 'utf8');
  const next = writeRunState(projectRoot, activeSession, {
    ...(current || {}),
    run_id: runId || makeRunId(),
    status: current && current.status ? current.status : 'planned',
    ci_checks: {
      generated_at: new Date().toISOString(),
      summary,
      results,
      path: path.relative(projectRoot, ciResultsPath).replace(/\\/g, '/'),
    },
  });
  appendEvent(projectRoot, activeSession, {
    type: 'runtime_ci_completed',
    run_id: next.run_id,
    payload: {
      total: summary.total,
      pass: summary.pass,
      fail: summary.fail,
      skip: summary.skip,
      error: summary.error,
      allPassed: summary.allPassed,
    },
  });
  return { run: next, runId: next.run_id, results, summary, path: ciResultsPath };
}

async function runRuntimePromotion(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.PromotionPipeline !== 'function' || typeof runtime.BranchManager !== 'function' || typeof runtime.PRManager !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  let current = options.runState || readRunState(projectRoot, activeSession);
  if (!current) {
    throw new Error('Nenhum ACTIVE-RUN disponível para promover.');
  }
  const verificationArtifacts = loadRuntimeVerificationArtifacts(projectRoot, current);
  if (!verificationArtifacts.manifest) {
    throw new Error('Manifest de verify ausente — execute `oxe-cc runtime verify` antes de promover.');
  }
  const branchManager = new runtime.BranchManager(projectRoot);
  const prManager = new runtime.PRManager(projectRoot);
  const pipeline = new runtime.PromotionPipeline(projectRoot, branchManager, prManager);
  const runResult = runResultFromRunState(current);
  const gates = readRuntimeGates(projectRoot, activeSession, { runId: current.run_id }).all;
  const commitRecord = pipeline.loadCommitRecord(current.run_id)
    || pipeline.recordLocalCommit(runResult, verificationArtifacts.manifest, verificationArtifacts.residualRisks, {
      commitSha: branchManager.currentCommit(),
      summaryPath: current.projections && current.projections.commit_summary_ref ? current.projections.commit_summary_ref : null,
    });
  const promotion = await pipeline.promote(
    runResult,
    verificationArtifacts.manifest,
    verificationArtifacts.residualRisks,
    {
      targetKind: options.targetKind || 'pr_draft',
      remote: options.remote || 'origin',
      baseBranch: options.baseBranch || 'main',
      targetRef: options.targetRef || options.baseBranch || 'main',
      minimumCoverage: options.minimumCoverage == null ? 100 : Number(options.minimumCoverage),
      draftPR: options.draftPR !== false,
    },
    gates,
    verificationArtifacts.evidenceCoverage
  );
  const health = loadProjectHealth();
  const healthReport = health && typeof health.buildHealthReport === 'function'
    ? health.buildHealthReport(projectRoot)
    : null;
  const promotionReadiness = healthReport && healthReport.promotionReadiness ? healthReport.promotionReadiness : null;
  const readinessPath = path.join(projectRoot, '.oxe', 'runs', current.run_id, 'promotion-readiness.json');
  ensureDirForFile(readinessPath);
  fs.writeFileSync(readinessPath, JSON.stringify({
    run_id: current.run_id,
    generated_at: new Date().toISOString(),
    readiness: promotionReadiness,
    promotion,
  }, null, 2), 'utf8');
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    delivery: {
      commit_record: commitRecord,
      promotion_record: promotion,
      promotion_readiness_ref: path.relative(projectRoot, readinessPath).replace(/\\/g, '/'),
    },
  });
  appendEvent(projectRoot, activeSession, {
    type: promotion.status === 'blocked' ? 'GateRequested' : 'ToolCompleted',
    run_id: next.run_id,
    payload: {
      promotion_target: promotion.target_kind,
      promotion_status: promotion.status,
      remote: promotion.remote,
      target_ref: promotion.target_ref,
      pr_url: promotion.pr_url,
    },
  });
  const projected = projectRuntimeArtifacts(projectRoot, activeSession, { runState: next, write: true });
  return {
    run: projected.run,
    commitRecord,
    promotion,
    promotionReadiness,
    projected,
  };
}

function recoverRuntimeState(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.loadJournal !== 'function') {
    throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  }
  const current = options.runState || readRunState(projectRoot, activeSession);
  if (!current || !current.run_id) {
    throw new Error('Nenhum ACTIVE-RUN disponível para recover.');
  }
  let journal = runtime.loadJournal(projectRoot, current.run_id);
  if (!journal) {
    throw new Error(`Journal ausente para run ${current.run_id}.`);
  }
  // 1.20c (OXB-010): `running` cujo dono morreu (OOM, terminal fechado) vira `interrupted`, retomável.
  if (typeof runtime.isJournalStale === 'function' && runtime.isJournalStale(journal)) {
    journal = runtime.markInterrupted(journal);
    runtime.saveJournal(projectRoot, current.run_id, journal);
    appendEvent(projectRoot, activeSession, {
      type: 'RunAborted',
      run_id: current.run_id,
      payload: { reason: 'owner_process_gone', reclaimed: true, completed: journal.completed_work_items || [] },
    });
  }
  const canonicalLive = reduceCanonicalRunStateLive(projectRoot, activeSession, {
    runId: current.run_id,
    runState: current,
  }) || mergeCanonicalStateWithRunState(current.canonical_state, current, activeSession, current.compiled_graph);
  const graphNodes = current.compiled_graph && current.compiled_graph.nodes && typeof current.compiled_graph.nodes === 'object'
    ? new Set(Object.keys(current.compiled_graph.nodes))
    : new Set();
  const orphanWorkItems = Array.from(new Set([
    ...((journal.pending_gates || []).filter((id) => id && !graphNodes.has(String(id)))),
    ...((current.active_tasks || []).filter((id) => id && !graphNodes.has(String(id)))),
  ]));
  const nextStatus = journal.scheduler_state === 'paused' || journal.scheduler_state === 'interrupted'
    ? 'paused'
    : journal.scheduler_state === 'blocked'
      ? 'blocked'
      : current.status || 'planned';
  const verificationArtifacts = loadRuntimeVerificationArtifacts(projectRoot, current);
  const consistency = buildRecoveryConsistency(
    projectRoot,
    activeSession,
    current,
    journal,
    verificationArtifacts
  );
  const recoverySummary = {
    recovered_at: new Date().toISOString(),
    journal_state: journal.scheduler_state,
    orphan_work_items: orphanWorkItems,
    orphan_worktrees: detectOrphanWorktrees(projectRoot, current.run_id),
    pending_gates: readRuntimeGates(projectRoot, activeSession, { runId: current.run_id }).pending.map((gate) => gate.gate_id),
    consistency,
  };
  const runDir = path.join(projectRoot, '.oxe', 'runs', current.run_id);
  ensureDir(runDir);
  const recoverySummaryPath = path.join(runDir, 'recovery-summary.json');
  fs.writeFileSync(recoverySummaryPath, JSON.stringify(recoverySummary, null, 2), 'utf8');
  const summaryPath = writeRecoverySummaryMarkdown(projectRoot, activeSession, current, recoverySummary);
  recoverySummary.json_ref = path.relative(projectRoot, recoverySummaryPath).replace(/\\/g, '/');
  recoverySummary.markdown_ref = path.relative(projectRoot, summaryPath).replace(/\\/g, '/');
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    status: nextStatus,
    canonical_state: serializeCanonicalState(canonicalLive),
    recovery_summary: recoverySummary,
    metrics: {
      ...(current.metrics || {}),
      recover_count: Number((current.metrics || {}).recover_count || 0) + 1,
      last_action: 'recover',
    },
  });
  appendEvent(projectRoot, activeSession, {
    type: 'RunStarted',
    run_id: next.run_id,
    payload: {
      recovered: true,
      orphan_work_items: orphanWorkItems,
      journal_state: journal.scheduler_state,
    },
  });
  return {
    run: next,
    journal,
    recoverySummary,
  };
}

function operationalPaths(projectRoot, activeSession) {
  const oxeDir = path.join(projectRoot, '.oxe');
  const scopeRoot = activeSession ? path.join(oxeDir, ...String(activeSession).split('/')) : oxeDir;
  const executionRoot = activeSession ? path.join(scopeRoot, 'execution') : oxeDir;
  const runsDir = path.join(executionRoot, 'runs');
  return {
    oxeDir,
    scopeRoot,
    executionRoot,
    runsDir,
    events: path.join(executionRoot, 'OXE-EVENTS.ndjson'),
    activeRun: path.join(executionRoot, 'ACTIVE-RUN.json'),
    projectLessons: path.join(oxeDir, 'global', 'LESSONS.md'),
    sessionManifest: activeSession ? path.join(scopeRoot, 'SESSION.md') : null,
    verify: activeSession ? path.join(scopeRoot, 'verification', 'VERIFY.md') : path.join(oxeDir, 'VERIFY.md'),
    investigations: activeSession ? path.join(scopeRoot, 'research', 'INVESTIGATIONS.md') : path.join(oxeDir, 'INVESTIGATIONS.md'),
    capabilitiesDir: path.join(oxeDir, 'capabilities'),
    capabilitiesIndex: path.join(oxeDir, 'CAPABILITIES.md'),
    checkpoints: activeSession ? path.join(scopeRoot, 'execution', 'CHECKPOINTS.md') : path.join(oxeDir, 'CHECKPOINTS.md'),
    gates: gateStoragePath(projectRoot, activeSession),
    auditTrail: path.join(oxeDir, 'AUDIT-TRAIL.ndjson'),
  };
}

function makeRunId() {
  return `oxe-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeNodes(nodes) {
  const byId = new Map();
  for (const node of nodes || []) {
    if (!node || !node.id) continue;
    byId.set(node.id, { ...byId.get(node.id), ...node });
  }
  return Array.from(byId.values());
}

function dedupeEdges(edges) {
  const byKey = new Map();
  for (const edge of edges || []) {
    if (!edge || !edge.from || !edge.to) continue;
    const key = [edge.from, edge.to, edge.type || 'link', edge.label || ''].join('::');
    byKey.set(key, { ...byKey.get(key), ...edge });
  }
  return Array.from(byKey.values());
}

function buildOperationalGraph(runState = {}) {
  const currentWave = runState.current_wave == null ? null : Number(runState.current_wave);
  const activeTasks = Array.isArray(runState.active_tasks) ? runState.active_tasks.map(String) : [];
  const pendingCheckpoints = Array.isArray(runState.pending_checkpoints) ? runState.pending_checkpoints.map(String) : [];
  const multiAgent = runState.multi_agent && typeof runState.multi_agent === 'object'
    ? runState.multi_agent
    : null;
  const azureContext = runState.provider_context && runState.provider_context.azure && typeof runState.provider_context.azure === 'object'
    ? runState.provider_context.azure
    : null;
  const baseNodes = (((runState.graph || {}).nodes) || []).map((node) => ({ ...node }));
  const baseEdges = (((runState.graph || {}).edges) || []).map((edge) => ({ ...edge }));
  const generatedNodes = [
    {
      id: `run:${runState.run_id || 'active'}`,
      label: runState.run_id || 'active-run',
      kind: 'run',
      status: runState.status || 'planned',
      detail: runState.cursor && runState.cursor.mode ? `mode:${runState.cursor.mode}` : 'run ativo',
    },
    {
      id: 'agent:main-executor',
      label: 'main-executor',
      kind: 'agent',
      status: /running|replaying/.test(String(runState.status || '')) ? 'active' : 'planned',
      detail: activeTasks.length ? activeTasks.join(', ') : 'sem tarefas ativas',
    },
  ];
  const generatedEdges = [
    {
      from: `run:${runState.run_id || 'active'}`,
      to: 'agent:main-executor',
      type: 'handoff',
      status: /running|replaying/.test(String(runState.status || '')) ? 'active' : 'planned',
      reason: 'orquestração principal',
    },
  ];
  if (currentWave != null) {
    generatedNodes.push({
      id: `wave:${currentWave}`,
      label: `wave-${currentWave}`,
      kind: 'wave',
      status: runState.status || 'planned',
      detail: activeTasks.length ? `${activeTasks.length} tarefa(s)` : 'sem tarefas ativas',
    });
    generatedEdges.push({
      from: `run:${runState.run_id || 'active'}`,
      to: `wave:${currentWave}`,
      type: 'contains',
      status: 'done',
    });
  }
  for (const taskId of activeTasks) {
    generatedNodes.push({
      id: `task:${taskId}`,
      label: taskId,
      kind: 'task',
      status: /paused|waiting_approval/.test(String(runState.status || '')) ? 'blocked' : 'active',
      detail: currentWave != null ? `wave ${currentWave}` : 'task ativa',
    });
    generatedEdges.push({
      from: currentWave != null ? `wave:${currentWave}` : 'agent:main-executor',
      to: `task:${taskId}`,
      type: 'executes',
      status: /running|replaying/.test(String(runState.status || '')) ? 'active' : 'planned',
    });
  }
  for (const checkpointId of pendingCheckpoints) {
    generatedNodes.push({
      id: `checkpoint:${checkpointId}`,
      label: checkpointId,
      kind: 'checkpoint',
      status: 'pending_approval',
      detail: 'aprovação pendente',
    });
    generatedEdges.push({
      from: activeTasks.length ? `task:${activeTasks[activeTasks.length - 1]}` : (currentWave != null ? `wave:${currentWave}` : `run:${runState.run_id || 'active'}`),
      to: `checkpoint:${checkpointId}`,
      type: 'gate',
      status: 'blocked',
      reason: 'checkpoint pendente',
    });
  }
  if (multiAgent && multiAgent.enabled) {
    const ownership = Array.isArray(multiAgent.ownership) ? multiAgent.ownership : [];
    const handoffs = Array.isArray(multiAgent.handoffs) ? multiAgent.handoffs : [];
    const agents = Array.isArray(multiAgent.agents) ? multiAgent.agents : [];
    for (const agent of agents) {
      const agentId = String(agent.agent_id || agent.id || 'agent');
      generatedNodes.push({
        id: `agent:${agentId}`,
        label: agentId,
        kind: 'agent',
        status: String(agent.status || agent.outcome || 'active'),
        detail: agent.role || agent.profile || multiAgent.mode || 'multi-agent',
      });
      generatedEdges.push({
        from: `run:${runState.run_id || 'active'}`,
        to: `agent:${agentId}`,
        type: 'handoff',
        status: String(agent.status || 'active'),
        reason: 'coordenação multi-agent',
      });
    }
    for (const item of ownership) {
      const taskId = String(item.work_item_id || item.task_id || '');
      const agentId = String(item.agent_id || '');
      if (!taskId || !agentId) continue;
      generatedNodes.push({
        id: `task:${taskId}`,
        label: taskId,
        kind: 'task',
        status: String(item.status || 'assigned'),
        detail: `owner ${agentId}`,
      });
      generatedEdges.push({
        from: `agent:${agentId}`,
        to: `task:${taskId}`,
        type: 'owns',
        status: String(item.status || 'assigned'),
        reason: 'ownership canónica',
      });
    }
    for (const handoff of handoffs) {
      const fromAgent = String(handoff.from_agent_id || handoff.from || '');
      const toAgent = String(handoff.to_agent_id || handoff.to || '');
      if (!fromAgent || !toAgent) continue;
      generatedEdges.push({
        from: `agent:${fromAgent}`,
        to: `agent:${toAgent}`,
        type: 'handoff',
        status: String(handoff.status || 'completed'),
        reason: handoff.reason || handoff.work_item_id || 'handoff cooperativo',
      });
    }
  }
  if (azureContext) {
    const azureStatus = azureContext.login_active
      ? (azureContext.pending_approval_count > 0 ? 'blocked' : 'active')
      : 'warning';
    generatedNodes.push({
      id: 'provider:azure',
      label: 'azure',
      kind: 'provider',
      status: azureStatus,
      detail: azureContext.subscription_name || azureContext.subscription_id || azureContext.cloud || 'contexto azure',
    });
    generatedEdges.push({
      from: `run:${runState.run_id || 'active'}`,
      to: 'provider:azure',
      type: 'provider',
      status: azureStatus,
      reason: 'contexto cloud ativo',
    });
    const lastOperation = azureContext.last_operation && typeof azureContext.last_operation === 'object'
      ? azureContext.last_operation
      : null;
    if (lastOperation) {
      const capabilityId = String(lastOperation.capability_id || lastOperation.domain || 'azure-operation');
      generatedNodes.push({
        id: `capability:${capabilityId}`,
        label: capabilityId,
        kind: 'capability',
        status: String(lastOperation.phase || lastOperation.status || 'planned'),
        detail: lastOperation.command_display || lastOperation.operation || 'operação Azure',
      });
      generatedEdges.push({
        from: 'provider:azure',
        to: `capability:${capabilityId}`,
        type: 'tool_call',
        status: String(lastOperation.phase || lastOperation.status || 'planned'),
        reason: lastOperation.operation || lastOperation.domain || 'ação Azure',
      });
      const refs = Array.isArray(lastOperation.resource_refs) ? lastOperation.resource_refs : [];
      for (let index = 0; index < refs.length; index += 1) {
        const ref = refs[index];
        const normalized = ref && typeof ref === 'object' ? ref : { name: String(ref || 'resource') };
        const resourceId = normalized.id || normalized.name || normalized.resource_id || normalized.type || `resource-${index + 1}`;
        generatedNodes.push({
          id: `resource:${resourceId}`,
          label: normalized.name || normalized.type || resourceId,
          kind: 'resource',
          status: String(lastOperation.phase || lastOperation.status || 'planned'),
          detail: [normalized.type, normalized.resource_group, normalized.location].filter(Boolean).join(' · ') || azureContext.subscription_name || 'recurso Azure',
        });
        generatedEdges.push({
          from: `capability:${capabilityId}`,
          to: `resource:${resourceId}`,
          type: 'targets',
          status: String(lastOperation.phase || lastOperation.status || 'planned'),
          reason: normalized.scope || normalized.kind || 'recurso alvo',
        });
      }
      if (lastOperation.pending_checkpoint_id) {
        generatedNodes.push({
          id: `checkpoint:${lastOperation.pending_checkpoint_id}`,
          label: String(lastOperation.pending_checkpoint_id),
          kind: 'checkpoint',
          status: 'pending_approval',
          detail: 'gate Azure pendente',
        });
        generatedEdges.push({
          from: `capability:${capabilityId}`,
          to: `checkpoint:${lastOperation.pending_checkpoint_id}`,
          type: 'gate',
          status: 'blocked',
          reason: 'approval policy do provider Azure',
        });
      }
    }
  }
  return {
    nodes: dedupeNodes([...baseNodes, ...generatedNodes]),
    edges: dedupeEdges([...baseEdges, ...generatedEdges]),
  };
}

const RECENT_EVENT_IDS_MAX = 10000;
const recentEventIds = new Set();

function rememberEventId(key) {
  if (recentEventIds.size >= RECENT_EVENT_IDS_MAX) {
    recentEventIds.delete(recentEventIds.values().next().value);
  }
  recentEventIds.add(key);
}

function appendEvent(projectRoot, activeSession, event = {}) {
  const p = operationalPaths(projectRoot, activeSession);
  ensureDirForFile(p.events);
  const entry = {
    // Runtime envelopes (OxeEvent) carry `id`; operational records carry `event_id`. Same identity.
    event_id: event.event_id || event.id || `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(event.type || 'custom'),
    timestamp: event.timestamp || new Date().toISOString(),
    run_id: event.run_id || null,
    session_id: activeSession || event.session_id || null,
    wave_id: event.wave_id || null,
    task_id: event.task_id || event.work_item_id || null,
    work_item_id: event.work_item_id || event.task_id || null,
    attempt_id: event.attempt_id || null,
    agent_id: event.agent_id || null,
    causation_id: event.causation_id || null,
    correlation_id: event.correlation_id || null,
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
  };
  // Idempotent append: the same event forwarded twice (bus + onEvent) must land once.
  const dedupeKey = `${p.events}::${entry.event_id}`;
  if (recentEventIds.has(dedupeKey)) return entry;
  rememberEventId(dedupeKey);
  fs.appendFileSync(p.events, `${JSON.stringify(entry)}\n`, 'utf8');
  // OXB-031/043: every runtime write records which oxe-cc wrote this .oxe/ (once per process).
  require('./oxe-dir-info.cjs').touchMarker(projectRoot);
  return entry;
}

function readEvents(projectRoot, activeSession) {
  const p = operationalPaths(projectRoot, activeSession);
  const raw = readTextIfExists(p.events) || '';
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeEvents(events) {
  const byType = {};
  for (const event of events) {
    const key = String(event.type || 'custom');
    byType[key] = (byType[key] || 0) + 1;
  }
  return {
    total: events.length,
    byType,
    lastEvent: events.length ? events[events.length - 1] : null,
  };
}

function writeRunState(projectRoot, activeSession, runState = {}) {
  const p = operationalPaths(projectRoot, activeSession);
  const runId = String(runState.run_id || makeRunId());
  const canonicalState = runState.canonical_state ? serializeCanonicalState(hydrateCanonicalState(runState.canonical_state)) : null;
  const payload = {
    run_id: runId,
    status: VALID_RUN_STATUSES.has(String(runState.status || 'planned')) ? String(runState.status || 'planned') : 'planned',
    created_at: runState.created_at || new Date().toISOString(),
    updated_at: runState.updated_at || new Date().toISOString(),
    plan_ref: runState.plan_ref || 'PLAN.md',
    session_id: activeSession || null,
    current_wave: runState.current_wave == null ? null : Number(runState.current_wave),
    cursor: {
      wave: runState.cursor && runState.cursor.wave != null ? Number(runState.cursor.wave) : null,
      task: runState.cursor && runState.cursor.task ? String(runState.cursor.task) : null,
      mode: runState.cursor && runState.cursor.mode ? String(runState.cursor.mode) : null,
    },
    active_tasks: Array.isArray(runState.active_tasks) ? runState.active_tasks.map(String) : [],
    pending_checkpoints: Array.isArray(runState.pending_checkpoints) ? runState.pending_checkpoints.map(String) : [],
    retries: Array.isArray(runState.retries) ? runState.retries : [],
    failures: Array.isArray(runState.failures) ? runState.failures : [],
    evidence: Array.isArray(runState.evidence) ? runState.evidence : [],
    provider_context: runState.provider_context && typeof runState.provider_context === 'object'
      ? runState.provider_context
      : {},
    graph: runState.graph && typeof runState.graph === 'object'
      ? {
          nodes: Array.isArray(runState.graph.nodes) ? runState.graph.nodes : [],
          edges: Array.isArray(runState.graph.edges) ? runState.graph.edges : [],
        }
      : { nodes: [], edges: [] },
    compiled_graph: runState.compiled_graph && typeof runState.compiled_graph === 'object'
      ? runState.compiled_graph
      : null,
    graph_version: runState.graph_version || null,
    canonical_state: canonicalState,
    verification_suite: runState.verification_suite && typeof runState.verification_suite === 'object'
      ? runState.verification_suite
      : null,
    verification_results: Array.isArray(runState.verification_results) ? runState.verification_results : [],
    verification_check_results: Array.isArray(runState.verification_check_results) ? runState.verification_check_results : [],
    verification_manifest: runState.verification_manifest && typeof runState.verification_manifest === 'object'
      ? runState.verification_manifest
      : null,
    residual_risks: runState.residual_risks && typeof runState.residual_risks === 'object'
      ? runState.residual_risks
      : null,
    verification_evidence_coverage: runState.verification_evidence_coverage && typeof runState.verification_evidence_coverage === 'object'
      ? runState.verification_evidence_coverage
      : null,
    verification_gaps: Array.isArray(runState.verification_gaps) ? runState.verification_gaps.map(String) : [],
    // OXB-079: the verify's own outcome (program close reads it; dropping it here kept the close on `running`).
    verification_status: typeof runState.verification_status === 'string' ? runState.verification_status : null,
    verified_at: typeof runState.verified_at === 'string' ? runState.verified_at : null,
    // 1.19: hash dos testes de aceite do plano congelado no compile; resumo da regressão de fases.
    acceptance_lock: runState.acceptance_lock && typeof runState.acceptance_lock === 'object' ? runState.acceptance_lock : null,
    verification_regression: runState.verification_regression && typeof runState.verification_regression === 'object' ? runState.verification_regression : null,
    // 1.21: phase gates of the last verify — program close reads them (dropping it here made every close fail).
    verification_gates: runState.verification_gates && typeof runState.verification_gates === 'object' ? runState.verification_gates : null,
    // 1.21.1: the plan sources the graph was compiled from (stale-graph check in execute).
    source_hash: typeof runState.source_hash === 'string' ? runState.source_hash : null,
    ci_checks: runState.ci_checks && typeof runState.ci_checks === 'object' ? runState.ci_checks : null,
    delivery: runState.delivery && typeof runState.delivery === 'object' ? runState.delivery : null,
    recovery_summary: runState.recovery_summary && typeof runState.recovery_summary === 'object' ? runState.recovery_summary : null,
    multi_agent: runState.multi_agent && typeof runState.multi_agent === 'object' ? runState.multi_agent : null,
    projections: runState.projections && typeof runState.projections === 'object' ? runState.projections : {},
    metrics: runState.metrics && typeof runState.metrics === 'object' ? runState.metrics : {},
  };
  payload.graph = buildOperationalGraph(payload);
  ensureDir(p.runsDir);
  fs.writeFileSync(path.join(p.runsDir, `${runId}.json`), JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(
    p.activeRun,
    JSON.stringify(
      {
        run_id: runId,
        status: payload.status,
        updated_at: payload.updated_at,
        current_wave: payload.current_wave,
        cursor: payload.cursor,
        provider_context: payload.provider_context,
        canonical_state: payload.canonical_state,
        compiled_graph: payload.compiled_graph,
        graph_version: payload.graph_version,
        multi_agent: payload.multi_agent,
      },
      null,
      2
    ),
    'utf8'
  );
  return payload;
}

function readRunState(projectRoot, activeSession) {
  const p = operationalPaths(projectRoot, activeSession);
  const activeRaw = readTextIfExists(p.activeRun);
  let runId = null;
  if (activeRaw) {
    try {
      runId = JSON.parse(activeRaw).run_id || null;
    } catch {
      runId = null;
    }
  }
  if (!runId && fs.existsSync(p.runsDir)) {
    const files = fs.readdirSync(p.runsDir).filter((name) => name.endsWith('.json')).sort();
    if (files.length) runId = files[files.length - 1].replace(/\.json$/i, '');
  }
  if (!runId) return null;
  const filePath = path.join(p.runsDir, `${runId}.json`);
  const raw = readTextIfExists(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readGitActivity(projectRoot, since) {
  if (!projectRoot || !since) return [];
  try {
    const result = spawnSync(
      'git',
      ['log', `--since=${since}`, '--pretty=format:%H %aI'],
      { cwd: projectRoot, encoding: 'utf8', timeout: 5000 }
    );
    if (result.status !== 0 || result.error || !result.stdout) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(' ');
        return {
          hash: idx !== -1 ? line.slice(0, idx) : line,
          timestamp: idx !== -1 ? line.slice(idx + 1) : '',
        };
      });
  } catch {
    return [];
  }
}

function verifyGitEvidence(runState, projectRoot) {
  const warns = [];
  if (!runState || !projectRoot || !runState.created_at) return warns;
  const commits = readGitActivity(projectRoot, runState.created_at);
  if (
    commits.length === 0 &&
    (String(runState.status || '') === 'completed' ||
      (Array.isArray(runState.evidence) && runState.evidence.length > 0))
  ) {
    warns.push('Nenhum commit git encontrado desde o início do run — confirme se o trabalho foi commitado');
  }
  return warns;
}

function runtimeStateWarnings(runState, checkpoints = [], projectRoot = null) {
  const warns = [];
  if (!runState) return warns;
  if (!VALID_RUN_STATUSES.has(String(runState.status || ''))) {
    warns.push(`ACTIVE-RUN inválido: status "${runState.status}" fora do contrato`);
  }
  const cursorWave = runState.cursor && runState.cursor.wave != null ? Number(runState.cursor.wave) : null;
  if (cursorWave != null && runState.current_wave != null && Number(cursorWave) !== Number(runState.current_wave)) {
    warns.push('ACTIVE-RUN com cursor de onda divergente do current_wave');
  }
  const pending = new Set((runState.pending_checkpoints || []).map(String));
  for (const cp of checkpoints) {
    if (/pending_approval/i.test(String(cp.status || '')) && !pending.has(String(cp.id))) {
      warns.push(`Checkpoint ${cp.id} pendente no índice, mas ausente do ACTIVE-RUN`);
    }
  }
  for (const edge of (((runState.graph || {}).edges) || [])) {
    if (edge.type === 'handoff' && (!edge.from || !edge.to)) {
      warns.push('Grafo operacional contém handoff sem origem ou destino');
      break;
    }
  }
  if (projectRoot) {
    for (const w of verifyGitEvidence(runState, projectRoot)) {
      warns.push(w);
    }
  }
  return warns;
}

function parseCapabilityManifest(text) {
  const fm = parseFrontmatter(text);
  const approval = String(fm.approval_policy || fm.policy || '').trim() || null;
  const sideEffects = parseArrayField(fm.side_effects || '');
  const envs = parseArrayField(fm.requires_env || '');
  const evidence = parseArrayField(fm.evidence_outputs || '');
  const sessionCompat = parseArrayField(fm.session_compatibility || fm.session_scope || '');
  const objectiveMatch = String(text || '').match(/##\s*Objetivo\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/i);
  const desc = objectiveMatch ? objectiveMatch[1].split(/\r?\n/).map((line) => line.replace(/^-\s+/, '').trim()).filter(Boolean)[0] || '' : '';
  return {
    id: String(fm.id || '').trim(),
    version: String(fm.version || '').trim() || '1',
    type: String(fm.type || 'local').trim(),
    status: String(fm.status || 'active').trim(),
    scope: String(fm.scope || 'mixed').trim(),
    entrypoint: String(fm.entrypoint || '').trim(),
    approvalPolicy: approval,
    sideEffects,
    requiresEnv: envs,
    evidenceOutputs: evidence,
    sessionCompatibility: sessionCompat,
    description: desc || 'Capability local do projeto',
  };
}

function readCapabilityCatalog(projectRoot) {
  const p = operationalPaths(projectRoot, null);
  if (!fs.existsSync(p.capabilitiesDir)) return [];
  return fs
    .readdirSync(p.capabilitiesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(p.capabilitiesDir, entry.name, 'CAPABILITY.md');
      const raw = readTextIfExists(manifestPath);
      if (!raw) return null;
      return { ...parseCapabilityManifest(raw), manifestPath };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function capabilityCatalogWarnings(projectRoot) {
  const warns = [];
  for (const cap of readCapabilityCatalog(projectRoot)) {
    if (!cap.id) warns.push(`Capability em ${cap.manifestPath} sem id`);
    if (!VALID_CAPABILITY_TYPES.has(cap.type)) warns.push(`Capability ${cap.id || cap.manifestPath}: type "${cap.type}" inválido`);
    if (!cap.approvalPolicy || !VALID_APPROVAL_POLICIES.has(cap.approvalPolicy)) {
      warns.push(`Capability ${cap.id || cap.manifestPath}: approval_policy ausente ou inválida`);
    }
    if (!cap.entrypoint) warns.push(`Capability ${cap.id || cap.manifestPath}: entrypoint ausente`);
    if (!cap.evidenceOutputs.length) warns.push(`Capability ${cap.id || cap.manifestPath}: evidence_outputs ausente`);
  }
  return warns;
}

function buildMemoryLayers(projectRoot, activeSession) {
  const p = operationalPaths(projectRoot, activeSession);
  return {
    readOrder: ['runtime_state', 'session_memory', 'project_memory', 'evidence'],
    runtime_state: {
      source: activeSession ? path.join('.oxe', activeSession, 'execution', 'STATE.md') : '.oxe/STATE.md + ACTIVE-RUN.json',
      exists: fs.existsSync(activeSession ? path.join(projectRoot, '.oxe', activeSession, 'execution', 'STATE.md') : path.join(projectRoot, '.oxe', 'STATE.md')),
    },
    session_memory: {
      source: activeSession ? path.join('.oxe', activeSession, 'SESSION.md') : null,
      exists: Boolean(p.sessionManifest && fs.existsSync(p.sessionManifest)),
    },
    project_memory: {
      source: '.oxe/global/LESSONS.md',
      exists: fs.existsSync(p.projectLessons),
    },
    evidence: {
      source: [
        activeSession ? path.join('.oxe', activeSession, 'research', 'INVESTIGATIONS.md') : '.oxe/INVESTIGATIONS.md',
        activeSession ? path.join('.oxe', activeSession, 'verification', 'VERIFY.md') : '.oxe/VERIFY.md',
      ],
      exists: fs.existsSync(p.investigations) || fs.existsSync(p.verify),
    },
  };
}

function applyRuntimeAction(projectRoot, activeSession, input = {}) {
  const action = String(input.action || 'status').toLowerCase();
  const now = new Date().toISOString();
  const current = readRunState(projectRoot, activeSession);
  const wave = input.wave == null || input.wave === '' ? null : Number(input.wave);
  const task = input.task ? String(input.task) : null;
  const mode = input.mode ? String(input.mode) : (task ? 'task' : wave != null ? 'wave' : 'complete');
  const pendingCheckpoints = Array.isArray(input.pending_checkpoints)
    ? input.pending_checkpoints.map(String)
    : current && Array.isArray(current.pending_checkpoints)
      ? current.pending_checkpoints
      : [];

  if (action === 'start') {
    const next = writeRunState(projectRoot, activeSession, {
      run_id: input.run_id || makeRunId(),
      status: 'running',
      created_at: now,
      updated_at: now,
      plan_ref: input.plan_ref || 'PLAN.md',
      current_wave: wave,
      cursor: { wave, task, mode },
      active_tasks: task ? [task] : Array.isArray(input.active_tasks) ? input.active_tasks.map(String) : [],
      pending_checkpoints: pendingCheckpoints,
      retries: [],
      failures: [],
      evidence: [],
      metrics: {
        transitions: 1,
        pause_count: 0,
        replay_count: 0,
        last_action: 'start',
      },
    });
    appendEvent(projectRoot, activeSession, {
      type: 'run_started',
      run_id: next.run_id,
      wave_id: wave != null ? `wave-${wave}` : null,
      task_id: task,
      payload: { reason: input.reason || 'run inicializado', mode },
    });
    return next;
  }

  if (!current) {
    throw new Error('Nenhum ACTIVE-RUN disponível para esta ação.');
  }

  const next = {
    ...current,
    updated_at: now,
    current_wave: wave != null ? wave : current.current_wave,
    cursor: {
      wave: wave != null ? wave : current.cursor && current.cursor.wave != null ? current.cursor.wave : current.current_wave,
      task: task || (current.cursor ? current.cursor.task : null),
      mode: input.mode ? String(input.mode) : (current.cursor && current.cursor.mode) || mode,
    },
    active_tasks: task ? [task] : Array.isArray(input.active_tasks) ? input.active_tasks.map(String) : current.active_tasks || [],
    pending_checkpoints: pendingCheckpoints,
    metrics: {
      ...(current.metrics || {}),
      transitions: Number((current.metrics || {}).transitions || 0) + 1,
      last_action: action,
    },
  };

  if (action === 'pause') {
    next.status = 'paused';
    next.metrics.pause_count = Number((current.metrics || {}).pause_count || 0) + 1;
  } else if (action === 'resume') {
    next.status = pendingCheckpoints.length ? 'waiting_approval' : 'running';
  } else if (action === 'replay') {
    next.status = 'replaying';
    next.metrics.replay_count = Number((current.metrics || {}).replay_count || 0) + 1;
  } else {
    throw new Error(`Ação de runtime desconhecida: ${action}`);
  }

  const saved = writeRunState(projectRoot, activeSession, next);
  appendEvent(projectRoot, activeSession, {
    type: action === 'pause' ? 'run_paused' : action === 'resume' ? 'run_resumed' : 'run_replay_requested',
    run_id: saved.run_id,
    wave_id: saved.current_wave != null ? `wave-${saved.current_wave}` : null,
    task_id: saved.cursor && saved.cursor.task ? saved.cursor.task : null,
    payload: {
      reason: input.reason || '',
      mode: saved.cursor && saved.cursor.mode ? saved.cursor.mode : null,
      pending_checkpoints: saved.pending_checkpoints || [],
    },
  });
  return saved;
}

/**
 * Reconstrói a timeline de eventos de OXE-EVENTS.ndjson com deltas entre transições.
 * @param {string} projectRoot
 * @param {string|null} activeSession
 * @param {{ fromEventId?: string, runId?: string, waveId?: number, limit?: number, writeReport?: boolean }} [options]
 */
function replayEvents(projectRoot, activeSession, options = {}) {
  let events = readEvents(projectRoot, activeSession);

  if (options.runId) {
    events = events.filter((e) => e.run_id === options.runId);
  }
  if (options.fromEventId) {
    const idx = events.findIndex((e) => e.event_id === options.fromEventId);
    if (idx >= 0) events = events.slice(idx);
  }
  if (options.waveId != null) {
    const waveTag = `wave-${options.waveId}`;
    events = events.filter((e) => e.wave_id === waveTag || String(e.wave_id) === String(options.waveId));
  }
  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  // Ordenar por timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Calcular deltas
  for (let i = 0; i < events.length; i++) {
    if (i === 0) {
      events[i]._delta_ms = 0;
    } else {
      const prev = new Date(events[i - 1].timestamp).getTime();
      const curr = new Date(events[i].timestamp).getTime();
      events[i]._delta_ms = curr - prev;
    }
  }

  const firstTs = events.length ? new Date(events[0].timestamp).getTime() : null;
  const lastTs = events.length ? new Date(events[events.length - 1].timestamp).getTime() : null;
  const duration_ms = firstTs != null && lastTs != null ? lastTs - firstTs : null;

  const waveIds = [...new Set(
    events
      .filter((e) => e.wave_id != null)
      .map((e) => {
        const m = String(e.wave_id).match(/^wave-(\d+)$/);
        return m ? Number(m[1]) : null;
      })
      .filter((n) => n != null)
  )].sort((a, b) => a - b);

  const taskSequence = [...new Set(events.filter((e) => e.task_id || e.work_item_id).map((e) => e.task_id || e.work_item_id))];
  const checkpointSequence = events
    .filter((e) => String(e.type).includes('checkpoint'))
    .map((e) => e.event_id);
  const failureEvents = events.filter((e) =>
    String(e.type).includes('fail') || String(e.type).includes('error')
  );

  const report = {
    events,
    totalEvents: events.length,
    duration_ms,
    runId: options.runId || (events.length ? events[0].run_id : null),
    waveIds,
    taskSequence,
    checkpointSequence,
    failureEvents,
  };

  if (options.writeReport) {
    const p = operationalPaths(projectRoot, activeSession);
    const scopeRoot = path.dirname(p.events);
    const reportPath = path.join(scopeRoot, 'REPLAY-SESSION.md');
    const lines = [
      '# OXE — Replay Session',
      '',
      `- **Data:** ${new Date().toISOString().slice(0, 10)}`,
      `- **Run:** ${report.runId || '—'}`,
      `- **Total eventos:** ${report.totalEvents}`,
      `- **Duração:** ${report.duration_ms != null ? `${(report.duration_ms / 1000).toFixed(1)}s` : '—'}`,
      `- **Ondas:** ${report.waveIds.join(', ') || '—'}`,
      `- **Tarefas:** ${report.taskSequence.join(', ') || '—'}`,
      `- **Falhas:** ${report.failureEvents.length}`,
      '',
      '## Timeline',
      '',
      '| # | Tipo | Wave | Task | Delta | Timestamp |',
      '|---|------|------|------|-------|-----------|',
    ];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const delta = i > 0 ? `+${(e._delta_ms / 1000).toFixed(1)}s` : '—';
      lines.push(`| ${i + 1} | ${e.type} | ${e.wave_id || '—'} | ${e.task_id || e.work_item_id || '—'} | ${delta} | ${e.timestamp} |`);
    }
    ensureDirForFile(reportPath);
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    report._reportPath = reportPath;
  }

  return report;
}

function replayRuntimeState(projectRoot, activeSession, options = {}) {
  const current = options.runState || readRunState(projectRoot, activeSession);
  const runId = options.runId || (current && current.run_id) || null;
  const replay = replayEvents(projectRoot, activeSession, {
    runId: runId || undefined,
    fromEventId: options.fromEventId || undefined,
    waveId: options.waveId != null ? options.waveId : options.wave,
    limit: options.limit,
    writeReport: options.writeReport || false,
  });
  const journalPath = runId ? path.join(projectRoot, '.oxe', 'runs', runId, 'journal.json') : null;
  const journal = journalPath ? readJsonIfExists(journalPath) : null;
  const verificationArtifacts = current ? loadRuntimeVerificationArtifacts(projectRoot, current) : {
    manifest: null,
    residualRisks: null,
    evidenceCoverage: null,
  };
  const consistency = current && journal
    ? buildRecoveryConsistency(projectRoot, activeSession, current, journal, verificationArtifacts)
    : null;
  const gateQueue = readRuntimeGates(projectRoot, activeSession, { runId });
  const policyDecisionsPath = runId ? path.join(projectRoot, '.oxe', 'runs', runId, 'policy-decisions.json') : null;
  const policyDecisions = policyDecisionsPath ? readJsonIfExists(policyDecisionsPath) : null;
  const promotionRecordPath = runId ? path.join(projectRoot, '.oxe', 'runs', runId, 'promotion-record.json') : null;
  const promotionRecord = promotionRecordPath ? readJsonIfExists(promotionRecordPath) : null;
  const summary = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    replay,
    gateQueue,
    policyDecisions: Array.isArray(policyDecisions) ? policyDecisions : [],
    verification: verificationArtifacts,
    promotion: promotionRecord || null,
    consistency,
  };
  if (options.writeReport && runId) {
    const reportPath = path.join(projectRoot, '.oxe', 'runs', runId, 'replay-report.json');
    ensureDirForFile(reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
    summary.report_path = reportPath;
  }
  return summary;
}

module.exports = {
  runtimeDefects,
  projectStatusPaths,
  runtimePlanReopen,
  runtimePhaseWork,
  resolvePreconditions,
  runtimePlanAppend,
  runtimeProgramBudget,
  runtimeProgramAdopt,
  runtimeProgramInitFrom,
  phaseDeliveredOn,
  runtimeDeployAttach,
  runtimeSignal,
  runtimePrintPrompt,
  resolvePromoteBase,
  spawnPromote,
  readNdjsonQuiet,
  coherentStateProjection,
  runtimeSpecAmend,
  runtimeSpecAdd,
  runtimeProgramPhaseAdd,
  runtimeProgramExport,
  runtimeProgramPhaseEdit,
  runtimeChangeSetStatus,
  runtimeProgramCriterionMove,
  oxeHistoryWarning,
  runtimeSync,
  runtimePromote,
  resolveMergedDependencies,
  isolateFailedTask,
  planSourceHash,
  runtimeCiAttach,
  runtimeScorecard,
  runtimePlanDone,
  findTaskCheckpoint,
  taskCommitShas,
  taskPhaseContext,
  retryFailedCheckpoints,
  VALID_RUN_STATUSES,
  VALID_APPROVAL_POLICIES,
  VALID_CAPABILITY_TYPES,
  operationalPaths,
  makeRunId,
  appendEvent,
  readEvents,
  buildNodeContextProvider,
  detectRuntimeAdapters,
  runtimeProgramStatus,
  runtimeRollback,
  commitTaskCheckpoint,
  runtimeFeedback,
  runtimeChanges,
  runtimeDossier,
  runtimeSignoff,
  projectStateMd,
  runtimePlanLint,
  runtimeProgramInit,
  runtimeProgramStart,
  runtimeProgramClose,
  phaseChanges,
  phaseGateInputFromRun,
  readExecutorUsageRows,
  extractPlanTaskBody,
  syncRunStateAfterExecute,
  writeProjectedBlock,
  extractBacktickSpans,
  looksLikeShellCommand,
  looksLikeFilePath,
  summarizeEvents,
  writeRunState,
  readRunState,
  readGitActivity,
  verifyGitEvidence,
  runtimeStateWarnings,
  parseCapabilityManifest,
  readCapabilityCatalog,
  capabilityCatalogWarnings,
  buildMemoryLayers,
  buildOperationalGraph,
  serializeCanonicalState,
  hydrateCanonicalState,
  reduceCanonicalRunState,
  compileExecutionGraphFromArtifacts,
  compileVerificationSuiteFromArtifacts,
  buildRuntimePluginRegistry,
  buildRuntimeModeStatus,
  buildRuntimeProviderCatalog,
  buildRecoveryConsistency,
  readRuntimeGates,
  resolveRuntimeGate,
  createExecutionContext,
  saveRuntimeProviderConfig,
  loadRuntimeProviderConfig,
  buildRuntimeExecutePreflight,
  runRuntimeExecute,
  runRuntimeVerify,
  projectRuntimeArtifacts,
  runRuntimeCiChecks,
  runRuntimePromotion,
  recoverRuntimeState,
  applyRuntimeAction,
  replayEvents,
  replayRuntimeState,
  readRuntimeMultiAgentStatus,
  applySpecChecklistSync,
};
