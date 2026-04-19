import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../src/policy/policy-engine';
import type { PolicyRule, PolicyContext, EnvironmentGuardrail } from '../src/policy/policy-engine';

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

  // Phase 2 — SideEffectClass, AutonomyTier, mutation budget, guardrails

  test('autonomy tier L0 denies write_fs', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'write_file',
      side_effect_class: 'write_fs',
      autonomy_tier: 'L0',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.rule_id, '__autonomy_tier');
  });

  test('autonomy tier L1 permits write_fs', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'write_file',
      side_effect_class: 'write_fs',
      autonomy_tier: 'L1',
    });
    assert.equal(decision.allowed, true);
  });

  test('autonomy tier L2 permits git_mutation', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'git_commit',
      side_effect_class: 'git_mutation',
      autonomy_tier: 'L2',
    });
    assert.equal(decision.allowed, true);
  });

  test('autonomy tier L1 denies infra_operation', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'deploy',
      side_effect_class: 'infra_operation',
      autonomy_tier: 'L1',
    });
    assert.equal(decision.allowed, false);
  });

  test('mutation budget exceeded denies action', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'apply_patch',
      node_policy: { max_retries: 0, mutation_budget: 3 },
      mutation_count: 3,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.includes('budget'));
  });

  test('mutation budget not exceeded allows action', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'apply_patch',
      node_policy: { max_retries: 0, mutation_budget: 5 },
      mutation_count: 2,
    });
    assert.equal(decision.allowed, true);
  });

  test('protected path triggers gate', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'write_file',
      affected_paths: ['.env'],
    });
    assert.equal(decision.gate_required, true);
    assert.equal(decision.rule_id, '__guardrail_path');
  });

  test('infra_operation side effect triggers gate via default guardrail', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({
      tool: 'deploy',
      side_effect_class: 'infra_operation',
      autonomy_tier: 'L3',
    });
    assert.equal(decision.gate_required, true);
    assert.equal(decision.rule_id, '__guardrail_side_effect');
  });

  test('withGuardrail replaces guardrail config', () => {
    const customGuardrail: EnvironmentGuardrail = {
      protected_paths: ['secrets.json'],
      protected_branches: ['prod'],
      require_human_gate_on: ['db_change'],
    };
    const engine = new PolicyEngine().withGuardrail(customGuardrail);
    // infra_operation no longer triggers gate with custom guardrail
    const d1 = engine.evaluate({ tool: 'deploy', side_effect_class: 'infra_operation', autonomy_tier: 'L3' });
    assert.equal(d1.gate_required, false);
    // db_change now triggers gate
    const d2 = engine.evaluate({ tool: 'query', side_effect_class: 'db_change', autonomy_tier: 'L3' });
    assert.equal(d2.gate_required, true);
  });

  test('side_effect_class matching in rule when clause', () => {
    const engine = new PolicyEngine([
      { id: 'no-network', when: { side_effect_class: 'network_call' }, action: 'deny' },
    ]);
    const d1 = engine.evaluate({ tool: 'fetch', side_effect_class: 'network_call' });
    assert.equal(d1.allowed, false);
    const d2 = engine.evaluate({ tool: 'read', side_effect_class: 'read_fs' });
    assert.equal(d2.allowed, true);
  });

  test('autonomy_tier matching in rule when clause', () => {
    const engine = new PolicyEngine([
      { id: 'gate-L0', when: { autonomy_tier: 'L0' }, action: 'require_human_gate' },
    ]);
    // L0 autonomy tier: guardrail checked first, but since no side_effect_class here,
    // rule should fire for L0
    const d = engine.evaluate({ tool: 'anything', autonomy_tier: 'L0' });
    assert.equal(d.gate_required, true);
  });

  test('defaultGuardrail static method returns copy', () => {
    const g1 = PolicyEngine.defaultGuardrail();
    const g2 = PolicyEngine.defaultGuardrail();
    assert.notEqual(g1, g2);
    assert.deepEqual(g1, g2);
  });
});
