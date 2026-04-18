"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const policy_engine_1 = require("../src/policy/policy-engine");
(0, node_test_1.describe)('PolicyEngine', () => {
    (0, node_test_1.test)('empty rules always allow', () => {
        const engine = new policy_engine_1.PolicyEngine();
        const decision = engine.evaluate({ tool: 'apply_patch', mutation_scope: [], affected_paths: [] });
        strict_1.default.equal(decision.allowed, true);
        strict_1.default.equal(decision.gate_required, false);
        strict_1.default.equal(decision.rule_id, null);
    });
    (0, node_test_1.test)('deny rule blocks action for matching tool', () => {
        const rules = [
            { id: 'no-prod-drop', when: { tool: 'execute_sql', env: 'prod' }, action: 'deny' },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const decision = engine.evaluate({ tool: 'execute_sql', env: 'prod' });
        strict_1.default.equal(decision.allowed, false);
        strict_1.default.equal(decision.rule_id, 'no-prod-drop');
    });
    (0, node_test_1.test)('deny rule does not fire for different env', () => {
        const rules = [
            { id: 'no-prod-drop', when: { tool: 'execute_sql', env: 'prod' }, action: 'deny' },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const decision = engine.evaluate({ tool: 'execute_sql', env: 'staging' });
        strict_1.default.equal(decision.allowed, true);
    });
    (0, node_test_1.test)('require_human_gate sets gate_required and allows action', () => {
        const rules = [
            { id: 'gate-infra', when: { kind: 'infrastructure' }, action: 'require_human_gate' },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const decision = engine.evaluate({ tool: 'apply_patch', kind: 'infrastructure' });
        strict_1.default.equal(decision.allowed, true);
        strict_1.default.equal(decision.gate_required, true);
    });
    (0, node_test_1.test)('allow rule explicitly permits and stops evaluation', () => {
        const rules = [
            { id: 'allow-read', when: { tool: 'read_code' }, action: 'allow' },
            { id: 'deny-all-after', when: {}, action: 'deny' },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const decision = engine.evaluate({ tool: 'read_code' });
        strict_1.default.equal(decision.allowed, true);
        strict_1.default.equal(decision.rule_id, 'allow-read');
    });
    (0, node_test_1.test)('assert diff_within_scope fails when path outside scope', () => {
        const rules = [
            {
                id: 'scope-check',
                when: { tool: 'apply_patch' },
                assert: { diff_within_scope: true },
                action: 'allow',
            },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const ctx = {
            tool: 'apply_patch',
            mutation_scope: ['src/auth/'],
            affected_paths: ['src/auth/login.ts', 'src/admin/users.ts'],
        };
        const decision = engine.evaluate(ctx);
        strict_1.default.equal(decision.allowed, false);
        strict_1.default.ok(decision.reason.includes('outside mutation scope'));
    });
    (0, node_test_1.test)('assert diff_within_scope passes when all paths within scope', () => {
        const rules = [
            {
                id: 'scope-check',
                when: { tool: 'apply_patch' },
                assert: { diff_within_scope: true },
                action: 'allow',
            },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const ctx = {
            tool: 'apply_patch',
            mutation_scope: ['src/auth/'],
            affected_paths: ['src/auth/login.ts', 'src/auth/session.ts'],
        };
        const decision = engine.evaluate(ctx);
        strict_1.default.equal(decision.allowed, true);
    });
    (0, node_test_1.test)('assert diff_within_scope passes when scope is empty (no scope declared)', () => {
        const rules = [
            {
                id: 'scope-check',
                when: { tool: 'apply_patch' },
                assert: { diff_within_scope: true },
                action: 'allow',
            },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const ctx = {
            tool: 'apply_patch',
            mutation_scope: [],
            affected_paths: ['src/anything.ts'],
        };
        const decision = engine.evaluate(ctx);
        strict_1.default.equal(decision.allowed, true);
    });
    (0, node_test_1.test)('withRule adds rule and returns new engine', () => {
        const base = new policy_engine_1.PolicyEngine();
        const extended = base.withRule({ id: 'r1', when: { tool: 'x' }, action: 'deny' });
        strict_1.default.equal(base.evaluate({ tool: 'x' }).allowed, true);
        strict_1.default.equal(extended.evaluate({ tool: 'x' }).allowed, false);
    });
    (0, node_test_1.test)('fromConfig loads policies array', () => {
        const engine = policy_engine_1.PolicyEngine.fromConfig({
            policies: [
                { id: 'no-drop', when: { tool: 'drop_table' }, action: 'deny' },
            ],
        });
        strict_1.default.equal(engine.evaluate({ tool: 'drop_table' }).allowed, false);
    });
    (0, node_test_1.test)('first matching rule wins — order matters', () => {
        const rules = [
            { id: 'r1', when: { tool: 'deploy' }, action: 'allow' },
            { id: 'r2', when: { tool: 'deploy' }, action: 'deny' },
        ];
        const engine = new policy_engine_1.PolicyEngine(rules);
        const decision = engine.evaluate({ tool: 'deploy' });
        strict_1.default.equal(decision.allowed, true);
        strict_1.default.equal(decision.rule_id, 'r1');
    });
});
