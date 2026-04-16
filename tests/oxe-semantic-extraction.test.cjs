'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Acessar extractSemanticFragment via require do módulo
// A função é interna, mas podemos testá-la indiretamente via buildContextPack
// e também exportá-la para testes (vamos expor no módulo)
const ctx = require('../bin/lib/oxe-context-engine.cjs');
const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProjectWithArtifact(content, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sem-test-'));
  const oxe = path.join(dir, '.oxe');
  const codebase = path.join(oxe, 'codebase');
  fs.mkdirSync(codebase, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${options.phase || 'executing'}\`\n`, 'utf8');
  if (options.plan) fs.writeFileSync(path.join(oxe, 'PLAN.md'), options.plan, 'utf8');
  if (options.spec) fs.writeFileSync(path.join(oxe, 'SPEC.md'), options.spec, 'utf8');
  if (options.verify) fs.writeFileSync(path.join(oxe, 'VERIFY.md'), options.verify, 'utf8');
  if (options.runtime) fs.writeFileSync(path.join(oxe, 'EXECUTION-RUNTIME.md'), options.runtime, 'utf8');
  for (const name of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md']) {
    fs.writeFileSync(path.join(codebase, name), `# ${name}\nok\n`, 'utf8');
  }
  return dir;
}

// Gera texto com P0 na linha 200
function makeDeepCriticalText(markerLine = 200) {
  const lines = [];
  lines.push('# Documento de verificação');
  lines.push('');
  lines.push('## Objetivo');
  lines.push('Verificar critérios de aceite.');
  lines.push('');
  for (let i = 0; i < markerLine - 6; i++) {
    lines.push(`Linha ${i + 1}: conteúdo regular sem relevância específica para o teste em questão.`);
  }
  lines.push('## Gaps Críticos');
  lines.push('');
  lines.push('- [P0] Critério A3 sem evidência — teste de carga não executado');
  lines.push('- [P1] Critério A7 inconclusivo — latência medida em ambiente de dev');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Testes diretos de extractSemanticFragment via context pack
// ---------------------------------------------------------------------------

describe('extractSemanticFragment — via buildContextPack semantic_summary', () => {
  test('marker P0 em linha 200 aparece no semantic_summary do pack de verify', () => {
    const deepText = makeDeepCriticalText(200);
    const dir = makeTmpProjectWithArtifact(null, {
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nFeature X.\n\n## Critérios de Aceite\n| ID | Critério |\n|---|---|\n| A3 | carga ok |',
      verify: deepText,
      plan: '# PLAN\n\n## Objetivo\nImplementar X.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', write: false });
    const verifyArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'verify');

    assert.ok(verifyArtifact, 'artefato verify deve estar no pack');
    assert.ok(verifyArtifact.exists, 'verify deve existir no projeto de teste');
    assert.ok(
      verifyArtifact.semantic_summary.includes('P0'),
      `semantic_summary deve conter "P0" mas contém: "${verifyArtifact.semantic_summary.slice(0, 200)}"`
    );
    assert.ok(
      verifyArtifact.semantic_summary.includes('evidência'),
      'semantic_summary deve conter texto do gap crítico'
    );
  });

  test('intent verification garante que seção ## Gaps com marcador crítico está no summary mesmo com budget apertado', () => {
    // Documento longo onde o budget (1200 chars) não cobre tudo
    const filler = Array.from({ length: 80 }, (_, i) =>
      `Linha ${i + 1}: informação contextual extensa sobre o processo de verificação item por item.`
    ).join('\n');
    const text = [
      '# Verificação',
      '',
      '## Objetivo',
      filler, // seção grande que consome muito budget
      '',
      '## Gaps Críticos',
      '- [crítico] A3 sem evidência — teste de carga não executado',
      '- [warning] A5 inconclusivo',
    ].join('\n');

    const dir = makeTmpProjectWithArtifact(null, {
      phase: 'verifying',
      spec: '# SPEC\n\n## Objetivo\nX.\n',
      verify: text,
      plan: '# PLAN\n\n## Objetivo\nY.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'verify', write: false });
    const verifyArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'verify');

    assert.ok(verifyArtifact && verifyArtifact.exists, 'verify deve existir');
    const summary = verifyArtifact.semantic_summary;

    // Gaps tem marcador crítico e deve sobreviver mesmo com budget apertado
    assert.ok(summary.includes('crítico'), `summary deve conter "crítico": "${summary.slice(0, 300)}"`);
    assert.ok(summary.includes('A3'), 'summary deve conter o gap A3');
    // O summary não deve ser maior que maxChars + margem
    assert.ok(summary.length <= 1300, `summary não deve exceder muito o maxChars: ${summary.length}`);
  });

  test('intent execution_input prioriza seção ## Onda sobre seções genéricas', () => {
    const text = [
      '# EXECUTION-RUNTIME',
      '',
      '## Histórico',
      'Ciclo iniciado em 2024-01-10.',
      '',
      '## Onda atual',
      'Onda 3: implementar endpoint de pagamento.',
      'Status: em andamento.',
      '',
      '## Configuração do ambiente',
      'Node 22, PostgreSQL 15, Redis 7.',
    ].join('\n');

    const dir = makeTmpProjectWithArtifact(null, {
      phase: 'executing',
      plan: '# PLAN\n\n## Objetivo\nImplementar pagamento.\n',
      runtime: text,
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });
    const runtimeArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'runtime');

    assert.ok(runtimeArtifact && runtimeArtifact.exists, 'runtime deve existir');
    const summary = runtimeArtifact.semantic_summary;

    assert.ok(summary.includes('Onda'), 'summary deve conter seção Onda');
    assert.ok(summary.includes('pagamento'), 'summary deve conter conteúdo da onda atual');
  });

  test('intent planning_input garante que ## Autoavaliação com risco sobrevive a budget apertado', () => {
    // SPEC está em required_artifacts do plan workflow — usamos spec como veículo do teste
    const filler = Array.from({ length: 80 }, (_, i) =>
      `Critério A${i + 1}: funcionalidade ${i + 1} deve estar implementada e testada.`
    ).join('\n');
    const specText = [
      '# SPEC',
      '',
      '## Critérios de Aceite',
      filler,
      '',
      '## Autoavaliação do Plano',
      'Confiança: 68% — risco técnico elevado na integração SAP.',
      'Dimensão técnica: 45/100.',
    ].join('\n');

    const dir = makeTmpProjectWithArtifact(null, {
      phase: 'planning',
      spec: specText,
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'plan', write: false });
    const specArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'spec');

    assert.ok(specArtifact && specArtifact.exists, 'spec deve existir');
    const summary = specArtifact.semantic_summary;

    // Autoavaliação contém confiança — deve ser priorizada por intent planning_input
    assert.ok(summary.includes('Confiança'), `summary deve conter "Confiança": "${summary.slice(0, 300)}"`);
    assert.ok(summary.includes('68%'), 'summary deve conter o valor de confiança');
  });

  test('semantic_summary preserva marcador BLOQUEADO independente de posição', () => {
    const lines = ['# RUNTIME', '', '## Configuração', 'Node 22.'];
    for (let i = 0; i < 50; i++) lines.push(`Linha ${i}: progresso normal.`);
    lines.push('## Status atual');
    lines.push('BLOQUEADO: dependência circular detectada no módulo auth.');
    const text = lines.join('\n');

    const dir = makeTmpProjectWithArtifact(null, {
      phase: 'executing',
      plan: '# PLAN\n\n## Objetivo\nX.\n',
      runtime: text,
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });
    const runtimeArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'runtime');

    assert.ok(runtimeArtifact && runtimeArtifact.exists, 'runtime deve existir');
    assert.ok(
      runtimeArtifact.semantic_summary.includes('BLOQUEADO'),
      'semantic_summary deve conter BLOQUEADO mesmo em posição tardia'
    );
  });

  test('extraction_intent está definido em todos os workflows do registry', () => {
    const contracts = runtimeSemantics.getAllWorkflowContracts();
    assert.ok(contracts.length >= 35, 'deve ter pelo menos 35 workflows');
    const valid = ['status_read', 'planning_input', 'execution_input', 'verification', 'critical_check'];
    for (const contract of contracts) {
      const intent = (runtimeSemantics.CONTRACTS_REGISTRY.workflows[contract.workflow_slug] || {}).extraction_intent;
      assert.ok(
        valid.includes(intent),
        `workflow "${contract.workflow_slug}" tem extraction_intent inválido: "${intent}"`
      );
    }
  });

  test('artefato sem headings usa fallback e retorna conteúdo não vazio', () => {
    // STATE.md não tem headings ## mas tem conteúdo — o plan workflow inclui state como required
    const stateContent = Array.from({ length: 20 }, (_, i) =>
      `fase_atual: executing | passo_${i + 1}: completo`
    ).join('\n');

    const dir = makeTmpProjectWithArtifact(null, { phase: 'executing' });
    // Substituir STATE.md por versão sem headings
    const fs2 = require('fs');
    fs2.writeFileSync(require('path').join(dir, '.oxe', 'STATE.md'), stateContent, 'utf8');

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });
    const stateArtifact = (pack.selected_artifacts || []).find((a) => a.alias === 'state');

    assert.ok(stateArtifact && stateArtifact.exists, 'state deve existir');
    assert.ok(stateArtifact.semantic_summary.length > 0, 'semantic_summary não deve estar vazio mesmo sem headings');
    // Deve conter algo do conteúdo original
    assert.ok(stateArtifact.semantic_summary.includes('executing'), 'deve conter conteúdo do state');
  });
});
