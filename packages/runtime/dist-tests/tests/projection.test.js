"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const projection_engine_1 = require("../src/projection/projection-engine");
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const run_state_reducer_1 = require("../src/reducers/run-state-reducer");
const SPEC = {
    objective: 'Implement auth',
    criteria: [{ id: 'A1', criterion: 'Tests pass', howToVerify: 'npm test' }],
};
const PLAN = {
    totalTasks: 2,
    waves: { 1: ['T1'], 2: ['T2'] },
    tasks: [
        { id: 'T1', title: 'Setup DB', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        { id: 'T2', title: 'Auth endpoint', wave: 2, dependsOn: ['T1'], files: ['src/auth.ts'], verifyCommand: 'npm test', aceite: ['A1'], done: false },
    ],
};
function makeEvent(overrides) {
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
function buildState(extraEvents = []) {
    const events = [
        makeEvent({ type: 'RunStarted', payload: { run_id: 'r001', status: 'running', session_id: null, graph_version: '1', started_at: '2026-04-18T10:00:00Z', ended_at: null, initiator: 'user', mode: 'por_onda' } }),
        makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'Setup DB', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
        makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: {} }),
        makeEvent({ type: 'WorkItemReady', work_item_id: 'T2', payload: { work_item_id: 'T2', title: 'Auth endpoint', type: 'task', depends_on: ['T1'], mutation_scope: ['src/auth.ts'], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'git_worktree', run_id: 'r001' } }),
        ...extraEvents.map(makeEvent),
    ];
    return (0, run_state_reducer_1.reduce)(events);
}
(0, node_test_1.describe)('ProjectionEngine', () => {
    const engine = new projection_engine_1.ProjectionEngine();
    const graph = (0, graph_compiler_1.compile)(PLAN, SPEC, { default_workspace_strategy: 'inplace' });
    (0, node_test_1.test)('projectPlan contains run_id and node titles', () => {
        const state = buildState();
        const md = engine.projectPlan(state, graph);
        strict_1.default.ok(md.includes('r001'));
        strict_1.default.ok(md.includes('Setup DB'));
        strict_1.default.ok(md.includes('Auth endpoint'));
    });
    (0, node_test_1.test)('projectPlan marks T1 as completed', () => {
        const state = buildState();
        const md = engine.projectPlan(state, graph);
        strict_1.default.ok(md.includes('T1'));
        strict_1.default.ok(md.match(/T1.*completed/s));
    });
    (0, node_test_1.test)('projectPlan has wave sections', () => {
        const state = buildState();
        const md = engine.projectPlan(state, graph);
        strict_1.default.ok(md.includes('Onda 1'));
        strict_1.default.ok(md.includes('Onda 2'));
    });
    (0, node_test_1.test)('projectVerify shows all pass when no failures', () => {
        const state = buildState([{ type: 'RunCompleted', payload: { status: 'completed' } }]);
        const results = [
            { verification_id: 'v1', work_item_id: 'T2', check_id: 'check-a1', status: 'pass', evidence_refs: ['ev-001'], summary: 'Tests pass' },
        ];
        const md = engine.projectVerify(state, results);
        strict_1.default.ok(md.includes('✓ PASS'));
        strict_1.default.ok(md.includes('Verificação concluída com sucesso'));
    });
    (0, node_test_1.test)('projectVerify shows failure message when failed results', () => {
        const state = buildState();
        const results = [
            { verification_id: 'v1', work_item_id: 'T2', check_id: 'check-a1', status: 'fail', evidence_refs: [], summary: 'Tests failed' },
        ];
        const md = engine.projectVerify(state, results);
        strict_1.default.ok(md.includes('✗ FAIL'));
        strict_1.default.ok(md.includes('Verificação com falhas'));
    });
    (0, node_test_1.test)('projectState shows lifecycleStatus executing when running', () => {
        const state = buildState();
        const md = engine.projectState(state);
        strict_1.default.ok(md.includes('executing'));
        strict_1.default.ok(md.includes('r001'));
    });
    (0, node_test_1.test)('projectState shows closed when run completed', () => {
        const state = buildState([{ type: 'RunCompleted', payload: { status: 'completed' } }]);
        const md = engine.projectState(state);
        strict_1.default.ok(md.includes('closed'));
    });
    (0, node_test_1.test)('projectRunSummary includes task counts', () => {
        const state = buildState();
        const md = engine.projectRunSummary(state);
        strict_1.default.ok(md.includes('r001'));
        strict_1.default.ok(md.includes('Completed'));
        strict_1.default.ok(md.includes('1'));
    });
    (0, node_test_1.test)('projectPRSummary includes completed tasks and wave checklist', () => {
        const state = buildState();
        const md = engine.projectPRSummary(state, graph);
        strict_1.default.ok(md.includes('T1'));
        strict_1.default.ok(md.includes('Setup DB'));
        strict_1.default.ok(md.includes('Wave 1'));
        strict_1.default.ok(md.includes('OXE Runtime'));
    });
    (0, node_test_1.test)('projection output is deterministic for same input', () => {
        const state = buildState();
        const md1 = engine.projectPlan(state, graph);
        const md2 = engine.projectPlan(state, graph);
        strict_1.default.equal(md1, md2);
    });
});
