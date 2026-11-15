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
    // OxeSpace 15/11 (OxeQuery polish): the verdict so far lives in .oxe/precheck-last.json, finished at the end
    const last = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'precheck-last.json'), 'utf8'));
    assert.equal(last.finished, true);
    assert.equal(last.done, 3);
    assert.deepEqual(last.findings.map((f) => f.kind).sort(), ['precheck_flaky', 'precheck_hang', 'precheck_passes_on_stub']);
  });

  it('a process that dies mid-way leaves the partial verdict: finished false, the entries done so far (and a progress line each)', () => {
    const dir = project();
    let calls = 0;
    const lines = [];
    const progressPath = path.join(dir, '.oxe', 'precheck-last.json');
    // the third run "kills" the process: the first entry is done (2 runs), the second never finishes
    const run = () => { calls += 1; if (calls === 3) throw new Error('killed'); return { code: 1, output: 'not ok 1 - a\n', timedOut: false }; };
    const ws = { create: () => dir, dispose: () => {} };
    assert.throws(() => pre.precheck(dir, DOC, null, { runs: 2, run, workspace: ws, progressPath, onProgress: (l) => lines.push(l) }), /killed/);
    const last = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    assert.equal(last.finished, false);
    assert.equal(last.done, 1);
    assert.equal(last.total, 3);
    assert.ok(lines.some((l) => /^precheck 1\/3: /.test(l)), lines.join(' | '));
    // cross-review 15/11: the entry already approved is cached although the process died (flushed in finally)
    const cache = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'precheck-cache.json'), 'utf8'));
    assert.equal(Object.keys(cache).length, 1, JSON.stringify(cache));
    // a plain plan lint (auto mode) never overwrites that partial explicit verdict: it writes its own file
    pre.precheck(dir, DOC, null, { mode: 'auto', runs: 2, run: () => ({ code: 1, output: 'not ok 1 - a\n', timedOut: false }), workspace: ws, progressPath, suites: [{ file: 'tests/s.test.js', task: 'T1', command: 'x' }], onProgress: (l) => lines.push(l) });
    assert.equal(JSON.parse(fs.readFileSync(progressPath, 'utf8')).finished, false, 'explicit partial kept');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'precheck-auto-last.json'), 'utf8')).mode, 'auto');
    assert.ok(lines.some((l) => /^precheck \d+\/\d+: suíte tests\/s\.test\.js — suite_red_at_head/.test(l)), 'a progress line per suite too');
    assert.ok(!fs.readdirSync(path.join(dir, '.oxe')).some((f) => f.endsWith('.tmp')), 'no temp file left');
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
  it('a remote command runs once with a 30 min ceiling, reports the timeout reason in output/notes, and --precheck-timeout wins', () => {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-remote-'));
    dirs.push(wsDir);
    const workspace = { create: () => wsDir, dispose: () => {} };
    const calls = [];
    const progress = [];
    const run = (cwd, command, timeoutMs) => { calls.push(timeoutMs); return { code: null, timedOut: true, output: '' }; };
    const doc = { tasks: [{ id: 'T7', acceptance: ['A7'] }], acceptance_tests: [{ criterion: 'A7', task: 'T7', files: [], command: 'node ../deps/scripts/remote-verify.mjs -- node scripts/test-electron.mjs a7.test.ts', proves: ['x'] }] };
    const r = pre.precheck(wsDir, doc, null, { workspace, run, runs: 2, onProgress: (line) => progress.push(line) });
    assert.deepEqual(calls, [30 * 60_000], 'one run, 30 min');
    assert.equal(r.findings[0].kind, 'precheck_timeout_remote');
    assert.equal(r.findings[0].level, 'warn');
    assert.match(r.findings[0].why, /remote-verify detectado/);
    assert.ok(r.notes.some((n) => /remote-verify detectado.*30 min/i.test(n)), `missing remote-verify reason in notes: ${JSON.stringify(r.notes)}`);
    assert.ok(progress.some((p) => /remote-verify detectado.*30 min/i.test(p)), `missing remote-verify reason in progress: ${JSON.stringify(progress)}`);
    assert.equal(r.details[0].remote, true);
    assert.equal(r.details[0].runs, 1);
    assert.match(r.details[0].timeout_reason, /remote-verify detectado/);

    // Even when the remote-verify command finishes red (normal case, no timeout), the reason is still emitted in notes/details
    calls.length = 0;
    const redOk = pre.precheck(wsDir, doc, null, {
      workspace,
      run: (_cwd, _cmd, timeoutMs) => { calls.push(timeoutMs); return { code: 1, timedOut: false, output: 'not ok 1 - x' }; },
      runs: 3,
    });
    assert.deepEqual(calls, [30 * 60_000]);
    assert.equal(redOk.findings.length, 0);
    assert.ok(redOk.notes.some((n) => /A7 \(T7\): remote-verify detectado.*30 min/.test(n)));

    calls.length = 0;
    const overridden = pre.precheck(wsDir, doc, null, { workspace, run, timeoutMs: 45 * 60_000 });
    assert.deepEqual(calls, [45 * 60_000]);
    assert.match(overridden.details[0].timeout_reason, /--precheck-timeout \(2700 s\)/);
  });

  it('CLI --precheck-timeout <s> sets custom timeout in seconds, prints reason on stdout, and rejects invalid values', () => {
    const cli = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-cli-timeout-'));
    dirs.push(dir);
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | slow | node |\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, plan_lint_preflight: false }));
    write(dir, 'tests/slow.test.js', "setTimeout(() => process.exit(1), 2500);\n");
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'slow', wave: 1, files: ['src/x.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(1)"'] } }],
      acceptance_tests: [{ criterion: 'A1', task: 'T1', files: ['tests/slow.test.js'], command: 'node tests/slow.test.js' }],
    }, null, 2));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@oxe.dev');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    // Invalid --precheck-timeout rejected
    const bad = spawnSync(process.execPath, [cli, 'plan', 'lint', '--precheck-timeout', '0', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Valor inválido para --precheck-timeout/);

    // 1 second timeout triggers precheck_hang with "--precheck-timeout (1 s)" in output
    const shortRun = spawnSync(process.execPath, [cli, 'plan', 'lint', '--no-preflight', '--precheck-timeout', '1', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(shortRun.status, 1);
    assert.match(shortRun.stdout, /precheck_hang/);
    assert.match(shortRun.stdout, /--precheck-timeout \(1 s\)/);
  });
});

