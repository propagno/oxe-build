'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const tiers = require('../bin/lib/oxe-model-tiers.cjs');
const scorecard = require('../bin/lib/oxe-scorecard.cjs');

// 1.21.2 — OXB-131: escalate the model tier after a logic failure, with a cap; override > tier > hint.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CFG = { models: { tiers: { fast: 'm-fast', balanced: 'm-bal', powerful: 'm-pow' }, escalate_on: ['logic'], max_escalations: 1 } };

describe('OXB-131: model tiers', () => {
  it('precedence override > tier > hint; only logic escalates; the cap is respected', () => {
    const sel = tiers.createModelSelector({ models: { ...CFG.models, overrides: { T9: 'm-x' } } }, new Map([['T1', { id: 'T1', model_hint: 'fast' }], ['T2', { id: 'T2' }], ['T3', { id: 'T3', model: 'm-task' }]]));
    assert.deepEqual(sel('T1', 1, null), { model: 'm-fast', tier: 'fast', escalated: false });
    assert.deepEqual(sel('T1', 2, 'verify'), { model: 'm-bal', tier: 'balanced', escalated: true });
    assert.equal(sel('T1', 3, 'verify').tier, 'balanced', 'max_escalations: 1 never reaches powerful');
    assert.equal(sel('T2', 1, null).tier, 'balanced');
    assert.equal(sel('T2', 2, 'env').tier, 'balanced', 'an environment failure does not escalate');
    assert.equal(sel('T9', 2, 'verify').model, 'm-x');
    assert.equal(sel('T3', 1, null).model, 'm-task');
    assert.equal(tiers.createModelSelector({}, new Map()), null, 'no models config → executor default');
  });

  it('the execute passes the tier model per attempt and records it; the scorecard sums cost per tier', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-mt-'));
    dirs.push(dir);
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, execute: { defer_failed: false }, ...CFG }));
    const gate = 'node -e "process.exit(require(\'fs\').existsSync(\'src/ok.js\')?0:1)"';
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, budget: { max_retries: 2 }, tasks: [{ id: 'T1', title: 'x', wave: 1, model_hint: 'fast', files: ['src/ok.js'], acceptance: ['A1'], verify: { commands: [gate] } }] }));
    write(dir, 'src/a.js', '1\n');
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
    const seen = [];
    const executor = { async execute(node, lease, _r, attempt, options) { seen.push(options && options.model); if (attempt === 2) write(lease.root_path, 'src/ok.js', '1\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(res.result.completed, ['T1']);
    assert.deepEqual(seen, ['m-fast', 'm-bal']);
    const events = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const starts = events.filter((e) => e.type === 'AttemptStarted' && e.work_item_id === 'T1');
    assert.deepEqual(starts.map((e) => [e.payload.model, e.payload.tier]), [['m-fast', 'fast'], ['m-bal', 'balanced']]);
    const runId = starts[0].run_id;
    const usage = [{ type: 'ExecutorUsage', run_id: runId, work_item_id: 'T1', payload: { attempt: 1, cost_usd: 0.1 } }, { type: 'ExecutorUsage', run_id: runId, work_item_id: 'T1', payload: { attempt: 2, cost_usd: 0.5 } }];
    const sc = scorecard.computeScorecard({ events: [...starts, ...usage], changeLines: [], ledgers: [] });
    assert.deepEqual(sc.sample.cost_by_tier, { fast: { attempts: 1, cost_usd: 0.1 }, balanced: { attempts: 1, cost_usd: 0.5 } });
  });
});
