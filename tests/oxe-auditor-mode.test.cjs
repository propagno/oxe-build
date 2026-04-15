'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ctx = require('../bin/lib/oxe-context-engine.cjs');
const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-audit-test-'));
  const oxe = path.join(dir, '.oxe');
  const codebase = path.join(oxe, 'codebase');
  fs.mkdirSync(codebase, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${options.phase || 'verifying'}\`\n`, 'utf8');
  if (options.plan) fs.writeFileSync(path.join(oxe, 'PLAN.md'), options.plan, 'utf8');
  if (options.spec) fs.writeFileSync(path.join(oxe, 'SPEC.md'), options.spec, 'utf8');
  if (options.runtime) fs.writeFileSync(path.join(oxe, 'EXECUTION-RUNTIME.md'), options.runtime, 'utf8');
  if (options.verify) fs.writeFileSync(path.join(oxe, 'VERIFY.md'), options.verify, 'utf8');
  for (const name of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md']) {
    fs.writeFileSync(path.join(codebase, name), `# ${name}\nok\n`, 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Contrato do verify
// ---------------------------------------------------------------------------

describe('contrato verify — auditor_artifacts e auditor_excluded', () => {
  test('getWorkflowContract retorna auditor_artifacts para verify', () => {
    const contract = runtimeSemantics.getWorkflowContract('verify');
    assert.ok(Array.isArray(contract.auditor_artifacts), 'auditor_artifacts deve ser array');
    assert.ok(contract.auditor_artifacts.includes('spec'), 'spec deve estar em auditor_artifacts');
    assert.ok(contract.auditor_artifacts.includes('verify'), 'verify deve estar em auditor_artifacts');
    assert.ok(contract.auditor_artifacts.includes('state'), 'state deve estar em auditor_artifacts');
  });

  test('getWorkflowContract retorna auditor_excluded para verify', () => {
    const contract = runtimeSemantics.getWorkflowContract('verify');
    assert.ok(Array.isArray(contract.auditor_excluded), 'auditor_excluded deve ser array');
    assert.ok(contract.auditor_excluded.includes('plan'), 'plan deve estar em auditor_excluded');
    assert.ok(contract.auditor_excluded.includes('runtime'), 'runtime deve estar em auditor_excluded');
  });

  test('outros workflows têm auditor_artifacts vazio por padrão', () => {
    const contract = runtimeSemantics.getWorkflowContract('execute');
    assert.deepStrictEqual(contract.auditor_artifacts, []);
    assert.deepStrictEqual(contract.auditor_excluded, []);
  });
});

// ---------------------------------------------------------------------------
// buildContextPack — modo auditor
// ---------------------------------------------------------------------------

describe('buildContextPack — modo auditor', () => {
  test('modo auditor exclui plan e runtime dos artefatos selecionados', () => {
    const dir = makeTmpProject({
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nX.\n\n## Critérios de Aceite\n| ID | Critério |\n|---|---|\n| A1 | login ok |',
      plan: '# PLAN\n\n## Objetivo\nImplementar X.\n',
      runtime: '# EXECUTION-RUNTIME\n\n## Onda atual\nOnda 1\n',
      verify: '# VERIFY\n\n## Resultado\nA1: PASS.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', mode: 'auditor', write: false });

    const aliases = pack.selected_artifacts.map((a) => a.alias);
    assert.ok(!aliases.includes('plan'), `plan não deve estar no pack auditor; aliases: ${aliases.join(',')}`);
    assert.ok(!aliases.includes('runtime'), `runtime não deve estar no pack auditor; aliases: ${aliases.join(',')}`);
  });

  test('modo auditor inclui spec, verify e state', () => {
    const dir = makeTmpProject({
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nX.\n',
      verify: '# VERIFY\n\n## Resultado\nOK.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', mode: 'auditor', write: false });

    const aliases = pack.selected_artifacts.map((a) => a.alias);
    assert.ok(aliases.includes('spec'), `spec deve estar no pack auditor; aliases: ${aliases.join(',')}`);
    assert.ok(aliases.includes('verify'), `verify deve estar no pack auditor; aliases: ${aliases.join(',')}`);
    assert.ok(aliases.includes('state'), `state deve estar no pack auditor; aliases: ${aliases.join(',')}`);
  });

  test('modo standard (padrão) não é afetado pelo auditor', () => {
    const dir = makeTmpProject({
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nX.\n',
      plan: '# PLAN\n\n## Objetivo\nY.\n',
      verify: '# VERIFY\n\n## Resultado\nOK.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', write: false });

    assert.strictEqual(pack.mode, 'standard');
    // No modo standard, verify e plan estão nos context_tiers
    const aliases = pack.selected_artifacts.map((a) => a.alias);
    assert.ok(aliases.includes('verify'), 'verify deve estar no pack standard');
    assert.ok(aliases.includes('state'), 'state deve estar no pack standard');
  });

  test('pack auditor tem campo mode = auditor', () => {
    const dir = makeTmpProject({
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nX.\n',
      verify: '# VERIFY\n\n## Resultado\nOK.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', mode: 'auditor', write: false });
    assert.strictEqual(pack.mode, 'auditor');
  });

  test('verify-audit.md existe em oxe/workflows', () => {
    const verifyAuditPath = path.join(__dirname, '..', 'oxe', 'workflows', 'verify-audit.md');
    assert.ok(fs.existsSync(verifyAuditPath), 'verify-audit.md deve existir em oxe/workflows');
    const content = fs.readFileSync(verifyAuditPath, 'utf8');
    assert.ok(content.includes('adversarial'), 'verify-audit.md deve conter instrução adversarial');
    assert.ok(content.includes('PASS'), 'verify-audit.md deve referenciar resultados PASS/FAIL');
  });

  test('adversarial_verify está no config template', () => {
    const configPath = path.join(__dirname, '..', 'oxe', 'templates', 'config.template.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok('adversarial_verify' in config, 'adversarial_verify deve estar no config template');
    assert.strictEqual(config.adversarial_verify, false, 'padrão deve ser false');
  });
});
