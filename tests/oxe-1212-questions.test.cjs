'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const questions = require('../bin/lib/oxe-questions.cjs');
const decisions = require('../bin/lib/oxe-decisions.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21.2 — OXB-125: the executor asks instead of guessing; the orchestrator answers from the artifacts or waits for a person.

const dirs = [];
after(() => { runtime.setQuestionResolver(null); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-q-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false, execute: { interrupt_on: ['migration'] } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  return dir;
}
const pdir = (dir) => path.join(dir, '.oxe', 'program');

describe('OXB-125: executor questions', () => {
  it('an active decision naming one option answers it, with the decision as the source', () => {
    const dir = project();
    const d = decisions.add(pdir(dir), { title: 'Datas de vencimento são exibidas em UTC no relatório', by: 'po' });
    const a = questions.resolve(pdir(dir), { question: 'O relatório exibe as datas de vencimento em UTC ou no fuso local?', options: ['UTC', 'fuso local'], default: 'fuso local', blocking: false });
    assert.deepEqual([a.answer, a.source, a.provisional], ['UTC', d.id, false]);
  });

  it('non-blocking without evidence: the default, recorded as a provisional decision', () => {
    const dir = project();
    const a = questions.resolve(pdir(dir), { question: 'Ordenar a lista por nome ou por data?', options: ['nome', 'data'], default: 'data', blocking: false });
    assert.equal(a.answer, 'data');
    assert.equal(a.provisional, true);
    const d = decisions.list(pdir(dir)).find((x) => x.id === a.source);
    assert.match(d.by, /executor \(provisória\)/);
  });

  it('blocking (or an interrupt_on term) without evidence waits; the preflight names it; the answer unblocks and is reused', () => {
    const dir = project();
    const a = questions.resolve(pdir(dir), { question: 'Apagar a coluna legacy_id?', options: ['sim', 'não'], default: 'não', blocking: true });
    assert.equal(a.wait, true);
    const forced = questions.resolve(pdir(dir), { question: 'Rodar a migration agora?', options: ['sim', 'não'], default: 'sim', blocking: false }, { interruptOn: ['migration'] });
    assert.equal(forced.wait, true);
    const pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.blockers.some((b) => b.startsWith(`question_waiting:${a.id}`)), pre.blockers.join('\n'));
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'questions', 'answer', a.id, '--answer', 'não', '--by', 'tl', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const again = questions.resolve(pdir(dir), { question: 'Apagar a coluna legacy_id?', options: ['sim', 'não'], default: 'sim', blocking: true });
    assert.deepEqual([again.answer, again.wait], ['não', undefined]);
    const ls = spawnSync(process.execPath, [CLI, 'runtime', 'questions', '--json', '--dir', dir], { encoding: 'utf8' });
    const out = JSON.parse(ls.stdout);
    assert.equal(out.waiting.length, 1);
  });

  it('the ask_orchestrator tool hands the resolver the question; a wait stops the task as waiting_answer, never retried', async () => {
    const seen = [];
    runtime.setQuestionResolver((q) => { seen.push(q); return { wait: true, id: 'Q-9' }; });
    const res = JSON.parse(await runtime.BUILT_IN_TOOLS.ask_orchestrator.execute({ question: 'x?', options: ['a', 'b'], default: 'a', blocking: true }, os.tmpdir()));
    assert.deepEqual([res.__ask_blocked__, res.id, seen[0].blocking], [true, 'Q-9', true]);
    runtime.setQuestionResolver(null);

    const dir = project();
    let calls = 0;
    const executor = { async execute() { calls += 1; return { success: false, failure_class: 'waiting_answer', evidence: [], output: 'waiting_answer: {"__ask_blocked__":true,"id":"Q-1"}' }; } };
    const tasks = [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand: null, aceite: [], done: false }];
    const graph = runtime.compile({ tasks, waves: { 1: ['T1'] }, totalTasks: 1 }, { objective: 'q', criteria: [] }, { default_workspace_strategy: 'inplace', default_max_retries: 3 });
    const events = [];
    const result = await new runtime.Scheduler().run(graph, { projectRoot: dir, sessionId: null, runId: 'r-q', executor, workspaceManager: new runtime.InplaceWorkspaceManager(dir), onEvent: (e) => events.push(e) });
    assert.equal(calls, 1, 'no retry while waiting for an answer');
    assert.deepEqual(result.blocked, ['T1']);
    assert.ok(events.some((e) => e.type === 'WorkItemBlocked' && e.payload.reason === 'waiting_answer'));
  });

  it('the tool is offered only when the run opts in (execute.ask_orchestrator)', () => {
    const names = (opts) => runtime.selectToolsForActions([{ type: 'custom' }, { type: 'generate_patch' }], opts).map((t) => t.function.name);
    assert.ok(!names().includes('ask_orchestrator'));
    assert.ok(names({ askOrchestrator: true }).includes('ask_orchestrator'));
  });
});
