'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ctx = require('../bin/lib/oxe-context-engine.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_WITH_VECTOR = `# PLAN

## Objetivo
Implementar autenticação.

## Autoavaliação do Plano

- **Melhor plano atual:** sim
- **Confiança:** 74%

<confidence_vector cycle="C-07" generated_at="2024-03-15T10:00:00Z">
  <dim name="requirements"   score="0.90" weight="25" note="SPEC fechada" />
  <dim name="dependencies"   score="0.80" weight="15" note="libs estáveis" />
  <dim name="technical_risk" score="0.45" weight="20" note="H1 não validada: JWT lib" />
  <dim name="code_impact"    score="0.75" weight="15" note="2 módulos afetados" />
  <dim name="validation"     score="0.85" weight="15" note="comandos de verify definidos" />
  <dim name="open_gaps"      score="0.90" weight="10" note="sem decisões pendentes" />
  <global score="0.74" gate="proceed_with_risk" />
</confidence_vector>

## Tarefas
T1: criar estrutura
`;

const PLAN_WITHOUT_VECTOR = `# PLAN

## Objetivo
Refatorar logger.

## Autoavaliação do Plano

- **Melhor plano atual:** sim
- **Confiança:** 80%

## Tarefas
T1: extrair logger
`;

// ---------------------------------------------------------------------------
// parseConfidenceVector
// ---------------------------------------------------------------------------

describe('parseConfidenceVector', () => {
  test('extrai vetor completo com 6 dimensões', () => {
    const cv = ctx.parseConfidenceVector(PLAN_WITH_VECTOR);
    assert.ok(cv, 'deve retornar objeto não-nulo');
    assert.strictEqual(cv.cycle, 'C-07');
    assert.strictEqual(cv.generated_at, '2024-03-15T10:00:00Z');
    assert.strictEqual(cv.dimensions.length, 6);
    assert.strictEqual(cv.global.score, 0.74);
    assert.strictEqual(cv.global.gate, 'proceed_with_risk');
  });

  test('dimensão technical_risk tem score 0.45 e peso 20', () => {
    const cv = ctx.parseConfidenceVector(PLAN_WITH_VECTOR);
    const techRisk = cv.dimensions.find((d) => d.name === 'technical_risk');
    assert.ok(techRisk, 'dimensão technical_risk deve estar presente');
    assert.strictEqual(techRisk.score, 0.45);
    assert.strictEqual(techRisk.weight, 20);
    assert.ok(techRisk.note.includes('JWT lib'));
  });

  test('retorna null para plano sem bloco confidence_vector', () => {
    const cv = ctx.parseConfidenceVector(PLAN_WITHOUT_VECTOR);
    assert.strictEqual(cv, null);
  });

  test('retorna null para string vazia', () => {
    assert.strictEqual(ctx.parseConfidenceVector(''), null);
    assert.strictEqual(ctx.parseConfidenceVector(null), null);
  });

  test('calcula global.score via média ponderada quando <global> ausente', () => {
    const planNoGlobal = `# PLAN
<confidence_vector cycle="C-01" generated_at="2024-01-01T00:00:00Z">
  <dim name="requirements" score="1.0" weight="50" note="completo" />
  <dim name="technical_risk" score="0.0" weight="50" note="alto risco" />
</confidence_vector>
`;
    const cv = ctx.parseConfidenceVector(planNoGlobal);
    assert.ok(cv, 'deve retornar objeto');
    // Média ponderada: (1.0 * 50 + 0.0 * 50) / 100 = 0.5
    assert.strictEqual(cv.global.score, 0.5);
  });

  test('gate padrão é proceed_with_risk quando não declarado', () => {
    const planNoGate = `# PLAN
<confidence_vector cycle="C-01" generated_at="2024-01-01T00:00:00Z">
  <dim name="requirements" score="0.80" weight="100" note="ok" />
  <global score="0.80" />
</confidence_vector>
`;
    const cv = ctx.parseConfidenceVector(planNoGate);
    assert.ok(cv, 'deve retornar objeto');
    assert.strictEqual(cv.global.gate, 'proceed_with_risk');
  });
});

// ---------------------------------------------------------------------------
// calibration artifact — resolveArtifactCandidates
// ---------------------------------------------------------------------------

describe('calibration artifact', () => {
  test('resolveArtifactCandidates inclui calibration como alias', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cal-test-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase\n\n`planning`\n', 'utf8');

    const candidates = ctx.resolveArtifactCandidates(dir, null);
    assert.ok('calibration' in candidates, 'calibration deve ser alias conhecido');
    assert.ok(candidates.calibration.primary.endsWith('calibration.json'), 'path deve terminar em calibration.json');
  });

  test('buildContextPack de plan inclui calibration em selected_artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cal-pack-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase\n\n`planning`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC\n\n## Objetivo\nX.\n', 'utf8');
    ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md'].forEach((n) =>
      fs.writeFileSync(path.join(codebase, n), `# ${n}\nok\n`, 'utf8')
    );

    // Criar calibration.json
    const calPath = path.join(oxe, 'calibration.json');
    fs.writeFileSync(
      calPath,
      JSON.stringify({
        schema_version: 1,
        records: [
          {
            cycle: 'C-06',
            plan_global_confidence: 0.85,
            plan_dimensions: { technical_risk: 0.85 },
            outcome: { verify_status: 'complete', actual_waves: 1, estimated_waves: 1 },
            calibration_error: { technical_risk: 0.02 },
          },
        ],
      }) + '\n',
      'utf8'
    );

    const pack = ctx.buildContextPack(dir, { workflow: 'plan', tier: 'full', write: false });
    const calArtifact = pack.selected_artifacts.find((a) => a.alias === 'calibration');

    assert.ok(calArtifact, 'calibration deve estar em selected_artifacts no tier full');
    assert.strictEqual(calArtifact.exists, true);
  });
});
