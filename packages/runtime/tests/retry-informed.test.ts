import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler, describeVerifyFailure, verifyFailureSignature } from '../src/scheduler/scheduler';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult, SchedulerContext } from '../src/scheduler/scheduler';
import type { OxeEvent } from '../src/events/envelope';

// OxeVoice F1: o verify da T1 falhou 3x e cada retry recebeu só "Verification failed: checks did not pass" —
// o executor nunca viu o erro do esbuild. 1.20c: retry informado + régua suspeita.

const SPEC: ParsedSpec = { objective: 'retry', criteria: [] };

function graphFor(verifyCommand: string) {
  const plan: ParsedPlan = {
    tasks: [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
    waves: { 1: ['T1'] },
    totalTasks: 1,
  };
  return compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
}

function setup(verifyCommand: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-retry-'));
  const seen: Array<string | null> = [];
  const executor: TaskExecutor = {
    async execute(_node, _lease, _runId, _attempt, options): Promise<TaskResult> {
      seen.push(options?.previousError ?? null);
      return { success: true, failure_class: null, evidence: [], output: 'ok' };
    },
  };
  const events: OxeEvent[] = [];
  const ctx: SchedulerContext = {
    projectRoot: tmp, sessionId: null, runId: `r-retry-${Date.now()}`, executor,
    workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
  };
  return { tmp, seen, events, ctx };
}

describe('retry informado e régua suspeita (1.20c)', () => {
  test('o retry recebe comando, motivo e saída; falha idêntica para na 2ª tentativa', async () => {
    const { tmp, seen, events, ctx } = setup('node -e "console.error(\'X [ERROR] Must use outdir\'); process.exit(1)"');
    try {
      const graph = graphFor('node -e "console.error(\'X [ERROR] Must use outdir\'); process.exit(1)"');
      for (const node of graph.nodes.values()) node.policy.max_retries = 3;
      const result = await new Scheduler().run(graph, ctx);
      assert.equal(result.status, 'failed');
      assert.equal(seen.length, 2, 'parou na 2ª tentativa idêntica, sem pagar a 3ª e a 4ª');
      assert.equal(seen[0], null);
      assert.match(String(seen[1]), /Command: node -e/);
      assert.match(String(seen[1]), /Must use outdir/);
      assert.match(String(seen[1]), /If you are certain the command itself is wrong/);
      const suspect = events.find((e) => e.type === 'VerifyCommandSuspect');
      assert.ok(suspect, 'VerifyCommandSuspect emitido');
      const blocked = events.find((e) => e.type === 'WorkItemBlocked');
      assert.equal((blocked?.payload as Record<string, unknown>).failure_class, 'verify_suspect');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('falhas diferentes continuam tentando até o limite', async () => {
    const cmd = 'node -e "const f=require(\'fs\');const n=f.existsSync(\'c\')?+f.readFileSync(\'c\',\'utf8\'):0;f.writeFileSync(\'c\',String(n+1));console.error(\'falha \'+n);process.exit(1)"';
    const { tmp, seen, events, ctx } = setup(cmd);
    try {
      const graph = graphFor(cmd);
      for (const node of graph.nodes.values()) node.policy.max_retries = 2;
      await new Scheduler().run(graph, ctx);
      assert.equal(seen.length, 3);
      assert.ok(!events.some((e) => e.type === 'VerifyCommandSuspect'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('assinatura ignora tempos, timestamps, hashes e caminhos temporários', () => {
    const a = verifyFailureSignature({ check_id: 'x', acceptance_ref: null, status: 'fail', stdout: 'done in 12ms at 2026-11-01T02:00:00Z abcdef1234', stderr: 'C:\\Temp\\x1\\f.js failed', exit_code: 1, duration_ms: 1, error: null });
    const b = verifyFailureSignature({ check_id: 'x', acceptance_ref: null, status: 'fail', stdout: 'done in 340ms at 2026-11-01T05:10:00Z 99887766aa', stderr: 'C:\\Temp\\y9\\f.js failed', exit_code: 1, duration_ms: 1, error: null });
    assert.equal(a, b);
    assert.match(describeVerifyFailure('npm test', undefined, ['x']), /Reason: x/);
  });
});
