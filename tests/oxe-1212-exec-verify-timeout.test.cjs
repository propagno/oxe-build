'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 - OXB-155 (F2 blocker): execute's per-task verify used a fixed 60 s (config verify_timeout_ms ignored), and a
// verify TIMEOUT counted as "identical_verify_failure", blocking T2 after two typecheck timeouts.

const dirs = [];
after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a killed verify may still hold the dir on Windows */ } } });

function project(verifyTimeoutMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-evt-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'slow.js'), 'setTimeout(() => process.exit(0), 1500);\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# S\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, verify_timeout_ms: verifyTimeoutMs }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node slow.js'] } }] }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const executor = (dir) => ({ async execute() { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1'); return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' }; } });

describe('OXB-155: execute honors verify_timeout_ms; a verify timeout is not an identical failure', () => {
  it('config verify_timeout_ms reaches the task verify (a 1.5 s verify with 10 s passes)', async () => {
    const dir = project(10_000);
    const res = await op.runRuntimeExecute(dir, null, { executor: executor(dir), skipPreflight: true });
    assert.deepEqual(res.result.completed, ['T1']);
  });

  it('with 300 ms it times out on every attempt, and is never flagged identical_verify_failure', async () => {
    const dir = project(300);
    const events = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: executor(dir), skipPreflight: true, maxRetries: 1, onProgress: (e) => events.push(e) });
    assert.ok(!(res.result.completed || []).includes('T1'));
    assert.ok(!events.some((e) => e.type === 'VerifyCommandSuspect'), 'a timeout is not a suspect verify');
    const log = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8');
    assert.match(log, /passou de 0s sem terminar|timeout/);
  });
});
