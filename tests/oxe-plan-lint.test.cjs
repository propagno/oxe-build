'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.19 — PLAN.json canônico: o runtime lê dados estruturados; `plan lint` torna mecânicas as
// regras de quality gate do plan.md (ids, dependências, escopo por onda, A* da fase, pack).

const SPEC = `# OXE — SPEC

## Objetivo

Lint.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | a | \`node -e "process.exit(0)"\` |
| A2 | b | \`node -e "process.exit(0)"\` |
`;

const PLAN_MD = `# OXE — PLAN

### T1 — markdown

- **Arquivos alvo:** \`src/md.js\`
- **Onda:** 1
- **Verificar:**
  - Comando: \`node -e "process.exit(0)"\`
- **Aceite vinculado:** A1
`;

function goodPlan() {
  return {
    schema_version: 1,
    phase: 'F1',
    tasks: [
      { id: 'T1', title: 'store', wave: 1, files: ['src/store.js'], verify: { commands: ['node -e "process.exit(0)"'] }, acceptance: ['A1'] },
      { id: 'T2', title: 'api', wave: 2, depends_on: ['T1'], files: ['src/api.js'], verify: { commands: ['node a.js', 'node b.js'] }, acceptance: ['A2'] },
    ],
  };
}

describe('PLAN.json — schema e conversão', () => {
  it('válido converte para o formato do parsePlan (comandos juntados, ondas)', () => {
    assert.deepEqual(planJson.validatePlanJson(goodPlan()), []);
    const parsed = planJson.planJsonToParsedPlan(goodPlan());
    assert.equal(parsed.source, 'PLAN.json');
    assert.deepEqual(parsed.waves, { 1: ['T1'], 2: ['T2'] });
    assert.equal(parsed.tasks[1].verifyCommand, 'node a.js && node b.js');
    assert.deepEqual(parsed.tasks[1].dependsOn, ['T1']);
    assert.deepEqual(parsed.tasks[0].aceite, ['A1']);
  });

  it('erros de schema apontam o caminho', () => {
    const bad = goodPlan();
    bad.schema_version = 2;
    bad.tasks[0].id = 'X1';
    bad.tasks[1].wave = 0;
    bad.tasks[1].acceptance = ['Z9'];
    const errors = planJson.validatePlanJson(bad);
    assert.ok(errors.includes('$.schema_version: deve ser 1'));
    assert.ok(errors.some((e) => e.startsWith('$.tasks[0].id')));
    assert.ok(errors.some((e) => e.startsWith('$.tasks[1].wave')));
    assert.ok(errors.some((e) => e.startsWith('$.tasks[1].acceptance')));
  });
});

