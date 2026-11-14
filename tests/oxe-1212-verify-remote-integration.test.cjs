'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — runtime verify with verify.remote against a FAKE CI: the heavy check leaves the machine, a red job fails its
// criterion with the link, `where: "both"` red only in the CI is `ci_only`, and below verify.min_free_mb no heavy
// check runs here.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const testFile = (title) => `const { test } = require('node:test');\ntest(${JSON.stringify(title)}, () => {});\n`;

function project(config, acceptance) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vri-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A8 | a tinta | manual |\n| A9 | o fluxo ponta a ponta | e2e |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  const plan = {
    schema_version: 1,
    tasks: [{ id: 'T1', title: 'tinta', wave: 1, files: ['src/tint.js'], acceptance: ['A8', 'A9'], verify: { commands: ['node -e "process.exit(0)"'] } }],
    acceptance_tests: acceptance,
  };
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, ...config }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'a8.test.js'), testFile('a8'));
  fs.writeFileSync(path.join(dir, 'test', 'e2e.spec.js'), testFile('e2e'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const writer = (dir) => ({
  async execute() {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'tint.js'), 'module.exports = 1;\n');
    return { success: true, failure_class: null, evidence: ['src/tint.js'], output: 'ok', completed_by: 'finish_task' };
  },
});

/** Fake gh/git: a green run already on the commit, with the given job conclusions. */
function fakeCi(jobs) {
  const calls = [];
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const spawn = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const a = args.join(' ');
    if (cmd === 'gh' && a === 'auth status') return ok();
    if (cmd === 'git' && a === 'rev-parse --abbrev-ref HEAD') return ok('feat/f1\n');
    if (cmd === 'git' && a === 'rev-parse HEAD') return ok('feedbeef\n');
    if (cmd === 'gh' && args[0] === 'api') return ok('false');
    if (cmd === 'git' && a.startsWith('rev-parse --abbrev-ref --symbolic-full-name')) return ok('origin/feat/f1');
    if (cmd === 'git' && a.startsWith('rev-list')) return ok('0');
    if (cmd === 'gh' && a.startsWith('run list')) return ok(JSON.stringify([{ databaseId: 55, headSha: 'feedbeef', event: 'workflow_dispatch', status: 'completed', conclusion: jobs.every((j) => j.conclusion === 'success') ? 'success' : 'failure', url: 'https://github.com/o/r/actions/runs/55' }]));
    if (cmd === 'gh' && a.startsWith('workflow run')) return ok();
    if (cmd === 'gh' && a.startsWith('run download')) return ok();
    if (cmd === 'gh' && a.startsWith('run view')) return ok(JSON.stringify({ url: 'https://github.com/o/r/actions/runs/55', conclusion: 'failure', status: 'completed', jobs }));
    return { status: 1, stdout: '', stderr: `sem rota: ${cmd} ${a}` };
  };
  return { spawn, calls };
}
const results = (dir) => op.readRunState(dir, null).verification_check_results || [];

describe('runtime verify + verify.remote (fake CI)', () => {
  it('the e2e check runs in the CI, not here; a red job fails it with the link', async () => {
    const dir = project({ verify: { remote: { workflow: 'ci.yml' } } }, [
      { criterion: 'A8', files: ['test/a8.test.js'], command: 'node --test test/a8.test.js' },
      { criterion: 'A9', files: ['test/e2e.spec.js'], command: 'npx playwright test test/e2e.spec.js', remote_job: 'e2e' },
    ]);
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    const ci = fakeCi([{ name: 'e2e', conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/55/job/9' }]);
    const out = await op.runRuntimeVerify(dir, null, { gates: false, ghSpawn: ci.spawn, sleep: () => {} });
    const a9 = results(dir).find((r) => r.check_id === 'check-accept-a9');
    assert.equal(a9.status, 'fail');
    assert.match(a9.stdout, /job\/9/);
    assert.equal(results(dir).find((r) => r.check_id === 'check-accept-a8').status, 'pass', 'the light one ran here');
    assert.equal(out.report.remote.status, 'verified');
    assert.ok(ci.calls.some((c) => /run download 55/.test(c)), 'CI trace kept on a red job');
  });

  it('where "both": green here, red in the CI → ci_only (read the CI trace, not a local repro)', async () => {
    const dir = project({ verify: { remote: { workflow: 'ci.yml' } } }, [
      { criterion: 'A8', files: ['test/a8.test.js'], command: 'node --test test/a8.test.js', where: 'both', remote_job: 'unit-windows' },
    ]);
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    const ci = fakeCi([{ name: 'unit-windows', conclusion: 'failure' }]);
    const out = await op.runRuntimeVerify(dir, null, { gates: false, ghSpawn: ci.spawn, sleep: () => {} });
    const local = results(dir).find((r) => r.check_id === 'check-accept-a8');
    const remote = results(dir).find((r) => /@ci$/.test(r.check_id));
    assert.equal(local.status, 'pass');
    assert.equal(remote.status, 'fail');
    assert.equal(remote.ci_only, true);
    assert.match(remote.stderr, /falhou só na CI/);
    assert.ok(out.report.remote.checks.some((c) => c.ci_only));
  });

  it('below verify.min_free_mb with no remote, the heavy check does not run here: low_memory, verify partial', async () => {
    const dir = project({ verify: { min_free_mb: 2560 } }, [
      { criterion: 'A9', files: ['test/e2e.spec.js'], command: 'npx playwright test test/e2e.spec.js' },
    ]);
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    const out = await op.runRuntimeVerify(dir, null, { gates: false, freeMemBytes: 1024 * 1024 * 1024 });
    const a9 = results(dir).find((r) => r.check_id === 'check-accept-a9');
    assert.equal(a9.status, 'skip');
    assert.equal(a9.skip_reason, 'low_memory');
    assert.ok((out.report.gaps || []).some((g) => /Memória baixa \(1024 MB livres < 2560 MB\)/.test(g)), JSON.stringify(out.report.gaps));
  });
});
