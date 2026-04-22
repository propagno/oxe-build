#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const release = require('../bin/lib/oxe-release.cjs');

const PACKAGE_ROOT = process.env.OXE_RELEASE_PACKAGE_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PACKAGE_ROOT)
  : path.join(__dirname, '..');
const PROJECT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT)
  : PACKAGE_ROOT;
const runtime = require(path.join(PACKAGE_ROOT, 'lib', 'runtime', 'index.js'));

function makeLease(id, isolationLevel = 'isolated') {
  return {
    workspace_id: id,
    strategy: isolationLevel === 'isolated' ? 'git_worktree' : 'inplace',
    isolation_level: isolationLevel,
    branch: null,
    base_commit: null,
    root_path: '/tmp',
    ttl_minutes: 30,
  };
}

function makeWorkspaceManager(id, isolationLevel = 'isolated') {
  return {
    isolation_level: isolationLevel,
    allocate: async (req) => makeLease(`ws-${id}-${req.work_item_id}`, isolationLevel),
    snapshot: async (workspaceId) => ({ snapshot_id: `snap-${workspaceId}`, workspace_id: workspaceId, commit: 'abc', created_at: new Date().toISOString() }),
    reset: async () => {},
    dispose: async () => {},
  };
}

function makeExecutor(mode) {
  return {
    execute: async () => ({
      success: true,
      failure_class: null,
      evidence: [{ type: 'log', path: `${mode}.txt` }],
      output: `${mode}-ok`,
    }),
  };
}

function makeSlowExecutor(mode, delayMs) {
  return {
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        success: true,
        failure_class: null,
        evidence: [{ type: 'log', path: `${mode}-slow.txt` }],
        output: `${mode}-slow-ok`,
      };
    },
  };
}

function makeGraph(nodeIds, workspaceStrategy = 'git_worktree') {
  const nodes = new Map();
  for (const id of nodeIds) {
    nodes.set(id, {
      id,
      title: `Task ${id}`,
      wave: 0,
      depends_on: [],
      workspace_strategy: workspaceStrategy,
      mutation_scope: [id],
      actions: [],
      verify: { must_pass: [], acceptance_refs: [], command: null },
      policy: { max_retries: 1, requires_human_approval: false },
    });
  }
  return {
    nodes,
    edges: [],
    waves: [{ wave_number: 0, node_ids: nodeIds }],
    metadata: {
      compiled_at: new Date().toISOString(),
      plan_hash: 'soak-plan',
      spec_hash: 'soak-spec',
      node_count: nodeIds.length,
      wave_count: 1,
    },
  };
}

function makeAgent(id, mode, assignedTaskIds) {
  return {
    id,
    executor: makeExecutor(mode),
    workspaceManager: makeWorkspaceManager(id, 'isolated'),
    assignedTaskIds,
  };
}

function makeSlowAgent(id, mode, assignedTaskIds, delayMs) {
  return {
    id,
    executor: makeSlowExecutor(mode, delayMs),
    workspaceManager: makeWorkspaceManager(id, 'isolated'),
    assignedTaskIds,
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function runScenario(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-masoak-${mode}-`));
  fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
  const coordinator = new runtime.MultiAgentCoordinator();
  const graph = makeGraph(['T1', 'T2', 'T3', 'T4']);
  const runId = `soak-${mode}-${Date.now()}`;
  const agents = mode === 'parallel'
    ? [makeAgent('agent-a', mode, ['T1', 'T2']), makeAgent('agent-b', mode, ['T3', 'T4'])]
    : [makeAgent('agent-a', mode), makeAgent('agent-b', mode)];
  const result = await coordinator.run(graph, {
    mode,
    agents,
    projectRoot: root,
    sessionId: null,
    runId,
  });
  const runDir = path.join(root, '.oxe', 'runs', runId);
  const state = loadJson(path.join(runDir, 'multi-agent-state.json'));
  const summary = loadJson(path.join(runDir, 'multi-agent-summary.json'));
  const handoffs = fs.existsSync(path.join(runDir, 'handoffs.json'))
    ? loadJson(path.join(runDir, 'handoffs.json'))
    : [];
  const arbitration = fs.existsSync(path.join(runDir, 'arbitration-results.json'))
    ? loadJson(path.join(runDir, 'arbitration-results.json'))
    : [];
  const observations = [];
  if (!summary.workspace_isolation_enforced) observations.push('summary sem isolamento enforced');
  if (mode === 'parallel' && state.ownership.length !== 4) observations.push('parallel sem ownership completo');
  if (mode === 'cooperative' && handoffs.length !== 4) observations.push('cooperative sem handoffs completos');
  if (mode === 'competitive' && arbitration.length !== 4) observations.push('competitive sem arbitragem por tarefa');
  return {
    scenario: mode,
    ok: observations.length === 0,
    completed: result.completed.length,
    failed: result.failed.length,
    blocked: result.blocked.length,
    summary,
    observations,
  };
}

async function runTimeoutFailoverScenario() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-masoak-timeout-'));
  fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
  const coordinator = new runtime.MultiAgentCoordinator();
  const graph = makeGraph(['T1', 'T2']);
  const runId = `soak-timeout-${Date.now()}`;
  const result = await coordinator.run(graph, {
    mode: 'parallel',
    agents: [
      makeSlowAgent('agent-timeout', 'parallel-timeout', ['T1'], 150),
      makeAgent('agent-fast', 'parallel-fast', ['T2']),
    ],
    heartbeatTimeoutMs: 25,
    projectRoot: root,
    sessionId: null,
    runId,
  });
  const runDir = path.join(root, '.oxe', 'runs', runId);
  const state = loadJson(path.join(runDir, 'multi-agent-state.json'));
  const summary = loadJson(path.join(runDir, 'multi-agent-summary.json'));
  const observations = [];
  if ((summary.timeout_count || 0) < 1) observations.push('timeout_count não refletiu agente expirado');
  if ((summary.orphan_reassignment_count || 0) < 1) observations.push('orphan_reassignment_count não refletiu failover');
  if (!Array.isArray(state.orphan_reassignments) || state.orphan_reassignments.length < 1) observations.push('state sem orphan_reassignments');
  if (!result.completed.includes('T1')) observations.push('failover não concluiu T1');
  return {
    scenario: 'parallel_timeout_failover',
    ok: observations.length === 0,
    completed: result.completed.length,
    failed: result.failed.length,
    blocked: result.blocked.length,
    summary,
    observations,
  };
}

async function main() {
  const results = [];
  for (const mode of ['parallel', 'competitive', 'cooperative']) {
    results.push(await runScenario(mode));
  }
  results.push(await runTimeoutFailoverScenario());
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      pass: results.filter((item) => item.ok).length,
      fail: results.filter((item) => !item.ok).length,
    },
  };
  const reportPath = release.releasePaths(PROJECT_ROOT).multiAgentSoakReport;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  if (output.summary.fail > 0) {
    console.error(`run-multi-agent-soak: ${output.summary.fail} cenário(s) com falha`);
    process.exit(1);
  }
  console.log(`run-multi-agent-soak: OK (${output.summary.pass}/${output.summary.total})`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
