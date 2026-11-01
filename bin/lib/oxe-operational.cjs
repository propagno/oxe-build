'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    const files = (Array.isArray(entry.exact_paths) ? entry.exact_paths : [])
      .map((value) => String(value || '').trim())
      .filter((value) => looksLikeFilePath(value) && !value.includes('*') && !value.includes('...'));
    if (files.length > 0) task.filesExist = [...new Set(files)];
    const exportsExpected = packSymbolExports(entry);
    if (exportsExpected.length > 0) task.exportsExpected = exportsExpected;
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
      gitStatus,
      lessons,
    };
  };
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
  const graph = runtime.compile(parsedPlan, parsedSpec, options.compilerOptions || {});
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
    for (const node of nodeList) {
      if (!node || !node.verify) continue;
      const refs = Array.isArray(node.verify.acceptance_refs) ? node.verify.acceptance_refs : [];
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

  const current = options.runState || readRunState(projectRoot, activeSession) || {};
  const runId = current.run_id || makeRunId();
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    run_id: runId,
    status: current.status || 'planned',
    compiled_graph: compiledGraph,
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
  const suite = runtime.compileVerification(parsers.parseSpec(specText), parsedPlan, options.compilerOptions || {});
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
function buildRuntimeExecutePreflight(projectRoot, activeSession, runState) {
    const health = loadProjectHealth();
    const blockers = [];
    const warnings = [];
    let report = null;
    if (health && typeof health.buildHealthReport === 'function') {
      report = health.buildHealthReport(projectRoot);
      if (report.planSelfEvaluation && report.planSelfEvaluation.executable === false) {
        const confidence = report.planSelfEvaluation.confidence;
        const threshold = report.planConfidenceThreshold || 90;
        // The gate also fails on an incomplete self-evaluation (rubric, vector): say which, or "91%<=90%" reads as a bug.
        const evaluationWarnings = Array.isArray(report.planSelfEvaluation.warnings) ? report.planSelfEvaluation.warnings : [];
        const belowThreshold = confidence == null || confidence <= threshold;
        blockers.push(belowThreshold || !evaluationWarnings.length
          ? `plan_confidence:${confidence == null ? 'missing' : `${confidence}%`}<=${threshold}%`
          : `plan_self_evaluation_incomplete:${evaluationWarnings.length} — ${evaluationWarnings.join('; ')}`);
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
    if (queue.pending.length > 0) {
      blockers.push(`pending_gates:${queue.pending.length}`);
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
    const runtime = loadRuntimeModule();
    if (!runtime) throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  const parsers = loadSdkParsers();
  if (!parsers) throw new Error('SDK parsers não disponíveis.');

  // Auto-wire LlmTaskExecutor (via adapter) if providerConfig or adapter is supplied
  let executor = options.executor || null;
  let usageRunId = null;
  if (!executor && (options.providerConfig || options.adapter)) {
    if (typeof runtime.LlmTaskExecutor !== 'function') throw new Error('Runtime não exporta LlmTaskExecutor.');
    executor = createAdapterExecutor(runtime, projectRoot, activeSession, options, () => usageRunId);
  }
  // Auto-wire InplaceWorkspaceManager as default
  let workspaceManager = options.workspaceManager || null;
  if (!workspaceManager) {
    if (typeof runtime.InplaceWorkspaceManager === 'function') {
      workspaceManager = new runtime.InplaceWorkspaceManager(projectRoot);
    }
  }

  // Resolve compiled graph from run state or compile on demand
  let current = options.runState || readRunState(projectRoot, activeSession);
    // A run de uma fase já fechada nunca é reaproveitada: a fase nova compila o seu próprio PLAN.
    // `{}` (não null) força run nova: null faria o compile reler a run antiga do disco.
    if (current && isClosedPhaseRun(projectRoot, activeSession, current.run_id)) current = {};
    if (!current || !current.compiled_graph) {
      current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current }).run;
    }
    if (!current || !current.compiled_graph) {
      throw new Error('Nenhum grafo compilado encontrado. Execute oxe-cc runtime compile primeiro.');
    }
    usageRunId = current.run_id;
    touchProgramPhase(projectRoot, activeSession, 'executing', { run_id: current.run_id });
    const checkpointCommits = Boolean(options.checkpointCommits || readProjectConfig(projectRoot).checkpoint_commits);
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
  const ctx = createExecutionContext(projectRoot, activeSession, {
    runId: current.run_id,
    executor,
    workspaceManager,
    pluginRegistry: options.pluginRegistry || buildRuntimePluginRegistry(projectRoot),
    schedulerOptions: options.schedulerOptions || {},
    // The scheduler already persists every event through the runtime bus (events/bus.ts →
    // appendEvent). This hook only forwards progress; writing here again duplicated the log.
    onEvent: (event) => {
      options.onProgress?.(event);
      // 1.20c: checkpoint de filesystem por tarefa concluída (opt-in).
      if (checkpointCommits && event && event.type === 'WorkItemCompleted' && event.work_item_id) {
        try {
          const cp = commitTaskCheckpoint(projectRoot, current, event.work_item_id);
          if (cp.committed) appendEvent(projectRoot, activeSession, { type: 'GateResolved', run_id: current.run_id, work_item_id: event.work_item_id, payload: { gate: 'checkpoint', commit: cp.commit, files: cp.files } });
        } catch { /* checkpoint nunca derruba a execução */ }
      }
    },
  });

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
  const result = await scheduler.run(graph, ctx);
  const syncedRun = syncRunStateAfterExecute(projectRoot, activeSession, current, result, 'single');
    return { mode: 'single', agentPlan: null, result, run: syncedRun, preflight };
  }

const EXECUTE_RESULT_STATUS = {
  completed: 'completed',
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

async function runRuntimeVerify(projectRoot, activeSession, options = {}) {
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
  const parsedSpec = parsers.parseSpec(specText);
  const parsedPlan = attachAcceptanceLock(
    attachImplementationPackContracts(parsePlanArtifact(parsers, planText, artifactPaths.plan), artifactPaths.implementationPack),
    current,
    projectRoot,
  );
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
  const runSuite = regressionChecks.length
    ? { ...suite, checks: [...(suite.checks || []).filter((check) => !check.regression_phase), ...regressionChecks] }
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
    timeoutMs: options.timeoutMs,
  });
  // A passing re-verify of a fully executed run restores `completed` (a previous failed verify
  // must not leave it stuck in `running`).
  const graphNodes = current.compiled_graph && current.compiled_graph.nodes
    ? Object.keys(current.compiled_graph.nodes).length
    : 0;
  const doneNodes = current.canonical_state && Array.isArray(current.canonical_state.completedWorkItems)
    ? current.canonical_state.completedWorkItems.length
    : 0;
  const executionDone = current.status === 'completed' || (graphNodes > 0 && doneNodes >= graphNodes);
  const nextStatus = report.status === 'passed'
    ? executionDone ? 'completed' : 'running'
    : report.status === 'failed'
      ? 'failed'
      : 'blocked';
  const regressionSummary = summarizeRegression(regressionChecks, report.check_results);
  // 1.20b: um CR aberto fecha só com evidência — o teste congelado que o declara em `resolves` ficou verde.
  try {
    const changeLib = require('./oxe-change.cjs');
    if (artifactPaths.programDir) {
      const reconciled = changeLib.reconcileChanges(artifactPaths.programDir, programPhaseId, parsedPlan, report.check_results);
      for (const id of reconciled.resolved) appendEvent(projectRoot, activeSession, { type: 'ChangeResolved', run_id: current.run_id, payload: { id } });
    }
  } catch { /* reconciliação é auxiliar ao verify */ }
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
    verification_regression: regressionSummary,
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
    },
  });
  const projected = projectRuntimeArtifacts(projectRoot, activeSession, { runState: next, write: true });
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  return {
    run: projected.run,
    report,
    regression: regressionSummary,
    projected,
  };
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
  const byCriterion = new Map(lock.tests.map((entry) => [entry.criterion, entry]));
  parsedPlan.acceptanceTests = parsedPlan.acceptanceTests.map((entry) => {
    const locked = byCriterion.get(entry.criterion);
    const hashes = new Map(locked ? locked.files.map((f) => [f.path, f.sha256]) : []);
    return {
      criterion: entry.criterion,
      command: entry.command,
      files: entry.files.map((file) => ({ path: file, sha256: hashes.has(file) ? hashes.get(file) : null })),
      proves: Array.isArray(entry.proves) ? entry.proves : [],
    };
  });
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
  return require('./oxe-plan-json.cjs').readPlanArtifact(planPath, planText, parsers.parsePlan);
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
  const result = planJson.lintPlan({
    plan, spec, pack, phase, maxTasksPerWave, projectRoot,
    requiredVersions: paths.programDir ? require('./oxe-change.cjs').requiredVersions(paths.programDir) : new Map(),
    requireAcceptanceTests: Boolean(options.requireAcceptanceTests || config.acceptance_tests_required),
  });
  if (spec) result.warnings.push(...lintPlanForCommonPitfalls(plan, spec, projectRoot, specText));
  let dryVerify = null;
  if (options.dryVerify) {
    // OXB-009: cada verify deve estar vermelho pelo motivo certo (alvo ausente), não por comando quebrado.
    dryVerify = require('./oxe-verify-dryrun.cjs').dryRunVerifyCommands(projectRoot, plan, { timeoutMs: options.dryVerifyTimeoutMs });
    result.errors.push(...dryVerify.errors);
    result.warnings.push(...dryVerify.warnings);
    result.ok = result.errors.length === 0;
  }
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
    for (const line of gitLines(projectRoot, ['diff', '--name-status', base, 'HEAD']) || []) {
      const [status, ...rest] = line.split('\t');
      changes.set(rest[rest.length - 1], status.charAt(0));
    }
  }
  for (const line of gitLines(projectRoot, ['status', '--porcelain', '-uall']) || []) {
    const status = line.slice(0, 2).trim() || 'M';
    const file = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
    if (!changes.has(file)) changes.set(file, status === '??' ? 'A' : status.charAt(0));
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
    hashFile: (rel) => { const rt = loadRuntimeModule(); return rt && typeof rt.sha256File === 'function' ? rt.sha256File(path.resolve(projectRoot, rel)) : null; },
    decisions: readNdjsonQuiet(path.join(programDir, 'decisions.ndjson')),
    notes: readNdjsonQuiet(path.join(programDir, 'notes.ndjson')).filter((n) => !phaseId || !n.phase || n.phase === phaseId),
    signoffs: readNdjsonQuiet(path.join(programDir, 'signoffs.ndjson')).filter((s) => !phaseId || s.phase === phaseId),
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
    .map((c) => c.trim()).filter((c) => /^A\d+$/.test(c));
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
    phase: options.phase, amendTo: options.amendTo, evidence: options.evidence,
  });
  if (result.reopened && result.program) programLib.writeProgram(programDir, result.program);
  appendEvent(projectRoot, activeSession, {
    type: 'ChangeRequested',
    payload: { id: result.cr.id, class: result.cr.class, phase: result.cr.phase, criteria: result.cr.criteria, reopened: result.reopened, impacted: result.impacted },
  });
  try { projectStateMd(projectRoot, activeSession); } catch { /* projeção auxiliar */ }
  return result;
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
function commitTaskCheckpoint(projectRoot, runState, taskId) {
  const files = taskScopeFiles(runState, taskId);
  if (!files.length) return { committed: false, reason: 'tarefa sem escopo declarado' };
  if (!gitLines(projectRoot, ['rev-parse', '--is-inside-work-tree'])) return { committed: false, reason: 'sem repositório git' };
  const changed = (gitLines(projectRoot, ['status', '--porcelain', '-uall', '--', ...files]) || []);
  if (!changed.length) return { committed: false, reason: 'nada mudou no escopo da tarefa' };
  const node = runState.compiled_graph.nodes[taskId] || {};
  const title = String(node.title || taskId).slice(0, 72);
  const add = spawnSync('git', ['add', '--', ...files.filter((f) => fs.existsSync(path.join(projectRoot, f)) || changed.some((l) => l.includes(f)))], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (add.status !== 0) return { committed: false, reason: `git add falhou: ${String(add.stderr).trim()}` };
  const commit = spawnSync('git', ['commit', '-q', '-m', `oxe(${taskId}): ${title}`, '--', ...files], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (commit.status !== 0) return { committed: false, reason: `git commit falhou: ${String(commit.stderr || commit.stdout).trim()}` };
  const head = gitLines(projectRoot, ['rev-parse', 'HEAD']);
  return { committed: true, commit: head && head[0], files };
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
  return { exists: true, state, progress: runtime.programProgress(state), paths: where };
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
  return runtimeProgramStatus(projectRoot, activeSession);
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
    writeProjectedBlock(paths.state, projections.state, 'Runtime (projetado)');
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
    // 1.19: hash dos testes de aceite do plano congelado no compile; resumo da regressão de fases.
    acceptance_lock: runState.acceptance_lock && typeof runState.acceptance_lock === 'object' ? runState.acceptance_lock : null,
    verification_regression: runState.verification_regression && typeof runState.verification_regression === 'object' ? runState.verification_regression : null,
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
