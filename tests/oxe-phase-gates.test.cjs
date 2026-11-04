'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gates = require('../bin/lib/oxe-phase-gates.cjs');
const change = require('../bin/lib/oxe-change.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21 · OXB-020: os gates do projeto (typecheck, lint, governança, CI) rodam uma vez no verify da fase; um gate
// vermelho vira CR com a saída e fecha quando o mesmo gate fica verde.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-gates-')); dirs.push(d); return d; }

describe('phase gates: declaração', () => {
  it('normaliza, rejeita gates inválidos e o plano vence o config no mesmo id', () => {
    const list = gates.readPhaseGates(
      { phase_gates: [{ id: 'typecheck', command: 'npm run typecheck' }, { id: 'x' }] },
      { phase_gates: [{ id: 'typecheck', command: 'tsc' }, { id: 'lint', command: 'npm run lint', when: 'program_close' }] },
    );
    assert.deepEqual(list.map((g) => [g.id, g.command, g.when]), [['typecheck', 'npm run typecheck', 'phase_verify'], ['lint', 'npm run lint', 'program_close']]);
    assert.equal(list[0].timeout_ms, gates.DEFAULT_GATE_TIMEOUT_MS);
  });

  it('o PLAN.json valida phase_gates e o parser os leva adiante', () => {
    const doc = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1 }], phase_gates: [{ id: 'typecheck', command: 'npm run typecheck', runner: 'lock -- {command}' }] };
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    assert.equal(planJson.planJsonToParsedPlan(doc).phaseGates[0].id, 'typecheck');
    const bad = { ...doc, phase_gates: [{ id: 'typecheck' }, { id: 'ci', kind: 'ci' }, { id: 'l', command: 'x', runner: 'sem marcador' }] };
    const errors = planJson.validatePlanJson(bad).join('\n');
    assert.match(errors, /phase_gates\[0\]\.command: obrigatório/);
    assert.doesNotMatch(errors, /phase_gates\[1\]/, 'kind ci não exige command');
    assert.match(errors, /phase_gates\[2\]\.runner: modelo com \{command\}/);
  });

  it('o runner envolve o comando e o check carrega o timeout próprio', () => {
    process.env.OXE_TEST_LOCKDIR = '/tmp/locks';
    const [check] = gates.gateChecks(
      gates.readPhaseGates({ phase_gates: [{ id: 'typecheck', command: 'npm run typecheck', timeout_ms: 1000 }] }, {}),
      'phase_verify',
      { defaultRunner: 'node {env:OXE_TEST_LOCKDIR}/lock.mjs -- {command}' },
    );
    assert.equal(check.id, 'gate-typecheck');
    assert.equal(check.command, 'node /tmp/locks/lock.mjs -- npm run typecheck');
    assert.equal(check.timeout_ms, 1000);
    assert.equal(check.phase_gate, 'typecheck');
  });

  it('o lint avisa quando o repo tem gates e o plano não declara nenhum', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest' } }));
    fs.mkdirSync(path.join(dir, 'tests', 'integration'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'design-lint.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'integration', 'fs-allowlist.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'feature.test.ts'), '');
    const [warning] = gates.lintPhaseGates(dir, []);
    assert.match(warning, /typecheck \(`npm run typecheck`\)/);
    assert.match(warning, /tests\/design-lint\.test\.ts/);
    assert.match(warning, /tests\/integration\/fs-allowlist\.test\.ts/);
    assert.doesNotMatch(warning, /feature\.test/);
    assert.deepEqual(gates.lintPhaseGates(dir, [{ id: 'typecheck' }]), []);
  });
});

describe('phase gates: CR automático', () => {
  it('gate vermelho abre um CR constraint com a saída; repetir não duplica; o gate verde o fecha', () => {
    const dir = tmpDir();
    const failing = [{ check_id: 'gate-typecheck', status: 'fail', stdout: 'src/a.ts(3,1): error TS2322: x\nok line', stderr: '' }];
    const first = gates.recordGateFailures({ programDir: dir, program: null, plan: { tasks: [] }, checkResults: failing });
    assert.equal(first.created.length, 1);
    const cr = first.created[0];
    assert.equal(cr.class, 'constraint');
    assert.equal(cr.gate, 'typecheck');
    assert.equal(cr.by, 'phase_gate:typecheck');
    assert.match(cr.evidence, /TS2322/);
    assert.equal(gates.recordGateFailures({ programDir: dir, program: null, plan: { tasks: [] }, checkResults: failing }).created.length, 0);
    const r = change.reconcileChanges(dir, null, { acceptanceTests: [] }, [{ check_id: 'gate-typecheck', status: 'pass' }]);
    assert.deepEqual(r.resolved, [cr.id]);
  });
});

