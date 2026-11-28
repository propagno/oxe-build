'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A14 — Runner headless deliver run, FINAL_SMOKE real e handoff DELIVERY.md (OXB-230-14)', () => {
  it('OXB-230-14: oxe-deliver-runner.cjs drives F1..Fn autonomously with approval_mode, tier escalation, max_budget_usd, and oxe-deliver-handoff.cjs runs FINAL_SMOKE and writes DELIVERY.md + DELIVERY.json', async () => {
    const runner = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-runner.cjs'));
    const handoff = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-handoff.cjs'));
    const op = require(path.join(REPO_ROOT, 'bin/lib/oxe-operational.cjs'));
    assert.equal(typeof op.runtimeDeliverRun, 'function');
    const helpRes = spawnSync(process.execPath, [CLI, 'deliver', 'run', '--help'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, OXE_NO_BANNER: '1' } });
    assert.equal(helpRes.status, 0);
    assert.match(helpRes.stdout, /deliver.*run|run/i);

    const briefing = [
      '# CLI Greeter Local',
      '',
      '## Objetivo',
      'Criar um CLI Node.js local em bin/greet.js que sauda usuarios e exibe versao.',
      '',
      '## Requisitos',
      '- Comando bin/greet.js --help exibindo uso',
      '- Comando bin/greet.js Ana imprimindo Ola, Ana!',
      '',
      '## Stack',
      '- Node.js 18+ sem dependencias externas',
    ].join('\n');

    // 1. approval_mode: single-ok pauses at DESIGN_REVIEW before executing
    const dirSingle = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a14-single-'));
    try {
      const pauseRes = await runner.runAutonomousDelivery(dirSingle, {
        briefingText: briefing,
        approval: 'single-ok',
        skipGitInit: true,
        executorFn: async () => { throw new Error('must not execute before approval'); },
      });
      assert.equal(pauseRes.ok, true);
      assert.equal(pauseRes.paused_for_approval, true);
      assert.equal(pauseRes.state.status, 'DESIGN_REVIEW');
      assert.equal(pauseRes.state.approval_mode, 'single-ok');
    } finally {
      fs.rmSync(dirSingle, { recursive: true, force: true });
    }

    // 2. approval_mode: auto runs end-to-end including 1 simulated failure -> PHASE_HEAL tier escalation -> fix -> FINAL_SMOKE -> DELIVERY.md
    const dirAuto = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a14-auto-'));
    try {
      let implCalls = 0;
      const seenTiers = [];
      const res = await runner.runAutonomousDelivery(dirAuto, {
        briefingText: briefing,
        approval: 'auto',
        maxBudgetUsd: 5,
        skipGitInit: true,
        executorFn: async (step) => {
          if (step.state === 'PHASE_FREEZE_TESTS') {
            fs.mkdirSync(path.join(dirAuto, 'tests', 'acceptance'), { recursive: true });
            const testRel = 'tests/acceptance/a1-greet.test.cjs';
            fs.writeFileSync(path.join(dirAuto, testRel), [
              "'use strict';",
              "const { test } = require('node:test');",
              "const assert = require('node:assert/strict');",
              "const { execFileSync } = require('node:child_process');",
              "const path = require('node:path');",
              "test('A1/A2: greet CLI responds properly', () => {",
              "  const bin = path.resolve(__dirname, '..', '..', 'bin', 'greet.js');",
              "  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });",
              "  assert.match(help, /greet/i);",
              "  const out = execFileSync(process.execPath, [bin, 'Ana'], { encoding: 'utf8' });",
              "  assert.match(out, /Ola, Ana!/);",
              "});",
              '',
            ].join('\n'), 'utf8');
            return { frozenTests: [testRel], costUsd: 0.05 };
          }
          if (step.state === 'PHASE_PLAN') {
            return {
              planTasks: [{
                id: 'T1',
                title: 'Implement bin/greet.js',
                files: ['bin/greet.js'],
                acceptance: step.phase.acceptance,
                verify: 'node --test tests/acceptance/a1-greet.test.cjs',
              }],
              costUsd: 0.03,
            };
          }
          if (step.state === 'PHASE_IMPLEMENT' || step.state === 'PHASE_HEAL') {
            implCalls += 1;
            seenTiers.push((step.heal_state && step.heal_state.tier) || 'balanced');
            fs.mkdirSync(path.join(dirAuto, 'bin'), { recursive: true });
            fs.writeFileSync(path.join(dirAuto, 'package.json'), JSON.stringify({
              name: 'greet-cli',
              version: '1.0.0',
              bin: { greet: 'bin/greet.js' },
              scripts: { test: 'node --test tests/acceptance/a1-greet.test.cjs' },
            }, null, 2));
            if (implCalls === 1) {
              // First attempt buggy -> triggers PHASE_HEAL & tier escalation
              fs.writeFileSync(path.join(dirAuto, 'bin', 'greet.js'), 'console.log("broken");\n', 'utf8');
            } else {
              // Second attempt (healed on escalated tier) -> real working CLI
              fs.writeFileSync(path.join(dirAuto, 'bin', 'greet.js'), [
                '#!/usr/bin/env node',
                "const arg = process.argv[2] || '--help';",
                "if (arg === '--help') { console.log('Usage: greet <name>'); process.exit(0); }",
                'console.log(`Ola, ${arg}!`);',
                '',
              ].join('\n'), 'utf8');
            }
            return { costUsd: 0.08 };
          }
          return {};
        },
      });

      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.state.status, 'DELIVERED');
      assert.equal(implCalls, 2, 'must retry once via PHASE_HEAL');
      assert.ok(seenTiers.includes('powerful'), `expected tier escalation to powerful, saw ${JSON.stringify(seenTiers)}`);
      assert.ok(res.state.smoke && res.state.smoke.ok === true, 'FINAL_SMOKE must pass on real CLI');

      const strategy = handoff.detectSmokeStrategy(dirAuto);
      assert.equal(strategy.kind, 'cli');

      const deliveryMd = path.join(dirAuto, res.state.handoff.delivery_md);
      const deliveryJson = path.join(dirAuto, res.state.handoff.delivery_json);
      assert.ok(fs.existsSync(deliveryMd), 'DELIVERY.md must exist');
      assert.ok(fs.existsSync(deliveryJson), 'DELIVERY.json must exist');
      const mdText = fs.readFileSync(deliveryMd, 'utf8');
      assert.match(mdText, /Como rodar/i);
      assert.match(mdText, /FINAL_SMOKE|Smoke/i);
      assert.match(mdText, /git push/i);
    } finally {
      fs.rmSync(dirAuto, { recursive: true, force: true });
    }

    // 3. Budget cap (max_budget_usd) stops cleanly in PAUSED_BLOCKED
    const dirBudget = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a14-budget-'));
    try {
      const budgetRes = await runner.runAutonomousDelivery(dirBudget, {
        briefingText: briefing,
        approval: 'auto',
        maxBudgetUsd: 0.05,
        skipGitInit: true,
        executorFn: async (step) => {
          if (step.state === 'PHASE_FREEZE_TESTS') {
            fs.mkdirSync(path.join(dirBudget, 'tests', 'acceptance'), { recursive: true });
            fs.writeFileSync(path.join(dirBudget, 'tests', 'acceptance', 'a1.test.cjs'), "const {test}=require('node:test');const assert=require('node:assert/strict');test('x',()=>assert.equal(1,2));\n");
            return { frozenTests: ['tests/acceptance/a1.test.cjs'], costUsd: 0.02 };
          }
          if (step.state === 'PHASE_PLAN') return { costUsd: 0.01 };
          return { costUsd: 0.05 };
        },
      });
      assert.equal(budgetRes.ok, false);
      assert.equal(budgetRes.state.status, 'PAUSED_BLOCKED');
      assert.match(String(budgetRes.state.blocked_reason || ''), /orçamento|budget/i);
    } finally {
      fs.rmSync(dirBudget, { recursive: true, force: true });
    }
  });
});
