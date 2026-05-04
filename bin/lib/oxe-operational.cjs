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
  return {
    projectRoot,
    sessionId: activeSession || null,
    runId,
    executor: options.executor || null,
    workspaceManager: options.workspaceManager || null,
    gateManager,
    policyEngine: options.policyEngine || null,
    policyActor: options.policyActor || 'runtime',
    quota: options.quota || null,
    pluginRegistry: options.pluginRegistry || null,
    auditTrail: options.auditTrail || null,
    evidenceStore: options.evidenceStore || null,
    onEvent: options.onEvent || null,
    options: options.schedulerOptions || {},
  };
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
      };
    }
    const sessionRoot = path.join(oxeDir, ...String(activeSession).split('/'));
    return {
      state: path.join(oxeDir, 'STATE.md'),
      spec: preferExistingPath(path.join(sessionRoot, 'spec', 'SPEC.md'), path.join(oxeDir, 'SPEC.md')),
      plan: preferExistingPath(path.join(sessionRoot, 'plan', 'PLAN.md'), path.join(oxeDir, 'PLAN.md')),
      verify: preferExistingPath(path.join(sessionRoot, 'verification', 'VERIFY.md'), path.join(oxeDir, 'VERIFY.md')),
    };
  }
  const base = health.oxePaths(projectRoot);
  const scoped = health.scopedOxePaths(projectRoot, activeSession || null);
  return {
    state: base.state,
    spec: preferExistingPath(scoped.spec, base.spec),
    plan: preferExistingPath(scoped.plan, base.plan),
    verify: preferExistingPath(scoped.verify, base.verify),
  };
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
    EvidenceCollected: 'EvidenceCollected',
    PolicyEvaluated: 'PolicyEvaluated',
    GateRequested: 'GateRequested',
    GateResolved: 'GateResolved',
    VerificationStarted: 'VerificationStarted',
    VerificationCompleted: 'VerificationCompleted',
    RetryScheduled: 'RetryScheduled',
    WorkItemCompleted: 'WorkItemCompleted',
    WorkItemBlocked: 'WorkItemBlocked',
    RunCompleted: 'RunCompleted',
    RetroPublished: 'RetroPublished',
    LessonPromoted: 'LessonPromoted',
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
    id: String(event.event_id || ''),
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

