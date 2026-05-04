#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const release = require('../bin/lib/oxe-release.cjs');

const PACKAGE_ROOT = process.env.OXE_RELEASE_PACKAGE_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PACKAGE_ROOT)
  : path.join(__dirname, '..');
const PROJECT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT)
  : PACKAGE_ROOT;
const runtime = require(path.join(PACKAGE_ROOT, 'lib', 'runtime', 'index.js'));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout.trim();
}

function makeRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-mareal-${name}-`));
  fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
  git(root, ['init']);
  git(root, ['config', 'user.email', 'oxe@example.local']);
  git(root, ['config', 'user.name', 'OXE Test']);
  fs.writeFileSync(path.join(root, 'README.md'), `# ${name}\n`, 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function makeNode(id, mutationScope, wave = 0) {
  return {
    id,
    title: `Task ${id}`,
    wave,
    depends_on: [],
    workspace_strategy: 'git_worktree',
    mutation_scope: mutationScope,
    actions: [],
    verify: { must_pass: [], acceptance_refs: [], command: null },
    policy: { max_retries: 1, requires_human_approval: false },
  };
}

function makeGraph(nodes) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const byWave = new Map();
  for (const node of nodes) {
    if (!byWave.has(node.wave)) byWave.set(node.wave, []);
    byWave.get(node.wave).push(node.id);
  }
  return {
    nodes: map,
    edges: [],
    waves: [...byWave.entries()].map(([wave_number, node_ids]) => ({ wave_number, node_ids })),
    metadata: {
      compiled_at: new Date().toISOString(),
      plan_hash: 'multi-agent-real-plan',
      spec_hash: 'multi-agent-real-spec',
      node_count: nodes.length,
      wave_count: byWave.size,
    },
  };
}

