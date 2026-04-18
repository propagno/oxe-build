import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionEngine } from '../src/projection/projection-engine';
import { compile } from '../src/compiler/graph-compiler';
import { reduce } from '../src/reducers/run-state-reducer';
import type { OxeEvent } from '../src/events/envelope';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { VerificationResult } from '../src/models/verification-result';

const SPEC: ParsedSpec = {
  objective: 'Implement auth',
  criteria: [{ id: 'A1', criterion: 'Tests pass', howToVerify: 'npm test' }],
};

const PLAN: ParsedPlan = {
  totalTasks: 2,
  waves: { 1: ['T1'], 2: ['T2'] },
  tasks: [
    { id: 'T1', title: 'Setup DB', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    { id: 'T2', title: 'Auth endpoint', wave: 2, dependsOn: ['T1'], files: ['src/auth.ts'], verifyCommand: 'npm test', aceite: ['A1'], done: false },
  ],
};

function makeEvent(overrides: Partial<OxeEvent> & { type: OxeEvent['type'] }): OxeEvent {
  return {
    id: `evt-${Date.now()}`,
    timestamp: new Date().toISOString(),
    session_id: null,
    run_id: 'r001',
    work_item_id: null,
    attempt_id: null,
    causation_id: null,
    correlation_id: null,
    payload: {},
    ...overrides,
  };
}

function buildState(extraEvents: (Partial<OxeEvent> & { type: OxeEvent['type'] })[] = []) {
  const events = [
    makeEvent({ type: 'RunStarted', payload: { run_id: 'r001', status: 'running', session_id: null, graph_version: '1', started_at: '2026-04-18T10:00:00Z', ended_at: null, initiator: 'user', mode: 'por_onda' } }),
    makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'Setup DB', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
    makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: {} }),
    makeEvent({ type: 'WorkItemReady', work_item_id: 'T2', payload: { work_item_id: 'T2', title: 'Auth endpoint', type: 'task', depends_on: ['T1'], mutation_scope: ['src/auth.ts'], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'git_worktree', run_id: 'r001' } }),
    ...extraEvents.map(makeEvent),
  ];
  return reduce(events);
}

describe('ProjectionEngine', () => {
  const engine = new ProjectionEngine();
  const graph = compile(PLAN, SPEC, { default_workspace_strategy: 'inplace' });

  test('projectPlan contains run_id and node titles', () => {
    const state = buildState();
    const md = engine.projectPlan(state, graph);
    assert.ok(md.includes('r001'));
    assert.ok(md.includes('Setup DB'));
    assert.ok(md.includes('Auth endpoint'));
  });

  test('projectPlan marks T1 as completed', () => {
    const state = buildState();
    const md = engine.projectPlan(state, graph);
    assert.ok(md.includes('T1'));
    assert.ok(md.match(/T1.*completed/s));
  });

  test('projectPlan has wave sections', () => {
    const state = buildState();
    const md = engine.projectPlan(state, graph);
    assert.ok(md.includes('Onda 1'));
    assert.ok(md.includes('Onda 2'));
  });

  test('projectVerify shows all pass when no failures', () => {
    const state = buildState([{ type: 'RunCompleted', payload: { status: 'completed' } }]);
    const results: VerificationResult[] = [
      { verification_id: 'v1', work_item_id: 'T2', check_id: 'check-a1', status: 'pass', evidence_refs: ['ev-001'], summary: 'Tests pass' },
    ];
    const md = engine.projectVerify(state, results);
    assert.ok(md.includes('✓ PASS'));
    assert.ok(md.includes('Verificação concluída com sucesso'));
  });

  test('projectVerify shows failure message when failed results', () => {
    const state = buildState();
    const results: VerificationResult[] = [
      { verification_id: 'v1', work_item_id: 'T2', check_id: 'check-a1', status: 'fail', evidence_refs: [], summary: 'Tests failed' },
    ];
    const md = engine.projectVerify(state, results);
    assert.ok(md.includes('✗ FAIL'));
    assert.ok(md.includes('Verificação com falhas'));
  });

  test('projectState shows lifecycleStatus executing when running', () => {
    const state = buildState();
    const md = engine.projectState(state);
    assert.ok(md.includes('executing'));
    assert.ok(md.includes('r001'));
  });

  test('projectState shows closed when run completed', () => {
    const state = buildState([{ type: 'RunCompleted', payload: { status: 'completed' } }]);
    const md = engine.projectState(state);
    assert.ok(md.includes('closed'));
  });

  test('projectRunSummary includes task counts', () => {
    const state = buildState();
    const md = engine.projectRunSummary(state);
    assert.ok(md.includes('r001'));
    assert.ok(md.includes('Completed'));
    assert.ok(md.includes('1'));
  });

  test('projectPRSummary includes completed tasks and wave checklist', () => {
    const state = buildState();
    const md = engine.projectPRSummary(state, graph);
    assert.ok(md.includes('T1'));
    assert.ok(md.includes('Setup DB'));
    assert.ok(md.includes('Wave 1'));
    assert.ok(md.includes('OXE Runtime'));
  });

  test('projection output is deterministic for same input', () => {
    const state = buildState();
    const md1 = engine.projectPlan(state, graph);
    const md2 = engine.projectPlan(state, graph);
    assert.equal(md1, md2);
  });
});
