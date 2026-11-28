'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function httpReq(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: raw }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('A15 — Dashboard v2 Live Deliver, /oxe-deliver sincronizado e Prova E2E Greenfield + Brownfield (OXB-230-15)', () => {
  it('OXB-230-15: oxe/workflows/deliver.md exists and runtime wrappers are synchronized with 0 mismatches', () => {
    const semantics = require(path.join(REPO_ROOT, 'bin/lib/oxe-runtime-semantics.cjs'));
    const deliverWf = path.join(REPO_ROOT, 'oxe/workflows/deliver.md');
    assert.ok(fs.existsSync(deliverWf), 'oxe/workflows/deliver.md must exist');
    const wfText = fs.readFileSync(deliverWf, 'utf8');
    assert.match(wfText, /oxe-cc primer/i);
    assert.match(wfText, /oxe-cc deliver/i);
    assert.match(wfText, /single-ok/i);
    const audit = semantics.auditRuntimeTargets(REPO_ROOT);
    assert.equal(audit.ok, true, JSON.stringify(audit));
    assert.equal(audit.mismatches.length, 0, JSON.stringify(audit.mismatches));
  });

  it('OXB-230-15: Greenfield E2E (primer → deliver → versão rodando + DELIVERY.md + DELIVER.json + Dashboard Entrega Pronta)', async () => {
    const primer = require(path.join(REPO_ROOT, 'bin/lib/oxe-primer.cjs'));
    const runner = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-runner.cjs'));
    const dashboard = require(path.join(REPO_ROOT, 'bin/lib/oxe-dashboard.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a15-green-'));
    try {
      const p0 = primer.buildPrimer(dir);
      assert.equal(p0.project_mode, 'greenfield');

      const briefing = [
        '# Mini Gerenciador de Notas CLI',
        '',
        '## Objetivo',
        'Construir um CLI Node.js local em bin/notes.js para adicionar e listar notas em JSON.',
        '',
        '## Requisitos',
        '- Salvar nota com titulo e corpo em arquivo JSON local',
        '- Listar notas salvas via comando list',
        '- Exibir ajuda via --help',
        '',
        '## Stack',
        '- Node.js 18+ sem dependencias externas',
      ].join('\n');

      const runRes = await runner.runAutonomousDelivery(dir, {
        briefingText: briefing,
        approval: 'auto',
        maxBudgetUsd: 5,
        skipGitInit: true,
        executorFn: async (step) => {
          if (step.state === 'PHASE_FREEZE_TESTS') {
            fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
            const testRel = `tests/acceptance/${step.phase.id.toLowerCase()}-notes.test.cjs`;
            fs.writeFileSync(path.join(dir, testRel), [
              "'use strict';",
              "const { test } = require('node:test');",
              "const assert = require('node:assert/strict');",
              "const { execFileSync } = require('node:child_process');",
              "const path = require('node:path');",
              "test('notes CLI add and list works end-to-end', () => {",
              "  const bin = path.resolve(__dirname, '..', '..', 'bin', 'notes.js');",
              "  const out = execFileSync(process.execPath, [bin, 'add', 'Comprar cafe'], { encoding: 'utf8' });",
              "  assert.match(out, /Comprar cafe/);",
              "});",
              '',
            ].join('\n'), 'utf8');
            return { frozenTests: [testRel], costUsd: 0.04 };
          }
          if (step.state === 'PHASE_PLAN') {
            return {
              planTasks: [{
                id: 'T1',
                title: 'Implement bin/notes.js',
                files: ['bin/notes.js'],
                acceptance: step.phase.acceptance,
                verify: `node --test ${step.frozen_tests[0]}`,
              }],
              costUsd: 0.02,
            };
          }
          if (step.state === 'PHASE_IMPLEMENT' || step.state === 'PHASE_HEAL') {
            fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
              name: 'notes-cli',
              version: '1.0.0',
              bin: { notes: 'bin/notes.js' },
              scripts: { test: `node --test ${step.frozen_tests[0]}` },
            }, null, 2));
            fs.writeFileSync(path.join(dir, 'bin', 'notes.js'), [
              '#!/usr/bin/env node',
              "const cmd = process.argv[2] || '--help';",
              "if (cmd === '--help') { console.log('Usage: notes add <text> | list'); process.exit(0); }",
              "if (cmd === 'add') { console.log('Saved: ' + process.argv.slice(3).join(' ')); process.exit(0); }",
              "console.log('[]');",
              '',
            ].join('\n'), 'utf8');
            return { costUsd: 0.05 };
          }
          return {};
        },
      });

      assert.equal(runRes.ok, true, JSON.stringify(runRes));
      assert.equal(runRes.state.status, 'DELIVERED');
      assert.ok(fs.existsSync(path.join(dir, '.oxe', runRes.state.session, 'DELIVER.json')), 'DELIVER.json must exist');
      assert.ok(fs.existsSync(path.join(dir, runRes.state.handoff.delivery_md)));

      // Verify Dashboard v2 exposes live delivery & "Entrega Pronta" card
      const server = dashboard.createDashboardServer(dir);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      try {
        const htmlRes = await httpReq(port, 'GET', '/');
        assert.equal(htmlRes.statusCode, 200);
        assert.match(htmlRes.body, /Entrega Pronta/i);

        const stateRes = await httpReq(port, 'GET', '/api/state');
        assert.equal(stateRes.statusCode, 200);
        const st = JSON.parse(stateRes.body);
        assert.ok(st.delivery && st.delivery.state, 'Dashboard /api/state must expose delivery state');
        assert.equal(st.delivery.state.status, 'DELIVERED');
        assert.ok(st.delivery.handoff && Array.isArray(st.delivery.handoff.how_to_run));
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-15: Brownfield E2E (primer brownfield -> deliver init -> Dashboard approve -> chat-driven next/advance -> regression + DELIVERED)', async () => {
    const primer = require(path.join(REPO_ROOT, 'bin/lib/oxe-primer.cjs'));
    const intake = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-intake.cjs'));
    const engine = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-engine.cjs'));
    const dashboard = require(path.join(REPO_ROOT, 'bin/lib/oxe-dashboard.cjs'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a15-brown-'));
    try {
      // Existing brownfield codebase with legacy test
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'brownfield-lib',
        version: '1.0.0',
        scripts: { test: 'node --test tests/*.test.cjs tests/acceptance/*.test.cjs' },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'src', 'math.cjs'), 'module.exports = { sum: (a, b) => a + b };\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'tests', 'legacy.test.cjs'), "const {test}=require('node:test');const assert=require('node:assert/strict');const {sum}=require('../src/math.cjs');test('legacy sum',()=>assert.equal(sum(1,2),3));\n", 'utf8');
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });

      const p = primer.buildPrimer(dir);
      assert.equal(p.project_mode, 'brownfield');

      const briefing = '# Nova funcao multiply\n\n## Objetivo\nAdicionar funcao multiply(a, b) em src/math.cjs mantendo sum intacto.\n\n## Requisitos\n- Exportar multiply(a, b) em src/math.cjs\n- Preservar sum(a, b) e testes existentes\n';
      const initRes = intake.initDelivery(dir, { briefingText: briefing, skipGitInit: true });
      assert.equal(initRes.state.approval_mode, 'pending_choice');
      assert.equal(initRes.state.status, 'DESIGN_REVIEW');

      // Approve via Dashboard API (POST /api/deliver/mode + POST /api/deliver/approve)
      const server = dashboard.createDashboardServer(dir);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      try {
        const modeResp = await httpReq(port, 'POST', '/api/deliver/mode', { mode: 'single-ok' });
        assert.equal(modeResp.statusCode, 200);
        const appResp = await httpReq(port, 'POST', '/api/deliver/approve', { by: 'reviewer' });
        assert.equal(appResp.statusCode, 200);
      } finally {
        server.close();
      }

      // Chat-driven loop: next -> freeze -> plan -> implement -> verify -> FINAL_SMOKE -> DELIVERED
      assert.equal(engine.getNextDeliveryStep(dir).state, 'PHASE_FREEZE_TESTS');
      fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
      const testRel = 'tests/acceptance/a1-multiply.test.cjs';
      fs.writeFileSync(path.join(dir, testRel), "const {test}=require('node:test');const assert=require('node:assert/strict');const {sum,multiply}=require('../../src/math.cjs');test('A1: multiply & legacy sum',()=>{assert.equal(sum(2,3),5);assert.equal(multiply(3,4),12);});\n", 'utf8');
      assert.equal(engine.advanceDelivery(dir, { frozenTests: [testRel] }).ok, true);
      assert.equal(engine.advanceDelivery(dir, { planTasks: [{ id: 'T1', title: 'Add multiply', files: ['src/math.cjs'], acceptance: initRes.state.phases[0].acceptance, verify: `node --test ${testRel}` }] }).ok, true);
      fs.writeFileSync(path.join(dir, 'src', 'math.cjs'), 'module.exports = { sum: (a, b) => a + b, multiply: (a, b) => a * b };\n', 'utf8');
      const vRes = engine.advanceDelivery(dir, { verifyCommand: `node --test tests/legacy.test.cjs ${testRel}` });
      assert.equal(vRes.ok, true, JSON.stringify(vRes));
      assert.equal(vRes.state.status, 'FINAL_SMOKE');

      const sRes = engine.advanceDelivery(dir);
      assert.equal(sRes.ok, true, JSON.stringify(sRes));
      assert.equal(sRes.state.status, 'DELIVERED');
      assert.ok(fs.existsSync(path.join(dir, sRes.state.handoff.delivery_md)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