function makeExecutor(agentId, options = {}) {
  return {
    execute: async (node, lease) => {
      if (options.fail) {
        return { success: false, failure_class: 'verify', evidence: [], output: `${agentId}-failed` };
      }
      for (const relativePath of node.mutation_scope || []) {
        const target = path.join(lease.root_path, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${agentId}:${node.id}\n`, 'utf8');
      }
      return {
        success: true,
        failure_class: null,
        evidence: [`evidence/${agentId}-${node.id}.txt`],
        output: `${agentId}-${node.id}-ok`,
      };
    },
  };
}

function agent(root, id, tasks, options = {}) {
  return {
    id,
    executor: makeExecutor(id, options),
    workspaceManager: new runtime.GitWorktreeManager(root),
    assignedTaskIds: tasks,
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function runParallelSuccess() {
  const root = makeRepo('parallel-success');
  const runId = `ma-real-parallel-${Date.now()}`;
  const graph = makeGraph([
    makeNode('T1', ['src/a.txt']),
    makeNode('T2', ['src/b.txt']),
  ]);
  const result = await new runtime.MultiAgentCoordinator().run(graph, {
    mode: 'parallel',
    projectRoot: root,
    sessionId: null,
    runId,
    applyWorkspaceMerges: true,
    agents: [agent(root, 'agent-a', ['T1']), agent(root, 'agent-b', ['T2'])],
  });
  const report = loadJson(path.join(root, '.oxe', 'runs', runId, 'workspace-merge-report.json'));
  const observations = [];
  if (result.completed.length !== 2) observations.push('parallel não concluiu as duas tarefas');
  if (report.merge_readiness !== 'ready') observations.push(`merge readiness inesperado: ${report.merge_readiness}`);
  if (!fs.existsSync(path.join(root, 'src', 'a.txt')) || !fs.existsSync(path.join(root, 'src', 'b.txt'))) observations.push('diffs não foram aplicados ao workspace principal');
  return { scenario: 'parallel_git_worktree_success', ok: observations.length === 0, observations, report };
}

async function runParallelConflict() {
  const root = makeRepo('parallel-conflict');
  const runId = `ma-real-conflict-${Date.now()}`;
  const graph = makeGraph([
    makeNode('T1', ['src/shared.txt']),
    makeNode('T2', ['src/shared.txt']),
  ]);
  const result = await new runtime.MultiAgentCoordinator().run(graph, {
    mode: 'parallel',
    projectRoot: root,
    sessionId: null,
    runId,
    applyWorkspaceMerges: true,
    agents: [agent(root, 'agent-a', ['T1']), agent(root, 'agent-b', ['T2'])],
  });
  const report = loadJson(path.join(root, '.oxe', 'runs', runId, 'workspace-merge-report.json'));
  const observations = [];
  if (result.blocked.length === 0) observations.push('overlap de mutation_scope não bloqueou');
  if (report.merge_readiness !== 'blocked') observations.push('merge report não ficou blocked');
  return { scenario: 'parallel_mutation_conflict_blocked', ok: observations.length === 0, observations, report };
}

async function runCompetitiveWinner() {
  const root = makeRepo('competitive');
  const runId = `ma-real-competitive-${Date.now()}`;
  const graph = makeGraph([makeNode('T1', ['src/winner.txt'])]);
  const result = await new runtime.MultiAgentCoordinator().run(graph, {
    mode: 'competitive',
    projectRoot: root,
    sessionId: null,
    runId,
    applyWorkspaceMerges: true,
    agents: [agent(root, 'agent-a', ['T1'], { fail: true }), agent(root, 'agent-b', ['T1'])],
  });
  const arbitration = loadJson(path.join(root, '.oxe', 'runs', runId, 'arbitration-results.json'));
  const observations = [];
  if (!result.completed.includes('T1')) observations.push('competitive não concluiu T1');
  if (!arbitration[0] || arbitration[0].winner_agent_id !== 'agent-b') observations.push('arbitragem não escolheu o candidato com verify/evidence');
  if (!fs.readFileSync(path.join(root, 'src', 'winner.txt'), 'utf8').includes('agent-b')) observations.push('diff vencedor não foi aplicado');
  return { scenario: 'competitive_winner_by_verify_evidence', ok: observations.length === 0, observations, arbitration };
}

async function runCooperativeHandoff() {
  const root = makeRepo('cooperative');
  const runId = `ma-real-cooperative-${Date.now()}`;
  const graph = makeGraph([makeNode('T1', ['src/cooperative.txt'])]);
  const result = await new runtime.MultiAgentCoordinator().run(graph, {
    mode: 'cooperative',
    projectRoot: root,
    sessionId: null,
    runId,
    applyWorkspaceMerges: true,
    agents: [agent(root, 'planner', ['T1']), agent(root, 'executor', ['T1'])],
  });
  const handoffs = loadJson(path.join(root, '.oxe', 'runs', runId, 'handoffs.json'));
  const observations = [];
  if (!result.completed.includes('T1')) observations.push('cooperative não concluiu T1');
  if (!handoffs[0] || handoffs[0].from_agent_id !== 'planner' || handoffs[0].to_agent_id !== 'executor') observations.push('handoff cooperativo não foi persistido');
  return { scenario: 'cooperative_handoff_persisted', ok: observations.length === 0, observations, handoffs };
}

async function runInplaceRejected() {
  const root = makeRepo('inplace-rejected');
  const graph = makeGraph([makeNode('T1', ['src/a.txt'])]);
  const sharedWorkspace = {
    isolation_level: 'shared',
    allocate: async () => ({ workspace_id: 'shared', strategy: 'inplace', isolation_level: 'shared', root_path: root, ttl_minutes: 0 }),
    snapshot: async () => ({ snapshot_id: 'snap', workspace_id: 'shared', commit: 'HEAD', created_at: new Date().toISOString() }),
    reset: async () => {},
    dispose: async () => {},
  };
  let rejected = false;
  try {
    await new runtime.MultiAgentCoordinator().run(graph, {
      mode: 'parallel',
      projectRoot: root,
      sessionId: null,
      runId: `ma-real-inplace-${Date.now()}`,
      agents: [
        { id: 'agent-a', executor: makeExecutor('agent-a'), workspaceManager: sharedWorkspace, assignedTaskIds: ['T1'] },
        agent(root, 'agent-b', []),
      ],
    });
  } catch (error) {
    rejected = /isolated workspaces/i.test(String(error && error.message ? error.message : error));
  }
  return { scenario: 'inplace_rejected', ok: rejected, observations: rejected ? [] : ['inplace/shared não foi rejeitado'] };
}

async function main() {
  const results = [];
  for (const run of [runParallelSuccess, runParallelConflict, runCompetitiveWinner, runCooperativeHandoff, runInplaceRejected]) {
    results.push(await run());
  }
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
  const reportPath = release.releasePaths(PROJECT_ROOT).multiAgentRealReport;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  if (output.summary.fail > 0) {
    console.error(`run-multi-agent-real: ${output.summary.fail} cenário(s) com falha`);
    process.exit(1);
  }
  console.log(`run-multi-agent-real: OK (${output.summary.pass}/${output.summary.total})`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
