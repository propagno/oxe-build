'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A13 — Motor determinístico oxe-deliver-engine, anti-cheat SHA-256, auto-cura/circuit breaker e MCP (OXB-230-13)', () => {
  it('OXB-230-13: oxe-deliver-engine.cjs enforces state machine transitions, frozen test SHA-256 anti-cheat, PHASE_HEAL escalation, circuit breaker PAUSED_BLOCKED and resume', () => {
    const intake = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-intake.cjs'));
    const engine = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-engine.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a13-engine-'));
    try {
      // 1. Vague briefing -> CLARIFY + pending_choice -> mode single-ok -> answer -> DESIGN_REVIEW -> approve
      const initRes = intake.initDelivery(dir, { briefingText: 'Crie um sistema legal.', skipGitInit: true });
      assert.equal(initRes.state.status, 'CLARIFY');
      assert.equal(initRes.state.approval_mode, 'pending_choice');

      const modeRes = engine.setApprovalMode(dir, 'single-ok');
      assert.equal(modeRes.ok, true);
      assert.equal(modeRes.state.approval_mode, 'single-ok');

      const ansRes = engine.answerClarification(dir, {
        Q1: 'Calculadora CLI com soma e subtracao',
        Q2: 'CLI em Node.js',
        Q3: 'Node.js 18+ stdlib',
      });
      assert.equal(ansRes.ok, true);
      assert.equal(ansRes.state.status, 'DESIGN_REVIEW');

      const appRes = engine.approveDelivery(dir);
      assert.equal(appRes.ok, true);
      assert.equal(appRes.state.status, 'PHASE_FREEZE_TESTS');

      // 2. Next contract in PHASE_FREEZE_TESTS
      const stepFreeze = engine.getNextDeliveryStep(dir);
      assert.equal(stepFreeze.ok, true);
      assert.equal(stepFreeze.state, 'PHASE_FREEZE_TESTS');
      assert.ok(stepFreeze.advance_cmd && stepFreeze.phase && stepFreeze.phase.id === 'F1');

      // 3. Create real acceptance test and freeze it
      fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const testRel = 'tests/acceptance/a1-calc.test.cjs';
      const originalTest = [
        "'use strict';",
        "const { test } = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const { add } = require('../../src/calc.cjs');",
        "test('A1: add returns exact sum', () => { assert.equal(add(2, 3), 5); });",
        '',
      ].join('\n');
      fs.writeFileSync(path.join(dir, testRel), originalTest, 'utf8');

      const advFreeze = engine.advanceDelivery(dir, { frozenTests: [testRel] });
      assert.equal(advFreeze.ok, true, JSON.stringify(advFreeze));
      assert.equal(advFreeze.state.status, 'PHASE_PLAN');
      assert.ok(advFreeze.state.frozen_test_hashes[testRel], 'SHA-256 hash of frozen test must be recorded');

      // 4. Advance PHASE_PLAN -> PHASE_IMPLEMENT
      const advPlan = engine.advanceDelivery(dir, {
        planTasks: [
          {
            id: 'T1',
            title: 'Implementar add em src/calc.cjs',
            files: ['src/calc.cjs'],
            acceptance: advFreeze.state.phases[0].acceptance,
            verify: `node --test ${testRel}`,
          },
        ],
      });
      assert.equal(advPlan.ok, true, JSON.stringify(advPlan));
      assert.equal(advPlan.state.status, 'PHASE_IMPLEMENT');

      // 5. Anti-cheat: tampering with frozen test MUST block advance
      fs.writeFileSync(path.join(dir, testRel), `${originalTest}// tampered\n`, 'utf8');
      fs.writeFileSync(path.join(dir, 'src', 'calc.cjs'), 'module.exports = { add: (a, b) => a + b };\n', 'utf8');
      const tampered = engine.advanceDelivery(dir, { verifyCommand: `node --test ${testRel}` });
      assert.equal(tampered.ok, false);
      assert.match(String(tampered.error || ''), /congelad|tamper|adulter|hash/i);
      fs.writeFileSync(path.join(dir, testRel), originalTest, 'utf8');

      // 6. Buggy implementation -> enters PHASE_HEAL, escalates tier, repeated failure trips circuit breaker -> PAUSED_BLOCKED
      fs.writeFileSync(path.join(dir, 'src', 'calc.cjs'), 'module.exports = { add: () => 0 };\n', 'utf8');
      const heal1 = engine.advanceDelivery(dir, { verifyCommand: `node --test ${testRel}`, costUsd: 0.1 });
      assert.equal(heal1.ok, false);
      assert.equal(heal1.state.status, 'PHASE_HEAL');
      assert.equal(heal1.state.heal_state.attempt, 1);

      const heal2 = engine.advanceDelivery(dir, { verifyCommand: `node --test ${testRel}`, costUsd: 0.1 });
      assert.equal(heal2.ok, false);
      assert.equal(heal2.state.status, 'PAUSED_BLOCKED');
      assert.ok(heal2.state.blocked_reason, 'circuit breaker must record blocked_reason');

      // 7. Resume -> fix code -> verify passes -> closes phase and reaches FINAL_SMOKE
      const resumed = engine.resumeDelivery(dir, { note: 'corrigindo soma' });
      assert.equal(resumed.ok, true);
      assert.equal(resumed.state.status, 'PHASE_IMPLEMENT');

      fs.writeFileSync(path.join(dir, 'src', 'calc.cjs'), 'module.exports = { add: (a, b) => a + b };\n', 'utf8');
      const passed = engine.advanceDelivery(dir, { verifyCommand: `node --test ${testRel}`, costUsd: 0.05 });
      assert.equal(passed.ok, true, JSON.stringify(passed));
      assert.equal(passed.state.phases[0].status, 'closed');
      assert.equal(passed.state.status, 'FINAL_SMOKE');
      assert.ok(engine.STATES.includes('PHASE_VERIFY') && engine.STATES.includes('PHASE_CLOSE'));
      assert.ok(passed.state.history.some((h) => h.event === 'PHASE_VERIFY' || h.status === 'PHASE_VERIFY'));
      assert.ok(passed.state.history.some((h) => h.event === 'PHASE_CLOSE' || h.status === 'PHASE_CLOSE'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-13: CLI oxe-cc deliver and MCP tools oxe_deliver_status/next/advance operate the same state machine', async () => {
    const intake = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-intake.cjs'));
    const mcp = require(path.join(REPO_ROOT, 'bin/lib/oxe-mcp-server.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a13-mcp-'));
    try {
      const briefing = '# Demo API\n\n## Objetivo\nAPI HTTP simples em Node.js com healthcheck e CRUD JSON.\n\n## Requisitos\n- Rota GET /health retornando 200\n- Rota POST/GET /items persistidos em JSON\n';
      intake.initDelivery(dir, { briefingText: briefing, approval: 'auto', skipGitInit: true });

      const cliStatus = spawnSync(process.execPath, [CLI, 'deliver', 'status', '--json', '--dir', dir], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, OXE_NO_BANNER: '1' },
      });
      assert.equal(cliStatus.status, 0, cliStatus.stderr + cliStatus.stdout);
      const stJson = JSON.parse(cliStatus.stdout.trim());
      assert.equal(stJson.oxeDeliverSchema, 1);
      assert.equal(stJson.state.status, 'PHASE_FREEZE_TESTS');

      const cliNext = spawnSync(process.execPath, [CLI, 'deliver', 'next', '--json', '--dir', dir], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, OXE_NO_BANNER: '1' },
      });
      assert.equal(cliNext.status, 0, cliNext.stderr + cliNext.stdout);
      const nextJson = JSON.parse(cliNext.stdout.trim());
      assert.equal(nextJson.state, 'PHASE_FREEZE_TESTS');

      // MCP tools (oxe_deliver_*)
      const srv = mcp.createMcpServer({ projectRoot: dir });
      const listResp = await srv.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      const names = listResp.result.tools.map((t) => t.name);
      assert.ok(names.includes('oxe_deliver_status'), 'oxe_deliver_* must expose oxe_deliver_status');
      assert.ok(names.includes('oxe_deliver_next'), 'oxe_deliver_* must expose oxe_deliver_next');
      assert.ok(names.includes('oxe_deliver_advance'), 'oxe_deliver_* must expose oxe_deliver_advance');

      const callNext = await srv.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'oxe_deliver_next', arguments: { dir } } });
      assert.ok(!callNext.result.isError);
      const mcpNext = JSON.parse(callNext.result.content[0].text);
      assert.equal(mcpNext.state, 'PHASE_FREEZE_TESTS');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
