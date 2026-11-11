'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ev = require('../bin/lib/oxe-workflow-eval.cjs');

// 1.21.2 — OXB-141: behavioral evaluation of OXE's own workflows (baseline × candidate, seeded mutations).

const ROOT = path.join(__dirname, '..');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const PLAN = fs.readFileSync(path.join(ROOT, 'oxe', 'workflows', 'plan.md'), 'utf8');

describe('OXB-141: workflow eval', () => {
  it('a candidate plan.md that drops the OXB-046 guard is a regression; a neutral change is not', async () => {
    const regressed = PLAN.split(/\r?\n/).filter((l) => !/teste de aceite da fase inteira não é verify de tarefa/.test(l)).join('\n');
    const bad = await ev.evalWorkflow('plan.md', { candidateText: regressed });
    assert.equal(bad.ok, false);
    assert.equal(bad.regressions[0].rule, 'no_phase_acceptance_as_task_verify');
    const neutral = await ev.evalWorkflow('plan.md', { candidateText: `${PLAN}\n\n<!-- nota editorial -->\n` });
    assert.equal(neutral.ok, true);
    assert.deepEqual(neutral.regressions, []);
  });

  it('every seeded mutation (one per guard) is detected by the evaluator', async () => {
    const r = await ev.evalWorkflow('plan.md', { selfTest: true });
    assert.equal(r.self_test.detected, r.self_test.mutations);
    assert.ok(r.self_test.mutations >= 3);
  });

  it('variance across runs is reported and the tolerance uses it', async () => {
    let i = 0;
    const noisy = async (text, input) => { i += 1; const p = ev.simulatedPlanner(text, input); if (i % 2) p.tasks[0].verify = undefined; return p; };
    const r = await ev.evalWorkflow('plan.md', { runs: 4, model: noisy });
    assert.ok(r.baseline.every_task_has_verify.sd > 0);
    assert.equal(r.regressions.length, 0, 'the same noisy model on both sides is not a regression');
  });

  it('doctor --release requires the eval report from 1.21.2 on', () => {
    const rel = require('../bin/lib/oxe-release.cjs');
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'oxe-release.cjs'), 'utf8');
    assert.match(src, /eval report ausente \(oxe-cc eval workflow plan\.md --self-test --write-report\)/);
    assert.equal(typeof rel, 'object');
  });

  it('the version gates read the version the manifest really carries (versions.rootPackage.version)', () => {
    const rel = require('../bin/lib/oxe-release.cjs');
    const manifest = JSON.parse(JSON.stringify(rel.buildReleaseManifest(ROOT, { skipWrapperSync: true })));
    assert.equal(manifest.versions.root, undefined, 'a real manifest has no versions.root');
    const blockers = (m) => rel.evaluateReleaseManifest(m, { enforceSync: false }).blockers;

    manifest.versions.rootPackage.version = '1.21.2';
    manifest.reports.workflow_eval = { present: false, ok: false, failures: [] };
    assert.ok(blockers(manifest).some((b) => /eval report ausente/.test(b)), 'eval gate fires without versions.root');

    manifest.reports.scorecard = { present: false, failures: ['report_missing'], results: [] };
    assert.ok(blockers(manifest).some((b) => /scorecard/.test(b)), 'scorecard gate fires without versions.root');

    manifest.versions.rootPackage.version = '1.20.0';
    assert.ok(!blockers(manifest).some((b) => /eval report ausente|scorecard/.test(b)), 'older lines are not gated');
  });
});
