"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const verification_compiler_1 = require("../src/verification/verification-compiler");
const evidence_store_1 = require("../src/evidence/evidence-store");
const plugin_registry_1 = require("../src/plugins/plugin-registry");
function tmpDir() {
    return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-verify-runtime-'));
}
(0, node_test_1.describe)('executeSuite', () => {
    (0, node_test_1.it)('collects evidence and builds manifest + risk ledger', async () => {
        const root = tmpDir();
        const suite = {
            compiled_at: new Date().toISOString(),
            spec_hash: 'spec',
            plan_hash: 'plan',
            checks: [
                {
                    id: 'check-a1',
                    type: 'custom',
                    command: null,
                    evidence_type_expected: 'summary',
                    acceptance_ref: 'A1',
                    description: 'skip check',
                },
            ],
        };
        const executed = await (0, verification_compiler_1.executeSuite)(suite, root, {
            runId: 'run-verify',
            workItemId: 'T1',
            evidenceStore: new evidence_store_1.EvidenceStore(root),
        });
        strict_1.default.equal(executed.results.length, 1);
        strict_1.default.equal(executed.manifest.summary.total, 1);
        strict_1.default.equal(executed.evidence_coverage.total_checks, 1);
    });
    (0, node_test_1.it)('uses verifier provider when available', async () => {
        const root = tmpDir();
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register({
            name: 'verifier-plugin',
            verifierProviders: [
                {
                    name: 'custom-verifier',
                    supports: (checkType) => checkType === 'security',
                    execute: async () => ({
                        verification_id: 'vr-custom',
                        work_item_id: 'T9',
                        check_id: 'check-a9',
                        status: 'pass',
                        evidence_refs: ['ev-custom'],
                        summary: 'provider verified',
                    }),
                },
            ],
        });
        const suite = {
            compiled_at: new Date().toISOString(),
            spec_hash: 'spec',
            plan_hash: 'plan',
            checks: [
                {
                    id: 'check-a9',
                    type: 'security',
                    command: 'noop',
                    evidence_type_expected: 'security_report',
                    acceptance_ref: 'A9',
                    description: 'provider check',
                },
            ],
        };
        const executed = await (0, verification_compiler_1.executeSuite)(suite, root, {
            runId: 'run-provider',
            workItemId: 'T9',
            pluginRegistry: registry,
        });
        strict_1.default.equal(executed.verification_results[0].verification_id, 'vr-custom');
        strict_1.default.equal(executed.manifest.checks[0].evidence_refs[0], 'ev-custom');
    });
    (0, node_test_1.it)('verifyRun returns partial with explicit gaps when suite has no checks', async () => {
        const root = tmpDir();
        const suite = {
            compiled_at: new Date().toISOString(),
            spec_hash: 'spec-empty',
            plan_hash: 'plan-empty',
            checks: [],
        };
        const result = await (0, verification_compiler_1.verifyRun)({
            projectRoot: root,
            runId: 'run-empty',
            workItemId: 'T0',
            cwd: root,
            suite,
        });
        strict_1.default.equal(result.status, 'partial');
        strict_1.default.equal(result.executed, null);
        strict_1.default.equal(result.gaps.length, 1);
        strict_1.default.match(result.gaps[0], /Nenhum check executável/i);
    });
});
