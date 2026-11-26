'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reference-projects.cjs');

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore EBUSY */ }
  }
});

describe('A10 (OB-34 / OXB-221-10): reference-projects --plan-model/--execute-model split and ROI comparison', () => {
  it('exports compareReferenceReports without running main() and computes cost/turn deltas and regressions', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(src, /require\.main\s*===\s*module/, 'reference-projects.cjs must guard main() with require.main === module');
    const rp = require(SCRIPT);
    assert.equal(typeof rp.compareReferenceReports, 'function');
    assert.equal(typeof rp.resolveModels, 'function');

    const baseline = {
      models: { plan: 'sonnet', execute: 'sonnet' },
      results: [
        {
          name: 'mdlint',
          ok: true,
          cost_usd: 10.0,
          turns: 40,
          phases: [{ phase: 'F1', closed: true, false_green: false, oracle: { ok: true } }],
          scorecard: { ok: true, metrics: [{ metric: 'first_attempt_rate', value: 1.0 }] },
        },
      ],
    };
    const cheaper = {
      models: { plan: 'opus', execute: 'haiku' },
      results: [
        {
          name: 'mdlint',
          ok: true,
          cost_usd: 4.5,
          turns: 44,
          phases: [{ phase: 'F1', closed: true, false_green: false, oracle: { ok: true } }],
          scorecard: { ok: true, metrics: [{ metric: 'first_attempt_rate', value: 0.9 }] },
        },
      ],
    };
    const cmp = rp.compareReferenceReports(baseline, cheaper);
    assert.equal(cmp.regression, false);
    assert.equal(cmp.cost_delta_usd, -5.5);
    assert.equal(cmp.cost_savings_pct, 55);
    assert.equal(cmp.turns_delta, 4);
    assert.equal(cmp.first_attempt_rate_delta, -0.1);

    const regressed = {
      models: { plan: 'opus', execute: 'haiku' },
      results: [
        {
          name: 'mdlint',
          ok: false,
          cost_usd: 2.0,
          turns: 30,
          phases: [{ phase: 'F1', closed: true, false_green: true, oracle: { ok: false } }],
          scorecard: { ok: true, metrics: [{ metric: 'first_attempt_rate', value: 0.8 }] },
        },
      ],
    };
    const cmpBad = rp.compareReferenceReports(baseline, regressed);
    assert.equal(cmpBad.regression, true);
    assert.ok(Array.isArray(cmpBad.regression_reasons) && cmpBad.regression_reasons.length > 0);
  });

  it('records models { plan, execute }, cost_by_tier and turns_by_phase offline under --solution', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a10-split-'));
    tmpDirs.push(outDir);
    const res = spawnSync(
      process.execPath,
      [SCRIPT, '--project', 'mdlint', '--solution', '--fresh', '--plan-model', 'opus', '--execute-model', 'haiku', '--root', outDir],
      { cwd: ROOT, encoding: 'utf8', timeout: 300000 }
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const reportPath = path.join(outDir, 'reference-projects-report.json');
    assert.equal(fs.existsSync(reportPath), true, 'reference-projects-report.json must be written');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.deepEqual(report.models, { plan: 'opus', execute: 'haiku' });
    const proj = report.results.find((r) => r.name === 'mdlint');
    assert.ok(proj, 'mdlint result missing');
    assert.equal(proj.ok, true);
    assert.deepEqual(proj.models, { plan: 'opus', execute: 'haiku' });
    assert.equal(typeof proj.cost_by_tier.plan, 'number');
    assert.equal(typeof proj.cost_by_tier.execute, 'number');
    assert.equal(typeof proj.turns_by_phase.F1, 'number');
    assert.equal(typeof proj.turns_by_phase.F2, 'number');
  });
});
