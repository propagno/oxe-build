'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recoveryStep } = require('../bin/lib/oxe-recovery.cjs');

// 1.21.2 — guided recovery (user, 15/11): after a failure the next step names the way out, most urgent first, in
// the same shape as the happy path (step, cursorCmd, reason).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-recov-')); dirs.push(d); fs.mkdirSync(path.join(d, '.oxe', 'program'), { recursive: true }); return d; };
const step = (ctx) => { const d = tmp(); return recoveryStep(d, null, { programDir: path.join(d, '.oxe', 'program'), run: null, doc: null, ...ctx }); };

describe('recoveryStep: each failure state → the command out of it', () => {
  it('nothing failed → null (the happy path decides)', () => {
    assert.equal(step({ doc: { tasks: [{ id: 'T1' }] } }), null);
  });

  it('a requested pause comes first', () => {
    const r = step({ run: { run_id: 'r', pause_requested: { reason: 'janela', at: '2026-11-15T19:00Z' } }, doc: { tasks: [{ id: 'T1', checkpoint_failed: { reason: 'x' } }] } });
    assert.equal(r.recovery, 'paused');
    assert.equal(r.cursorCmd, 'oxe-cc runtime resume');
    assert.match(r.reason, /janela/);
  });

  it('scope_insufficient → plan scope add with the red tests, then reopen', () => {
    const r = step({ doc: { tasks: [{ id: 'T8', files: ['src/a.ts'], checkpoint_failed: { kind: 'scope_insufficient', related_red: ['tests/ipc.test.ts'], reason: 'x' } }] } });
    assert.equal(r.recovery, 'scope_insufficient');
    assert.match(r.cursorCmd, /^oxe-cc plan scope add T8 tests\/ipc\.test\.ts --cr/);
    assert.match(r.reason, /plan reopen T8/);
  });

  it('a failed checkpoint with the work in the tree → commit-task, together with the failed task sharing a file', () => {
    const r = step({ doc: { tasks: [
      { id: 'T14', files: ['app/PairingFlow.kt'], checkpoint_failed: { reason: 'hook', snapshot: {} } },
      { id: 'T15', files: ['app/PairingFlow.kt'], checkpoint_failed: { reason: 'hook', snapshot: {} } },
      { id: 'T16', files: ['app/PairingFlow.kt'] },
    ] } });
    assert.equal(r.recovery, 'checkpoint_failed');
    assert.equal(r.cursorCmd, 'oxe-cc runtime commit-task T14,T15 --together');
    assert.match(r.reason, /T16 espera/);
  });

  it('an empty checkpoint that left nothing → plan done with the commit (or reopen); an integration red names the check', () => {
    assert.equal(step({ doc: { tasks: [{ id: 'T3', checkpoint_failed: { kind: 'empty_checkpoint', reason: 'nada' } }] } }).cursorCmd, 'oxe-cc plan done T3 --commit <sha>');
    const i = step({ doc: { tasks: [{ id: 'T2', files: ['big.ts'], checkpoint_failed: { kind: 'integration', reason: 'check de integração vermelho (node scripts/check-file-size.mjs)' } }] } });
    assert.equal(i.recovery, 'integration');
    assert.match(i.reason, /check-file-size/);
  });

  it('an open spec_gap CR without its amendment → spec amend --cr; a done/superseded task never counts', () => {
    const d = tmp();
    const pd = path.join(d, '.oxe', 'program');
    fs.writeFileSync(path.join(pd, 'changes.ndjson'), `${JSON.stringify({ kind: 'cr', id: 'CR-3', class: 'spec_gap', status: 'open', criteria: ['A7'], summary: 'A7 precisa citar o limite', at: 'x' })}\n`);
    const r = recoveryStep(d, null, { programDir: pd, run: null, doc: { tasks: [{ id: 'T1', done: true, checkpoint_failed: { reason: 'old' } }, { id: 'T2', superseded: { by_phase: 'F5' }, checkpoint_failed: { reason: 'old' } }] } });
    assert.equal(r.recovery, 'spec_gap');
    assert.match(r.cursorCmd, /^oxe-cc spec amend A7 --cr CR-3/);
  });

  it('an open deferral → deferred retry; a red verify names its first red check', () => {
    const d = tmp();
    const pd = path.join(d, '.oxe', 'program');
    require('../bin/lib/oxe-deferred.cjs').add(pd, { task: 'T9', reason: 'logic', evidence: 'x', run_id: 'r', phase: 'F1' });
    assert.equal(recoveryStep(d, null, { programDir: pd, run: null, doc: null }).cursorCmd, 'oxe-cc runtime deferred retry');
    const v = step({ run: { run_id: 'r', verification_status: 'failed', verification_check_results: [{ check_id: 'check-a1', status: 'pass' }, { check_id: 'check-accept-a3', status: 'fail', acceptance_ref: 'A3', command: 'npx vitest run tests/a3.test.ts' }] } });
    assert.equal(v.recovery, 'verify_failed');
    assert.match(v.reason, /check-accept-a3 \(A3\) — reproduza com `npx vitest run tests\/a3\.test\.ts`/);
  });
});

