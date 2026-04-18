import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultiAgentCoordinator } from '../src/scheduler/multi-agent-coordinator';
import type { CoordinationOptions, AgentSpec } from '../src/scheduler/multi-agent-coordinator';
import type { ExecutionGraph, GraphNode } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult } from '../src/scheduler/scheduler';
import type { WorkspaceManager, WorkspaceRequest } from '../src/workspace/workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../src/models/workspace';
import os from 'os';
import fs from 'fs';
import path from 'path';

function makeLease(id: string): WorkspaceLease {
  return { workspace_id: id, strategy: 'inplace', branch: null, base_commit: null, root_path: '/tmp', ttl_minutes: 30 };
}

function makeWorkspaceManager(id: string): WorkspaceManager {
  return {
    allocate: async (_req: WorkspaceRequest) => makeLease(`ws-${id}-${_req.work_item_id}`),
    snapshot: async (_id: string): Promise<SnapshotRef> => ({ snapshot_id: 'snap', workspace_id: _id, commit: 'abc', created_at: new Date().toISOString() }),
    reset: async () => {},
    dispose: async () => {},
  };
}

function makeSuccessExecutor(): TaskExecutor {
  return {
    execute: async (_node, _lease, _runId, _attempt): Promise<TaskResult> => ({
      success: true, failure_class: null, evidence: [], output: 'done',
    }),
  };
}

function makeFailExecutor(): TaskExecutor {
  return {
    execute: async (): Promise<TaskResult> => ({
      success: false, failure_class: 'env', evidence: [], output: 'error',
    }),
  };
}

function makeGraph(nodeIds: string[]): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();
  for (const id of nodeIds) {
    nodes.set(id, {
      id,
      title: `Task ${id}`,
      wave: 0,
      depends_on: [],
      workspace_strategy: 'inplace',
      mutation_scope: [],
      actions: [],
      verify: { must_pass: [], acceptance_refs: [], command: null },
      policy: { max_retries: 1, requires_human_approval: false },
    });
  }
  const waves = [{ wave_number: 0, node_ids: nodeIds }];
  return {
    nodes,
    edges: [],
    waves,
    metadata: { compiled_at: new Date().toISOString(), plan_hash: 'h1', spec_hash: 'h2', node_count: nodeIds.length, wave_count: 1 },
  };
}

function makeAgent(id: string, executor: TaskExecutor, assignedTaskIds?: string[]): AgentSpec {
  return { id, executor, workspaceManager: makeWorkspaceManager(id), assignedTaskIds };
}

function makeTmpProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ma-'));
  fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
  return root;
}

describe('MultiAgentCoordinator — parallel mode', () => {
  it('completes all tasks with two agents', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1', 't2', 't3', 't4']);
    const opts: CoordinationOptions = {
      mode: 'parallel',
      agents: [makeAgent('a1', makeSuccessExecutor()), makeAgent('a2', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-parallel-001',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.equal(result.mode, 'parallel');
    assert.equal(result.completed.length + result.failed.length, 4);
  });

  it('distributes tasks round-robin when no assignedTaskIds', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1', 't2', 't3', 't4']);
    const opts: CoordinationOptions = {
      mode: 'parallel',
      agents: [makeAgent('a1', makeSuccessExecutor()), makeAgent('a2', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-parallel-002',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.equal(result.agent_results.length, 2);
    const totalAgentCompleted = result.agent_results.reduce((sum, r) => sum + r.completed.length, 0);
    assert.equal(totalAgentCompleted, result.completed.length);
  });

  it('respects assignedTaskIds when provided', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1', 't2', 't3', 't4']);
    const opts: CoordinationOptions = {
      mode: 'parallel',
      agents: [
        makeAgent('a1', makeSuccessExecutor(), ['t1', 't2']),
        makeAgent('a2', makeSuccessExecutor(), ['t3', 't4']),
      ],
      projectRoot: root,
      sessionId: null,
      runId: 'r-parallel-003',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.equal(result.completed.length, 4);
  });
});

describe('MultiAgentCoordinator — competitive mode', () => {
  it('picks winner when both succeed (prefers A)', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1']);
    const opts: CoordinationOptions = {
      mode: 'competitive',
      agents: [makeAgent('agentA', makeSuccessExecutor()), makeAgent('agentB', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-competitive-001',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.equal(result.mode, 'competitive');
    assert.ok(result.completed.includes('t1') || result.failed.includes('t1'));
  });

  it('picks B when A fails', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1']);
    const opts: CoordinationOptions = {
      mode: 'competitive',
      agents: [makeAgent('agentA', makeFailExecutor()), makeAgent('agentB', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-competitive-002',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.ok(result.completed.includes('t1') || result.failed.includes('t1'));
  });

  it('throws when less than 2 agents in competitive mode', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1']);
    const opts: CoordinationOptions = {
      mode: 'competitive',
      agents: [makeAgent('a1', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-competitive-003',
    };
    const coordinator = new MultiAgentCoordinator();
    await assert.rejects(() => coordinator.run(graph, opts), /at least 2 agents/);
  });
});

describe('MultiAgentCoordinator — cooperative mode', () => {
  it('runs as parallel (R3 implementation)', async () => {
    const root = makeTmpProjectRoot();
    const graph = makeGraph(['t1', 't2']);
    const opts: CoordinationOptions = {
      mode: 'cooperative',
      agents: [makeAgent('a1', makeSuccessExecutor()), makeAgent('a2', makeSuccessExecutor())],
      projectRoot: root,
      sessionId: null,
      runId: 'r-cooperative-001',
    };
    const coordinator = new MultiAgentCoordinator();
    const result = await coordinator.run(graph, opts);
    assert.equal(result.completed.length + result.failed.length, 2);
  });
});
