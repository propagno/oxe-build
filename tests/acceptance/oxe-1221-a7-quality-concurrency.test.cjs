'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'quality-check.cjs');

describe('A7 (OB-31 / OXB-221-07): quality-check test-root --concurrency, --timings, --shard and --dry-run', () => {
  it('exports pure helpers without side effects when required', () => {
    const qc = require(SCRIPT);
    assert.equal(typeof qc.selectTestShard, 'function');
    assert.equal(typeof qc.resolveTestConcurrency, 'function');
    assert.equal(typeof qc.parseSlowSuitesFromTap, 'function');
    assert.equal(typeof qc.parseTestRootArgs, 'function');

    const cExplicit = qc.resolveTestConcurrency(6, { env: {}, platform: 'win32', parallelism: 16 });
    assert.equal(cExplicit, 6);
    const cEnv = qc.resolveTestConcurrency(null, { env: { OXE_TEST_CONCURRENCY: '3' }, platform: 'win32', parallelism: 16 });
    assert.equal(cEnv, 3);
    const cWinDefault = qc.resolveTestConcurrency(null, { env: {}, platform: 'win32', parallelism: 16 });
    assert.ok(cWinDefault >= 1 && cWinDefault <= 4, `Windows default concurrency must be bounded <= 4, got ${cWinDefault}`);

    const sampleTap = [
      'TAP version 13',
      'ok 1 - tests/fast.test.cjs',
      '  ---',
      '  duration_ms: 42.5',
      '  ...',
      'ok 2 - tests/slowest.test.cjs',
      '  ---',
      '  duration_ms: 8120.4',
      '  ...',
      'ok 3 - tests/medium.test.cjs',
      '  ---',
      '  duration_ms: 950.1',
      '  ...',
    ].join('\n');
    const slowest = qc.parseSlowSuitesFromTap(sampleTap, 2);
    assert.equal(slowest.length, 2);
    assert.equal(slowest[0].name, 'tests/slowest.test.cjs');
    assert.equal(slowest[0].duration_ms, 8120.4);
    assert.equal(slowest[1].name, 'tests/medium.test.cjs');
  });

  it('shards 100% of root test suites deterministically with 0 overlap/omission in < 2s --dry-run and rejects invalid shard', () => {
    const allSuites = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.test.cjs')) allSuites.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    };
    walk(path.join(ROOT, 'tests'));
    allSuites.sort();
    assert.ok(allSuites.length >= 250, `expected >= 250 test suites, got ${allSuites.length}`);

    const seen = new Set();
    const collected = [];
    for (let k = 1; k <= 4; k += 1) {
      const t0 = Date.now();
      const res = spawnSync(process.execPath, [SCRIPT, 'test-root', '--shard', `${k}/4`, '--concurrency', '4', '--dry-run'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      const elapsed = Date.now() - t0;
      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(elapsed < 2000, `dry-run shard ${k}/4 took ${elapsed}ms (>= 2000ms)`);
      assert.match(res.stdout, /--test-concurrency=4/);
      const matchedSuites = res.stdout.match(/tests\/[^\s]+\.test\.cjs/g) || [];
      assert.ok(matchedSuites.length > 0, `shard ${k}/4 must contain suites`);
      for (const s of matchedSuites) {
        assert.equal(seen.has(s), false, `duplicate suite across shards: ${s}`);
        seen.add(s);
        collected.push(s);
      }
    }
    collected.sort();
    assert.deepEqual(collected, allSuites, 'union of 4 shards must equal 100% of tests/**/*.test.cjs');

    const invalid = spawnSync(process.execPath, [SCRIPT, 'test-root', '--shard', '5/4', '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(invalid.status, 2, `invalid shard must exit 2, got ${invalid.status}`);
  });
});
