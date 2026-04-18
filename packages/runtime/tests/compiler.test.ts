import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile, validateGraph, toSerializable, fromSerializable } from '../src/compiler/graph-compiler';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';

const SPEC: ParsedSpec = {
  objective: 'Test spec',
  criteria: [
    { id: 'A1', criterion: 'Tests pass', howToVerify: 'npm test' },
    { id: 'A2', criterion: 'Lint clean', howToVerify: 'npm run lint' },
  ],
};

const PLAN: ParsedPlan = {
  totalTasks: 3,
  waves: { 1: ['T1', 'T2'], 2: ['T3'] },
  tasks: [
    { id: 'T1', title: 'Setup', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: ['A1'], done: false },
    { id: 'T2', title: 'Implement auth', wave: 1, dependsOn: [], files: ['src/auth.ts'], verifyCommand: 'npm test -- auth', aceite: ['A1', 'A2'], done: false },
    { id: 'T3', title: 'Integration test', wave: 2, dependsOn: ['T1', 'T2'], files: [], verifyCommand: 'npm test -- integration', aceite: ['A1'], done: false },
  ],
};

describe('ExecutionGraph Compiler', () => {
  test('compiles plan to graph with correct node count', () => {
    const graph = compile(PLAN, SPEC);
    assert.equal(graph.nodes.size, 3);
    assert.ok(graph.nodes.has('T1'));
    assert.ok(graph.nodes.has('T2'));
    assert.ok(graph.nodes.has('T3'));
  });

  test('assigns correct wave numbers', () => {
    const graph = compile(PLAN, SPEC);
    assert.equal(graph.waves.length, 2);
    assert.equal(graph.waves[0].wave_number, 1);
    assert.deepEqual(graph.waves[0].node_ids.sort(), ['T1', 'T2']);
    assert.equal(graph.waves[1].wave_number, 2);
    assert.deepEqual(graph.waves[1].node_ids, ['T3']);
  });

  test('creates dependency edges', () => {
    const graph = compile(PLAN, SPEC);
    const t3edges = graph.edges.filter((e) => e.to === 'T3');
    assert.equal(t3edges.length, 2);
    assert.ok(t3edges.some((e) => e.from === 'T1'));
    assert.ok(t3edges.some((e) => e.from === 'T2'));
  });

  test('nodes with files get mutation_scope set', () => {
    const graph = compile(PLAN, SPEC);
    const t2 = graph.nodes.get('T2')!;
    assert.deepEqual(t2.mutation_scope, ['src/auth.ts']);
  });

  test('nodes without files have empty mutation_scope', () => {
    const graph = compile(PLAN, SPEC);
    const t1 = graph.nodes.get('T1')!;
    assert.deepEqual(t1.mutation_scope, []);
  });

  test('default workspace strategy is git_worktree', () => {
    const graph = compile(PLAN, SPEC);
    for (const node of graph.nodes.values()) {
      assert.equal(node.workspace_strategy, 'git_worktree');
    }
  });

  test('respects custom options', () => {
    const graph = compile(PLAN, SPEC, {
      default_workspace_strategy: 'inplace',
      default_max_retries: 3,
      require_approval_for_all: true,
    });
    const t1 = graph.nodes.get('T1')!;
    assert.equal(t1.workspace_strategy, 'inplace');
    assert.equal(t1.policy.max_retries, 3);
    assert.equal(t1.policy.requires_human_approval, true);
  });

  test('skip_done_tasks excludes done tasks', () => {
    const planWithDone: ParsedPlan = {
      ...PLAN,
      tasks: PLAN.tasks.map((t) => (t.id === 'T1' ? { ...t, done: true } : t)),
    };
    const graph = compile(planWithDone, SPEC, { skip_done_tasks: true });
    assert.equal(graph.nodes.size, 2);
    assert.ok(!graph.nodes.has('T1'));
  });

  test('metadata includes hashes and timestamps', () => {
    const graph = compile(PLAN, SPEC);
    assert.ok(graph.metadata.plan_hash.length === 12);
    assert.ok(graph.metadata.spec_hash.length === 12);
    assert.ok(graph.metadata.compiled_at);
    assert.equal(graph.metadata.node_count, 3);
  });

  test('validateGraph returns no errors for valid graph', () => {
    const graph = compile(PLAN, SPEC);
    const errors = validateGraph(graph);
    assert.deepEqual(errors, []);
  });

  test('validateGraph detects missing dependency', () => {
    const graph = compile(PLAN, SPEC);
    // Manually inject a bad dependency
    const t3 = graph.nodes.get('T3')!;
    graph.nodes.set('T3', { ...t3, depends_on: ['T1', 'T2', 'T99'] });
    const errors = validateGraph(graph);
    assert.ok(errors.some((e) => e.includes('T99')));
  });

  test('toSerializable / fromSerializable round-trip', () => {
    const graph = compile(PLAN, SPEC);
    const raw = toSerializable(graph);
    const restored = fromSerializable(raw);
    assert.equal(restored.nodes.size, graph.nodes.size);
    assert.equal(restored.waves.length, graph.waves.length);
    assert.deepEqual(restored.metadata, graph.metadata);
  });
});
