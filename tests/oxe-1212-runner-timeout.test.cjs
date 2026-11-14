'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rt = require('../lib/runtime');

// 1.21.2 — oxespace-152-code F1 (run oxe-run-mwfftxes-lwhrew): `runtime verify` failed check-a1 as "[HIGH] …
// deterministic" on one vitest "Test timed out in 5000ms" (no assertion failed); the same file had just passed in the
// governance gate of the same verify, and alone ran 28/28 in 4.2 s. A runner timeout is load, not the code.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rto-')); dirs.push(d); return d; };

const VITEST_TIMEOUT = [
  ' FAIL  tests/design-lint.test.ts > design lint > hand-made spinners (lucide Loader2) do not grow',
  'Error: Test timed out in 5000ms.',
  'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
  ' Test Files  1 failed (1)',
  '      Tests  1 failed | 27 passed (28)',
].join('\n');

/** A check that fails with a runner timeout on its first run(s) and passes afterwards. */
function flakyCheck(dir, failRuns, output = VITEST_TIMEOUT) {
  const script = path.join(dir, 'check.js');
  fs.writeFileSync(path.join(dir, 'out.txt'), output);
  fs.writeFileSync(script, [
    "const fs = require('fs'); const path = require('path');",
    "const c = path.join(__dirname, 'count'); const n = (fs.existsSync(c) ? Number(fs.readFileSync(c, 'utf8')) : 0) + 1;",
    'fs.writeFileSync(c, String(n));',
    `if (n <= ${failRuns}) { console.log(fs.readFileSync(path.join(__dirname, 'out.txt'), 'utf8')); process.exit(1); }`,
    "console.log(' Test Files  1 passed (1)\\n      Tests  28 passed (28)');",
  ].join('\n'));
  return { id: 'check-a1', acceptance_ref: 'A1', type: 'custom', command: `node "${script}"` };
}
const runs = (dir) => Number(fs.readFileSync(path.join(dir, 'count'), 'utf8'));

describe('runner timeout is load, not a deterministic failure', () => {
  it('isRunnerTimeoutOnly: a timeout with no failed assertion yes; with an assertion, or no timeout, no', () => {
    assert.equal(rt.isRunnerTimeoutOnly(VITEST_TIMEOUT), true);
    assert.equal(rt.isRunnerTimeoutOnly('Error: Timeout of 2000ms exceeded. For async tests and hooks, ensure "done()" is called'), true);
    assert.equal(rt.isRunnerTimeoutOnly('thrown: "Exceeded timeout of 5000 ms for a test.'), true);
    assert.equal(rt.isRunnerTimeoutOnly(`${VITEST_TIMEOUT}\nAssertionError: expected 3 to be 2`), false);
    assert.equal(rt.isRunnerTimeoutOnly('AssertionError: expected [ 1 ] to deeply equal []'), false);
    assert.equal(rt.isRunnerTimeoutOnly('FAIL tests/x.test.ts > resets the timeout setting'), false);
  });

  it('the check is run once more by itself; green on the rerun passes, with both outcomes kept', async () => {
    const dir = tmp();
    const r = await rt.runCheck(flakyCheck(dir, 1), dir);
    assert.equal(runs(dir), 2, 'ran twice');
    assert.equal(r.status, 'pass');
    assert.equal(r.rerun.reason, 'runner_timeout');
    assert.equal(r.rerun.first.status, 'fail');
    assert.equal(r.rerun.status, 'pass');
    const m = rt.buildManifest('run-1', [r]);
    assert.equal(m.summary.all_passed, true);
    assert.equal(m.checks[0].failure_class, null);
    assert.equal(m.checks[0].rerun.first.status, 'fail', 'the manifest keeps the first outcome');
    const md = new rt.ProjectionEngine().projectVerify({ run: null }, [], [r], m, rt.buildRiskLedger('run-1', m), null);
    assert.match(md, /\| check-a1 \| A1 \| .+ → .+ \(timeout do runner; rodou de novo sozinho\) \| \d+ms \+ \d+ms \|/);
  });

  it('timed out twice: still a failure, classified timeout (low), never deterministic (high)', async () => {
    const dir = tmp();
    const r = await rt.runCheck(flakyCheck(dir, 2), dir);
    assert.equal(runs(dir), 2, 'one rerun only');
    assert.equal(r.status, 'fail');
    assert.equal(rt.classifyFailure(r), 'timeout');
    const m = rt.buildManifest('run-1', [r], { profile: 'critical' });
    assert.equal(m.summary.all_passed, false);
    const ledger = rt.buildRiskLedger('run-1', m);
    assert.ok(!ledger.risks.some((x) => x.failure_class === 'deterministic' || x.severity === 'high'), JSON.stringify(ledger.risks));
  });

  it('a real assertion failure is not rerun and stays deterministic', async () => {
    const dir = tmp();
    const r = await rt.runCheck(flakyCheck(dir, 5, 'FAIL tests/a.test.ts > a\nAssertionError: expected 3 to be 2'), dir);
    assert.equal(runs(dir), 1, 'no rerun');
    assert.equal(r.rerun, undefined);
    assert.equal(rt.classifyFailure(r), 'deterministic');
  });
});