describe('R42: recovery priorities', () => {
  it('uncommitted work in the tree comes before another task\'s scope gap or empty checkpoint', () => {
    const r = step({ doc: { tasks: [
      { id: 'T4', files: ['b.ts'], checkpoint_failed: { kind: 'scope_insufficient', related_red: ['tests/x.test.ts'], reason: 'x' } },
      { id: 'T1', files: ['a.ts'], checkpoint_failed: { reason: 'hook', snapshot: {} } },
    ] } });
    assert.equal(r.cursorCmd, 'oxe-cc runtime commit-task T1');
    // R43: a scope gap sharing the file is never committed together (it reopens with the scope fixed)
    const s = step({ doc: { tasks: [
      { id: 'T1', files: ['a.ts'], checkpoint_failed: { reason: 'hook', snapshot: {} } },
      { id: 'T2', files: ['a.ts'], checkpoint_failed: { kind: 'scope_insufficient', related_red: ['tests/x.test.ts'], reason: 'x' } },
    ] } });
    assert.equal(s.cursorCmd, 'oxe-cc runtime commit-task T1');
  });

  it('a deferral waits while other tasks of the plan are still pending; another phase\'s deferral never counts', () => {
    const d = tmp();
    const pd = path.join(d, '.oxe', 'program');
    const dl = require('../bin/lib/oxe-deferred.cjs');
    dl.add(pd, { task: 'T2', reason: 'logic', evidence: 'x', run_id: 'r', phase: 'F1' });
    const doc = { tasks: [{ id: 'T2' }, { id: 'T3' }] };
    assert.equal(recoveryStep(d, null, { programDir: pd, run: null, doc, phase: { id: 'F1' } }), null, 'T3 still to run: the plan goes on');
    assert.equal(recoveryStep(d, null, { programDir: pd, run: null, doc: { tasks: [{ id: 'T2' }, { id: 'T3', done: true }] }, phase: { id: 'F1' } }).recovery, 'deferred');
    assert.equal(recoveryStep(d, null, { programDir: pd, run: null, doc: { tasks: [{ id: 'T2' }] }, phase: { id: 'F2' } }), null, 'F1 deferral is not F2\'s');
  });

  it('a red verify of an older commit asks for /oxe-verify; with delivery.close "ci" the CI close decides', () => {
    const run = { run_id: 'r', verification_status: 'failed', verification_head: 'aaaaaaaa', verification_check_results: [{ check_id: 'check-a1', status: 'fail' }] };
    assert.equal(step({ run, head: 'bbbbbbbb', cfg: {} }).cursorCmd, '/oxe-verify');
    assert.equal(step({ run, head: 'bbbbbbbb', cfg: { delivery: { close: 'ci' } } }), null);
    assert.equal(step({ run, head: 'aaaaaaaa', cfg: {} }).cursorCmd, '/oxe-execute');
  });
});

describe('delivery.close "ci": the phase closes on its CI, guided', () => {
  it('work done → attach a CI run; attached → program close --by-ci; closing by verify → null', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, '.oxe', 'STATE.md'), '# S\n');
    fs.writeFileSync(path.join(d, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(d, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['a.txt'], done: true }] }));
    const journey = require('../bin/lib/oxe-journey.cjs');
    const phase = { id: 'F4', status: 'executing' };
    assert.equal(journey.ciCloseStep(d, null, phase, { cfg: {} }), null, 'default: close by verify');
    const cfg = { delivery: { mode: 'local', close: 'ci' } };
    assert.equal(journey.ciCloseStep(d, null, phase, { cfg }).cursorCmd, 'oxe-cc runtime ci --attach <run|url>');
    require('../bin/lib/oxe-phase-gates.cjs').attachCiRun(path.join(d, '.oxe', 'program'), { run: '43752403192', phase: 'F4' });
    const close = journey.ciCloseStep(d, null, phase, { cfg });
    assert.equal(close.step, 'program-close');
    assert.match(close.cursorCmd, /program close --by-ci --by <papel>/);
    fs.writeFileSync(path.join(d, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['a.txt'] }] }));
    assert.equal(journey.ciCloseStep(d, null, phase, { cfg }), null, 'work not done: execute first');
  });
});

describe('status --json carries the recovery step', () => {
  it('a project with a failed checkpoint: the next step is commit-task, not "em execução"', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, '.oxe', 'STATE.md'), '# STATE\n\n## Fase atual\n\nexecuting\n');
    fs.writeFileSync(path.join(d, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(d, '.oxe', 'SPEC.md'), '# SPEC\n');
    fs.writeFileSync(path.join(d, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['a.txt'], checkpoint_failed: { reason: 'git commit falhou', snapshot: {} } }] }));
    const next = require('../bin/lib/oxe-project-health.cjs').suggestNextStep(d, {});
    assert.equal(next.step, 'commit-task');
    assert.equal(next.cursorCmd, 'oxe-cc runtime commit-task T1');
  });

  it('a fresh folder never suggests a legacy command', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-recov-empty-'));
    dirs.push(d);
    const next = require('../bin/lib/oxe-project-health.cjs').suggestNextStep(d, {});
    assert.equal(next.cursorCmd, 'oxe-cc init-oxe');
    // /oxe-retro stays: it is the only way to run the retro alone after verify_complete (verify.md names it when the
    // automatic retro was skipped); every other legacy command has a main-trail replacement
    const LEGACY = ['/oxe-ask', '/oxe-scan', '/oxe-research', '/oxe-ui-spec', '/oxe-obs', '/oxe-debug', '/oxe-forensics', '/oxe-checkpoint', '/oxe-loop', '/oxe-validate-gaps', '/oxe-security', '/oxe-ui-review', '/oxe-review-pr', '/oxe-project'];
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'oxe-project-health.cjs'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'oxe-recovery.cjs'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'oxe-journey.cjs'), 'utf8');
    const used = [...src.matchAll(/cursorCmd:\s*[`'"]([^`'"]+)/g)].map((m) => m[1].split(/\s/)[0]);
    assert.deepEqual(used.filter((c) => LEGACY.includes(c)), [], 'no next step points to a legacy command');
  });
});
