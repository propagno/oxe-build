'use strict';

// 1.21.2 (G36 part 2): a frozen test runs against a stub, repeated, before any paid attempt depends on it — a hang or
// a flaky result is an error (FIRST), and a test that passes without the implementation is a warning.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const pre = require('../bin/lib/oxe-test-precheck.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content, 'utf8'); };

const HANG = "const t = require('node:test');\nt('A1 opens the notice', () => { setInterval(() => {}, 1000); });\n";
const FLAKY = "const t = require('node:test');\nconst fs = require('fs');\nconst n = fs.existsSync('.count') ? Number(fs.readFileSync('.count', 'utf8')) : 0;\nfs.writeFileSync('.count', String(n + 1));\nt('A2 counts the live region once', () => { if (n % 2) throw new Error('two'); });\n";
const ALWAYS = "const t = require('node:test');\nt('A3 shows the label', () => {});\n";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'README.md', 'x\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@oxe.dev');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  // the frozen tests are NOT committed yet: the precheck copies them from the working tree
  write(dir, 'tests/a1.test.js', HANG);
  write(dir, 'tests/a2.test.js', FLAKY);
  write(dir, 'tests/a3.test.js', ALWAYS);
  return dir;
}

const DOC = {
  tasks: [{ id: 'T1', acceptance: ['A1', 'A2', 'A3'], files: ['src/x.js'] }, { id: 'T9', acceptance: ['A9'], done: true }],
  acceptance_tests: [
    { criterion: 'A1', task: 'T1', files: ['tests/a1.test.js'], command: 'node --test tests/a1.test.js', proves: ['A1 opens the notice'] },
    { criterion: 'A2', task: 'T1', files: ['tests/a2.test.js'], command: 'node --test tests/a2.test.js', proves: ['A2 counts the live region once'] },
    { criterion: 'A3', task: 'T1', files: ['tests/a3.test.js'], command: 'node --test tests/a3.test.js', proves: ['A3 shows the label'] },
    { criterion: 'A9', files: ['tests/a9.test.js'], command: 'node --test tests/a9.test.js' },
  ],
};

describe('G36 part 2: precheck of the frozen tests (FIRST)', () => {
  it('a hang and a flaky result are errors; passing without the implementation is a warning; done tasks are skipped', () => {
    const dir = project();
    const r = pre.precheck(dir, DOC, null, { runs: 2, timeoutMs: 4000 });
    assert.equal(r.ran, 3, 'only the pending task tests');
    const by = Object.fromEntries(r.findings.map((f) => [f.criterion, f]));
    assert.equal(by.A1.kind, 'precheck_hang');
    assert.equal(by.A2.kind, 'precheck_flaky');
    assert.equal(by.A3.kind, 'precheck_passes_on_stub');
    const msg = pre.messages(r);
    assert.equal(msg.errors.length, 2);
    assert.equal(msg.warnings.length, 1);
    // the temporary worktree is gone, the project tree untouched
    assert.deepEqual(fs.existsSync(path.join(dir, '.oxe', 'precheck-ws')) ? fs.readdirSync(path.join(dir, '.oxe', 'precheck-ws')) : [], []);
    assert.equal(fs.existsSync(path.join(dir, '.count')), false, 'the runs happen in the temporary worktree');
  });
});

describe('G30b part 2: the suites the G30 found run once at HEAD', () => {
  it('already red or hanging at HEAD is a warning naming the suite (not the task red)', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-ws-'));
    dirs.push(wsDir);
    const workspace = { create: () => wsDir, dispose: () => {} };
    const run = (cwd, command) => (/red/.test(command) ? { code: 1, timedOut: false, output: 'not ok 1 - x' } : /hang/.test(command) ? { code: null, timedOut: true, output: '' } : { code: 0, timedOut: false, output: 'ok 1 - x' });
    const r = pre.precheck(wsDir, { tasks: [], acceptance_tests: [] }, null, { workspace, run, suites: [
      { file: 'tests/red.test.ts', task: 'T13', command: 'vitest run red' },
      { file: 'tests/hang.test.ts', task: 'T13', command: 'vitest run hang' },
      { file: 'tests/ok.test.ts', task: 'T13', command: 'vitest run ok' },
    ] });
    const kinds = r.findings.map((f) => `${f.id}:${f.kind}`).sort();
    assert.deepEqual(kinds, ['tests/hang.test.ts:suite_hangs_at_head', 'tests/red.test.ts:suite_red_at_head']);
    assert.ok(pre.messages(r).warnings.every((w) => /^T13: suíte tests\/(red|hang)\.test\.ts: suite_/.test(w)));
  });
});

describe('precheck with remote-verify commands (OxeSpace 15/11, OxeChat sessions)', () => {
  it('a remote command runs once with a 30 min ceiling, and its timeout is a warning, never a hang; --precheck-timeout wins', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-remote-'));
    dirs.push(wsDir);
    const workspace = { create: () => wsDir, dispose: () => {} };
    const calls = [];
    const run = (cwd, command, timeoutMs) => { calls.push(timeoutMs); return { code: null, timedOut: true, output: '' }; };
    const doc = { tasks: [{ id: 'T7', acceptance: ['A7'] }], acceptance_tests: [{ criterion: 'A7', task: 'T7', files: [], command: 'node ../deps/scripts/remote-verify.mjs -- node scripts/test-electron.mjs a7.test.ts', proves: ['x'] }] };
    const r = pre.precheck(wsDir, doc, null, { workspace, run, runs: 2 });
    assert.deepEqual(calls, [30 * 60_000], 'one run, 30 min');
    assert.equal(r.findings[0].kind, 'precheck_timeout_remote');
    assert.equal(r.findings[0].level, 'warn');
    calls.length = 0;
    pre.precheck(wsDir, doc, null, { workspace, run, timeoutMs: 45 * 60_000 });
    assert.deepEqual(calls, [45 * 60_000]);
  });
});
