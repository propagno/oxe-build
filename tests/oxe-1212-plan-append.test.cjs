'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OXB-087: HML found 4 gaps (G1–G4) after F2's plan was frozen and its execute chained; the only option was a
// second plan in the same phase after the first run ended.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = `# SPEC

## Objetivo

x

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | a base funciona | manual |
| A2 | as lacunas do HML | manual |
`;

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pa-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  const ok = 'node -e "process.exit(0)"';
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'base', wave: 1, files: ['src/t1.js'], acceptance: ['A1'], verify: { commands: [ok] } },
    { id: 'T2', title: 'mais', wave: 2, depends_on: ['T1'], files: ['src/t2.js'], acceptance: ['A1'], verify: { commands: [ok] } },
  ] }, null, 2));
  const phase = { id: 'F2', title: 'Remoções', requirements: [], acceptance: ['A1', 'A2'], scope: null, status: 'executing', plan_ref: '.oxe/PLAN.md', run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null };
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F2', created_at: 'x', updated_at: 'x', phases: [phase] }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const writer = (dir, ran) => ({
  async execute(node) {
    ran.push(node.id);
    const file = `src/${node.id.toLowerCase()}.js`;
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'module.exports = 1;\n');
    return { success: true, failure_class: null, evidence: [file], output: 'ok', completed_by: 'finish_task' };
  },
});
const extra = (dir, doc) => { const f = path.join(dir, 'extra.json'); fs.writeFileSync(f, JSON.stringify(doc)); return f; };

describe('OXB-087: plan append while the phase is executing', () => {
  it('renumbers the batch after the last T, shifts its waves after the last wave, maps deps, logs the batch', async () => {
    const dir = project();
    const ran = [];
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, ran), skipPreflight: true });
    assert.deepEqual(ran, ['T1', 'T2']);
    const from = extra(dir, { tasks: [
      { id: 'G1', title: 'lacuna 1', wave: 1, files: ['src/t3.js'], acceptance: ['A2'], verify: { commands: ['node -e "process.exit(0)"'] } },
      { id: 'G2', title: 'lacuna 2', wave: 2, depends_on: ['G1', 'T1'], files: ['src/t4.js'], acceptance: ['A2'], verify: { commands: ['node -e "process.exit(0)"'] } },
    ] });
    const out = op.runtimePlanAppend(dir, null, { from, by: 'hml', reason: 'lacunas G1–G4 do HML' });
    assert.equal(out.batch, 2);
    assert.deepEqual(out.tasks.map((t) => [t.id, t.wave, t.from_id]), [['T3', 3, 'G1'], ['T4', 4, 'G2']]);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(doc.tasks.find((t) => t.id === 'T4').depends_on, ['T3', 'T1']);
    assert.ok(doc.tasks.find((t) => t.id === 'T1').done, 'the done of batch 1 is kept');
    assert.deepEqual(doc.batches.map((b) => [b.batch, b.tasks]), [[1, ['T1', 'T2']], [2, ['T3', 'T4']]]);
    const log = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8');
    assert.match(log, /"action":"plan_append","batch":2,"tasks":\["T3","T4"\]/);
    // The phase is not complete until both batches are done; the next execute runs only the batch.
    assert.equal(op.runtimePhaseWork(dir, null).complete, false);
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, ran), skipPreflight: true });
    assert.deepEqual(ran, ['T1', 'T2', 'T3', 'T4'], 'done tasks are not run again');
    assert.equal(op.runtimePhaseWork(dir, null).complete, true);
  });

  it('refuses a batch whose depends_on is unknown, or that fails the schema; nothing is written', () => {
    const dir = project();
    const before = fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8');
    assert.throws(() => op.runtimePlanAppend(dir, null, { from: extra(dir, { tasks: [{ id: 'G1', title: 'x', wave: 1, files: ['a.js'], depends_on: ['T9'] }] }), by: 'hml', reason: 'lacunas do HML' }), /depends_on "T9" não é do lote nem do plano/);
    assert.throws(() => op.runtimePlanAppend(dir, null, { from: extra(dir, { tasks: [{ id: 'G1', wave: 1, files: ['a.js'], acceptance: ['a tela some'] }] }), by: 'hml', reason: 'lacunas do HML' }), /schema do PLAN\.json[\s\S]*title: obrigatório[\s\S]*"a tela some" não é id A<n>/);
    assert.throws(() => op.runtimePlanAppend(dir, null, { from: extra(dir, { tasks: [{ id: 'G1', title: 'x', wave: 1, files: ['a.js'] }] }), by: 'hml' }), /--reason/);
    // An error the batch introduces in plan lint (a criterion the SPEC does not have) rolls the write back.
    assert.throws(() => op.runtimePlanAppend(dir, null, { from: extra(dir, { tasks: [{ id: 'G1', title: 'x', wave: 1, files: ['src/g.js'], acceptance: ['A9'], verify: { commands: ['node -e "process.exit(0)"'] } }] }), by: 'hml', reason: 'lacunas do HML' }), /plan lint reprovou o lote \(nada foi gravado\):[\s\S]*T3: aceite A9 não existe na SPEC/);
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'), before);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'PLAN.json.lock')), 'the lock is released on error');
  });

  it('PLAN.json writes share a lock: a stale lock is taken over, and done-writeback goes through it', () => {
    const dir = project();
    const jsonPath = path.join(dir, '.oxe', 'PLAN.json');
    fs.writeFileSync(`${jsonPath}.lock`, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${jsonPath}.lock`, old, old);
    assert.equal(planJson.markPlanTaskDone(path.join(dir, '.oxe', 'PLAN.md'), 'T1', { commit: 'abc' }), true);
    assert.ok(!fs.existsSync(`${jsonPath}.lock`));
    assert.equal(planJson.withPlanLock(jsonPath, () => fs.existsSync(`${jsonPath}.lock`)), true, 'held while the callback runs');
  });

  it('CLI: plan append --from … --by … --reason …', () => {
    const dir = project();
    const from = extra(dir, { tasks: [{ id: 'G1', title: 'lacuna', wave: 1, files: ['src/t3.js'], acceptance: ['A2'], verify: { commands: ['node -e "process.exit(0)"'] } }] });
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'plan', 'append', '--from', from, '--by', 'hml', '--reason', 'lacunas do HML', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /lote 2: T3 \(G1\) onda 3/);
  });
});
