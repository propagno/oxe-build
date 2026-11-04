'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const budget = require('../bin/lib/oxe-budget.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21 · OXB-023: o teto de turnos/US$ de uma run é do runtime, não de alguém olhando eventos.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-budget-')); dirs.push(d); return d; }

describe('ledger de orçamento', () => {
  it('sem limite não há ledger; com limite soma entre execuções da mesma run', () => {
    const dir = tmpDir();
    assert.equal(budget.openBudget(dir, 'r1', {}), null);
    const l = budget.openBudget(dir, 'r1', { turns: 20 });
    budget.recordUsage(dir, l, { turns: 6, cost_usd: 0.69, task: 'T13', attempt: 1 });
    budget.recordUsage(dir, l, { turns: 4, cost_usd: 0.42, task: 'T14', attempt: 1 });
    const again = budget.openBudget(dir, 'r1', {});
    assert.deepEqual([again.used_turns, again.limit_turns, again.used_usd], [10, 20, 1.11]);
    assert.equal(budget.remainingTurns(again), 10);
    assert.equal(budget.describeBudget(again), '10/20 turnos · US$ 1.11');
    assert.equal(budget.openBudget(dir, 'r1', { reset: true, turns: 5 }).used_turns, 0);
  });

  it('a flag vence o PLAN.json e esgota por turnos ou por US$', () => {
    const dir = tmpDir();
    const l = budget.openBudget(dir, 'r2', { turns: 3, plan: { turns: 50, usd: 0.5 } });
    assert.deepEqual([l.limit_turns, l.limit_usd], [3, 0.5]);
    budget.recordUsage(dir, l, { turns: 3, cost_usd: 0.1 });
    assert.match(budget.exhaustedReason(l), /budget_turns: 3\/3/);
    const u = budget.openBudget(dir, 'r3', { usd: 0.2 });
    budget.recordUsage(dir, u, { turns: 1, cost_usd: 0.25 });
    assert.match(budget.exhaustedReason(u), /budget_usd/);
  });

  it('PLAN.json valida budget e o parser o leva adiante', () => {
    const doc = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1 }], budget: { turns: 20, usd: 5, max_retries: 1 } };
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    assert.deepEqual(planJson.planJsonToParsedPlan(doc).budget, { turns: 20, usd: 5, max_retries: 1 });
    assert.match(planJson.validatePlanJson({ ...doc, budget: { turns: 0, max_retries: -1 } }).join('\n'), /budget\.turns.*\n.*budget\.max_retries/s);
  });
});

describe('scheduler respeita o orçamento', () => {
  function graph(n) {
    const tasks = Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, title: `T${i + 1}`, wave: 1, dependsOn: [], files: [`f${i}.js`], verifyCommand: null, aceite: [], done: false }));
    return runtime.compile({ tasks, waves: { 1: tasks.map((t) => t.id) }, totalTasks: n }, { objective: 'b', criteria: [] }, { default_workspace_strategy: 'inplace' });
  }

  it('limita a tentativa aos turnos restantes e para entre tentativas com BudgetExhausted', async () => {
    const dir = tmpDir();
    const ledger = budget.openBudget(dir, 'r-sched', { turns: 7 });
    const seenCaps = [];
    const executor = {
      async execute(node, _lease, _run, _attempt, options) {
        seenCaps.push(options && options.maxTurns);
        budget.recordUsage(dir, ledger, { turns: Math.min(5, options.maxTurns), task: node.id });
        return { success: true, failure_class: null, evidence: [`${node.id}.js`], output: 'ok' };
      },
    };
    const events = [];
    const result = await new runtime.Scheduler().run(graph(3), {
      projectRoot: dir, sessionId: null, runId: 'r-sched', executor,
      workspaceManager: new runtime.InplaceWorkspaceManager(dir), onEvent: (e) => events.push(e),
      budget: budget.schedulerBudget(ledger),
    });
    assert.deepEqual(seenCaps, [7, 2], 'a 2ª tarefa só recebe os 2 turnos que restam; a 3ª nem começa');
    assert.equal(ledger.used_turns, 7, 'nunca passa do teto');
    const exhausted = events.find((e) => e.type === 'BudgetExhausted');
    assert.ok(exhausted, 'BudgetExhausted emitido');
    assert.equal(result.completed.length, 2);
    assert.equal(result.blocked.length, 1);
  });
});
