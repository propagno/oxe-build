import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler, tailLines, segmentTestFiles } from '../src/scheduler/scheduler';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { TaskExecutor, SchedulerContext } from '../src/scheduler/scheduler';
import type { OxeEvent } from '../src/events/envelope';

// 1.21.2 · OXB-162 (F4-T1, oxe-run-mw855cc1-yap7sx, attempt 3, US$ 5.29): segment 2/4 ran four vitest files and
// PASSED; segment 4/4 (the suite command) ran the same four files and FAILED; the task was blocked, and the output tail
// was only git "LF will be replaced by CRLF" warnings.

const SPEC: ParsedSpec = { objective: 'flaky', criteria: [] };
function graphFor(verifyCommand: string) {
  const plan: ParsedPlan = {
    tasks: [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
    waves: { 1: ['T1'] },
    totalTasks: 1,
  };
  const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
  for (const node of graph.nodes.values()) node.policy.max_retries = 0;
  return graph;
}
// run n of the script: fails on the runs listed in FAIL_ON (comma-separated)
const FLAKY = `const fs=require('fs');const f='count.txt';const n=(Number(fs.existsSync(f)?fs.readFileSync(f,'utf8'):0)||0)+1;fs.writeFileSync(f,String(n));const fail=String(process.env.FAIL_ON||'').split(',').map(Number);if(fail.includes(n)){console.error('FAIL tests/m.test.ts > migrates');process.exit(1)}console.log('ok run '+n)`;
const executor: TaskExecutor = { async execute() { return { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' }; } };

async function run(failOn: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-flaky-'));
  fs.writeFileSync(path.join(tmp, 'flaky.js'), FLAKY);
  const prev = process.env.FAIL_ON;
  process.env.FAIL_ON = failOn;
  const events: OxeEvent[] = [];
  try {
    const ctx: SchedulerContext = { projectRoot: tmp, sessionId: null, runId: `r-fl-${Date.now()}`, executor, workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e) };
    const cmd = 'node flaky.js tests/m.test.ts tests/w.test.ts && node flaky.js tests/m.test.ts --reporter=dot';
    const result = await new Scheduler().run(graphFor(cmd), ctx);
    return { result, events, runs: Number(fs.readFileSync(path.join(tmp, 'count.txt'), 'utf8')) };
  } finally {
    if (prev === undefined) delete process.env.FAIL_ON; else process.env.FAIL_ON = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('OXB-162: flaky suspect in the task verify', () => {
  test('a later segment on files an earlier one passed fails → rerun once; green → the task completes, marked', async () => {
    const { result, events, runs } = await run('2');
    assert.equal(runs, 3, 'segment 1, segment 2, its rerun');
    assert.deepEqual(result.completed, ['T1']);
    const suspect = events.find((e) => e.type === 'VerifyCommandSuspect');
    const p = suspect?.payload as Record<string, unknown>;
    assert.equal(p.reason, 'flaky_suspect');
    assert.equal(p.rerun, 'passed');
    assert.equal(p.passed_before_in, 1);
  });

  test('red again on the rerun → the task fails as before (marked flaky_suspect)', async () => {
    const { result, events } = await run('2,3');
    assert.ok(!result.completed.includes('T1'));
    const p = events.find((e) => e.type === 'VerifyCommandSuspect')?.payload as Record<string, unknown>;
    assert.equal(p.rerun, 'failed');
  });

  test('segmentTestFiles reads the test files of a segment', () => {
    assert.deepEqual(segmentTestFiles('npx vitest run tests/integration/migrations.test.ts ./tests/b.spec.tsx --reporter dot'), ['tests/b.spec.tsx', 'tests/integration/migrations.test.ts']);
  });
});

describe('OXB-162: the output tail', () => {
  test("git's LF/CRLF notices are dropped", () => {
    const text = ['FAIL tests/m.test.ts > migrates', 'AssertionError: expected 3 to be 4', ...Array.from({ length: 30 }, (_, i) => `warning: in the working copy of 'f${i}.ts', LF will be replaced by CRLF the next time Git touches it`)].join('\n');
    const tail = tailLines(text, 10);
    assert.doesNotMatch(tail, /LF will be replaced/);
    assert.match(tail, /AssertionError: expected 3 to be 4/);
  });

  test('the last failing-test block is kept when summary noise pushes it out of the tail', () => {
    const text = ['FAIL tests/m.test.ts > migrates', 'AssertionError: expected 3 to be 4', '  at m.test.ts:12', ...Array.from({ length: 40 }, (_, i) => `summary line ${i}`)].join('\n');
    const tail = tailLines(text, 12);
    assert.match(tail, /^FAIL tests\/m\.test\.ts > migrates\nAssertionError/);
    assert.match(tail, /summary line 39$/);
    assert.ok(tail.split('\n').length <= 12);
  });
});
