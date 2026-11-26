'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reference-projects.cjs');
const PYCSV_DEF = path.join(ROOT, 'scripts', 'reference-projects', 'pycsv.cjs');

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('A11 (OB-35 / OXB-221-11): pycsv Python 3 stdlib reference project', () => {
  it('defines pycsv with 2 phases (10 tasks) and gracefully skips when Python 3 is missing', async () => {
    assert.equal(fs.existsSync(PYCSV_DEF), true, 'scripts/reference-projects/pycsv.cjs must exist');
    const def = require(PYCSV_DEF);
    assert.equal(def.name, 'pycsv');
    assert.equal(def.stack, 'python');
    assert.equal(def.phases.length, 2);
    const totalTasks = def.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    assert.equal(totalTasks, 10, `pycsv must have 10 tasks across 2 phases, got ${totalTasks}`);

    const rp = require(SCRIPT);
    assert.equal(typeof rp.resolvePythonBinary, 'function');
    assert.equal(rp.resolvePythonBinary({ candidates: ['__nonexistent_python_oxe_xyz__'] }), null);

    const skipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a11-skip-'));
    tmpDirs.push(skipDir);
    const skipped = await rp.runProject(def, { root: skipDir, solution: true, fresh: true, pythonBin: null });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.ok, true);
    assert.match(String(skipped.reason || ''), /python/i);
  });

  it('completes 2 phases (10 tasks) with green oracle and first_attempt_rate 1 in --solution mode when Python >= 3.9 is installed', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(src, /require\.main\s*===\s*module/, 'reference-projects.cjs must guard main() with require.main === module');
    const rp = require(SCRIPT);
    const py = rp.resolvePythonBinary();
    if (!py) return; // environment without Python >= 3.9

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a11-pycsv-'));
    tmpDirs.push(outDir);
    const res = spawnSync(
      process.execPath,
      [SCRIPT, '--project', 'pycsv', '--solution', '--fresh', '--root', outDir],
      { cwd: ROOT, encoding: 'utf8', timeout: 180000 }
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'reference-projects-report.json'), 'utf8'));
    const proj = report.results.find((r) => r.name === 'pycsv');
    assert.ok(proj, 'pycsv result missing from report');
    assert.equal(proj.ok, true, JSON.stringify(proj, null, 2));
    assert.equal(proj.phases.length, 2);
    for (const ph of proj.phases) {
      assert.equal(ph.closed, true, `phase ${ph.phase} did not close`);
      assert.equal(ph.oracle.ok, true, `phase ${ph.phase} oracle failed: ${JSON.stringify(ph.oracle)}`);
      assert.equal(ph.false_green, false);
    }
    const far = proj.scorecard.metrics.find((m) => m.metric === 'first_attempt_rate');
    assert.ok(far && far.value === 1, `expected first_attempt_rate === 1, got ${JSON.stringify(far)}`);
  });
});
