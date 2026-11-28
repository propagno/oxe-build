'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A12 — Primer compacto do agente e Intake autônomo deliver init (OXB-230-12)', () => {
  it('OXB-230-12: oxe-primer.cjs detects greenfield/brownfield, emits < 80-line guide, wires CLI primer & MCP oxe_primer', async () => {
    const primerMod = require(path.join(REPO_ROOT, 'bin/lib/oxe-primer.cjs'));
    const mcpMod = require(path.join(REPO_ROOT, 'bin/lib/oxe-mcp-server.cjs'));

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a12-green-'));
    const brownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a12-brown-'));
    try {
      // Greenfield
      const green = primerMod.buildPrimer(emptyDir);
      assert.equal(green.project_mode, 'greenfield');
      assert.ok(Array.isArray(green.rules) && green.rules.length >= 5);
      const md = primerMod.formatPrimerMarkdown(green);
      const lines = md.trim().split(/\r?\n/);
      assert.ok(lines.length < 80, `primer markdown must stay < 80 lines, got ${lines.length}`);
      assert.match(md, /oxe-cc deliver/i);
      assert.match(md, /single-ok/i);
      assert.match(md, /auto/i);

      // Brownfield
      fs.writeFileSync(path.join(brownDir, 'package.json'), JSON.stringify({ name: 'demo-app', version: '1.0.0', scripts: { test: 'node --test' } }));
      fs.mkdirSync(path.join(brownDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(brownDir, 'src', 'index.js'), 'module.exports = () => 42;\n');
      const brown = primerMod.buildPrimer(brownDir);
      assert.equal(brown.project_mode, 'brownfield');
      assert.ok(brown.environment && Array.isArray(brown.environment.stacks));

      // CLI `oxe-cc primer --json`
      const cliRes = spawnSync(process.execPath, [CLI, 'primer', '--json', '--dir', brownDir], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, OXE_NO_BANNER: '1' },
      });
      assert.equal(cliRes.status, 0, cliRes.stderr + cliRes.stdout);
      const parsedCli = JSON.parse(cliRes.stdout.trim());
      assert.equal(parsedCli.oxePrimerSchema, 1);
      assert.equal(parsedCli.project_mode, 'brownfield');

      // MCP tool `oxe_primer`
      const srv = mcpMod.createMcpServer({ projectRoot: brownDir });
      const listResp = await srv.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      assert.ok(listResp.result.tools.some((t) => t.name === 'oxe_primer'), 'MCP must expose oxe_primer');
      const callResp = await srv.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'oxe_primer', arguments: { dir: brownDir } } });
      assert.ok(!callResp.result.isError, `oxe_primer failed: ${JSON.stringify(callResp.result)}`);
      const mcpPayload = JSON.parse(callResp.result.content[0].text);
      assert.equal(mcpPayload.project_mode, 'brownfield');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
      fs.rmSync(brownDir, { recursive: true, force: true });
    }
  });

  it('OXB-230-12: oxe-deliver-intake.cjs asks single-ok vs auto when omitted, filters <= 5 blocking questions, auto-bootstraps and creates SPEC/ROADMAP/DELIVER.json', () => {
    const intakeMod = require(path.join(REPO_ROOT, 'bin/lib/oxe-deliver-intake.cjs'));
    const completeBriefing = [
      '# CLI de Controle de Tarefas',
      '',
      '## Objetivo',
      'Criar um CLI Node.js local para gerenciar tarefas em JSON com comandos add, list, done e export CSV.',
      '',
      '## Requisitos',
      '- Adicionar tarefa com título e prioridade (low, medium, high)',
      '- Listar tarefas filtrando por status e prioridade',
      '- Marcar tarefa como concluída por ID',
      '- Exportar lista de tarefas para CSV em stdout',
      '',
      '## Stack e Restrições',
      '- Node.js 18+ sem dependências externas',
      '- Armazenamento em arquivo JSON local',
    ].join('\n');

    const dirPending = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a12-ask-'));
    const dirAuto = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a12-auto-'));
    const dirVague = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a12-vague-'));
    try {
      // 1. Omitted approval -> asks user single-ok vs auto
      const rAsk = intakeMod.initDelivery(dirPending, { briefingText: completeBriefing, skipGitInit: true });
      assert.equal(rAsk.ok, true);
      assert.equal(rAsk.state.approval_mode, 'pending_choice');
      assert.equal(rAsk.state.status, 'DESIGN_REVIEW');
      assert.ok(rAsk.approval_prompt && /single-ok/i.test(rAsk.approval_prompt) && /auto/i.test(rAsk.approval_prompt));
      assert.ok(fs.existsSync(rAsk.paths.deliverJson), 'DELIVER.json must be written');
      assert.ok(fs.existsSync(rAsk.paths.spec), 'SPEC.md must be written');
      assert.ok(fs.existsSync(rAsk.paths.roadmap), 'ROADMAP.md must be written');
      assert.ok(rAsk.state.phases.length >= 1);
      assert.ok(rAsk.state.criteria.length >= 2);

      // 2. Explicit --approval auto on complete briefing -> skips DESIGN_REVIEW straight to PHASE_FREEZE_TESTS
      const rAuto = intakeMod.initDelivery(dirAuto, { briefingText: completeBriefing, approval: 'auto', skipGitInit: true });
      assert.equal(rAuto.ok, true);
      assert.equal(rAuto.state.approval_mode, 'auto');
      assert.equal(rAuto.state.auto_approved, true);
      assert.equal(rAuto.state.status, 'PHASE_FREEZE_TESTS');

      // 3. Vague briefing -> enters CLARIFY with 1..5 blocking questions even when approval=auto
      execFileSync('git', ['init', '-b', 'main'], { cwd: dirVague, stdio: 'ignore' });
      const rVague = intakeMod.initDelivery(dirVague, { briefingText: 'Crie um sistema legal.', approval: 'auto', skipGitInit: true });
      assert.equal(rVague.ok, true);
      assert.equal(rVague.state.status, 'CLARIFY');
      assert.ok(rVague.state.blocking_questions.length >= 1 && rVague.state.blocking_questions.length <= 5);
    } finally {
      fs.rmSync(dirPending, { recursive: true, force: true });
      fs.rmSync(dirAuto, { recursive: true, force: true });
      fs.rmSync(dirVague, { recursive: true, force: true });
    }
  });
});
