'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.19 — Programa por fases: ROADMAP → fases; gate de fase com regressão, contratos e commit;
// a fase seguinte recebe as interfaces da anterior e não pode quebrá-la.

const ROADMAP = `# Roteiro de Entrega

## Fase 1 — Armazenamento

**Requisitos:** R1
**Critérios de aceite:** A1
**Escopo:** store em memória

## Fase 2 — API

**Requisitos:** R2
**Critérios de aceite:** A2
**Escopo:** api sobre o store
`;

const SPEC1 = `# OXE — SPEC

## Objetivo

Fase 1.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | store exporta save | \`node -e "process.exit(typeof require('./src/store.js').save === 'function' ? 0 : 1)"\` |
`;

const PLAN1 = `# OXE — PLAN

## Resumo

Fase 1.

### T1 — Store

- **Arquivos alvo:** \`src/store.js\`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: \`node -e "process.exit(typeof require('./src/store.js').save === 'function' ? 0 : 1)"\`
- **Aceite vinculado:** A1

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 95%
`;

const SPEC2 = SPEC1.replace('Fase 1.', 'Fase 2.')
  .replace(/\| A1 .*\n/, "| A2 | api exporta handle | `node -e \"process.exit(typeof require('./src/api.js').handle === 'function' ? 0 : 1)\"` |\n");

const PLAN2 = `# OXE — PLAN

## Resumo

Fase 2.

### T1 — API

- **Arquivos alvo:** \`src/api.js\`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: \`node -e "process.exit(typeof require('./src/api.js').handle === 'function' ? 0 : 1)"\`
- **Aceite vinculado:** A2

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 95%
`;

const PACK1 = {
  tasks: [{ id: 'T1', mode: 'mutating', exact_paths: ['src/store.js'], symbols: [{ kind: 'function', name: 'save', path: 'src/store.js' }] }],
};
const PACK2 = {
  tasks: [{ id: 'T1', mode: 'mutating', exact_paths: ['src/api.js'], symbols: [{ kind: 'function', name: 'handle', path: 'src/api.js' }] }],
};

const hasGit = spawnSync('git', ['--version']).status === 0;

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function writePhaseArtifacts(tmp, spec, plan, pack) {
  fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), spec, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), plan, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify(pack), 'utf8');
}

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-program-'));
  fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# OXE — STATE\n\n- **phase:** plan_ready\n', 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'ROADMAP.md'), ROADMAP, 'utf8');
  fs.writeFileSync(path.join(tmp, '.gitignore'), '.oxe/\n', 'utf8');
  if (hasGit) {
    git(tmp, ['init', '-q']);
    git(tmp, ['config', 'user.email', 'oxe@test.local']);
    git(tmp, ['config', 'user.name', 'OXE Test']);
    git(tmp, ['config', 'commit.gpgsign', 'false']);
    git(tmp, ['add', '-A']);
    git(tmp, ['commit', '-qm', 'init']);
  }
  return tmp;
}

function writer(files) {
  return {
    async execute(_node, lease) {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(lease.root_path, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
      }
      return { success: true, failure_class: null, evidence: Object.keys(files), output: 'ok' };
    },
  };
}

