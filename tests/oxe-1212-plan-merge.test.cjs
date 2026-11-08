'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mergeRolePlans } = require('../bin/lib/oxe-plan-merge.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OXB-086: BACKEND and FRONTEND each wrote a task file for the same F2 removals (R5 and FE-R5); the TL needed
// a 150-line script to merge them, and hit prose criteria and dict-shaped proves.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const BACKEND = {
  role: 'backend',
  tasks: [
    { rid: 'R3', id: 'R3', title: 'tirar a rota do AI Memory', files: ['electron/main/memory.ts'], verify: { commands: ['vitest run tests/acceptance/r3.test.ts'] }, acceptance: ['A12'] },
    { rid: 'R5', id: 'R5', title: 'remover o AI Memory (backend)', files: ['electron/main/ai-memory/index.ts'], depends_on: ['R3'], verify: { commands: ['vitest run tests/acceptance/r5.test.ts'] }, acceptance: ['A14'], proves: { 'tests/acceptance/r5.test.ts': ['remove o IPC memory:*'] } },
  ],
};
const FRONTEND = {
  role: 'frontend',
  tasks: [
    { rid: 'R5', id: 'FE-R5', title: 'remover o AI Memory (tela)', files: ['src/pages/Memory.tsx', 'electron/main/ai-memory/index.ts'], verify: ['vitest run tests/acceptance/r5.test.ts', 'vitest run src/pages'], criteria: ['A14', 'a tela some do menu'] },
    { rid: 'R7', id: 'FE-R7', title: 'limpar o menu', files: ['src/menu.ts'], depends_on: ['R5'], verify: 'vitest run src/menu', criteria: ['A15'] },
  ],
  acceptance_tests: [{ criterion: 'A14', files: ['tests/acceptance/r5.test.ts'], command: 'vitest run tests/acceptance/r5.test.ts', proves: ['a tela some'] }],
};

describe('OXB-086: plan merge of per-role plans', () => {
  it('one task per rid: unions, deps by rid, waves by depth, T ids, prose criteria to notes, both proves shapes', () => {
    const r = mergeRolePlans([{ file: 'backend.json', doc: BACKEND }, { file: 'frontend.json', doc: FRONTEND }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.map, { R3: 'T1', R5: 'T2', R7: 'T3' });
    const [t1, t2, t3] = r.plan.tasks;
    assert.deepEqual([t1.wave, t2.wave, t3.wave], [1, 2, 3]);
    assert.deepEqual(t2.depends_on, ['T1']);
    assert.deepEqual(t3.depends_on, ['T2']);
    assert.deepEqual(t2.roles, ['backend', 'frontend']);
    assert.deepEqual(t2.files, ['electron/main/ai-memory/index.ts', 'src/pages/Memory.tsx']);
    assert.deepEqual(t2.verify.commands, ['vitest run tests/acceptance/r5.test.ts', 'vitest run src/pages']);
    assert.deepEqual(t2.acceptance, ['A14']);
    assert.match(t2.notes, /frontend \(critério em prosa\): a tela some do menu/);
    assert.match(t2.notes, /frontend: remover o AI Memory \(tela\)/);
    assert.ok(r.warnings.some((w) => /critério em prosa movido para notes — "a tela some do menu"/.test(w)));
    // BACKEND's { file: [titles] } folds into FRONTEND's acceptance_tests entry for the same file.
    assert.equal(r.plan.acceptance_tests.length, 1);
    assert.deepEqual(r.plan.acceptance_tests[0].proves, ['a tela some', 'remove o IPC memory:*']);
    assert.deepEqual(planJson.validatePlanJson(r.plan), [], 'the merged plan passes the PLAN.json schema');
  });

  it('a dict proves with no matching entry becomes one when the task has one criterion and a verify naming the file', () => {
    const r = mergeRolePlans([{ file: 'backend.json', doc: BACKEND }, { file: 'x.json', doc: { tasks: [{ rid: 'R9', title: 'x', files: ['a.ts'] }] } }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.plan.acceptance_tests, [{ criterion: 'A14', files: ['tests/acceptance/r5.test.ts'], command: 'vitest run tests/acceptance/r5.test.ts', proves: ['remove o IPC memory:*'] }]);
  });

  it('errors name the problem: missing rid, unknown dependency, cycle', () => {
    const r = mergeRolePlans([
      { file: 'a.json', doc: { tasks: [{ title: 'sem chave' }, { rid: 'R1', title: 'a', depends_on: ['R2'] }, { rid: 'R2', title: 'b', depends_on: ['R1'] }, { rid: 'R4', title: 'c', depends_on: ['R99'] }] } },
      { file: 'b.json', doc: { tasks: [] } },
    ]);
    const text = r.errors.join('\n');
    assert.match(text, /a\.json: tasks\[0\]: sem "rid"/);
    assert.match(text, /ciclo de dependência: R1 → R2 → R1/);
    assert.match(text, /R4: depends_on "R99" não existe em nenhum plano/);
  });

  it('plan lint names prose criteria and dict proves with the fix', () => {
    const errors = planJson.validatePlanJson({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['a.ts'], acceptance: ['A1', 'a tela some do menu'] }], acceptance_tests: [{ criterion: 'A1', files: ['t.ts'], command: 'x', proves: { 't.ts': ['y'] } }] });
    const text = errors.join('\n');
    assert.match(text, /\$\.tasks\[0\]\.acceptance: "a tela some do menu" não é id A<n> — critérios são ids A da SPEC; a prosa vai em "notes"/);
    assert.match(text, /proves: lista de nomes de teste — o formato \{ arquivo: \[títulos\] \} é de plano por papel: junte com oxe-cc plan merge/);
  });

  it('CLI: --out writes the PLAN.json (refuses to overwrite without --force), errors exit 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pm-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'backend.json'), JSON.stringify(BACKEND));
    fs.writeFileSync(path.join(dir, 'frontend.json'), JSON.stringify(FRONTEND));
    const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
    const run = (...args) => spawnSync(process.execPath, [CLI, 'plan', 'merge', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    let r = run('backend.json', 'frontend.json', '--out', '.oxe/PLAN.json');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /3 tarefas em 3 onda\(s\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')).tasks.length, 3);
    r = run('backend.json', 'frontend.json', '--out', '.oxe/PLAN.json');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /já existe . use --force/);
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ tasks: [{ title: 'x' }] }));
    r = run('backend.json', 'bad.json', '--json');
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).errors.join('\n'), /sem "rid"/);
  });
});
