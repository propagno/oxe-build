'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const remote = require('../bin/lib/oxe-verify-remote.cjs');

// 1.21.2 — verify.remote against a FAKE gh/git (never the real repository): heavy checks run in the repo's CI, the
// dispatch carries no input (never publish_release), a green run on the same commit is reused, the dispatched run is
// found by commit + workflow_dispatch, nothing is ever force-pushed or pushed to a protected branch, and any GitHub
// trouble leaves the checks "not verified" instead of failing the phase.

const HEAD = 'abc123def456';
const CFG = remote.remoteConfig({ verify: { remote: { workflow: 'ci.yml', wait_minutes: 1 } } });
const CHECKS = [
  { id: 'A7-e2e', acceptance_ref: 'A7', command: 'npx playwright test e2e/send.spec.ts' },
  { id: 'gate-android', acceptance_ref: null, command: './gradlew assembleRelease', remote_job: 'android' },
];

/** A scripted gh/git: `state` tunes each answer; every call is recorded. */
function fake(state = {}) {
  const calls = [];
  let listCalls = 0;
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr = 'erro') => ({ status: 1, stdout: '', stderr });
  const spawn = (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = args.join(' ');
    if (cmd === 'gh' && a === 'auth status') return state.noGh ? { status: null, error: new Error('spawn gh ENOENT') } : ok();
    if (cmd === 'git' && a === 'rev-parse --abbrev-ref HEAD') return ok(`${state.branch || 'feat/f2-envio'}\n`);
    if (cmd === 'git' && a === 'rev-parse HEAD') return ok(`${HEAD}\n`);
    if (cmd === 'gh' && args[0] === 'api') return ok(state.protected ? 'true' : 'false');
    if (cmd === 'git' && a.startsWith('rev-parse --abbrev-ref --symbolic-full-name')) return state.noUpstream ? fail('no upstream') : ok('origin/feat/f2-envio');
    if (cmd === 'git' && a.startsWith('rev-list --count')) return ok(String(state.ahead || 0));
    if (cmd === 'git' && args[0] === 'push') return state.pushRejected ? fail(' ! [rejected] feat/f2-envio -> feat/f2-envio (non-fast-forward)') : ok();
    if (cmd === 'gh' && a.startsWith('run list')) {
      listCalls += 1;
      const runs = [...(state.runs || [])];
      if (state.dispatched && calls.some((c) => c[1] === 'workflow' && c[2] === 'run')) runs.push({ databaseId: 900, headSha: HEAD, event: 'workflow_dispatch', status: 'in_progress', conclusion: null, url: 'https://github.com/o/r/actions/runs/900' });
      return ok(JSON.stringify(runs));
    }
    if (cmd === 'gh' && a.startsWith('workflow run')) return state.dispatchFails ? fail('HTTP 422: Workflow does not have workflow_dispatch trigger') : ok();
    if (cmd === 'gh' && a.startsWith('run watch')) return state.watchTimeout ? { status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }) } : ok();
    if (cmd === 'gh' && a.startsWith('run view')) return ok(JSON.stringify({ url: 'https://github.com/o/r/actions/runs/900', conclusion: 'success', status: 'completed', jobs: state.jobs || [{ name: 'A7-e2e', conclusion: 'success', url: 'https://github.com/o/r/actions/runs/900/job/1' }, { name: 'android', conclusion: 'success' }] }));
    return fail(`rota fake ausente: ${cmd} ${a}`);
  };
  return { spawn, calls, listCalls: () => listCalls };
}
const run = (f, extra = {}) => remote.runRemote({ checks: CHECKS, rcfg: CFG, cwd: '.', spawn: f.spawn, sleep: () => {}, ...extra });
const called = (f, prefix) => f.calls.filter((c) => c.join(' ').startsWith(prefix));

describe('verify.remote: config and routing', () => {
  it('heavy commands go remote, light ones stay local; explicit where wins (check, criterion, task, verify.where)', () => {
    assert.equal(remote.whereFor({ id: 'x', command: 'npx playwright test' }, CFG), 'remote');
    assert.equal(remote.whereFor({ id: 'x', command: './gradlew assembleRelease' }, CFG), 'remote');
    assert.equal(remote.whereFor({ id: 'x', command: 'npx vitest run src' }, CFG), 'local');
    assert.equal(remote.whereFor({ id: 'x', command: 'npx tsc --noEmit' }, CFG), 'local');
    assert.equal(remote.whereFor({ id: 'x', command: 'npx vitest run', where: 'remote' }, CFG), 'remote');
    const hints = remote.planHints({ acceptance_tests: [{ criterion: 'A3', where: 'local' }], tasks: [{ id: 'T4', where: 'remote', remote_job: 'build' }] });
    assert.equal(remote.whereFor({ id: 'A3-e2e', acceptance_ref: 'A3', command: 'npx playwright test' }, CFG, hints), 'local');
    assert.equal(remote.whereFor({ id: 'T4-verify', command: 'npm test' }, CFG, hints), 'remote');
    assert.equal(hints.jobs.get('T4'), 'build');
    const byConfig = remote.remoteConfig({ verify: { remote: { workflow: 'ci.yml' }, where: { 'gate-lint': 'remote' } } });
    assert.equal(remote.whereFor({ id: 'gate-lint', command: 'npm run lint' }, byConfig), 'remote');
  });

  it('a publish/release/deploy input is refused in the config; no remote block → null', () => {
    assert.throws(() => remote.remoteConfig({ verify: { remote: { workflow: 'ci.yml', inputs: { publish_release: 'false' } } } }), /publish_release/);
    assert.equal(remote.remoteConfig({}), null);
    assert.equal(remote.remoteConfig({ verify: { remote: { workflow: 'ci.yml', enabled: false } } }), null);
  });
});