describe('programa por fases (CLI/operational)', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fase 1 fecha pelo gate; fase 2 recebe interfaces e a regressão pega a quebra da fase 1', async () => {
    const tmp = makeProject();
    dirs.push(tmp);

    let status = op.runtimeProgramInit(tmp, null);
    assert.equal(status.progress.total, 2);
    assert.throws(() => op.runtimeProgramInit(tmp, null), /já existe/);
    status = op.runtimeProgramStart(tmp, null);
    assert.equal(status.state.active_phase, 'F1');

    // Gate sem verify: reprovado.
    writePhaseArtifacts(tmp, SPEC1, PLAN1, PACK1);
    const early = op.runtimeProgramClose(tmp, null, { commit: false });
    assert.equal(early.closed, false);

    // Fase 1: implementa, verifica, fecha.
    await op.runRuntimeExecute(tmp, null, {
      executor: writer({ 'src/store.js': 'function save(item) { return item; }\nmodule.exports = { save };\n' }),
      skipPreflight: true,
    });
    const v1 = await op.runRuntimeVerify(tmp, null);
    assert.equal(v1.run.status, 'completed', JSON.stringify(v1.report.check_results.map((r) => [r.check_id, r.status, r.error])));
    assert.equal(v1.regression, null, 'fase 1 não tem regressão');
    assert.equal(op.runtimeProgramStatus(tmp, null).state.phases[0].status, 'verifying');

    const closed = op.runtimeProgramClose(tmp, null, { commit: hasGit });
    assert.equal(closed.closed, true, JSON.stringify(closed.gate));
    assert.equal(closed.next.id, 'F2');
    const programDir = path.join(tmp, '.oxe', 'program');
    const regression = JSON.parse(fs.readFileSync(path.join(programDir, 'regression', 'F1.json'), 'utf8'));
    assert.deepEqual(regression.checks.map((c) => c.id).sort(), ['check-a1', 'check-pack-t1']);
    const interfaces = JSON.parse(fs.readFileSync(path.join(programDir, 'interfaces', 'F1.json'), 'utf8'));
    assert.deepEqual(interfaces.modules, [{ file: 'src/store.js', exports: [{ name: 'save', signature: '(item)' }] }]);
    if (hasGit) {
      assert.equal(closed.commit.committed, true, String(closed.commit.reason));
      assert.match(git(tmp, ['log', '-1', '--format=%s']).stdout, /feat\(phase-f1\): Armazenamento/);
      assert.equal(op.runtimeProgramStatus(tmp, null).state.phases[0].closed_commit, closed.commit.commit);
    }
    const f1Run = op.readRunState(tmp, null).run_id;

    // Fase 2: o contexto do nó traz a interface da fase 1.
    op.runtimeProgramStart(tmp, null, 'F2');
    writePhaseArtifacts(tmp, SPEC2, PLAN2, PACK2);
    const provider = op.buildNodeContextProvider(tmp, null);
    const ctx = provider({ id: 'T1', mutation_scope: ['src/api.js'], depends_on: [] }, { root_path: tmp });
    assert.deepEqual(ctx.interfaces.map((m) => [m.file, m.phase, m.exports[0].name]), [['src/store.js', 'F1', 'save']]);

    // A fase 2 quebra o store da fase 1 (remove `save`).
    await op.runRuntimeExecute(tmp, null, {
      executor: writer({
        'src/api.js': 'function handle(req) { return req; }\nmodule.exports = { handle };\n',
        'src/store.js': 'module.exports = {};\n',
      }),
      skipPreflight: true,
    });
    assert.notEqual(op.readRunState(tmp, null).run_id, f1Run, 'fase nova não reaproveita a run fechada');
    const v2 = await op.runRuntimeVerify(tmp, null);
    assert.equal(v2.run.status, 'failed');
    assert.deepEqual(v2.regression.phases, ['F1']);
    assert.deepEqual(v2.regression.failed.map((f) => f.check_id).sort(), ['reg-f1-check-a1', 'reg-f1-check-pack-t1']);
    assert.match(v2.regression.failed.find((f) => f.check_id === 'reg-f1-check-pack-t1').error, /exports_missing: src\/store\.js#save/);
    assert.ok(v2.report.check_results.some((r) => r.check_id === 'check-a2' && r.status === 'pass'), 'a fase 2 em si passa');

    const blocked = op.runtimeProgramClose(tmp, null, { commit: false });
    assert.equal(blocked.closed, false);
    assert.match(blocked.gate.reasons.join(' | '), /regressão de fases anteriores: reg-f1-check-a1/);
    assert.ok(op.readEvents(tmp, null).some((e) => e.type === 'PhaseGateFailed'));

    // Conserta o store: regressão verde, fase fecha.
    fs.writeFileSync(path.join(tmp, 'src', 'store.js'), 'function save(item) { return item; }\nmodule.exports = { save };\n', 'utf8');
    const v3 = await op.runRuntimeVerify(tmp, null);
    assert.equal(v3.run.status, 'completed');
    assert.equal(v3.regression.failed.length, 0);
    const done = op.runtimeProgramClose(tmp, null, { commit: false });
    assert.equal(done.closed, true, JSON.stringify(done.gate));
    assert.equal(done.next, null, 'programa concluído');
    const types = op.readEvents(tmp, null).map((e) => e.type);
    for (const t of ['ProgramCreated', 'PhaseStarted', 'PhaseClosed']) assert.ok(types.includes(t), t);
  });

  it('start fora de ordem e init sem ROADMAP falham com mensagem clara', () => {
    const tmp = makeProject();
    dirs.push(tmp);
    op.runtimeProgramInit(tmp, null);
    assert.throws(() => op.runtimeProgramStart(tmp, null, 'F2'), /feche antes: F1/);
    fs.rmSync(path.join(tmp, '.oxe', 'ROADMAP.md'));
    assert.throws(() => op.runtimeProgramInit(tmp, null, { force: true }), /ROADMAP\.md não encontrado/);
  });
});
