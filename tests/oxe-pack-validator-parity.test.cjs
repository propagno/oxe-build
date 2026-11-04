'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rationality = require('../bin/lib/oxe-rationality.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21 · OXB-022: o plan lint aprovou a T12 (só voice.css) e o preflight a bloqueou por "sem symbols". Um validador só.

const base = (over) => ({
  id: 'T1', mode: 'mutating', ready: true, write_set: 'closed', exact_paths: ['src/a.ts'],
  symbols: [{ kind: 'function', name: 'a', path: 'src/a.ts' }], contracts: [{ name: 'c' }], expected_checks: ['t'], ...over,
});

describe('validador único do IMPLEMENTATION-PACK', () => {
  it('symbols só é exigido quando a tarefa escreve código', () => {
    assert.deepEqual(rationality.validatePackTask(base()).gaps, []);
    assert.match(rationality.validatePackTask(base({ symbols: [] })).gaps.join(), /sem symbols \(escreve arquivo de código: src\/a\.ts\)/);
    assert.deepEqual(rationality.validatePackTask(base({ exact_paths: ['src/features/voice/voice.css'], symbols: [] })).gaps, []);
    assert.deepEqual(rationality.validatePackTask(base({ exact_paths: ['docs/x.md', 'config/app.json'], symbols: [] })).gaps, []);
  });

  it('lint e preflight dão o mesmo veredito para o mesmo pack', () => {
    const pack = { ready: true, tasks: [base({ id: 'T1', symbols: [] }), base({ id: 'T2', exact_paths: ['a.css'], symbols: [] }), base({ id: 'T3', write_set: 'open' })] };
    const plan = {
      tasks: [
        { id: 'T1', title: 'a', wave: 1, dependsOn: [], files: ['src/a.ts'], aceite: [], done: false },
        { id: 'T2', title: 'b', wave: 1, dependsOn: [], files: ['a.css'], aceite: [], done: false },
        { id: 'T3', title: 'c', wave: 2, dependsOn: [], files: ['src/a.ts'], aceite: [], done: false },
      ],
      acceptanceTests: [],
    };
    const lint = planJson.lintPlan({ plan, spec: null, pack, phase: null, projectRoot: process.cwd(), requiredVersions: new Map() });
    const lintPackErrors = lint.errors.filter((e) => e.startsWith('IMPLEMENTATION-PACK.json'));
    const preflight = pack.tasks.flatMap((t) => rationality.validatePackTask(t).gaps);
    assert.deepEqual(lintPackErrors.sort(), preflight.sort());
    assert.equal(lintPackErrors.length, 2, 'T1 sem symbols (código) e T3 write_set aberto; T2 (CSS) passa');
  });

  it('tarefas done não são cobradas pelo lint', () => {
    const pack = { tasks: [base({ id: 'T1', symbols: [] })] };
    const plan = { tasks: [{ id: 'T1', title: 'a', wave: 1, dependsOn: [], files: ['src/a.ts'], aceite: [], done: true }], acceptanceTests: [] };
    const lint = planJson.lintPlan({ plan, spec: null, pack, phase: null, projectRoot: process.cwd(), requiredVersions: new Map() });
    assert.equal(lint.errors.filter((e) => e.startsWith('IMPLEMENTATION-PACK.json')).length, 0);
  });
});
