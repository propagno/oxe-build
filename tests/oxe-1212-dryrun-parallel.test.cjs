'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dryRunVerifyCommands } = require('../bin/lib/oxe-verify-dryrun.cjs');
const { runParallel } = require('../bin/lib/oxe-parallel-run.cjs');

// 1.21.2 - OXB-095: dry-verify commands of different tasks run concurrently, bounded by parallel.max and min_free_mb.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-par-'));
  dirs.push(dir);
  // sleeps 1s, then fails naming its missing target (the right red)
  fs.writeFileSync(path.join(dir, 'slow.js'), "setTimeout(() => { console.error('Error: Cannot find module ./src/' + process.argv[2] + '.ts'); process.exit(1); }, 1500);\n");
  return dir;
}
const plan = { tasks: ['alpha', 'bravo', 'charlie'].map((n, i) => ({ id: `T${i + 1}`, files: [`src/${n}.ts`], verifyCommand: `node slow.js ${n}` })) };

describe('OXB-095: parallel dry-verify', () => {
  it('3 commands of 1.5s with max 3 take well under the 4.5s of serial; verdicts are the same as serial, in plan order', () => {
    const dir = project();
    const lines = [];
    const t0 = Date.now();
    const r = dryRunVerifyCommands(dir, plan, { parallel: { max: 3, minFreeMb: 0 }, onProgress: (l) => lines.push(l) });
    const ms = Date.now() - t0;
    assert.ok(ms < 4300, // < serial 4500ms; 3800 flaked under a loaded suite (3890ms)
      `took ${ms}ms (serial would be ≥ 4500ms)`);
    assert.deepEqual(r.results.map((x) => [x.task, x.verdict]), [['T1', 'missing_target'], ['T2', 'missing_target'], ['T3', 'missing_target']]);
    assert.ok(lines.some((l) => /dry-verify paralelo: 3 comando\(s\), até 3 por vez/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /\(paralelo\)$/.test(l)));
  });

  it('max 1 (or no parallel option) keeps the serial path', () => {
    const dir = project();
    const t0 = Date.now();
    dryRunVerifyCommands(dir, plan, { parallel: { max: 1 } });
    assert.ok(Date.now() - t0 >= 4400);
  });

  it('runParallel: results by id, exit codes, timeout, and the memory gate never starves the first job', () => {
    const res = runParallel([
      { id: 0, command: 'node -e "process.exit(0)"' },
      { id: 1, command: 'node -e "process.exit(3)"' },
      { id: 2, command: 'node -e "setTimeout(()=>{},5000)"', timeoutMs: 500 },
    ], { max: 2, minFreeMb: 10 * 1024 * 1024 });
    assert.deepEqual(res.map((r) => [r.id, r.code, r.timedOut]), [[0, 0, false], [1, 3, false], [2, null, true]]);
  });
});
