"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const SPEC = {
    objective: 'Test spec',
    criteria: [
        { id: 'A1', criterion: 'Tests pass', howToVerify: 'npm test' },
        { id: 'A2', criterion: 'Lint clean', howToVerify: 'npm run lint' },
    ],
};
const PLAN = {
    totalTasks: 3,
    waves: { 1: ['T1', 'T2'], 2: ['T3'] },
    tasks: [
        { id: 'T1', title: 'Setup', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: ['A1'], done: false },
        { id: 'T2', title: 'Implement auth', wave: 1, dependsOn: [], files: ['src/auth.ts'], verifyCommand: 'npm test -- auth', aceite: ['A1', 'A2'], done: false },
        { id: 'T3', title: 'Integration test', wave: 2, dependsOn: ['T1', 'T2'], files: [], verifyCommand: 'npm test -- integration', aceite: ['A1'], done: false },
    ],
};
(0, node_test_1.describe)('ExecutionGraph Compiler', () => {
    (0, node_test_1.test)('compiles plan to graph with correct node count', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        strict_1.default.equal(graph.nodes.size, 3);
        strict_1.default.ok(graph.nodes.has('T1'));
        strict_1.default.ok(graph.nodes.has('T2'));
        strict_1.default.ok(graph.nodes.has('T3'));
    });
    (0, node_test_1.test)('assigns correct wave numbers', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        strict_1.default.equal(graph.waves.length, 2);
        strict_1.default.equal(graph.waves[0].wave_number, 1);
        strict_1.default.deepEqual(graph.waves[0].node_ids.sort(), ['T1', 'T2']);
        strict_1.default.equal(graph.waves[1].wave_number, 2);
        strict_1.default.deepEqual(graph.waves[1].node_ids, ['T3']);
    });
    (0, node_test_1.test)('creates dependency edges', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        const t3edges = graph.edges.filter((e) => e.to === 'T3');
        strict_1.default.equal(t3edges.length, 2);
        strict_1.default.ok(t3edges.some((e) => e.from === 'T1'));
        strict_1.default.ok(t3edges.some((e) => e.from === 'T2'));
    });
    (0, node_test_1.test)('nodes with files get mutation_scope set', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        const t2 = graph.nodes.get('T2');
        strict_1.default.deepEqual(t2.mutation_scope, ['src/auth.ts']);
    });
    (0, node_test_1.test)('nodes without files have empty mutation_scope', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        const t1 = graph.nodes.get('T1');
        strict_1.default.deepEqual(t1.mutation_scope, []);
    });
    (0, node_test_1.test)('default workspace strategy is git_worktree', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        for (const node of graph.nodes.values()) {
            strict_1.default.equal(node.workspace_strategy, 'git_worktree');
        }
    });
    (0, node_test_1.test)('respects custom options', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC, {
            default_workspace_strategy: 'inplace',
            default_max_retries: 3,
            require_approval_for_all: true,
        });
        const t1 = graph.nodes.get('T1');
        strict_1.default.equal(t1.workspace_strategy, 'inplace');
        strict_1.default.equal(t1.policy.max_retries, 3);
        strict_1.default.equal(t1.policy.requires_human_approval, true);
    });
    (0, node_test_1.test)('skip_done_tasks excludes done tasks', () => {
        const planWithDone = {
            ...PLAN,
            tasks: PLAN.tasks.map((t) => (t.id === 'T1' ? { ...t, done: true } : t)),
        };
        const graph = (0, graph_compiler_1.compile)(planWithDone, SPEC, { skip_done_tasks: true });
        strict_1.default.equal(graph.nodes.size, 2);
        strict_1.default.ok(!graph.nodes.has('T1'));
    });
    (0, node_test_1.test)('metadata includes hashes and timestamps', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        strict_1.default.ok(graph.metadata.plan_hash.length === 12);
        strict_1.default.ok(graph.metadata.spec_hash.length === 12);
        strict_1.default.ok(graph.metadata.compiled_at);
        strict_1.default.equal(graph.metadata.node_count, 3);
    });
    (0, node_test_1.test)('validateGraph returns no errors for valid graph', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        const errors = (0, graph_compiler_1.validateGraph)(graph);
        strict_1.default.deepEqual(errors, []);
    });
    (0, node_test_1.test)('validateGraph detects missing dependency', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        // Manually inject a bad dependency
        const t3 = graph.nodes.get('T3');
        graph.nodes.set('T3', { ...t3, depends_on: ['T1', 'T2', 'T99'] });
        const errors = (0, graph_compiler_1.validateGraph)(graph);
        strict_1.default.ok(errors.some((e) => e.includes('T99')));
    });
    (0, node_test_1.test)('toSerializable / fromSerializable round-trip', () => {
        const graph = (0, graph_compiler_1.compile)(PLAN, SPEC);
        const raw = (0, graph_compiler_1.toSerializable)(graph);
        const restored = (0, graph_compiler_1.fromSerializable)(raw);
        strict_1.default.equal(restored.nodes.size, graph.nodes.size);
        strict_1.default.equal(restored.waves.length, graph.waves.length);
        strict_1.default.deepEqual(restored.metadata, graph.metadata);
    });
});
