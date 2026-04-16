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

function makeTmpProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-hyp-test-'));
  const oxe = path.join(dir, '.oxe');
  const codebase = path.join(oxe, 'codebase');
  fs.mkdirSync(codebase, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${options.phase || 'executing'}\`\n`, 'utf8');
  if (options.plan) fs.writeFileSync(path.join(oxe, 'PLAN.md'), options.plan, 'utf8');
  if (options.spec) fs.writeFileSync(path.join(oxe, 'SPEC.md'), options.spec, 'utf8');
  if (options.runtime) fs.writeFileSync(path.join(oxe, 'EXECUTION-RUNTIME.md'), options.runtime, 'utf8');
  for (const name of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md']) {
    fs.writeFileSync(path.join(codebase, name), `# ${name}\nok\n`, 'utf8');
  }
  return dir;
}

const PLAN_WITH_XML_HYPOTHESES = `# PLAN

## Objetivo
Implementar autenticação JWT.

<hypothesis id="H1" checkpoint="T2" status="pending">
  <condition>JWT lib disponível no npm sem conflito de peer deps</condition>
  <validation>npm install jsonwebtoken && node -e "require('jsonwebtoken')"</validation>
  <on_failure>bloquear T2, avaliar alternativa jose</on_failure>
</hypothesis>

<hypothesis id="H2" checkpoint="T3" status="validated">
  <condition>Redis disponível na porta 6379</condition>
  <validation>redis-cli ping</validation>
  <on_failure>usar in-memory fallback com aviso</on_failure>
</hypothesis>

## Tarefas
T1: criar estrutura
T2: integrar JWT
T3: integrar Redis
`;

const PLAN_WITH_TABLE_HYPOTHESES = `# PLAN

## Objetivo
Implementar pagamento.

## Hipóteses Críticas

| ID  | Hipótese                | Validação         | Falha esperada      | Checkpoint | Status  |
|-----|-------------------------|-------------------|---------------------|------------|---------|
| H1  | Stripe SDK disponível   | npm install stripe| replanejar com PayPal| antes de T3| pending |
| H2  | Webhook secret válido   | curl webhook      | bloquear T4         | antes de T4| pending |

## Tarefas
T1: criar estrutura
`;

const PLAN_WITHOUT_HYPOTHESES = `# PLAN

## Objetivo
Refatorar módulo de log.

## Tarefas
T1: extrair logger
T2: adicionar timestamps
`;

// ---------------------------------------------------------------------------
// parseHypotheses — formato XML
// ---------------------------------------------------------------------------

describe('parseHypotheses — formato XML', () => {
  test('extrai hipóteses com todos os campos', () => {
    const hyps = ctx.parseHypotheses(PLAN_WITH_XML_HYPOTHESES);
    assert.strictEqual(hyps.length, 2);
    assert.strictEqual(hyps[0].id, 'H1');
    assert.strictEqual(hyps[0].status, 'pending');
    assert.strictEqual(hyps[0].checkpoint, 'T2');
    assert.ok(hyps[0].condition.includes('JWT lib'));
    assert.ok(hyps[0].validation.includes('jsonwebtoken'));
    assert.ok(hyps[0].on_failure.includes('bloquear T2'));
  });

  test('extrai status validated corretamente', () => {
    const hyps = ctx.parseHypotheses(PLAN_WITH_XML_HYPOTHESES);
    const h2 = hyps.find((h) => h.id === 'H2');
    assert.ok(h2, 'H2 deve ser extraída');
    assert.strictEqual(h2.status, 'validated');
    assert.strictEqual(h2.checkpoint, 'T3');
  });

  test('retorna array vazio para plano sem hipóteses', () => {
    const hyps = ctx.parseHypotheses(PLAN_WITHOUT_HYPOTHESES);
    assert.strictEqual(hyps.length, 0);
  });

  test('retorna array vazio para string vazia', () => {
    assert.deepStrictEqual(ctx.parseHypotheses(''), []);
    assert.deepStrictEqual(ctx.parseHypotheses(null), []);
  });
});

// ---------------------------------------------------------------------------
// parseHypotheses — fallback tabela Markdown
// ---------------------------------------------------------------------------

describe('parseHypotheses — fallback tabela Markdown', () => {
  test('extrai hipóteses de tabela quando sem tags XML', () => {
    const hyps = ctx.parseHypotheses(PLAN_WITH_TABLE_HYPOTHESES);
    assert.strictEqual(hyps.length, 2);
    assert.strictEqual(hyps[0].id, 'H1');
    assert.ok(hyps[0].condition.includes('Stripe SDK'));
    assert.strictEqual(hyps[1].id, 'H2');
  });

  test('XML tem precedência sobre tabela quando ambos presentes', () => {
    const mixed = PLAN_WITH_XML_HYPOTHESES + '\n' + PLAN_WITH_TABLE_HYPOTHESES.split('\n').slice(6).join('\n');
    const hyps = ctx.parseHypotheses(mixed);
    // XML encontrado primeiro → retorna apenas os do XML
    assert.ok(hyps.every((h) => h.validation.includes('npm') || h.validation.includes('redis')));
    assert.ok(!hyps.some((h) => h.condition.includes('Stripe')));
  });
});

// ---------------------------------------------------------------------------
// buildContextPack — campo hypotheses
// ---------------------------------------------------------------------------

describe('buildContextPack — campo hypotheses', () => {
  test('pack de execute inclui hipóteses do PLAN.md', () => {
    const dir = makeTmpProject({
      phase: 'executing',
      plan: PLAN_WITH_XML_HYPOTHESES,
      runtime: '# EXECUTION-RUNTIME\n\n## Onda atual\nOnda 1\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });

    assert.ok(Array.isArray(pack.hypotheses), 'pack deve ter campo hypotheses');
    assert.strictEqual(pack.hypotheses.length, 2);
    assert.strictEqual(pack.hypotheses[0].id, 'H1');
  });

  test('pack sem PLAN.md tem hypotheses = []', () => {
    const dir = makeTmpProject({
      phase: 'scan_complete',
      spec: '# SPEC\n\n## Objetivo\nX.\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'ask', write: false });

    assert.ok(Array.isArray(pack.hypotheses), 'pack deve ter campo hypotheses');
    assert.strictEqual(pack.hypotheses.length, 0);
  });

  test('pack de plano sem hipóteses declaradas tem hypotheses = []', () => {
    const dir = makeTmpProject({
      phase: 'executing',
      plan: PLAN_WITHOUT_HYPOTHESES,
      runtime: '# EXECUTION-RUNTIME\n\n## Onda atual\nOnda 1\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });

    assert.strictEqual(pack.hypotheses.length, 0);
  });

  test('hipótese sem checkpoint não bloqueia extração das demais', () => {
    const planWithPartial = `# PLAN
<hypothesis id="H1" status="pending">
  <condition>lib X disponível</condition>
  <validation>npm install X</validation>
  <on_failure>replanejar</on_failure>
</hypothesis>
`;
    const dir = makeTmpProject({
      phase: 'executing',
      plan: planWithPartial,
      runtime: '# EXECUTION-RUNTIME\n\n## Onda atual\nOnda 1\n',
    });

    const pack = ctx.buildContextPack(dir, { workflow: 'execute', write: false });

    assert.strictEqual(pack.hypotheses.length, 1);
    assert.strictEqual(pack.hypotheses[0].checkpoint, null);
  });
});