describe('phase gates: CI anexado', () => {
  it('aceita id ou URL e só fica verde com success na head anexada', () => {
    const dir = tmpDir();
    assert.throws(() => gates.attachCiRun(dir, { run: 'abc' }), /run de CI/);
    const rec = gates.attachCiRun(dir, { run: 'https://github.com/o/r/actions/runs/123', phase: 'F1', head: 'ae6b79b9' });
    assert.deepEqual([rec.run, rec.repo], ['123', 'o/r']);
    assert.equal(gates.latestCiRun(dir, 'F1').run, '123');
    const fake = (payload, status = 0) => () => ({ status, stdout: JSON.stringify(payload), stderr: '' });
    assert.equal(gates.ciRunStatus(rec, { spawn: fake({ status: 'in_progress' }) }).state, 'pending');
    assert.equal(gates.ciRunStatus(rec, { spawn: fake({ status: 'completed', conclusion: 'failure' }) }).state, 'red');
    assert.equal(gates.ciRunStatus(rec, { spawn: fake({ status: 'completed', conclusion: 'success', headSha: '4fdc80ef00' }) }).state, 'stale');
    assert.equal(gates.ciRunStatus(rec, { spawn: fake({ status: 'completed', conclusion: 'success', headSha: 'ae6b79b9ff' }) }).ok, true);
  });
});

function project(planDoc) {
  const tmp = tmpDir();
  fs.mkdirSync(path.join(tmp, '.oxe', 'program'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 't'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | `node t/ok.js` |\n');
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(tmp, 't', 'ok.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(tmp, 't', 'gate.js'), "const fs=require('fs');if(fs.existsSync('t/red')){console.error('src/x.ts(1,1): error TS2304: nope');process.exit(2)}console.log('gate ok')\n");
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify(planDoc));
  return tmp;
}

const basePlan = {
  schema_version: 1,
  tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/x.js'], acceptance: ['A1'], verify: { commands: ['node t/ok.js'] } }],
  phase_gates: [{ id: 'typecheck', command: 'node t/gate.js' }],
};

describe('phase gates no verify (ponta a ponta)', () => {
  it('gate vermelho reprova o verify e abre CR; verde de novo resolve o CR', async () => {
    const tmp = project(basePlan);
    fs.writeFileSync(path.join(tmp, 't', 'red'), '');
    op.compileExecutionGraphFromArtifacts(tmp, null);
    const red = await op.runRuntimeVerify(tmp, null);
    assert.equal(red.report.status, 'failed');
    assert.deepEqual(red.gates.failed, ['typecheck']);
    assert.equal(red.gates.changes.length, 1);
    const cr = op.runtimeChanges(tmp, null).find((c) => c.gate === 'typecheck');
    assert.equal(cr.status, 'open');
    assert.match(cr.evidence, /TS2304/);

    fs.rmSync(path.join(tmp, 't', 'red'));
    const green = await op.runRuntimeVerify(tmp, null);
    assert.deepEqual(green.gates.passed, ['typecheck']);
    // The program close reads the gates from the persisted run (reference project: the normalizer dropped them).
    assert.deepEqual(op.readRunState(tmp, null).verification_gates.passed, ['typecheck']);
    assert.equal(op.runtimeChanges(tmp, null).find((c) => c.id === cr.id).status, 'resolved');
  });

  it('--no-gates (gates: false) pula os gates', async () => {
    const tmp = project(basePlan);
    fs.writeFileSync(path.join(tmp, 't', 'red'), '');
    op.compileExecutionGraphFromArtifacts(tmp, null);
    const out = await op.runRuntimeVerify(tmp, null, { gates: false });
    assert.equal(out.gates.total, 0);
  });
});