describe('verify.remote: the run', () => {
  it('dispatch WITHOUT inputs (never publish_release), finds the dispatched run by commit + event, maps jobs → pass', () => {
    const f = fake({ dispatched: true });
    const out = run(f);
    assert.equal(out.status, 'verified');
    const dispatch = called(f, 'gh workflow run');
    assert.equal(dispatch.length, 1);
    assert.deepEqual(dispatch[0], ['gh', 'workflow', 'run', 'ci.yml', '--ref', 'feat/f2-envio']);
    for (const c of f.calls) assert.ok(!c.join(' ').includes('publish_release'), `publish_release apareceu em: ${c.join(' ')}`);
    for (const c of f.calls) assert.ok(!c.includes('-f') || !c.join(' ').match(/publish|release|deploy/i));
    assert.deepEqual(out.results.map((r) => [r.check.id, r.status, r.job]), [['A7-e2e', 'pass', 'A7-e2e'], ['gate-android', 'pass', 'android']]);
    assert.equal(out.run.id, 900);
  });

  it('a green run on the same commit (even from pull_request) is reused: no dispatch, no CI paid twice', () => {
    const f = fake({ runs: [{ databaseId: 77, headSha: HEAD, event: 'pull_request', status: 'completed', conclusion: 'success', url: 'https://github.com/o/r/actions/runs/77' }] });
    const out = run(f);
    assert.equal(called(f, 'gh workflow run').length, 0);
    assert.equal(called(f, 'gh run watch').length, 0);
    assert.equal(out.run.reused, true);
    assert.equal(out.run.id, 77);
  });

  it('a failed job fails its check with the link; a missing job is not verified', () => {
    const f = fake({ dispatched: true, jobs: [{ name: 'A7-e2e', conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/900/job/1' }] });
    const out = run(f);
    assert.equal(out.results[0].status, 'fail');
    assert.match(out.results[0].url, /job\/1/);
    assert.equal(out.results[1].status, 'not_verified');
    assert.match(out.results[1].reason, /não tem o job "android"/);
    const cr = remote.toCheckResult(out.results[0], out.run);
    assert.equal(cr.status, 'fail');
    assert.match(cr.stdout, /actions\/runs\/900\/job\/1/);
  });

  it('timeout, missing gh, dispatch refused → every remote check not verified, with the reason', () => {
    const t = run(fake({ dispatched: true, watchTimeout: true }));
    assert.equal(t.status, 'not_verified');
    assert.match(t.reason, /tempo esgotado \(1 min\)/);
    assert.ok(t.results.every((r) => r.status === 'not_verified'));
    assert.match(run(fake({ noGh: true })).reason, /gh indisponível/);
    assert.match(run(fake({ dispatchFails: true })).reason, /workflow_dispatch/);
  });
});

describe('verify.remote: push safety', () => {
  it('never pushes to main/master or a protected branch', () => {
    for (const st of [{ branch: 'main' }, { branch: 'master' }, { protected: true }]) {
      const f = fake({ ...st, ahead: 2 });
      const out = run(f);
      assert.equal(out.status, 'not_verified');
      assert.match(out.reason, /protegido/);
      assert.equal(called(f, 'git push').length, 0);
    }
    const glob = remote.remoteConfig({ verify: { remote: { workflow: 'ci.yml', protected: ['release/*'] } } });
    const f = fake({ branch: 'release/1.5.0', ahead: 1 });
    assert.match(remote.runRemote({ checks: CHECKS, rcfg: glob, cwd: '.', spawn: f.spawn, sleep: () => {} }).reason, /protegido/);
  });

  it('no upstream: refused without --push; with --push: set-upstream, never --force; a rejected push is not verified', () => {
    assert.match(run(fake({ noUpstream: true })).reason, /--push/);
    const f = fake({ noUpstream: true, dispatched: true });
    run(f, { push: true });
    const pushes = called(f, 'git push');
    assert.deepEqual(pushes[0], ['git', 'push', '--set-upstream', 'origin', 'feat/f2-envio']);
    const r = fake({ ahead: 1, pushRejected: true });
    const out = run(r);
    assert.equal(out.status, 'not_verified');
    assert.match(out.reason, /non-fast-forward/);
    for (const c of [...f.calls, ...r.calls]) assert.ok(!c.includes('--force') && !c.includes('-f') || c[1] !== 'push', `force push: ${c.join(' ')}`);
  });
});
