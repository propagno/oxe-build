'use strict';

// Proposals 3 and 4 of the bench v2: an ambiguity becomes an executable example; test strength is measured.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cases = require('../bin/lib/oxe-grill-cases.cjs');
const grill = require('../bin/lib/oxe-grill.cjs');
const mutate = require('../bin/lib/oxe-plan-mutate.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-p34-')); dirs.push(d); return d; };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const childEnv = { ...process.env, OXE_NO_PROMPT: '1', NO_COLOR: '1' };
delete childEnv.NODE_TEST_CONTEXT;
const cli = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', env: childEnv });

const OPTIONS = ['mine=true', 'sem filtro'];
const CASE = 'aprovador lista sem parâmetros => não vê nada | vê a fila';
const NEED = 'aprovador lista sem parâmetros => vê a fila';
const ASK = { branch: 'rules', question: 'Qual o padrão do filtro mine?', options: OPTIONS, recommended: 'sem filtro', case: [CASE], need: [NEED] };

function asked() {
  const dir = path.join(tmp(), 'grill');
  grill.start(dir, { type: 'feature' });
  grill.ask(dir, ASK);
  return dir;
}

describe('executable disambiguation: the question', () => {
  it('refuses the recommended option that fails what the role needs (the F2-14 miss)', () => {
    assert.throws(() => cases.build({ options: OPTIONS, recommended: 'mine=true', cases: [CASE], needs: [NEED] }), /falha no que o papel precisa.*atendem: b\)/);
  });

  it('refuses cases that do not tell the options apart, the wrong number of outcomes and a need with no case', () => {
    const build = (c, n) => () => cases.build({ options: OPTIONS, recommended: 'sem filtro', cases: c, needs: n });
    assert.throws(build(['x => igual | igual']), /nenhum caso separa a\) de b\)/);
    assert.throws(build(['x => só um']), /1 resultado\(s\) para 2 opções/);
    assert.throws(build([], [NEED]), /exige o --case/);
    assert.throws(build([CASE], ['outro cenário => vê a fila']), /não há --case/);
  });

  it('a question with no cases works as before', () => {
    const dir = path.join(tmp(), 'grill');
    grill.start(dir, { type: 'feature' });
    grill.ask(dir, { branch: 'rules', question: 'Qual o padrão do limite?', recommended: '20' });
    assert.deepEqual(grill.answer(dir, 'Q-1', { choice: 'ok' }).examples, []);
  });
});

describe('executable disambiguation: the answer', () => {
  it('ok, a number and a letter freeze the example of the option chosen', () => {
    assert.equal(grill.answer(asked(), 'Q-1', { choice: 'ok' }).examples[0].id, 'Q-1.1b');
    assert.equal(grill.answer(asked(), 'Q-1', { choice: '1' }).examples[0].id, 'Q-1.1a');
    const r = grill.answer(asked(), 'Q-1', { choice: 'b' });
    assert.equal(r.answer, 'sem filtro');
    assert.deepEqual(r.examples[0], { id: 'Q-1.1b', question: 'Q-1', scenario: 'aprovador lista sem parâmetros', expect: 'vê a fila' });
  });

  it('an answer outside the options freezes nothing and says so', () => {
    const dir = asked();
    assert.equal(grill.answer(dir, 'Q-1', { text: 'depende do tenant' }).examples, null);
    assert.equal(cases.specFindings({ questions: grill.status(dir).questions, criteria: [] }).warnings.length, 1);
  });

  it('spec check: the example needs a criterion; a changed answer makes the old id stale', () => {
    const dir = asked();
    grill.answer(dir, 'Q-1', { choice: 'b' });
    const criteria = [{ id: 'A1', text: 'aprovador vê a fila (Q-1.1b)', verify: 'teste' }];
    const find = (c) => cases.specFindings({ questions: grill.status(dir).questions, criteria: c }).errors;
    assert.deepEqual(find(criteria), []);
    assert.match(find([]).join(), /Q-1\.1b: exemplo decidido no grill sem critério/);
    grill.answer(dir, 'Q-1', { choice: 'a' });
    assert.match(find(criteria).join(), /A1: cita Q-1\.1b, que não é a leitura escolhida/);
  });

  it('plan lint: the frozen test of the criterion carries the example; other phases are not judged', () => {
    const dir = asked();
    grill.answer(dir, 'Q-1', { choice: 'ok' });
    const base = { questions: grill.status(dir).questions, criteria: [{ id: 'A1', text: 'vê a fila (Q-1.1b)', verify: 'teste' }] };
    const doc = { tasks: [{ id: 'T1', acceptance: ['A1'] }], acceptance_tests: [{ criterion: 'A1', files: ['t.js'] }] };
    assert.match(cases.planFindings({ ...base, doc, readFile: () => "it('A1: lista')" }).join(), /não traz|traz Q-1\.1b/);
    assert.deepEqual(cases.planFindings({ ...base, doc, readFile: () => "it('A1: Q-1.1b lista')" }), []);
    assert.deepEqual(cases.planFindings({ ...base, doc: { tasks: [{ id: 'T9', acceptance: ['A9'] }] }, readFile: () => '' }), []);
  });

  it('CLI: shows the cases, takes a letter, lists the example; spec check and plan lint enforce it', () => {
    const dir = tmp();
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/config.json', '{}');
    assert.equal(cli(dir, 'grill', 'start', '--type', 'feature').status, 0);
    const q = cli(dir, 'grill', 'ask', '--branch', 'rules', '--question', ASK.question, '--options', 'mine=true | sem filtro', '--recommended', 'sem filtro', '--case', CASE, '--need', NEED);
    assert.equal(q.status, 0, q.stderr);
    assert.match(q.stdout, /Caso: aprovador lista sem parâmetros/);
    const a = cli(dir, 'grill', 'answer', 'Q-1', 'b');
    assert.match(a.stdout, /exemplo Q-1\.1b/);
    assert.equal(JSON.parse(cli(dir, 'grill', 'status', '--json').stdout).examples[0].expect, 'vê a fila');

    write(dir, '.oxe/SPEC.md', '# SPEC\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | lista | P2 | teste |\n');
    const check = cli(dir, 'spec', 'check');
    assert.match(check.stdout + check.stderr, /Q-1\.1b: exemplo decidido no grill sem critério/);

    write(dir, '.oxe/SPEC.md', '# SPEC\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | lista a fila (Q-1.1b) | P2 | teste |\n');
    write(dir, 'test/acceptance/a1.test.js', "require('node:test')('A1: lista', () => {});\n");
    write(dir, '.oxe/plan/F1.role.json', JSON.stringify({
      role: 'fase',
      tasks: [{ rid: 'R1', title: 'Lista', files: ['src/list.js'], created: ['src/list.js'], acceptance: ['A1'], verify: { commands: ['node --test test/acceptance/a1.test.js'] } }],
      acceptance_tests: [{ criterion: 'A1', files: ['test/acceptance/a1.test.js'], command: 'node --test test/acceptance/a1.test.js', proves: ['A1: lista'] }],
    }));
    const built = cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json', '--force');
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const lint = cli(dir, 'plan', 'lint', '--no-precheck');
    assert.notEqual(lint.status, 0);
    assert.match(lint.stdout + lint.stderr, /A1: nenhum teste congelado dele traz Q-1\.1b/);
  });
});

