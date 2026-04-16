'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Importar via SDK para garantir que os exports estão corretos
const sdk = require('../lib/sdk/index.cjs');
const { parseLessonsMetrics, updateLessonMetric, deprecateLowEffectiveness } = sdk;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const METRICS_JSON_VALID = JSON.stringify({
  schema_version: 1,
  lessons: [
    {
      id: 'L-01',
      rule: 'Integração com lib externa → Complexidade L mínimo',
      type: 'plan',
      applied_cycles: ['C-03', 'C-05'],
      outcomes: [
        { cycle: 'C-03', verify_status: 'complete', saved_hours: 1.5 },
        { cycle: 'C-05', verify_status: 'complete', saved_hours: 2.0 },
      ],
      success_rate: 1.0,
      status: 'active',
      deprecation_threshold: 0.5,
    },
    {
      id: 'L-02',
      rule: 'Testes de integração sem mock de serviço externo falham em CI',
      type: 'execute',
      applied_cycles: ['C-04', 'C-06', 'C-08'],
      outcomes: [
        { cycle: 'C-04', verify_status: 'failed', failure_condition: 'serviço externo indisponível em CI' },
        { cycle: 'C-06', verify_status: 'failed', failure_condition: 'timeout no CI' },
        { cycle: 'C-08', verify_status: 'complete' },
      ],
      success_rate: 0.33,
      status: 'active',
      deprecation_threshold: 0.5,
    },
  ],
});

const METRICS_JSON_EMPTY = JSON.stringify({ schema_version: 1, lessons: [] });
const METRICS_JSON_INVALID = 'not json {{{{';

// ---------------------------------------------------------------------------
// parseLessonsMetrics
// ---------------------------------------------------------------------------

describe('parseLessonsMetrics', () => {
  test('lê lessons de JSON válido', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    assert.strictEqual(lessons.length, 2);
    assert.strictEqual(lessons[0].id, 'L-01');
    assert.strictEqual(lessons[0].success_rate, 1.0);
    assert.strictEqual(lessons[1].id, 'L-02');
    assert.strictEqual(lessons[1].success_rate, 0.33);
  });

  test('retorna array vazio para JSON com lessons vazio', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_EMPTY);
    assert.deepStrictEqual(lessons, []);
  });

  test('retorna array vazio para JSON inválido', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_INVALID);
    assert.deepStrictEqual(lessons, []);
  });

  test('retorna array vazio para string vazia', () => {
    assert.deepStrictEqual(parseLessonsMetrics(''), []);
    assert.deepStrictEqual(parseLessonsMetrics(null), []);
  });
});

// ---------------------------------------------------------------------------
// updateLessonMetric
// ---------------------------------------------------------------------------

describe('updateLessonMetric', () => {
  test('incrementa applied_cycles e recalcula success_rate', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const updated = updateLessonMetric(lessons, 'L-01', { cycle: 'C-07', verify_status: 'complete', saved_hours: 1.0 });

    const l01 = updated.find((l) => l.id === 'L-01');
    assert.ok(l01.applied_cycles.includes('C-07'), 'C-07 deve ser adicionado a applied_cycles');
    assert.strictEqual(l01.outcomes.length, 3);
    assert.strictEqual(l01.success_rate, 1.0); // 3/3
  });

  test('outcome de falha reduz success_rate', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const updated = updateLessonMetric(lessons, 'L-01', {
      cycle: 'C-09',
      verify_status: 'failed',
      failure_condition: 'lib foi yanked',
    });

    const l01 = updated.find((l) => l.id === 'L-01');
    assert.ok(l01.success_rate < 1.0, 'success_rate deve diminuir após falha');
    // 2 complete de 3 total = 0.67
    assert.strictEqual(l01.success_rate, 0.67);
  });

  test('retorna métricas inalteradas se lessonId não encontrado', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const updated = updateLessonMetric(lessons, 'L-99', { cycle: 'C-01', verify_status: 'complete' });
    assert.strictEqual(updated.length, lessons.length);
  });

  test('não duplica applied_cycles para mesmo cycle', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const updated = updateLessonMetric(lessons, 'L-01', { cycle: 'C-03', verify_status: 'complete' });
    const l01 = updated.find((l) => l.id === 'L-01');
    const c03Count = l01.applied_cycles.filter((c) => c === 'C-03').length;
    assert.strictEqual(c03Count, 1, 'C-03 não deve ser duplicado em applied_cycles');
  });

  test('marca como deprecated quando success_rate < threshold e >= 3 observações', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    // L-02 já tem 2 falhas e 1 sucesso (33%); adicionar mais uma falha → 4 observações, 1/4 = 25%
    const updated = updateLessonMetric(lessons, 'L-02', {
      cycle: 'C-10',
      verify_status: 'failed',
      failure_condition: 'nova falha',
    });

    const l02 = updated.find((l) => l.id === 'L-02');
    assert.strictEqual(l02.status, 'deprecated', 'L-02 deve ser marcada como deprecated');
  });
});

// ---------------------------------------------------------------------------
// deprecateLowEffectiveness
// ---------------------------------------------------------------------------

describe('deprecateLowEffectiveness', () => {
  test('depreca lições com success_rate < threshold e >= minObservations', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const deprecated = deprecateLowEffectiveness(lessons, 0.5, 3);

    const l02 = deprecated.find((l) => l.id === 'L-02');
    assert.strictEqual(l02.status, 'deprecated', 'L-02 com 33% deve ser depreciada');
  });

  test('não depreca lições com success_rate >= threshold', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    const deprecated = deprecateLowEffectiveness(lessons, 0.5, 2);

    const l01 = deprecated.find((l) => l.id === 'L-01');
    assert.strictEqual(l01.status, 'active', 'L-01 com 100% não deve ser depreciada');
  });

  test('não depreca lições com < minObservations', () => {
    const lessons = parseLessonsMetrics(METRICS_JSON_VALID);
    // L-02 tem 3 observações; se exigirmos 5 minObservations, não depreca
    const deprecated = deprecateLowEffectiveness(lessons, 0.5, 5);

    const l02 = deprecated.find((l) => l.id === 'L-02');
    assert.strictEqual(l02.status, 'active', 'L-02 com < 5 observações não deve ser depreciada com threshold 5');
  });

  test('não modifica lições já deprecadas', () => {
    const lessons = [{ id: 'L-10', rule: 'X', type: 'plan', applied_cycles: ['C-01','C-02','C-03'], outcomes: [{cycle:'C-01',verify_status:'failed'},{cycle:'C-02',verify_status:'failed'},{cycle:'C-03',verify_status:'failed'}], success_rate: 0, status: 'deprecated', deprecation_threshold: 0.5 }];
    const result = deprecateLowEffectiveness(lessons, 0.5, 3);
    assert.strictEqual(result[0].status, 'deprecated');
  });
});
