import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  savePolicyPack,
  loadPolicyPack,
  listPolicyPacks,
  applyPolicyPack,
} from '../src/audit/policy-pack';
import type { PolicyPack } from '../src/audit/policy-pack';
import { PolicyEngine } from '../src/policy/policy-engine';

function makePack(id: string, overrides: Partial<PolicyPack> = {}): PolicyPack {
  return {
    pack_id: id,
    org_id: 'org-test',
    name: `Test Pack ${id}`,
    version: '1.0.0',
    policies: [
      {
        id: `rule-${id}-1`,
        when: { tool: 'deploy' },
        action: 'deny',
      },
    ],
    guardrail: {
      protected_paths: ['.env', 'secrets.json'],
      protected_branches: ['main', 'production'],
      require_human_gate_on: ['infra_operation'],
    },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PolicyPack persistence', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-policy-'));
  });

  test('savePolicyPack creates JSON file', () => {
    const pack = makePack('pack-1');
    savePolicyPack(tmpDir, pack);
    const packPath = path.join(tmpDir, '.oxe', 'policy-packs', 'pack-1.json');
    assert.ok(fs.existsSync(packPath));
  });

  test('loadPolicyPack retrieves saved pack', () => {
    const pack = makePack('pack-2');
    savePolicyPack(tmpDir, pack);
    const loaded = loadPolicyPack(tmpDir, 'pack-2');
    assert.ok(loaded !== null);
    assert.equal(loaded!.pack_id, 'pack-2');
    assert.equal(loaded!.org_id, 'org-test');
    assert.equal(loaded!.policies.length, 1);
  });

  test('loadPolicyPack returns null for unknown pack', () => {
    assert.equal(loadPolicyPack(tmpDir, 'no-such-pack'), null);
  });

  test('listPolicyPacks returns all saved packs', () => {
    savePolicyPack(tmpDir, makePack('pack-3'));
    savePolicyPack(tmpDir, makePack('pack-4'));
    const packs = listPolicyPacks(tmpDir);
    assert.ok(packs.length >= 2);
    const ids = packs.map((p) => p.pack_id);
    assert.ok(ids.includes('pack-3'));
    assert.ok(ids.includes('pack-4'));
  });

  test('listPolicyPacks returns empty for new directory', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-empty-'));
    assert.deepEqual(listPolicyPacks(emptyDir), []);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('applyPolicyPack', () => {
  test('applies rules from pack to engine', () => {
    const pack = makePack('pack-apply');
    const engine = new PolicyEngine();
    const updated = applyPolicyPack(engine, pack);

    const decision = updated.evaluate({
      tool: 'deploy',
      env: 'production',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.rule_id, `rule-pack-apply-1`);
  });

  test('applies guardrail from pack', () => {
    const pack = makePack('pack-guard');
    const engine = new PolicyEngine();
    const updated = applyPolicyPack(engine, pack);
    const guardrail = updated.getGuardrail();
    assert.ok(guardrail.protected_paths.includes('.env'));
    assert.ok(guardrail.protected_branches.includes('production'));
  });

  test('pack with multiple rules — all applied', () => {
    const pack: PolicyPack = {
      pack_id: 'multi-rule',
      org_id: 'org',
      name: 'multi',
      version: '1.0.0',
      policies: [
        { id: 'r1', when: { tool: 'delete' }, action: 'deny' },
        { id: 'r2', when: { tool: 'read' }, action: 'allow' },
      ],
      guardrail: PolicyEngine.defaultGuardrail(),
      created_at: new Date().toISOString(),
    };
    const engine = new PolicyEngine();
    const updated = applyPolicyPack(engine, pack);

    assert.equal(updated.evaluate({ tool: 'delete' }).allowed, false);
    assert.equal(updated.evaluate({ tool: 'read' }).allowed, true);
  });

  test('original engine is not mutated', () => {
    const pack = makePack('immutable-test');
    const engine = new PolicyEngine();
    applyPolicyPack(engine, pack);
    // engine should still allow the tool
    const decision = engine.evaluate({ tool: 'deploy' });
    assert.equal(decision.allowed, true);
  });
});