describe('lintPlan — regras estruturais', () => {
  const spec = { criteria: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }] };

  it('dependência na mesma onda, escopo colidindo, ciclo e aceite inexistente', () => {
    const plan = planJson.planJsonToParsedPlan({
      schema_version: 1,
      tasks: [
        { id: 'T1', title: 'a', wave: 1, files: ['src/x.js'], depends_on: ['T3'], acceptance: ['A1'], verify: { commands: ['x'] } },
        { id: 'T2', title: 'b', wave: 1, files: ['src/x.js'], acceptance: ['A9'], verify: { commands: ['x'] } },
        { id: 'T3', title: 'c', wave: 2, depends_on: ['T1', 'T7'], acceptance: ['A2'] },
      ],
    });
    const result = planJson.lintPlan({ plan, spec });
    const text = result.errors.join('\n');
    assert.equal(result.ok, false);
    assert.match(text, /T1 \(onda 1\) depende de T3 \(onda 2\)/);
    assert.match(text, /onda 1: T1 e T2 escrevem src\/x\.js/);
    assert.match(text, /dependência circular/);
    assert.match(text, /T2: aceite A9 não existe na SPEC/);
    assert.match(text, /T3: depende de T7, que não existe/);
    assert.match(result.warnings.join('\n'), /T3: sem comando de verificação/);
    assert.match(result.warnings.join('\n'), /A\* da SPEC sem tarefa: A3/);
  });

  it('fase do programa: A* de outra fase e A* da fase sem tarefa; pack obrigatório para mutável', () => {
    const plan = planJson.planJsonToParsedPlan(goodPlan());
    const phase = { id: 'F1', acceptance: ['A1', 'A3'] };
    const pack = { tasks: [{ id: 'T1' }] };
    const result = planJson.lintPlan({ plan, spec, phase, pack, maxTasksPerWave: 0 });
    const text = result.errors.join('\n');
    assert.match(text, /fase F1: o plano usa A\* de outras fases: A2/);
    assert.match(text, /fase F1: A\* da fase sem tarefa: A3/);
    assert.match(text, /T2: tarefa mutável sem entrada no IMPLEMENTATION-PACK/);
  });

  it('aceite do plano: arquivo ausente, no escopo do executor, critério inexistente e A* sem teste', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-lint-accept-'));
    try {
      fs.mkdirSync(path.join(tmp, 'test', 'acceptance'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'test', 'acceptance', 'a1.test.js'), '// a1\n');
      const doc = goodPlan();
      doc.tasks[1].files.push('test/acceptance/a2.test.js');
      doc.acceptance_tests = [
        { criterion: 'A1', files: ['test/acceptance/a1.test.js'], command: 'node --test test/acceptance/a1.test.js' },
        { criterion: 'A2', files: ['test/acceptance/a2.test.js'], command: 'node --test test/acceptance/a2.test.js' },
        { criterion: 'A9', files: ['test/acceptance/a1.test.js'], command: 'x' },
      ];
      assert.deepEqual(planJson.validatePlanJson(doc), []);
      const plan = planJson.planJsonToParsedPlan(doc);
      const text = planJson.lintPlan({ plan, spec: { criteria: [{ id: 'A1' }, { id: 'A2' }] }, projectRoot: tmp }).errors.join('\n');
      assert.match(text, /teste de aceite A2: test\/acceptance\/a2\.test\.js não existe/);
      assert.match(text, /teste de aceite A2: test\/acceptance\/a2\.test\.js está no escopo de T2/);
      assert.match(text, /teste de aceite A9: critério não existe na SPEC/);

      const only = planJson.planJsonToParsedPlan({ ...goodPlan(), acceptance_tests: [doc.acceptance_tests[0]] });
      const soft = planJson.lintPlan({ plan: only, spec: { criteria: [{ id: 'A1' }, { id: 'A2' }] }, projectRoot: tmp });
      assert.match(soft.warnings.join('\n'), /A\* sem teste de aceite congelado: A2/);
      const strict = planJson.lintPlan({ plan: only, spec: { criteria: [{ id: 'A1' }, { id: 'A2' }] }, projectRoot: tmp, requireAcceptanceTests: true });
      assert.match(strict.errors.join('\n'), /A\* sem teste de aceite congelado: A2/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('plano bom passa; limite de tarefas por onda é cobrado', () => {
    const plan = planJson.planJsonToParsedPlan(goodPlan());
    assert.deepEqual(planJson.lintPlan({ plan, spec: { criteria: [{ id: 'A1' }, { id: 'A2' }] } }).errors, []);
    const crowded = planJson.planJsonToParsedPlan({
      schema_version: 1,
      tasks: [1, 2, 3].map((n) => ({ id: `T${n}`, title: 't', wave: 1, files: [`f${n}.js`], verify: { commands: ['x'] } })),
    });
    assert.match(planJson.lintPlan({ plan: crowded, maxTasksPerWave: 2 }).errors.join('\n'), /onda 1: 3 tarefas > plan_max_tasks_per_wave \(2\)/);
  });
});

describe('runtime lê PLAN.json e o CLI `plan lint`', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function project() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-planjson-'));
    dirs.push(tmp);
    fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC, 'utf8');
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN_MD, 'utf8');
    fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# OXE — STATE\n', 'utf8');
    return tmp;
  }

  it('PLAN.json vence o markdown no compile; inválido é erro explícito', () => {
    const tmp = project();
    const doc = goodPlan();
    delete doc.phase;
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify(doc), 'utf8');
    const compiled = op.compileExecutionGraphFromArtifacts(tmp, null);
    const nodes = compiled.run.compiled_graph.nodes;
    assert.deepEqual(Object.keys(nodes).sort(), ['T1', 'T2'], 'grafo veio do PLAN.json, não do PLAN.md (T1 markdown)');

    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [] }), 'utf8');
    assert.throws(() => op.compileExecutionGraphFromArtifacts(tmp, null, { runState: {} }), /PLAN\.json não segue o schema/);
  });

  it('CLI: sem PLAN.json avisa; com erro sai 1 e lista os erros em JSON', () => {
    const tmp = project();
    const cli = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
    const md = spawnSync(process.execPath, [cli, 'plan', 'lint', '--json', tmp], { encoding: 'utf8' });
    assert.equal(md.status, 0, md.stderr);
    const mdReport = JSON.parse(md.stdout);
    assert.equal(mdReport.source, 'PLAN.md');
    assert.match(mdReport.warnings.join('\n'), /PLAN\.json ausente/);

    const bad = goodPlan();
    delete bad.phase;
    bad.tasks[1].wave = 1;
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify(bad), 'utf8');
    const res = spawnSync(process.execPath, [cli, 'plan', 'lint', '--json', tmp], { encoding: 'utf8' });
    assert.equal(res.status, 1);
    const report = JSON.parse(res.stdout);
    assert.equal(report.source, 'PLAN.json');
    assert.match(report.errors.join('\n'), /T2 \(onda 1\) depende de T1 \(onda 1\)/);
  });
});

describe('gate por tarefa e dependência externa (1.20c, OXB-005)', () => {
  it('PLAN.json gate/blocked_by viram gate do nó; o scheduler para antes da tarefa', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-taskgate-'));
    try {
      fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC, 'utf8');
      fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN_MD, 'utf8');
      fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n', 'utf8');
      const doc = goodPlan();
      delete doc.phase;
      doc.tasks[1].blocked_by = ['oxespace#B21'];
      doc.tasks[1].gate = { kind: 'external', reason: 'wiring dos hot files só depois do B21' };
      assert.deepEqual(planJson.validatePlanJson(doc), []);
      fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify(doc), 'utf8');
      const ran = [];
      const executor = { async execute(node) { ran.push(node.id); return { success: true, failure_class: null, evidence: [], output: 'ok' }; } };
      const res = await op.runRuntimeExecute(tmp, null, { executor, skipPreflight: true });
      assert.deepEqual(ran, ['T1'], 'T2 não executa enquanto o gate não for resolvido');
      const gateEvent = op.readEvents(tmp, null).find((e) => e.type === 'GateRequested');
      assert.ok(gateEvent, 'GateRequested emitido');
      assert.match(JSON.stringify(gateEvent.payload), /oxespace#B21/);
      assert.notEqual(res.result.status, 'completed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
