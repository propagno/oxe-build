"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const policy_pack_1 = require("../src/audit/policy-pack");
const policy_engine_1 = require("../src/policy/policy-engine");
function makePack(id, overrides = {}) {
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
(0, node_test_1.describe)('PolicyPack persistence', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-policy-'));
    });
    (0, node_test_1.test)('savePolicyPack creates JSON file', () => {
        const pack = makePack('pack-1');
        (0, policy_pack_1.savePolicyPack)(tmpDir, pack);
        const packPath = path_1.default.join(tmpDir, '.oxe', 'policy-packs', 'pack-1.json');
        strict_1.default.ok(fs_1.default.existsSync(packPath));
    });
    (0, node_test_1.test)('loadPolicyPack retrieves saved pack', () => {
        const pack = makePack('pack-2');
        (0, policy_pack_1.savePolicyPack)(tmpDir, pack);
        const loaded = (0, policy_pack_1.loadPolicyPack)(tmpDir, 'pack-2');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.pack_id, 'pack-2');
        strict_1.default.equal(loaded.org_id, 'org-test');
        strict_1.default.equal(loaded.policies.length, 1);
    });
    (0, node_test_1.test)('loadPolicyPack returns null for unknown pack', () => {
        strict_1.default.equal((0, policy_pack_1.loadPolicyPack)(tmpDir, 'no-such-pack'), null);
    });
    (0, node_test_1.test)('listPolicyPacks returns all saved packs', () => {
        (0, policy_pack_1.savePolicyPack)(tmpDir, makePack('pack-3'));
        (0, policy_pack_1.savePolicyPack)(tmpDir, makePack('pack-4'));
        const packs = (0, policy_pack_1.listPolicyPacks)(tmpDir);
        strict_1.default.ok(packs.length >= 2);
        const ids = packs.map((p) => p.pack_id);
        strict_1.default.ok(ids.includes('pack-3'));
        strict_1.default.ok(ids.includes('pack-4'));
    });
    (0, node_test_1.test)('listPolicyPacks returns empty for new directory', () => {
        const emptyDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-empty-'));
        strict_1.default.deepEqual((0, policy_pack_1.listPolicyPacks)(emptyDir), []);
        fs_1.default.rmSync(emptyDir, { recursive: true, force: true });
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('applyPolicyPack', () => {
    (0, node_test_1.test)('applies rules from pack to engine', () => {
        const pack = makePack('pack-apply');
        const engine = new policy_engine_1.PolicyEngine();
        const updated = (0, policy_pack_1.applyPolicyPack)(engine, pack);
        const decision = updated.evaluate({
            tool: 'deploy',
            env: 'production',
        });
        strict_1.default.equal(decision.allowed, false);
        strict_1.default.equal(decision.rule_id, `rule-pack-apply-1`);
    });
    (0, node_test_1.test)('applies guardrail from pack', () => {
        const pack = makePack('pack-guard');
        const engine = new policy_engine_1.PolicyEngine();
        const updated = (0, policy_pack_1.applyPolicyPack)(engine, pack);
        const guardrail = updated.getGuardrail();
        strict_1.default.ok(guardrail.protected_paths.includes('.env'));
        strict_1.default.ok(guardrail.protected_branches.includes('production'));
    });
    (0, node_test_1.test)('pack with multiple rules — all applied', () => {
        const pack = {
            pack_id: 'multi-rule',
            org_id: 'org',
            name: 'multi',
            version: '1.0.0',
            policies: [
                { id: 'r1', when: { tool: 'delete' }, action: 'deny' },
                { id: 'r2', when: { tool: 'read' }, action: 'allow' },
            ],
            guardrail: policy_engine_1.PolicyEngine.defaultGuardrail(),
            created_at: new Date().toISOString(),
        };
        const engine = new policy_engine_1.PolicyEngine();
        const updated = (0, policy_pack_1.applyPolicyPack)(engine, pack);
        strict_1.default.equal(updated.evaluate({ tool: 'delete' }).allowed, false);
        strict_1.default.equal(updated.evaluate({ tool: 'read' }).allowed, true);
    });
    (0, node_test_1.test)('original engine is not mutated', () => {
        const pack = makePack('immutable-test');
        const engine = new policy_engine_1.PolicyEngine();
        (0, policy_pack_1.applyPolicyPack)(engine, pack);
        // engine should still allow the tool
        const decision = engine.evaluate({ tool: 'deploy' });
        strict_1.default.equal(decision.allowed, true);
    });
});
