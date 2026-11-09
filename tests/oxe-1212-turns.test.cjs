'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const turns = require('../bin/lib/oxe-turns.cjs');

// 1.21.2 — OXB-185: out of turns is reported as turns_exhausted (never scope/verify); turns sized to the task.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-tu-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, execute: { defer_failed: false }, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, budget: { max_retries: 1 }, tasks }, null, 2));
  write(dir, 'src/a.js', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  return dir;
}

describe('OXB-185: turns sized to the task', () => {
  it('max_turns > size > estimate; a retry after turns_exhausted gets the next size', () => {
    const sizer = turns.createTurnSizer({}, new Map([
      ['T1', { id: 'T1', files: ['a.js'] }],
      ['T2', { id: 'T2', files: ['a', 'b', 'c', 'd'] }],
      ['T3', { id: 'T3', files: ['src/**/*.ts', 'x', 'y', 'z', 'w'] }],
      ['T4', { id: 'T4', files: ['a'], size: 'L' }],
      ['T5', { id: 'T5', files: ['a'], max_turns: 25 }],
    ]), new Map());
    assert.deepEqual(['T1', 'T2', 'T3', 'T4', 'T5'].map((t) => sizer(t, 1, null)), [15, 30, 60, 60, 25]);
    assert.equal(sizer('T1', 2, 'turns_exhausted'), 30);
    assert.equal(sizer('T1', 2, 'verify'), 15);
    assert.equal(sizer('T5', 2, 'turns_exhausted'), 50);
  });

  it('the execute passes the sized turns, capped by the provider maxTurns; out of turns is turns_exhausted, never scope/verify', async () => {
    const dir = project([{ id: 'T13', title: 'remoção grande', wave: 1, files: ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(1)"'] } }]);
    const seen = [];
    const executor = {
      async execute(node, lease, _r, attempt, options) {
        seen.push(options && options.maxTurns);
        write(lease.root_path, 'src/a.js', `${attempt}\n`);
        return { success: false, failure_class: 'turns_exhausted', evidence: ['src/a.js'], output: `turns_exhausted: ${options.maxTurns}/${options.maxTurns} turnos usados sem finish_task\nthe change needs a file outside the scope`, completed_by: 'turn_limit_exhausted', turns_used: options.maxTurns, turns_cap: options.maxTurns };
      },
    };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(seen, [30, 60], 'M (4 files) → 30, retry after turns_exhausted → L 60');
    const ev = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(!ev.some((e) => e.type === 'ScopeInsufficient'), 'not classed as scope_insufficient');
    const retry = ev.find((e) => e.type === 'RetryScheduled');
    assert.equal(retry.payload.reason, 'turns_exhausted');
    const blocked = ev.find((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T13');
    assert.equal(blocked.payload.failure_class, 'turns_exhausted');
    assert.match(blocked.payload.output_tail, /turns_exhausted: 60\/60 turnos/);
  });

  it('plan lint warns when a task needs more turns than the global cap', () => {
    const dir = project([{ id: 'T1', title: 'grande', wave: 1, files: ['src/**/*.ts', 'a', 'b', 'c', 'd'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }], { runtime: { provider: { maxTurns: 10 } } });
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.warnings.some((w) => /T1: tarefa L pede 60 turnos, mas runtime\.provider\.maxTurns=10 limita/.test(w)), lint.warnings.join('\n'));
  });
});
