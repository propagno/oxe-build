import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler, splitVerifySegments, buildVerifyLog } from '../src/scheduler/scheduler';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult, SchedulerContext } from '../src/scheduler/scheduler';
import type { OxeEvent } from '../src/events/envelope';

// 1.21.2 · OXB-066 (oxespace 1.5.0, run oxe-run-mw28b0n9-3s0gda, T13): the verify `npx vitest … && npx tsc --noEmit`
// ran as one command; vitest passed 39/39, tsc failed, and the retry only carried vitest's output — 4 attempts,
// US$ 4.54, 0 completed. Each segment now runs alone and the retry carries the failing segment's own output.

const SPEC: ParsedSpec = { objective: 'segments', criteria: [] };

function graphFor(verifyCommand: string, retries = 1) {
  const plan: ParsedPlan = {
    tasks: [{ id: 'T13', title: 'T13', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
    waves: { 1: ['T13'] },
    totalTasks: 1,
  };
  const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
  for (const node of graph.nodes.values()) node.policy.max_retries = retries;
  return graph;
}

describe('verify por segmento (OXB-066)', () => {
  test('splitVerifySegments separa && de topo, respeitando aspas', () => {
    assert.deepEqual(splitVerifySegments('npx vitest run a && npx tsc --noEmit'), ['npx vitest run a', 'npx tsc --noEmit']);
    assert.deepEqual(splitVerifySegments('node -e "a && b" && echo ok'), ['node -e "a && b"', 'echo ok']);
    assert.deepEqual(splitVerifySegments('npm test'), ['npm test']);
  });

  test('o retry leva o erro do segmento 2 e nada da saída longa do segmento 1; o evento nomeia o segmento', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-seg-'));
    try {
      // Segment 1: passes with 80 lines of output (vitest-like). Segment 2: fails with a short type error (tsc-like).
      const seg1 = `node -e "for (let i = 0; i < 80; i++) console.log('PASS test ' + i)"`;
      const seg2 = `node -e "console.error('src/ThreadView.tsx(12,3): error TS2322: Type string is not assignable to number'); process.exit(2)"`;
      const seen: Array<string | null> = [];
      const executor: TaskExecutor = {
        async execute(_n, _l, _r, _a, options): Promise<TaskResult> {
          seen.push(options?.previousError ?? null);
          return { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' };
        },
      };
      const events: OxeEvent[] = [];
      const ctx: SchedulerContext = {
        projectRoot: tmp, sessionId: null, runId: `r-seg-${Date.now()}`, executor,
        workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
      };
      await new Scheduler().run(graphFor(`${seg1} && ${seg2}`), ctx);
      const retryPrompt = String(seen[1]);
      assert.match(retryPrompt, /Failing segment \[2\/2\]: node -e "console\.error/);
      assert.match(retryPrompt, /error TS2322/);
      assert.doesNotMatch(retryPrompt, /PASS test \d/, 'nada da cauda do segmento 1 que passou');
      const completed = events.filter((e) => e.type === 'VerificationCompleted');
      const failed = (completed[0].payload as Record<string, unknown>).failed_segment as Record<string, unknown>;
      assert.deepEqual([failed.index, failed.total, failed.exit_code], [2, 2, 2]);
      const retry = events.find((e) => e.type === 'RetryScheduled');
      const p = retry?.payload as Record<string, string>;
      assert.match(p.output_tail, /TS2322/);
      assert.doesNotMatch(p.output_tail, /PASS test \d/);
      assert.match(p.verify_log, /=== \[1\/2\] .* — passed/);
      assert.match(p.verify_log, /PASS test 79/);
      assert.match(p.verify_log, /=== \[2\/2\] .* — failed \(exit 2\) ===\n.*TS2322/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('para no primeiro segmento que falha (o seguinte não roda)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-seg-'));
    try {
      const marker = path.join(tmp, 'ran-2');
      const executor: TaskExecutor = { async execute() { return { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' }; } };
      const ctx: SchedulerContext = { projectRoot: tmp, sessionId: null, runId: `r-seg2-${Date.now()}`, executor, workspaceManager: new InplaceWorkspaceManager(tmp) };
      await new Scheduler().run(graphFor(`node -e "process.exit(1)" && node -e "require('fs').writeFileSync('ran-2','x')"`, 0), ctx);
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('buildVerifyLog: um cabeçalho por segmento', () => {
    const log = buildVerifyLog([
      { index: 1, total: 2, command: 'a', status: 'passed', check: { check_id: 'x', acceptance_ref: null, status: 'pass', stdout: 'ok', stderr: '', exit_code: 0, duration_ms: 1, error: null } },
      { index: 2, total: 2, command: 'b', status: 'failed', check: { check_id: 'y', acceptance_ref: null, status: 'fail', stdout: '', stderr: 'boom', exit_code: 1, duration_ms: 1, error: null } },
    ]);
    assert.equal(log, '=== [1/2] a — passed (exit 0) ===\nok\n\n=== [2/2] b — failed (exit 1) ===\nboom');
  });
});
