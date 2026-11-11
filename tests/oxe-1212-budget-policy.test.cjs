'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const budget = require('../bin/lib/oxe-budget.cjs');

// 1.21.2 — OXB-036: the user approved a US$ 275 cap by phases and, hours later, removed it ("o valor final é o produto
// funcional"). The budget lived in execute flags or in each PLAN.json, and nothing recorded who changed the policy.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-bp-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, budget: { usd: 5 }, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
  const phase = { id: 'F1', title: 'Base', requirements: [], acceptance: ['A1'], scope: null, status: 'executing', plan_ref: '.oxe/PLAN.md', run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null };
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F1', created_at: 'x', updated_at: 'x', phases: [phase] }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-036: the program budget policy', () => {
  it('cap then track_only: recorded with who/why/when; the ledger follows the policy over PLAN.json', () => {
    const dir = project();
    op.runtimeProgramBudget(dir, null, { mode: 'cap', usd: 275, by: 'usuário', reason: 'teto aprovado por fases' });
    let led = budget.openBudget(dir, 'run-1', { plan: { usd: 5 }, policy: JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8')).budget_policy });
    assert.equal(led.limit_usd, 275, 'the program cap wins over the PLAN.json budget');
    assert.equal(led.policy, 'cap');
    const out = op.runtimeProgramBudget(dir, null, { mode: 'track_only', by: 'usuário', reason: 'o valor final é o produto funcional' });
    assert.equal(out.policy.mode, 'track_only');
    assert.deepEqual(out.policy.history.map((h) => h.mode), ['cap', 'track_only']);
    led = budget.openBudget(dir, 'run-1', { plan: { usd: 5 }, policy: out.policy });
    assert.equal(led.limit_usd, null, 'track_only drops the previous cap of the same run');
    assert.equal(led.policy, 'track_only');
    assert.equal(budget.exhaustedReason(led), null);
    assert.equal(budget.openBudget(dir, 'run-1', { usd: 10, policy: out.policy }).limit_usd, 10, 'an explicit CLI flag still caps');
    const log = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8');
    assert.match(log, /"action":"budget_policy","before":\{"mode":"cap","usd":275,"turns":null\},"after":\{"mode":"track_only"/);
  });

  it('refuses a cap without a number, a track_only with one, and a change without --by/--reason', () => {
    const dir = project();
    assert.throws(() => op.runtimeProgramBudget(dir, null, { mode: 'cap', by: 'tl', reason: 'teto do programa' }), /exige --budget-usd/);
    assert.throws(() => op.runtimeProgramBudget(dir, null, { mode: 'track_only', usd: 3, by: 'tl', reason: 'teto do programa' }), /track_only não tem teto/);
    assert.throws(() => op.runtimeProgramBudget(dir, null, { mode: 'cap', usd: 3, reason: 'teto do programa' }), /--by/);
    assert.equal(op.runtimeProgramBudget(dir, null, {}).policy, null);
  });

  it('execute opens a track_only ledger that records spend with no cap (CLI)', async () => {
    const dir = project();
    let r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'budget', '--mode', 'track_only', '--by', 'usuário', '--reason', 'sem teto, só acompanhar', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /track_only \(sem teto; o gasto é registrado\)/);
    const executor = { async execute() { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1'); return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' }; } };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(res.budget.policy, 'track_only');
    assert.equal(res.budget.limit_usd, null, 'the PLAN.json budget (US$ 5) does not cap under track_only');
    r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'budget', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.match(r.stdout, /track_only . usuário: sem teto, só acompanhar/);
  });
});
