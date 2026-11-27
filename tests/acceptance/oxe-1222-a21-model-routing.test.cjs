'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const scorecard = require('../../bin/lib/oxe-scorecard.cjs');
const planBuild = require('../../bin/lib/oxe-plan-build.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkRepo(prefix = 'oxe-a21-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '# Guide\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'exports.a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'exports.b = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'c.js'), 'exports.c = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'd.js'), 'exports.d = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'e.js'), 'exports.e = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A21 — Roteamento empírico de modelos por categoria de tarefa (OXB-222-21)', () => {
  it('OXB-222-21: computeModelRoutingStats and scorecard --with-routing compute offline tier stats and plan build annotates suggested_model_hint preserving explicit model_hint', () => {
    const dir = mkRepo('oxe-a21-');
    try {
      const events = [
        // docs-config: fast succeeds 100% on attempt 1
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T1', timestamp: '2026-11-20T10:00:00Z', payload: { tier: 'fast', category: 'docs-config', turns: 2, cost_usd: 0.01, success: true } },
        { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T1', timestamp: '2026-11-20T10:00:10Z', payload: { attempt_number: 1, category: 'docs-config', tier: 'fast' } },
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T2', timestamp: '2026-11-20T10:01:00Z', payload: { tier: 'fast', category: 'docs-config', turns: 3, cost_usd: 0.02, success: true } },
        { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T2', timestamp: '2026-11-20T10:01:10Z', payload: { attempt_number: 1, category: 'docs-config', tier: 'fast' } },
        // multi-file-refactor: balanced failed twice -> escalate recommendation to powerful
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T3', timestamp: '2026-11-20T10:02:00Z', payload: { tier: 'balanced', category: 'multi-file-refactor', turns: 8, cost_usd: 0.15, success: false } },
        { type: 'RetryScheduled', run_id: 'r1', work_item_id: 'T3', timestamp: '2026-11-20T10:02:10Z', payload: { category: 'multi-file-refactor' } },
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T3', timestamp: '2026-11-20T10:03:00Z', payload: { tier: 'powerful', category: 'multi-file-refactor', turns: 4, cost_usd: 0.30, success: true } },
        { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T3', timestamp: '2026-11-20T10:03:10Z', payload: { attempt_number: 2, category: 'multi-file-refactor', tier: 'powerful' } },
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T4', timestamp: '2026-11-20T10:04:00Z', payload: { tier: 'balanced', category: 'multi-file-refactor', turns: 9, cost_usd: 0.18, success: false } },
        { type: 'RetryScheduled', run_id: 'r1', work_item_id: 'T4', timestamp: '2026-11-20T10:04:10Z', payload: { category: 'multi-file-refactor' } },
        { type: 'ExecutorUsage', run_id: 'r1', work_item_id: 'T4', timestamp: '2026-11-20T10:05:00Z', payload: { tier: 'powerful', category: 'multi-file-refactor', turns: 5, cost_usd: 0.32, success: true } },
        { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T4', timestamp: '2026-11-20T10:05:10Z', payload: { attempt_number: 2, category: 'multi-file-refactor', tier: 'powerful' } },
      ];

      // 1. Offline stats computation
      const stats = scorecard.computeModelRoutingStats(events);
      assert.equal(stats.offline, true);
      assert.ok(stats.by_category['docs-config'], 'expected docs-config category stats');
      assert.equal(stats.by_category['docs-config'].recommended_tier, 'fast');
      assert.ok(stats.by_category['multi-file-refactor'], 'expected multi-file-refactor category stats');
      assert.equal(stats.by_category['multi-file-refactor'].recommended_tier, 'powerful');

      // 2. CLI `oxe-cc runtime scorecard --with-routing --json`
      fs.mkdirSync(path.join(dir, '.oxe', 'events'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.oxe', 'events', 'events.ndjson'),
        `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
        'utf8',
      );
      const withoutFlag = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'runtime', 'scorecard', '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(withoutFlag.model_routing, undefined, 'model_routing must stay omitted without --with-routing');

      const withRouting = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'runtime', 'scorecard', '--with-routing', '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(withRouting.model_routing.offline, true);
      assert.equal(withRouting.model_routing.by_category['docs-config'].recommended_tier, 'fast');
      assert.equal(withRouting.model_routing.by_category['multi-file-refactor'].recommended_tier, 'powerful');

      // 3. `plan build` annotates `suggested_model_hint` and preserves explicit `model_hint`
      const roleDoc = {
        role: 'fase',
        tasks: [
          {
            rid: 'R1',
            title: 'Update docs guide',
            kind: 'config-only',
            files: ['docs/guide.md'],
            edited: ['docs/guide.md'],
            acceptance: ['A1'],
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
          {
            rid: 'R2',
            title: 'Multi-file refactor across 5 modules',
            files: ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js'],
            edited: ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js'],
            acceptance: ['A2'],
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
          {
            rid: 'R3',
            title: 'Explicit user hint must win',
            files: ['docs/guide.md'],
            edited: ['docs/guide.md'],
            model_hint: 'powerful',
            acceptance: ['A3'],
            depends_on: ['R1'],
            verify: { commands: ['node -e "process.exit(0)"'] },
          },
        ],
        acceptance_tests: [],
      };
      const built = planBuild.build(dir, [roleDoc], { phase: 'F1' });
      const t1 = built.plan.tasks.find((t) => t.rid === 'R1');
      const t2 = built.plan.tasks.find((t) => t.rid === 'R2');
      const t3 = built.plan.tasks.find((t) => t.rid === 'R3');
      assert.equal(t1.suggested_model_hint, 'fast');
      assert.ok(typeof t1.routing_reason === 'string' && t1.routing_reason.length > 0);
      assert.equal(t2.suggested_model_hint, 'powerful');
      assert.equal(t3.model_hint, 'powerful', 'explicit model_hint must NEVER be overwritten');
      assert.equal(t3.suggested_model_hint, 'fast', 'suggested_model_hint still records empirical suggestion');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
