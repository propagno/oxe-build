'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const { classifyFailureOutput, quotaResumeAt } = require('../lib/runtime/scheduler/scheduler');

// 1.21.2 — OXB-191: quota/rate-limit pause without consuming attempts, retrying, deferring, or rolling back.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function project(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-qp-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, checkpoint_commits: false, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', budget: { max_retries: 2 }, tasks }, null, 2));
  write(dir, 'src/a.js', 'original\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-191: quota exhaustion pause (rate limit / weekly limit)', () => {
  it('weekly limit from claude -p output halts immediately as paused_quota, preserves in-scope modifications and triggers no retry or deferred task', async () => {
    const dir = project([
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    ]);

    let attemptCount = 0;
    const executor = {
      async execute(node, lease, runId, attempt) {
        attemptCount = attempt;
        // Edit file in-scope
        fs.writeFileSync(path.join(dir, 'src/a.js'), 'modified content\n');
        // Claude CLI error with weekly limit
        return {
          success: false,
          failure_class: 'env', // adapter initially classified as env before fix
          evidence: [],
          output: "claude exit 1 · subtype=success · result=You've hit your weekly limit · resets Nov 14, 10am (America/Sao_Paulo) · prompt=279845 chars (~69961 tokens) · kind=env",
        };
      },
    };

    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(res.result.status, 'paused');
    assert.equal(attemptCount, 1, 'did not consume more than 1 attempt (no immediate retry)');

    // In-scope edited file remains intact (no rollback to original)
    const content = fs.readFileSync(path.join(dir, 'src/a.js'), 'utf8');
    assert.equal(content, 'modified content\n', 'modified file in scope was not reverted');

    const ev = op.readEvents(dir, null);
    assert.ok(!ev.some((e) => e.type === 'RetryScheduled'), 'no retry scheduled on quota limit');
    assert.ok(!ev.some((e) => e.type === 'WorkItemDeferred'), 'task must not be marked as deferred on quota');
    assert.ok(!ev.some((e) => e.type === 'RollbackExecuted'), 'no rollback executed');

    const paused = ev.find((e) => e.type === 'RunPaused');
    assert.ok(paused, 'RunPaused event emitted');
    assert.equal(paused.payload.reason, 'quota');
    assert.match(paused.payload.diagnosis, /hit your weekly limit/i);
    assert.equal(paused.payload.resume_at, 'Nov 14, 10am (America/Sao_Paulo)');

    const blocked = ev.find((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T1');
    assert.ok(blocked, 'WorkItemBlocked event emitted');
    assert.equal(blocked.payload.reason, 'paused_quota');
  });

  it('classifies 429, rate_limit_error, insufficient_quota and hit your limit', () => {
    assert.equal(classifyFailureOutput("You've hit your weekly limit · resets Nov 14, 10am", 1).kind, 'quota');
    assert.equal(classifyFailureOutput('HTTP 429: rate_limit_error: Request rate limit reached', 1).kind, 'quota');
    assert.equal(classifyFailureOutput('insufficient_quota: You exceeded your current quota', 1).kind, 'quota');
    assert.equal(classifyFailureOutput('overloaded_error: Server is overloaded', 1).kind, 'quota');
    assert.equal(quotaResumeAt("You've hit your weekly limit · resets Nov 14, 10am (America/Sao_Paulo)"), 'Nov 14, 10am (America/Sao_Paulo)');
  });

  it('ordinary test output is never quota: "resets", a line 429, a rate limiter suite, git reset', () => {
    const logic = [
      ' FAIL  tests/form.test.ts > form > resets the fields after submit\nAssertionError: expected 1 to be 0',
      'error: assertion failed\nhint: run git reset --hard to recover',
      'src/foo.ts:429:12 - error TS2322: Type string is not assignable to type number',
      'FAIL tests/rateLimiter.test.ts > rateLimit middleware returns 200\nexpected 200 got 500',
      'expected 429 tests to pass, 428 passed',
      'retry limit reached after 3 tries',
      'AssertionError: expected true to be false',
    ];
    for (const out of logic) assert.equal(classifyFailureOutput(out, 1), null, out);
  });

  it('the output of a verify is quota only by a pattern the project configured', () => {
    const out = 'HTTP 429: rate_limit_error from the fixture server';
    assert.equal(classifyFailureOutput(out, 1, undefined, { builtinQuota: false }), null);
    assert.equal(classifyFailureOutput(out, 1, { quota: ['fixture server'] }, { builtinQuota: false }).kind, 'quota');
  });

  it('a red verify whose log says "resets" / ":429:" costs an attempt and retries — the run is not paused as quota', async () => {
    const dir = project([
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "console.log(\'FAIL form > resets the fields after submit\'); console.log(\'src/a.ts:429:1 - error\'); process.exit(1)"'] } },
    ]);
    let attempts = 0;
    const executor = {
      async execute(node, lease, runId, attempt) {
        attempts = attempt;
        fs.writeFileSync(path.join(dir, 'src/a.js'), `attempt ${attempt}\n`);
        return { success: true, evidence: [], output: 'done' };
      },
    };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    const ev = op.readEvents(dir, null);
    assert.ok(attempts > 1, 'the logic failure was retried');
    assert.ok(!ev.some((e) => e.type === 'RunPaused' && e.payload && e.payload.reason === 'quota'), 'no quota pause');
    assert.ok(!ev.some((e) => e.type === 'WorkItemBlocked' && e.payload && e.payload.reason === 'paused_quota'), 'not blocked as paused_quota');
    assert.notEqual(res.result.status, 'paused');
  });
});
