'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');
const x = require('../bin/lib/oxe-phase-extras.cjs');

// 1.21.2 — OXB-117: (a) cost per task/CR/retry + forecast; (b) flaky quarantine; (c) regression impact before
// execute; (d) rollback rehearsal before close; (e) one-page phase report.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-px-')); dirs.push(d); return d; };

describe('OXB-117 (a): cost and forecast', () => {
  it('per task (with retries), per CR, totals and the forecast for the pending tasks', () => {
    const u = (id, attempt, cost, turns, ms) => ({ type: 'ExecutorUsage', work_item_id: id, payload: { attempt, cost_usd: cost, turns, elapsed_ms: ms } });
    const doc = { tasks: [{ id: 'T1', done: true }, { id: 'T2', done: true }, { id: 'T3' }, { id: 'T4' }] };
    const r = x.costReport([u('T1', 1, 1.0, 10, 60000), u('T2', 1, 2.0, 20, 120000), u('T2', 2, 1.0, 10, 60000)], doc, [{ id: 'CR-01', class: 'defect', tasks: ['T2'] }]);
    assert.deepEqual(r.tasks.map((t) => [t.task, t.cost_usd, t.attempts, t.retry_cost_usd]), [['T2', 3, 2, 1], ['T1', 1, 1, 0]]);
    assert.equal(r.totals.cost_usd, 4);
    assert.equal(r.totals.retry_cost_usd, 1);
    assert.deepEqual(r.crs, [{ cr: 'CR-01', class: 'defect', tasks: ['T2'], cost_usd: 3 }]);
    assert.deepEqual(r.forecast, { pending_tasks: 2, avg_cost_usd: 2, remaining_cost_usd: 4, phase_total_usd: 8, remaining_ms: 240000 });
  });
});

describe('OXB-117 (b): flaky quarantine', () => {
  it('a flaky verify is quarantined with evidence (counted); the lint names the tasks still using it', () => {
    const dir = tmp();
    const e = { task: 'T1', command: 'npx vitest run tests/m.test.ts', rerun: 'passed', evidence: 'FAIL tests/m.test.ts', at: '2026-11-09T10:00:00Z' };
    x.quarantine(dir, e);
    x.quarantine(dir, { ...e, at: '2026-11-09T11:00:00Z' });
    const q = x.readQuarantine(dir);
    assert.equal(q.entries.length, 1);
    assert.equal(q.entries[0].count, 2);
    const w = x.quarantineWarnings(dir, { tasks: [{ id: 'T5', verify: { commands: ['npx vitest run tests/m.test.ts --reporter=dot'] } }] });
    assert.match(w[0], /verify em quarentena \(instável 2×.*usado por T5/);
  });
});

describe('OXB-117 (c): regression impact', () => {
  it('a pending task touching a file the closed phase\'s regression test imports is named in the preflight', () => {
    const dir = tmp();
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Mais\n\n**Critérios de aceite:** A2\n');
    write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false }));
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T7', title: 'x', wave: 1, files: ['src/store.js'], acceptance: ['A2'], verify: { commands: ['node -e 0'] } }] }));
    write(dir, 'src/store.js', 'exports.s = 1;\n');
    write(dir, 'tests/acceptance/f1/store.test.js', "require('../../../src/store.js');\n");
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
    op.runtimeProgramInit(dir, null, {});
    const pdir = path.join(dir, '.oxe', 'program');
    const s = programLib.readProgram(pdir);
    Object.assign(s.phases[0], { status: 'closed', closed_at: new Date().toISOString() });
    programLib.writeProgram(pdir, s);
    write(dir, '.oxe/program/regression/F1.json', JSON.stringify({ schema_version: 1, phase: 'F1', checks: [{ id: 'chk-a1', command: 'node --test tests/acceptance/f1/store.test.js' }] }));
    op.runtimeProgramStart(dir, null, 'F2');
    const pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.warnings.some((w) => /^regression_impact:T7 mexe em src\/store\.js \(reg-f1-chk-a1\)/.test(w)), pre.warnings.join('\n'));
  });
});

describe('OXB-117 (d)(e): rollback rehearsal and phase report', () => {
  it('the phase commits revert cleanly in a temporary worktree; the real tree is untouched', () => {
    const dir = tmp();
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    write(dir, 'a.txt', '1\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    write(dir, 'a.txt', '2\n'); git(dir, 'commit', '-qam', 'phase 1');
    write(dir, 'b.txt', 'x\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'phase 2');
    const r = x.rehearseRollback(dir, base);
    assert.deepEqual([r.ok, r.commits, r.conflicts], [true, 2, []]);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), '2\n');
    assert.equal(git(dir, 'worktree', 'list').stdout.trim().split(/\r?\n/).length, 1);
  });

  it('the report is one page: delivered, cost, CRs, risks, rollback', () => {
    const md = x.renderPhaseReport({ phase: 'F2', title: 'Settings', at: '2026-11-09', commit: 'abcdef1234', criteria: ['A4', 'A5'], tasks_done: 6, tasks_total: 7, first_attempt_rate: 0.83, cost: { totals: { cost_usd: 12.5, retry_cost_usd: 2, turns: 300, ms: 5400000 } }, crs_total: 3, crs_resolved: 2, crs_open: 1, defects_waived: 1, complexity_alarms: 0, api_flagged: 2, deferred: 0, quarantined: 1, rollback: { ok: true, commits: 9 } });
    assert.match(md, /^# Relatório da fase F2 — Settings/);
    assert.match(md, /Tarefas: 6\/7 concluídas · 83% na 1ª tentativa/);
    assert.match(md, /US\$ 12\.50 \(retries US\$ 2\.00\) · 300 turnos · 1\.5 h/);
    assert.match(md, /2 mudança\(s\) de API fora do pack/);
    assert.match(md, /os 9 commit\(s\) da fase revertem sem conflito/);
    assert.ok(md.split('\n').length < 40, 'one page');
  });
});
