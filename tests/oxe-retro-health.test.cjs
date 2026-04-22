'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('../bin/lib/oxe-project-health.cjs');

describe('oxe-retro-health', () => {
  // P0.1 — security_in_verify aceito como chave válida
  test('security_in_verify is in ALLOWED_CONFIG_KEYS', () => {
    assert.ok(
      h.ALLOWED_CONFIG_KEYS.includes('security_in_verify'),
      'security_in_verify deve estar em ALLOWED_CONFIG_KEYS'
    );
  });

  test('validateConfigShape accepts security_in_verify', () => {
    const { unknownKeys } = h.validateConfigShape({ security_in_verify: true });
    assert.ok(
      !unknownKeys.includes('security_in_verify'),
      'security_in_verify não deve ser unknownKey'
    );
  });

  // P0.3 — config.template.json tem security_in_verify
  test('config.template.json has security_in_verify field', () => {
    const tmpl = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'oxe', 'templates', 'config.template.json'), 'utf8')
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(tmpl, 'security_in_verify'),
      'config.template.json deve ter campo security_in_verify'
    );
    assert.strictEqual(tmpl.security_in_verify, false, 'valor padrão deve ser false');
  });

  // P1.2 — parseLastRetroDate
  test('parseLastRetroDate parses last_retro field from STATE.md', () => {
    const state = '## Fase atual\n\n`verify_complete`\n\nlast_retro: 2026-04-04\n';
    const d = h.parseLastRetroDate(state);
    assert.ok(d instanceof Date, 'deve retornar um Date');
    assert.strictEqual(d.toISOString().split('T')[0], '2026-04-04');
  });

  test('parseLastRetroDate returns null when field is absent', () => {
    const state = '## Fase atual\n\n`plan_ready`\n';
    assert.strictEqual(h.parseLastRetroDate(state), null);
  });

  test('parseLastRetroDate returns null for invalid date format', () => {
    const state = 'last_retro: not-a-date\n';
    assert.strictEqual(h.parseLastRetroDate(state), null);
  });

  // P0.5 — suggestNextStep retorna retro após verify_complete sem LESSONS.md
  test('suggestNextStep returns retro when verify_complete and LESSONS.md missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-retro-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    // Criar todos os mapas de codebase esperados
    const maps = ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONVENTIONS.md', 'CONCERNS.md'];
    for (const m of maps) fs.writeFileSync(path.join(codebase, m), `# ${m}\n`, 'utf8');
    // STATE com verify_complete e sem last_retro
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`verify_complete`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">\n  <dim name="requirements" score="0.92" weight="25" note="ok" />\n  <dim name="dependencies" score="0.93" weight="15" note="ok" />\n  <dim name="technical_risk" score="0.90" weight="20" note="controlado" />\n  <dim name="code_impact" score="0.93" weight="15" note="claro" />\n  <dim name="validation" score="0.87" weight="15" note="bom" />\n  <dim name="open_gaps" score="0.90" weight="10" note="sem gaps" />\n  <global score="0.91" gate="proceed" />\n</confidence_vector>\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'VERIFY.md'), '# VERIFY\n\n## Gaps\n\nNenhum gap restante\n', 'utf8');
    // LESSONS.md NÃO existe → deve sugerir retro
    const result = h.suggestNextStep(dir);
    assert.strictEqual(result.step, 'retro', `esperado retro, recebeu ${result.step}: ${result.reason}`);
    assert.strictEqual(result.cursorCmd, '/oxe-retro');
  });

  test('suggestNextStep returns next when verify_complete and LESSONS.md exists with last_retro in STATE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-retro-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    const maps = ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONVENTIONS.md', 'CONCERNS.md'];
    for (const m of maps) fs.writeFileSync(path.join(codebase, m), `# ${m}\n`, 'utf8');
    // STATE com verify_complete E last_retro
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`verify_complete`\n\nlast_retro: 2026-04-04\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">\n  <dim name="requirements" score="0.92" weight="25" note="ok" />\n  <dim name="dependencies" score="0.93" weight="15" note="ok" />\n  <dim name="technical_risk" score="0.90" weight="20" note="controlado" />\n  <dim name="code_impact" score="0.93" weight="15" note="claro" />\n  <dim name="validation" score="0.87" weight="15" note="bom" />\n  <dim name="open_gaps" score="0.90" weight="10" note="sem gaps" />\n  <global score="0.91" gate="proceed" />\n</confidence_vector>\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'VERIFY.md'), '# VERIFY\n\n## Gaps\n\nNenhum gap restante\n', 'utf8');
    // LESSONS.md existe
    fs.writeFileSync(path.join(oxe, 'LESSONS.md'), '# LESSONS\n\n### C-01\n', 'utf8');
    const result = h.suggestNextStep(dir);
    assert.strictEqual(result.step, 'next', `esperado next, recebeu ${result.step}: ${result.reason}`);
  });

  // P1.3 — planAgentsWarnings detecta schema 1 legado
  test('planAgentsWarnings warns about schema 1 (legacy)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-agents-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'plan-agents.json'),
      JSON.stringify({ oxePlanAgentsSchema: 1, goal: 'test', agents: [], execution: {} }),
      'utf8'
    );
    const warns = h.planAgentsWarnings(dir);
    assert.ok(
      warns.some((w) => /schema 1.*legado/i.test(w)),
      `esperado aviso sobre schema 1, recebeu: ${JSON.stringify(warns)}`
    );
  });

  test('planAgentsWarnings warns about invalid model_hint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-agents-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'plan-agents.json'),
      JSON.stringify({
        oxePlanAgentsSchema: 3,
        runId: 'oxe-test-abc123',
        lifecycle: { status: 'pending_execute', since: '2026-04-04T00:00:00Z' },
        goal: 'test',
        agents: [{ id: 'agent-x', role: 'X', scope: ['do it'], taskIds: ['T1'], model_hint: 'turbo' }],
        execution: { strategy: 'sequential', waves: [['agent-x']] },
      }),
      'utf8'
    );
    const warns = h.planAgentsWarnings(dir);
    assert.ok(
      warns.some((w) => /model_hint.*turbo/i.test(w)),
      `esperado aviso sobre model_hint inválido, recebeu: ${JSON.stringify(warns)}`
    );
  });

  test('planAgentsWarnings returns empty for valid schema 3', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-agents-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'plan-agents.json'),
      JSON.stringify({
        oxePlanAgentsSchema: 3,
        runId: 'oxe-test-abc123',
        lifecycle: { status: 'pending_execute', since: '2026-04-04T00:00:00Z' },
        goal: 'test',
        agents: [{ id: 'agent-x', role: 'X', scope: ['do it'], taskIds: ['T1'], model_hint: 'balanced' }],
        execution: { strategy: 'sequential', waves: [['agent-x']] },
      }),
      'utf8'
    );
    const warns = h.planAgentsWarnings(dir);
    assert.strictEqual(warns.length, 0, `esperado sem avisos, recebeu: ${JSON.stringify(warns)}`);
  });

  test('planAgentsWarnings returns empty when plan-agents.json does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-agents-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const warns = h.planAgentsWarnings(dir);
    assert.strictEqual(warns.length, 0);
  });

  // P0.2 — plan-agents.schema.json tem enum [2,3] e campos persona/model_hint
  test('plan-agents.schema.json enum includes 3', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'oxe', 'schemas', 'plan-agents.schema.json'), 'utf8')
    );
    assert.ok(schema.properties.oxePlanAgentsSchema.enum.includes(3), 'enum deve incluir 3');
    assert.ok(!schema.properties.oxePlanAgentsSchema.enum.includes(1), 'enum não deve incluir 1');
  });

  test('plan-agents.schema.json agents items has model_hint and persona', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'oxe', 'schemas', 'plan-agents.schema.json'), 'utf8')
    );
    const agentProps = schema.properties.agents.items.properties;
    assert.ok(agentProps.model_hint, 'agents items deve ter model_hint');
    assert.ok(agentProps.persona, 'agents items deve ter persona');
    assert.deepStrictEqual(agentProps.model_hint.enum, ['fast', 'balanced', 'powerful']);
  });
});
