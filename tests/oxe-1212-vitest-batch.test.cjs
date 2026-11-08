'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vb = require('../bin/lib/oxe-vitest-batch.cjs');
const { dryRunVerifyCommands } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21.2 — OXB-094: F2's dry-verify ran 318 commands (~2h), most `vitest run <one file>` paying vitest's start-up
// each time. Same runner + flags → one process; results still per file.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A fake `vitest` on PATH: logs each invocation; writes a JSON report (vitest's shape) when asked. */
function fakeVitest(dir) {
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  const js = path.join(bin, 'vitest.js');
  fs.writeFileSync(js, `
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2).filter((a) => a !== 'run');
fs.appendFileSync(path.join(process.cwd(), 'vitest-calls.log'), args.join(' ') + '\\n');
const files = args.filter((a) => !a.startsWith('-'));
const out = (args.find((a) => a.startsWith('--outputFile.json=')) || '').split('=')[1];
const results = files.map((f) => {
  const src = fs.readFileSync(f, 'utf8');
  if (src.includes('MISSING')) return { name: path.resolve(f), status: 'failed', message: "Cannot find module '../src/" + path.basename(f).split('.')[0] + ".ts'", assertionResults: [] };
  if (src.includes('RED')) return { name: path.resolve(f), status: 'failed', message: '', assertionResults: [{ status: 'failed', title: 'x', failureMessages: ['AssertionError: expected 1 to be 2'] }] };
  return { name: path.resolve(f), status: 'passed', message: '', assertionResults: [{ status: 'passed', title: 'ok', failureMessages: [] }] };
});
if (out) fs.writeFileSync(out, JSON.stringify({ testResults: results }));
const bad = results.filter((r) => r.status !== 'passed');
for (const r of bad) console.error('FAIL ' + r.name + '\\n' + (r.message || r.assertionResults.map((a) => a.failureMessages.join('\\n')).join('\\n')));
process.exit(bad.length ? 1 : 0);
`);
  fs.writeFileSync(path.join(bin, 'vitest.cmd'), `@node "${js}" %*\r\n`);
  fs.writeFileSync(path.join(bin, 'vitest'), `#!/bin/sh\nexec node "${js}" "$@"\n`, { mode: 0o755 });
  return bin;
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vb-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, 'tests', `${n}.test.ts`), 'MISSING\n');
  fs.writeFileSync(path.join(dir, 'tests', 'd.test.ts'), 'RED\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'd.ts'), 'export const d = 1;\n');
  const bin = fakeVitest(dir);
  return { dir, bin };
}
const calls = (dir) => fs.readFileSync(path.join(dir, 'vitest-calls.log'), 'utf8').trim().split('\n');

describe('OXB-094: vitest batching', () => {
  it('parses plain vitest segments; anything unusual is left alone', () => {
    assert.deepEqual(vb.parseVitest('npx vitest run tests/a.test.ts --reporter=verbose'), { prefix: 'npx vitest run', flags: ['--reporter=verbose'], files: ['tests/a.test.ts'], key: 'npx vitest run --reporter=verbose' });
    assert.equal(vb.parseVitest('vitest run tests/a.test.ts -t "um nome"'), null, 'quoted');
    assert.equal(vb.parseVitest('vitest tests/a.test.ts'), null, 'watch mode');
    assert.equal(vb.parseVitest('vitest run somefilter'), null, 'not a path');
    assert.equal(vb.parseVitest('npm test'), null);
  });

  it('a task verify merges its vitest segments per runner+flags and keeps the rest in place', () => {
    assert.equal(
      vb.batchVerifyCommand('npx vitest run tests/a.test.ts && npm run typecheck && npx vitest run tests/b.test.ts && npx vitest run tests/c.test.ts --reporter=verbose'),
      'npx vitest run tests/a.test.ts tests/b.test.ts && npm run typecheck && npx vitest run tests/c.test.ts --reporter=verbose',
    );
    assert.equal(vb.batchVerifyCommand('npx vitest run tests/a.test.ts'), 'npx vitest run tests/a.test.ts');
  });

  it('dry-verify: one process for the 4 files of 3 tasks, verdicts per segment as before', () => {
    const { dir, bin } = project();
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    try {
      const lines = [];
      const r = dryRunVerifyCommands(dir, { tasks: [
        { id: 'T1', files: ['src/a.ts', 'src/b.ts'], verifyCommand: 'vitest run tests/a.test.ts && vitest run tests/b.test.ts' },
        { id: 'T2', files: ['src/c.ts'], verifyCommand: 'vitest run tests/c.test.ts' },
        { id: 'T3', files: ['src/d.ts'], verifyCommand: 'vitest run tests/d.test.ts' },
      ] }, { onProgress: (l) => lines.push(l) });
      assert.deepEqual(calls(dir).length, 1, calls(dir).join('\n'));
      assert.match(calls(dir)[0], /tests\/a\.test\.ts tests\/b\.test\.ts tests\/c\.test\.ts tests\/d\.test\.ts --reporter=json --outputFile\.json=/);
      assert.deepEqual(r.results.map((x) => [x.task, x.verdict]), [['T1', 'missing_target'], ['T2', 'missing_target'], ['T3', 'assertion_red']]);
      assert.ok(lines.some((l) => /\[lote\] vitest run · 4 arquivo\(s\) de T1, T2, T3/.test(l)), lines.join('\n'));
      assert.ok(lines.some((l) => /\[1\/4\] T1 vitest run tests\/a\.test\.ts \.\.\. ok \(lote\)/.test(l)));
      // without batching: one process per segment (the old behavior, still available)
      fs.rmSync(path.join(dir, 'vitest-calls.log'));
      dryRunVerifyCommands(dir, { tasks: [{ id: 'T2', files: ['src/c.ts'], verifyCommand: 'vitest run tests/c.test.ts && vitest run tests/a.test.ts' }] }, { batch: false });
      assert.equal(calls(dir).length, 2);
    } finally {
      process.env.PATH = prev;
    }
  });
});

describe('OXB-094/096 (F2 data): npm run <script> -- <files> batches; identical commands run once', () => {
  it('npm run test:electron -- <file> batches by script; lint/typecheck/build are never batched', () => {
    assert.equal(vb.batchVerifyCommand('npm run test:electron -- tests/x.test.ts && npm run test:electron -- tests/y.test.ts'), 'npm run test:electron -- tests/x.test.ts tests/y.test.ts');
    assert.equal(vb.parseVitest('npm run lint -- src/a.ts'), null);
    assert.equal(vb.parseVitest('npm run typecheck'), null);
  });

  it('dry-verify: `npm run typecheck` shared by 3 tasks runs once; each task is still classified on its own', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vb-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'tc.js'), "require('fs').appendFileSync('tc.log','x\\n'); console.error(\"error TS2307: Cannot find module './src/alpha'\"); process.exit(1);\n");
    const tasks = ['T1', 'T2', 'T3'].map((id) => ({ id, files: ['src/alpha.ts'], verifyCommand: 'node tc.js' }));
    const r = dryRunVerifyCommands(dir, { tasks });
    assert.equal(fs.readFileSync(path.join(dir, 'tc.log'), 'utf8').trim().split('\n').length, 1);
    assert.deepEqual(r.results.map((x) => x.verdict), ['missing_target', 'missing_target', 'missing_target']);
  });
});