describe('default precheck in plan lint when frozen tests are new (--no-precheck to opt out)', () => {
  const op = require('../bin/lib/oxe-operational.cjs');
  const cli = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

  function makeLintProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-precheck-default-'));
    dirs.push(dir);
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | old | node |\n| A2 | new | node |\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, plan_lint_preflight: false }));
    write(dir, 'tests/old.test.js', "const t = require('node:test');\nt('A1 fails cleanly without impl', () => { throw new Error('missing'); });\n");
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [
        { id: 'T1', title: 'old task', wave: 1, files: ['src/old.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(1)"'] } },
        { id: 'T2', title: 'new task', wave: 1, files: ['src/new.js'], acceptance: ['A2'], verify: { commands: ['node -e "process.exit(1)"'] } },
      ],
      acceptance_tests: [
        { criterion: 'A1', task: 'T1', files: ['tests/old.test.js'], command: 'node --test tests/old.test.js', proves: ['A1 fails cleanly without impl'] },
      ],
    }, null, 2));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@oxe.dev');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'commit old frozen test');
    return dir;
  }

  it('skips precheck by default when no frozen test is new, runs automatically on new frozen tests, and honors --no-precheck', () => {
    const dir = makeLintProject();

    // 1. All frozen tests already committed at HEAD → default plan lint does NOT run precheck
    const noNew = op.runtimePlanLint(dir, null, { preflight: false });
    assert.equal(noNew.precheck, undefined, 'precheck must not run when all frozen tests are already committed at HEAD');

    // 2. Add a new uncommitted frozen test (flaky) to the plan → default plan lint runs precheck ONLY on the new test!
    write(dir, 'tests/new-flaky.test.js', FLAKY);
    const planWithNew = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planWithNew.acceptance_tests.push({
      criterion: 'A2',
      task: 'T2',
      files: ['tests/new-flaky.test.js'],
      command: 'node --test tests/new-flaky.test.js',
      proves: ['A2 counts the live region once'],
    });
    write(dir, '.oxe/PLAN.json', JSON.stringify(planWithNew, null, 2));

    const autoCli = spawnSync(process.execPath, [cli, 'plan', 'lint', '--no-preflight', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(autoCli.status, 1, `expected default plan lint to fail on flaky new frozen test: ${autoCli.stdout}\n${autoCli.stderr}`);
    assert.match(autoCli.stdout, /precheck padrão ativado: 1 teste\(s\) congelado\(s\) novo\(s\)/);
    assert.match(autoCli.stdout, /precheck_flaky/);

    const autoJsonRes = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(autoJsonRes.precheck, 'runtimePlanLint should populate result.precheck');
    assert.equal(autoJsonRes.precheck.mode, 'auto');
    assert.equal(autoJsonRes.precheck.ran, 1, 'only the 1 new frozen test should run in auto mode');

    // 3. --no-precheck disables the default precheck even when new frozen tests exist
    const optedOut = spawnSync(process.execPath, [cli, 'plan', 'lint', '--no-preflight', '--no-precheck', '--json', dir], { encoding: 'utf8', windowsHide: true });
    assert.equal(optedOut.status, 0, `expected --no-precheck to skip precheck: ${optedOut.stdout}\n${optedOut.stderr}`);
    const parsedOptOut = JSON.parse(optedOut.stdout);
    assert.equal(parsedOptOut.precheck, undefined);
  });

  it('also detects committed frozen tests added after phase.base_commit as new until locked by an active run', () => {
    const dir = makeLintProject();
    const baseSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({
      schema_version: 1,
      name: 'p',
      active_phase: 'F1',
      phases: [{ id: 'F1', title: 'Phase 1', status: 'planning', base_commit: baseSha, acceptance: ['A1', 'A2'] }],
    }, null, 2));

    // Planner writes and commits a new frozen test on the phase branch after base_commit
    write(dir, 'tests/committed-in-phase.test.js', ALWAYS);
    const planDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDoc.phase = 'F1';
    planDoc.acceptance_tests.push({
      criterion: 'A2',
      task: 'T2',
      files: ['tests/committed-in-phase.test.js'],
      command: 'node --test tests/committed-in-phase.test.js',
      proves: ['A3 shows the label'],
    });
    write(dir, '.oxe/PLAN.json', JSON.stringify(planDoc, null, 2));
    git(dir, 'add', 'tests/committed-in-phase.test.js');
    git(dir, 'commit', '-qm', 'test(F1): add A2 frozen test');

    const newOnes = pre.newFrozenAcceptance(dir, planDoc, { baseCommit: baseSha });
    assert.deepEqual(newOnes.map((e) => e.criterion), ['A2']);

    const lintRes = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(lintRes.precheck, 'committed test added after phase.base_commit triggers auto precheck');
    assert.equal(lintRes.precheck.mode, 'auto');
    assert.equal(lintRes.precheck.ran, 1);
    assert.ok(lintRes.warnings.some((w) => /precheck_passes_on_stub/.test(w)));
  });

  it('auto mode skips remote-verify commands without calling run or creating a worktree, and emits the CI guidance warning', () => {
    const dir = makeLintProject();
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | old | node |\n| A7 | remote e2e | node |\n');
    write(dir, 'tests/a7-remote.test.js', "const t = require('node:test');\nt('A7 e2e', () => { throw new Error('stub'); });\n");
    const planDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDoc.tasks[1] = { id: 'T2', title: 'remote task', wave: 1, files: ['src/new.js'], acceptance: ['A7'], verify: { commands: ['node -e "process.exit(1)"'] } };
    planDoc.acceptance_tests.push({
      criterion: 'A7',
      task: 'T2',
      files: ['tests/a7-remote.test.js'],
      command: 'node ../deps/scripts/remote-verify.mjs -- node scripts/test-electron.mjs tests/a7-remote.test.js',
      proves: ['A7 e2e'],
    });
    write(dir, '.oxe/PLAN.json', JSON.stringify(planDoc, null, 2));

    let wsCreated = 0;
    const calls = [];
    const workspace = {
      create: () => { wsCreated += 1; return dir; },
      dispose: () => {},
    };
    const run = (_cwd, _cmd, timeoutMs) => {
      calls.push(timeoutMs);
      return { code: 1, timedOut: false, output: 'not ok 1 - A7 e2e' };
    };

    const autoRes = op.runtimePlanLint(dir, null, {
      preflight: false,
      precheckWorkspace: workspace,
      precheckRun: run,
    });
    assert.equal(calls.length, 0, 'fake run must NOT be called in auto mode for remote-verify');
    assert.equal(wsCreated, 0, 'temporary worktree must NOT be created when only remote-verify entries exist');
    assert.equal(autoRes.precheck.mode, 'auto');
    assert.equal(autoRes.precheck.ran, 0);
    assert.equal(autoRes.precheck.skipped_remote, 1);
    assert.ok(
      autoRes.warnings.includes('precheck: A7 é remote-verify — pulado no modo padrão; rode plan lint --precheck-tests para checar contra o stub na CI'),
      `expected remote-verify skip warning, got: ${JSON.stringify(autoRes.warnings)}`
    );

    // Explicit mode (--precheck-tests) still runs remote-verify once with 30 min ceiling
    const explicitRes = op.runtimePlanLint(dir, null, {
      preflight: false,
      precheckTests: true,
      precheckWorkspace: workspace,
      precheckRun: run,
    });
    assert.equal(explicitRes.precheck.mode, 'explicit');
    assert.ok(calls.includes(30 * 60_000), `expected 30 min remote-verify run in explicit mode, got: ${JSON.stringify(calls)}`);
  });

  it('caches approved frozen test LF hashes in precheck-cache.json, skips unchanged files in auto mode, never caches findings, and ignores cache on --precheck-tests', () => {
    const dir = makeLintProject();
    const RED_CLEAN = "const t = require('node:test');\nt('A2 fails deterministically against stub', () => { throw new Error('not implemented'); });\n";
    write(dir, 'tests/new-red.test.js', RED_CLEAN);
    const planDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDoc.acceptance_tests.push({
      criterion: 'A2',
      task: 'T2',
      files: ['tests/new-red.test.js'],
      command: 'node --test tests/new-red.test.js',
      proves: ['A2 fails deterministically against stub'],
    });
    write(dir, '.oxe/PLAN.json', JSON.stringify(planDoc, null, 2));

    let wsCreated = 0;
    const calls = [];
    const workspace = {
      create: () => { wsCreated += 1; return dir; },
      dispose: () => {},
    };
    let mockOutput = 'not ok 1 - A2 fails deterministically against stub';
    const run = (_cwd, cmd, timeoutMs) => {
      calls.push({ cmd, timeoutMs });
      return { code: 1, timedOut: false, output: mockOutput };
    };

    // 1st plan lint (auto): runs 2 times, records LF sha256 in .oxe/precheck-cache.json
    const first = op.runtimePlanLint(dir, null, { preflight: false, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(calls.length, 2, 'first auto lint runs the new frozen test 2 times');
    assert.equal(first.precheck.ran, 1);
    assert.equal(first.precheck.cached, 0);
    const cachePath = path.join(dir, '.oxe', 'precheck-cache.json');
    assert.equal(fs.existsSync(cachePath), true, 'precheck-cache.json written alongside PLAN.json');
    const cachedJson = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.deepEqual(Object.keys(cachedJson), ['tests/new-red.test.js']);
    assert.equal(cachedJson['tests/new-red.test.js'].ok, true);
    assert.equal(cachedJson['tests/new-red.test.js'].hash, pre.sha256Lf(path.join(dir, 'tests/new-red.test.js')));
    assert.match(cachedJson['tests/new-red.test.js'].at, /^\d{4}-\d{2}-\d{2}T/);

    // 2nd plan lint without editing file (and even with CRLF line endings): fake run NOT called
    calls.length = 0;
    wsCreated = 0;
    write(dir, 'tests/new-red.test.js', RED_CLEAN.replace(/\n/g, '\r\n'));
    const second = op.runtimePlanLint(dir, null, { preflight: false, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(calls.length, 0, 'second auto lint must NOT call run when LF hash matches cache');
    assert.equal(wsCreated, 0, 'second auto lint must NOT create worktree when all entries hit cache');
    assert.equal(second.precheck.ran, 0);
    assert.equal(second.precheck.cached, 1);

    // --precheck-tests ignores cache and runs anyway
    calls.length = 0;
    const forced = op.runtimePlanLint(dir, null, { preflight: false, precheckTests: true, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(forced.precheck.mode, 'explicit');
    assert.equal(calls.length, 4, 'explicit --precheck-tests runs both A1 and A2 (2x each), ignoring cache');

    // Editing the frozen test invalidates hash match -> auto lint runs again
    calls.length = 0;
    write(dir, 'tests/new-red.test.js', `${RED_CLEAN}// edited\n`);
    const afterEdit = op.runtimePlanLint(dir, null, { preflight: false, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(calls.length, 2, 'editing frozen test triggers auto precheck again');
    assert.equal(afterEdit.precheck.ran, 1);

    // Editing into a test with a finding (passes_on_stub) does NOT cache ok: true, so the next lint repeats
    calls.length = 0;
    write(dir, 'tests/new-red.test.js', ALWAYS);
    mockOutput = 'ok 1 - A2 fails deterministically against stub';
    const withFinding = op.runtimePlanLint(dir, null, { preflight: false, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(calls.length, 2);
    assert.ok(withFinding.warnings.some((w) => /precheck_passes_on_stub/.test(w)));
    const cacheAfterFinding = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(cacheAfterFinding['tests/new-red.test.js'], undefined, 'finding must remove/exclude file from cache');

    calls.length = 0;
    op.runtimePlanLint(dir, null, { preflight: false, precheckWorkspace: workspace, precheckRun: run });
    assert.equal(calls.length, 2, 'unchanged file with prior finding must NOT be skipped on next lint');
  });
});