/** A black-box project: the test never imports the product, so `plan lint --mutation` would measure nothing. */
function product(assertion, { risk = 'P0', broken = false, loop = false } = {}) {
  const dir = tmp();
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/rule.js', loop
    ? "let stop = true;\nwhile (!stop) { }\nconsole.log('ok');\n"
    : `function allowed(role) {\n  return role === 'finance';\n}\nconsole.log(String(allowed(process.argv[2])));\n${broken ? 'process.exit(3);\n' : ''}`);
  write(dir, 'check.js', `const r = require('child_process').spawnSync(process.execPath, ['src/rule.js', 'finance'], { encoding: 'utf8' });\n${assertion}\n`);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/SPEC.md', `# SPEC\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | só finance | ${risk} | teste |\n`);
  write(dir, '.oxe/PLAN.json', JSON.stringify({
    schema_version: 1,
    tasks: [{ id: 'T1', title: 'regra', wave: 1, files: ['src/rule.js'], acceptance: ['A1'] }],
    acceptance_tests: [{ criterion: 'A1', files: ['check.js'], command: 'node check.js' }],
  }));
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}
const STRONG = "process.exit(r.stdout.trim() === 'true' ? 0 : 1);";
const WEAK = "process.exit(r.status === null ? 1 : 0);";

describe('plan mutate', () => {
  it('a black-box test that checks the value kills the mutant, on uncommitted files, without touching them', () => {
    const dir = product(STRONG);
    const before = fs.readFileSync(path.join(dir, 'src/rule.js'), 'utf8');
    const r = cli(dir, 'plan', 'mutate', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.mutants > 0);
    assert.equal(out.killed, out.mutants);
    assert.equal(fs.readFileSync(path.join(dir, 'src/rule.js'), 'utf8'), before);
    assert.equal(git(dir, 'worktree', 'list').stdout.trim().split('\n').length, 1);
    assert.equal(git(dir, 'ls-files').stdout.trim(), '', 'the real index is untouched');
  });

  it('a P0 test that detects nothing exits 1; the same in P2 only informs', () => {
    const p0 = cli(product(WEAK), 'plan', 'mutate');
    assert.equal(p0.status, 1, p0.stdout + p0.stderr);
    assert.match(p0.stdout, /P0 com teste que não detecta nada: A1/);
    const p2 = cli(product(WEAK, { risk: 'P2' }), 'plan', 'mutate');
    assert.equal(p2.status, 0, p2.stdout + p2.stderr);
  });

  it('a test already red is "not measured", never green', () => {
    const r = cli(product('process.exit(r.status === 0 ? 0 : 1);', { broken: true }), 'plan', 'mutate');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /já falha sem mutação/);
  });

  it('a mutant that loops forever is killed with its process tree', () => {
    const started = Date.now();
    const r = cli(product(STRONG.replace("'true'", "'ok'"), { loop: true }), 'plan', 'mutate', '--timeout', '5', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).killed, 1);
    assert.ok(Date.now() - started < 60_000);
  });

  it('node_modules of the project survives the cleanup of the copy', async () => {
    const dir = product(STRONG);
    write(dir, '.gitignore', '.oxe/\nnode_modules/\n');
    write(dir, 'node_modules/dep/index.js', 'module.exports = 1;\n');
    const out = await mutate.measure(dir, JSON.parse(fs.readFileSync(path.join(dir, '.oxe/PLAN.json'), 'utf8')));
    assert.ok(out.mutants > 0);
    assert.equal(fs.readFileSync(path.join(dir, 'node_modules/dep/index.js'), 'utf8'), 'module.exports = 1;\n');
  });

  it('a folder inside an outer repository is refused', () => {
    const dir = product(STRONG);
    write(dir, 'pkg/.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [], acceptance_tests: [] }));
    const r = cli(path.join(dir, 'pkg'), 'plan', 'mutate');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /topo de um repositório git/);
  });

  it('the sample is spread over the file', () => {
    assert.deepEqual(mutate.spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2), [2, 7]);
  });
});
