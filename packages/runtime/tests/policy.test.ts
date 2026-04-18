import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../src/policy/policy-engine';
import type { PolicyRule, PolicyContext } from '../src/policy/policy-engine';

describe('PolicyEngine', () => {
  test('empty rules always allow', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({ tool: 'apply_patch', mutation_scope: [], affected_paths: [] });
    assert.equal(decision.allowed, true);
    assert.equal(decision.gate_required, false);
    assert.equal(decision.rule_id, null);
  });

  test('deny rule blocks action for matching tool', () => {
    const rules: PolicyRule[] = [
      { id: 'no-prod-drop', when: { tool: 'execute_sql', env: 'prod' }, action: 'deny' },
    ];
    const engine = new PolicyEngine(rules);
    const decision = engine.evaluate({ tool: 'execute_sql', env: 'prod' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.rule_id, 'no-prod-drop');
  });

  test('deny rule does not fire for different env', () => {
    const rules: PolicyRule[] = [
      { id: 'no-prod-drop', when: { tool: 'execute_sql', env: 'prod' }, action: 'deny' },
    ];
    const engine = new PolicyEngine(rules);
    const decision = engine.evaluate({ tool: 'execute_sql', env: 'staging' });
    assert.equal(decision.allowed, true);
  });

  test('require_human_gate sets gate_required and allows action', () => {
    const rules: PolicyRule[] = [
      { id: 'gate-infra', when: { kind: 'infrastructure' }, action: 'require_human_gate' },
    ];
    const engine = new PolicyEngine(rules);
    const decision = engine.evaluate({ tool: 'apply_patch', kind: 'infrastructure' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.gate_required, true);
  });

  test('allow rule explicitly permits and stops evaluation', () => {
    const rules: PolicyRule[] = [
      { id: 'allow-read', when: { tool: 'read_code' }, action: 'allow' },
      { id: 'deny-all-after', when: {}, action: 'deny' },
    ];
    const engine = new PolicyEngine(rules);
    const decision = engine.evaluate({ tool: 'read_code' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.rule_id, 'allow-read');
  });

  test('assert diff_within_scope fails when path outside scope', () => {
    const rules: PolicyRule[] = [
      {
        id: 'scope-check',
        when: { tool: 'apply_patch' },
        assert: { diff_within_scope: true },
        action: 'allow',
      },
    ];
    const engine = new PolicyEngine(rules);
    const ctx: PolicyContext = {
      tool: 'apply_patch',
      mutation_scope: ['src/auth/'],
      affected_paths: ['src/auth/login.ts', 'src/admin/users.ts'],
    };
    const decision = engine.evaluate(ctx);
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.includes('outside mutation scope'));
  });

  test('assert diff_within_scope passes when all paths within scope', () => {
    const rules: PolicyRule[] = [
      {
        id: 'scope-check',
        when: { tool: 'apply_patch' },
        assert: { diff_within_scope: true },
        action: 'allow',
      },
    ];
    const engine = new PolicyEngine(rules);
    const ctx: PolicyContext = {
      tool: 'apply_patch',
      mutation_scope: ['src/auth/'],
      affected_paths: ['src/auth/login.ts', 'src/auth/session.ts'],
    };
    const decision = engine.evaluate(ctx);
    assert.equal(decision.allowed, true);
  });

  test('assert diff_within_scope passes when scope is empty (no scope declared)', () => {
    const rules: PolicyRule[] = [
      {
        id: 'scope-check',
        when: { tool: 'apply_patch' },
        assert: { diff_within_scope: true },
        action: 'allow',
      },
    ];
    const engine = new PolicyEngine(rules);
    const ctx: PolicyContext = {
      tool: 'apply_patch',
      mutation_scope: [],
      affected_paths: ['src/anything.ts'],
    };
    const decision = engine.evaluate(ctx);
    assert.equal(decision.allowed, true);
  });

  test('withRule adds rule and returns new engine', () => {
    const base = new PolicyEngine();
    const extended = base.withRule({ id: 'r1', when: { tool: 'x' }, action: 'deny' });
    assert.equal(base.evaluate({ tool: 'x' }).allowed, true);
    assert.equal(extended.evaluate({ tool: 'x' }).allowed, false);
  });

  test('fromConfig loads policies array', () => {
    const engine = PolicyEngine.fromConfig({
      policies: [
        { id: 'no-drop', when: { tool: 'drop_table' }, action: 'deny' },
      ],
    });
    assert.equal(engine.evaluate({ tool: 'drop_table' }).allowed, false);
  });

  test('first matching rule wins — order matters', () => {
    const rules: PolicyRule[] = [
      { id: 'r1', when: { tool: 'deploy' }, action: 'allow' },
      { id: 'r2', when: { tool: 'deploy' }, action: 'deny' },
    ];
    const engine = new PolicyEngine(rules);
    const decision = engine.evaluate({ tool: 'deploy' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.rule_id, 'r1');
  });
});