function reduceCanonicalRunStateLive(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime || typeof runtime.reduce !== 'function') return null;
  const currentRun = options.runState || readRunState(projectRoot, activeSession) || null;
  const runId = options.runId || (currentRun && currentRun.run_id) || null;
  let events = readEvents(projectRoot, activeSession);
  if (runId) events = events.filter((event) => !event.run_id || event.run_id === runId);
  const reduced = runtime.reduce(events.map((event) => toRuntimeEventEnvelope(event, activeSession)));
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
  const parsedPlan = parsers.parsePlan(planText);
  const graph = runtime.compile(parsedPlan, parsedSpec, options.compilerOptions || {});
  const validationErrors = typeof runtime.validateGraph === 'function' ? runtime.validateGraph(graph) : [];

  // Static-analysis lints: detect common patterns that cause runtime failures
  const lintHints = lintPlanForCommonPitfalls(parsedPlan, parsedSpec, projectRoot, specText);
  if (lintHints.length) validationErrors.push(...lintHints);

  const compiledGraph = runtime.toSerializable(graph);
  const current = options.runState || readRunState(projectRoot, activeSession) || {};
  const runId = current.run_id || makeRunId();
  const next = writeRunState(projectRoot, activeSession, {
    ...current,
    run_id: runId,
    status: current.status || 'planned',
    compiled_graph: compiledGraph,
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
  const suite = runtime.compileVerification(parsers.parseSpec(specText), parsers.parsePlan(planText), options.compilerOptions || {});
  const current = options.runState || readRunState(projectRoot, activeSession) || {};
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
async function runRuntimeExecute(projectRoot, activeSession, options = {}) {
  const runtime = loadRuntimeModule();
  if (!runtime) throw new Error('Runtime package não está disponível. Rode npm run build:runtime.');
  const parsers = loadSdkParsers();
  if (!parsers) throw new Error('SDK parsers não disponíveis.');

  // Auto-wire LlmTaskExecutor if providerConfig is supplied
  let executor = options.executor || null;
  if (!executor && options.providerConfig) {
    if (typeof runtime.LlmTaskExecutor !== 'function') throw new Error('Runtime não exporta LlmTaskExecutor.');
    executor = new runtime.LlmTaskExecutor(options.providerConfig, null, options.onProgress || null);
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
  if (!current || !current.compiled_graph) {
    current = compileExecutionGraphFromArtifacts(projectRoot, activeSession, { runState: current }).run;
  }
  if (!current || !current.compiled_graph) {
    throw new Error('Nenhum grafo compilado encontrado. Execute oxe-cc runtime compile primeiro.');
  }
  const graph = runtime.fromSerializable
    ? runtime.fromSerializable(current.compiled_graph)
    : current.compiled_graph;

  // Detect plan-agents.json (session path takes priority over root)
  const rootAgentPlan = path.join(projectRoot, '.oxe', 'plan-agents.json');
  const sessAgentPlan = activeSession
    ? path.join(projectRoot, '.oxe', activeSession, 'plan', 'plan-agents.json')
    : null;
  const agentPlanPath = (sessAgentPlan && fs.existsSync(sessAgentPlan))
    ? sessAgentPlan
    : (fs.existsSync(rootAgentPlan) ? rootAgentPlan : null);

  // Build ctx with GateManager (Gap 1)
  const ctx = createExecutionContext(projectRoot, activeSession, {
    runId: current.run_id,
    executor,
    workspaceManager,
    pluginRegistry: options.pluginRegistry || buildRuntimePluginRegistry(projectRoot),
    schedulerOptions: options.schedulerOptions || {},
    onEvent: (event) => {
      appendEvent(projectRoot, activeSession, event);
      options.onProgress?.(event);
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
    if (!Array.isArray(agentPlan.agents) || agentPlan.agents.length === 0) {
      throw new Error('plan-agents.json não contém agentes válidos (campo "agents" vazio ou ausente).');
    }
    if (typeof runtime.MultiAgentCoordinator !== 'function') {
      throw new Error('Runtime não exporta MultiAgentCoordinator. Verifique a versão do runtime.');
    }
    const agents = agentPlan.agents.map((spec) => ({
      id: spec.id,
      executor: options.executorFactory ? options.executorFactory(spec) : (options.executor || null),
      workspaceManager: options.workspaceManager || null,
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
      onEvent: ctx.onEvent,
    });
    return { mode: agentPlan.mode || 'parallel', agentPlan, result, run: current };
  }

  // Single-agent fallback
  if (typeof runtime.Scheduler !== 'function') {
    throw new Error('Runtime não exporta Scheduler. Verifique a versão do runtime.');
  }
  const scheduler = new runtime.Scheduler();
  const result = await scheduler.run(graph, ctx);
  return { mode: 'single', agentPlan: null, result, run: current };
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
      summary: null,
    };
  }
  const runDir = path.join(projectRoot, '.oxe', 'runs', runId);
  const statePath = path.join(runDir, 'multi-agent-state.json');
  const summaryPath = path.join(runDir, 'multi-agent-summary.json');
  const handoffsPath = path.join(runDir, 'handoffs.json');
  const arbitrationPath = path.join(runDir, 'arbitration-results.json');
  const state = runtime && typeof runtime.loadMultiAgentState === 'function'
    ? runtime.loadMultiAgentState(projectRoot, runId)
    : readJsonIfExists(statePath);
  const summary = runtime && typeof runtime.loadMultiAgentSummary === 'function'
    ? runtime.loadMultiAgentSummary(projectRoot, runId)
    : readJsonIfExists(summaryPath);
  const handoffs = readJsonIfExists(handoffsPath);
  const arbitrationResults = readJsonIfExists(arbitrationPath);
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
    summary: summary || null,
  };
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
  const parsedPlan = parsers.parsePlan(planText);
  const suite = current.verification_suite
    || runtime.compileVerification(parsedSpec, parsedPlan, options.compilerOptions || {});
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
      total_checks: Array.isArray(suite.checks) ? suite.checks.length : 0,
    },
  });
  const report = await runtime.verifyRun({
    projectRoot,
    runId: current.run_id,
    workItemId: String(targetWorkItem),
    cwd: options.cwd || projectRoot,
    suite,
    pluginRegistry: registry || undefined,
    evidenceStore,
    attemptNumber: options.attemptNumber || 1,
    timeoutMs: options.timeoutMs,
  });
  const nextStatus = report.status === 'passed'
    ? current.status === 'completed' ? 'completed' : 'running'
    : report.status === 'failed'
      ? 'failed'
      : 'blocked';
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
    },
  });
  const projected = projectRuntimeArtifacts(projectRoot, activeSession, { runState: next, write: true });
  return {
    run: projected.run,
    report,
    projected,
  };
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
  const canonicalLive = current.canonical_state
    ? mergeCanonicalStateWithRunState(current.canonical_state, current, activeSession, current.compiled_graph)
    : reduceCanonicalRunStateLive(projectRoot, activeSession, { runState: current });
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
    runSummary: projector.projectRunSummary(canonicalLive),
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
    fs.writeFileSync(paths.verify, projections.verify + '\n', 'utf8');
    fs.writeFileSync(paths.state, projections.state + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'RUN-SUMMARY.md'), projections.runSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'COMMIT-SUMMARY.md'), projections.commitSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'PROMOTION-SUMMARY.md'), projections.promotionSummary + '\n', 'utf8');
    fs.writeFileSync(path.join(op.executionRoot, 'PR-SUMMARY.md'), projections.prSummary + '\n', 'utf8');
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
  const journal = runtime.loadJournal(projectRoot, current.run_id);
  if (!journal) {
    throw new Error(`Journal ausente para run ${current.run_id}.`);
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
  const nextStatus = journal.scheduler_state === 'paused'
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

function appendEvent(projectRoot, activeSession, event = {}) {
  const p = operationalPaths(projectRoot, activeSession);
  ensureDirForFile(p.events);
  const entry = {
    event_id: event.event_id || `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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
};
