'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtime = require('../../lib/runtime/index.js');
const verifyCache = require('../../bin/lib/oxe-verify-cache.cjs');

describe('A15 — Pool paralelo de regressão e cache incremental seguro no runtime verify (OXB-222-15)', () => {
  it('OXB-222-15: executeSuite runs independent checks concurrently with concurrency > 1 preserving deterministic order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a15-par-'));
    try {
      const logFile = path.join(dir, 'timings.ndjson');
      const workerFile = path.join(dir, 'worker.cjs');
      fs.writeFileSync(
        workerFile,
        [
          "'use strict';",
          "const fs = require('fs');",
          'const id = process.argv[2];',
          'const logFile = process.argv[3];',
          'const start = Date.now();',
          'setTimeout(() => {',
          '  fs.appendFileSync(logFile, JSON.stringify({ id, start, end: Date.now() }) + "\\n");',
          '  console.log("ok-" + id);',
          '}, 350);',
        ].join('\n'),
      );
      const suite = {
        checks: ['c1', 'c2', 'c3', 'c4'].map((id) => ({
          id,
          type: 'command',
          acceptance_ref: id.toUpperCase(),
          command: `node "${workerFile}" ${id} "${logFile}"`,
          evidence_type_expected: 'verification_summary',
          required: true,
        })),
        compiled_at: new Date().toISOString(),
        spec_hash: 's1',
        plan_hash: 'p1',
      };

      const executed = await runtime.executeSuite(suite, dir, {
        runId: 'r-par',
        workItemId: 'T1',
        concurrency: 4,
      });

      // Deterministic result ordering preserved
      assert.deepEqual(executed.results.map((r) => r.check_id), ['c1', 'c2', 'c3', 'c4']);
      assert.ok(executed.results.every((r) => r.status === 'pass'));

      // Proven concurrent overlap: at least two checks had overlapping [start, end] intervals
      const rows = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
      assert.equal(rows.length, 4);
      const maxStart = Math.max(...rows.map((r) => r.start));
      const minEnd = Math.min(...rows.map((r) => r.end));
      assert.ok(maxStart < minEnd, `expected overlapping execution intervals across 4 concurrent checks, got: ${JSON.stringify(rows)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-222-15: oxe-verify-cache reuses valid passing results by fingerprint, never caches failures, and invalidates on change', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a15-cache-'));
    try {
      const fp1 = 'tree-abc123';
      const fp2 = 'tree-def456';
      const check = {
        id: 'reg-F1-c1',
        type: 'command',
        acceptance_ref: 'A1',
        command: 'node -e "console.log(\'pass\')"',
        evidence_type_expected: 'verification_summary',
        required: true,
      };
      const passResult = {
        check_id: check.id,
        acceptance_ref: 'A1',
        status: 'pass',
        stdout: 'pass\n',
        stderr: '',
        exit_code: 0,
        duration_ms: 120,
        error: null,
        evidence_refs: [],
      };
      const failResult = { ...passResult, check_id: 'reg-F1-fail', status: 'fail', exit_code: 1, error: 'boom' };

      const cache = verifyCache.loadVerifyCache(dir);
      verifyCache.recordVerifyPass(cache, check, passResult, fp1);
      verifyCache.recordVerifyPass(cache, { ...check, id: 'reg-F1-fail' }, failResult, fp1);
      verifyCache.saveVerifyCache(dir, cache);

      const reloaded = verifyCache.loadVerifyCache(dir);
      // Pass hit on matching fingerprint
      const hit = verifyCache.lookupCachedPass(reloaded, check, fp1);
      assert.ok(hit, 'expected cache hit on same fingerprint');
      assert.equal(hit.status, 'pass');
      assert.equal(hit.cached, true);

      // Failure is NEVER cached
      assert.equal(verifyCache.lookupCachedPass(reloaded, { ...check, id: 'reg-F1-fail' }, fp1), null);

      // Fingerprint change invalidates cache
      assert.equal(verifyCache.lookupCachedPass(reloaded, check, fp2), null);

      // executeSuite reuses regressionCache without spawning the command (marker file is NOT created!)
      const marker = path.join(dir, 'should-not-run.txt');
      const cachedCheck = {
        id: 'reg-cached',
        type: 'command',
        acceptance_ref: 'A1',
        command: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"`,
        evidence_type_expected: 'verification_summary',
        required: true,
      };
      const cacheMap = new Map([
        ['reg-cached', { ...passResult, check_id: 'reg-cached', cached: true, duration_ms: 0 }],
      ]);
      const suite = { checks: [cachedCheck], compiled_at: new Date().toISOString(), spec_hash: 's', plan_hash: 'p' };
      const executed = await runtime.executeSuite(suite, dir, {
        runId: 'r-cache',
        workItemId: 'T1',
        concurrency: 2,
        regressionCache: cacheMap,
      });
      assert.equal(executed.results[0].status, 'pass');
      assert.equal(executed.results[0].cached, true);
      assert.equal(fs.existsSync(marker), false, 'cached check must not spawn command');

      // Verify runRuntimeVerify wires verify.concurrency and oxe-verify-cache
      const oxeOp = require('../../bin/lib/oxe-operational.cjs');
      assert.equal(typeof oxeOp.runRuntimeVerify, 'function');
      const opSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'lib', 'oxe-operational.cjs'), 'utf8');
      assert.match(opSrc, /oxe-verify-cache\.cjs/);
      assert.match(opSrc, /concurrency/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
