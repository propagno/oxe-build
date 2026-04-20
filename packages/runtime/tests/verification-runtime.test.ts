import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { executeSuite, verifyRun, type AcceptanceCheckSuite } from '../src/verification/verification-compiler';
import { EvidenceStore } from '../src/evidence/evidence-store';
import { PluginRegistry } from '../src/plugins/plugin-registry';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-verify-runtime-'));
}

describe('executeSuite', () => {
  it('collects evidence and builds manifest + risk ledger', async () => {
    const root = tmpDir();
    const suite: AcceptanceCheckSuite = {
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
    const executed = await executeSuite(suite, root, {
      runId: 'run-verify',
      workItemId: 'T1',
      evidenceStore: new EvidenceStore(root),
    });
    assert.equal(executed.results.length, 1);
    assert.equal(executed.manifest.summary.total, 1);
    assert.equal(executed.evidence_coverage.total_checks, 1);
  });

  it('uses verifier provider when available', async () => {
    const root = tmpDir();
    const registry = new PluginRegistry();
    registry.register({
      name: 'verifier-plugin',
      verifierProviders: [
        {
          name: 'custom-verifier',
          supports: (checkType: string) => checkType === 'security',
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
    const suite: AcceptanceCheckSuite = {
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
    const executed = await executeSuite(suite, root, {
      runId: 'run-provider',
      workItemId: 'T9',
      pluginRegistry: registry,
    });
    assert.equal(executed.verification_results[0].verification_id, 'vr-custom');
    assert.equal(executed.manifest.checks[0].evidence_refs[0], 'ev-custom');
  });

  it('verifyRun returns partial with explicit gaps when suite has no checks', async () => {
    const root = tmpDir();
    const suite: AcceptanceCheckSuite = {
      compiled_at: new Date().toISOString(),
      spec_hash: 'spec-empty',
      plan_hash: 'plan-empty',
      checks: [],
    };
    const result = await verifyRun({
      projectRoot: root,
      runId: 'run-empty',
      workItemId: 'T0',
      cwd: root,
      suite,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.executed, null);
    assert.equal(result.gaps.length, 1);
    assert.match(result.gaps[0], /Nenhum check executável/i);
  });
});
