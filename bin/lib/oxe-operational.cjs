'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VALID_RUN_STATUSES = new Set([
  'planned',
  'running',
  'paused',
  'waiting_approval',
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
    session_id: activeSession || null,
    wave_id: event.wave_id || null,
    task_id: event.task_id || null,
    agent_id: event.agent_id || null,
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

  const taskSequence = [...new Set(events.filter((e) => e.task_id).map((e) => e.task_id))];
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
      lines.push(`| ${i + 1} | ${e.type} | ${e.wave_id || '—'} | ${e.task_id || '—'} | ${delta} | ${e.timestamp} |`);
    }
    ensureDirForFile(reportPath);
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    report._reportPath = reportPath;
  }

  return report;
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
  applyRuntimeAction,
  replayEvents,
};
