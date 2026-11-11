'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const { classifyFailureOutput, quotaResumeAt } = require('../lib/runtime/scheduler/scheduler');

// 1.21.2 — OXB-120: classify the failure before charging an attempt; environment / quota pause the run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-fc-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, budget: { max_retries: 2 }, tasks }, null, 2));
  write(dir, 'src/a.js', '1\n');
  write(dir, 'src/b.js', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  return dir;
}
const counting = (calls) => ({ async execute(node) { calls.push(node.id); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } });

describe('OXB-120: failure classes', () => {
  it('a verify exiting 127 pauses the run as environment: one call, no retry, the next task never starts', async () => {
    const dir = project([
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e "console.error(\'tsc: command not found\'); process.exit(127)"'] } },
      { id: 'T2', title: 'b', wave: 2, files: ['src/b.js'], verify: { commands: ['node -e 0'] } },
    ]);
    const calls = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: counting(calls), skipPreflight: true });
    assert.deepEqual(calls, ['T1'], 'no retry, T2 not started');
    assert.equal(res.result.status, 'paused');
    const ev = op.readEvents(dir, null);
    const paused = ev.find((e) => e.type === 'RunPaused');
    assert.equal(paused.payload.reason, 'environment');
    assert.match(paused.payload.diagnosis, /command not found/);
    const blocked = ev.find((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T1');
    assert.equal(blocked.payload.reason, 'paused_environment');
  });

  it('a logic failure is retried as before (no pause)', async () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e "console.error(\'AssertionError: expected 1 to be 2\'); process.exit(1)"'] } }]);
    const calls = [];
    await op.runRuntimeExecute(dir, null, { executor: counting(calls), skipPreflight: true });
    assert.ok(calls.length >= 2, String(calls.length));
    assert.ok(!op.readEvents(dir, null).some((e) => e.type === 'RunPaused'));
  });

  it('a project pattern (execute.failure_classes.environment) is respected', async () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e "console.error(\'emulator offline\'); process.exit(1)"'] } }], { execute: { failure_classes: { environment: ['emulator offline'] } } });
    const calls = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: counting(calls), skipPreflight: true });
    assert.deepEqual(calls, ['T1']);
    assert.equal(res.result.status, 'paused');
  });

  it('quota from the executor pauses the run with the reset time', async () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e 0'] } }, { id: 'T2', title: 'b', wave: 2, files: ['src/b.js'], verify: { commands: ['node -e 0'] } }]);
    const calls = [];
    const exec = { async execute(node) { calls.push(node.id); return { success: false, failure_class: 'quota', evidence: [], output: 'Claude usage limit reached. Your limit resets at 3pm (America/Sao_Paulo)' }; } };
    const res = await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true });
    assert.deepEqual(calls, ['T1']);
    assert.equal(res.result.status, 'paused');
    const paused = op.readEvents(dir, null).find((e) => e.type === 'RunPaused');
    assert.equal(paused.payload.reason, 'quota');
    assert.equal(paused.payload.resume_at, '3pm (America/Sao_Paulo)');
  });

  it('classifier: 126/127, build artifacts, native modules, network; plain assertion is logic', () => {
    assert.equal(classifyFailureOutput('', 127).kind, 'environment');
    assert.equal(classifyFailureOutput("Error: ENOENT: no such file or directory, open 'C:\\\\w\\\\out\\\\main\\\\index.js'", 1).kind, 'environment');
    assert.equal(classifyFailureOutput('was compiled against a different Node.js version using NODE_MODULE_VERSION 115', 1).kind, 'environment');
    assert.equal(classifyFailureOutput('connect ECONNREFUSED 127.0.0.1:5432', 1).kind, 'environment');
    assert.equal(classifyFailureOutput('AssertionError: expected 1 to be 2', 1), null);
    assert.equal(quotaResumeAt('try again in 2 hours.'), '2 hours');
  });
});
