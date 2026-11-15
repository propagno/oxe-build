'use strict';

// 1.21.2 (G30): plan lint lists the existing suites that import a task's files and are not in its verify/scope —
// three paid redos in one round (terminal.service.ts, desktop.ts, the policy lists of CR-07/CR-08).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const si = require('../bin/lib/oxe-suite-impact.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-suite-'));
  dirs.push(dir);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

const FILES = {
  'src/policy.ts': "export const ALLOWED_TOOLS = ['read', 'write'];\nexport function check(x: string) { return ALLOWED_TOOLS.includes(x); }\n",
  'tests/unit/policy-list.test.ts': "import { ALLOWED_TOOLS } from '../../src/policy';\nit('has two', () => expect(ALLOWED_TOOLS).toHaveLength(2));\n",
  'tests/unit/policy-check.test.ts': "import { check } from '../../src/policy';\nit('checks', () => expect(check('read')).toBe(true));\n",
  'tests/unit/policy-own.test.ts': "import { check } from '@/policy';\nit('own', () => {});\n",
  'tests/unit/unrelated.test.ts': "import { other } from '../../src/other';\n",
  'src/other.ts': 'export const other = 1;\n',
};

const plan = (extra = {}) => ({
  tasks: [
    { id: 'T1', title: 'Adicionar "exec" em ALLOWED_TOOLS', files: ['src/policy.ts'], verify: { commands: ['npx vitest run tests/unit/policy-own.test.ts'] }, ...extra },
    { id: 'T2', title: 'feita', files: ['src/policy.ts'], done: true },
  ],
});

describe('G30 · suítes que importam os arquivos da tarefa', () => {
  it('erro quando a suíte afirma sobre a lista que a tarefa muda; aviso para as outras; nada para o verify e o escopo', () => {
    const dir = repo(FILES);
    const f = si.suiteImpact(dir, plan());
    assert.equal(f.length, 1);
    assert.equal(f[0].task, 'T1');
    assert.equal(f[0].file, 'src/policy.ts');
    const by = Object.fromEntries(f[0].suites.map((s) => [s.test, s]));
    assert.equal(by['tests/unit/policy-list.test.ts'].level, 'error');
    assert.deepEqual(by['tests/unit/policy-list.test.ts'].names, ['ALLOWED_TOOLS']);
    assert.equal(by['tests/unit/policy-check.test.ts'].level, 'warn');
    assert.equal(by['tests/unit/policy-own.test.ts'], undefined, 'no verify (alias @/ resolvido)');
    assert.equal(by['tests/unit/unrelated.test.ts'], undefined);
    const msg = si.messages(f);
    assert.equal(msg.errors.length, 1);
    assert.match(msg.errors[0], /T1: tests\/unit\/policy-list\.test\.ts importa ALLOWED_TOOLS de src\/policy\.ts/);
    assert.equal(msg.warnings.length, 1);
    assert.equal(si.messages(f, { mode: 'warn' }).errors.length, 0);
  });

  it('a suíte no escopo da tarefa (files) ou sem a lista no texto da tarefa é só aviso ou nada', () => {
    const dir = repo(FILES);
    const inScope = si.suiteImpact(dir, plan({ files: ['src/policy.ts', 'tests/unit/'] }));
    assert.equal(inScope.length, 0);
    const noMention = si.suiteImpact(dir, plan({ title: 'Refatorar o check' }));
    assert.ok(noMention[0].suites.every((s) => s.level === 'warn'));
  });

  it('G30b: a fixture que uma suíte lê (import de .json, readFileSync, path.join) fora de files vira aviso, mesmo com a suíte no verify', () => {
    const dir = repo({
      ...FILES,
      'tests/fixtures/palette-commands.base.json': '["open"]\n',
      'tests/unit/policy-own.test.ts': "import base from '../fixtures/palette-commands.base.json';\nimport { check } from '@/policy';\nconst fs = require('fs');\nconst verbs = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'verbs.json'), 'utf8');\nit('own', () => {});\n",
      'tests/fixtures/verbs.json': '["Abrir"]\n',
    });
    const f = si.suiteImpact(dir, plan());
    const data = f.flatMap((x) => x.data || []).map((d) => d.file).sort();
    assert.deepEqual(data, ['tests/fixtures/palette-commands.base.json', 'tests/fixtures/verbs.json']);
    const msg = si.messages(f);
    assert.ok(msg.warnings.some((w) => /policy-own\.test\.ts \(que importa src\/policy\.ts\) lê tests\/fixtures\/palette-commands\.base\.json/.test(w)), msg.warnings.join('\n'));
    // in files: no warning
    const inFiles = si.suiteImpact(dir, plan({ files: ['src/policy.ts', 'tests/fixtures/'] }));
    assert.equal(inFiles.flatMap((x) => x.data || []).length, 0);
  });

  it('constantes exportadas: lista, objeto, literal e Object.freeze; não uma função', () => {
    const c = si.exportedConstants("export const A = [1];\nexport const B: Record<string, number> = { x: 1 };\nexport const C = 'x';\nexport const D = Object.freeze([1]);\nexport function E() {}\nexport const F = () => 1;\n");
    assert.deepEqual([...c].sort(), ['A', 'B', 'C', 'D']);
  });
});

// G38 (OxeSpace 15/11, OxeCode F6 T27: US$ 16.91 in 3 attempts): a test in a task's verify that only a LATER pending
// task turns green (u83, in T30's files at wave 3, inside T27's verify at wave 1) is unpassable at that point.
describe('G38: a verify that holds a test only a later task turns green', () => {
  const U83 = 'tests/acceptance/f8/u83-command-bar.test.tsx';
  const plan = (over = {}) => ({
    acceptance_tests: over.acceptance_tests || [],
    tasks: [
      { id: 'T27', wave: 1, files: ['src/bar.tsx'], verify: { commands: [`node run.mjs tests/unit/x.test.ts ${U83} tests/shared.test.ts`] }, ...(over.T27 || {}) },
      { id: 'T30', wave: 3, files: ['src/cmd.tsx', U83, 'tests/shared.test.ts'], verify: { commands: [`node run.mjs ${U83}`] } },
      { id: 'T29', wave: 7, files: ['src/q.tsx'], verify: { commands: [`node run.mjs ${U83}`] } },
    ],
  });
  it('flags the earlier task, names the owner; a later task, a shared non-acceptance suite and the owner itself are not flagged', () => {
    const f = si.laterOwnedTests(plan());
    assert.deepEqual(f.map((x) => [x.task, x.test, x.owner]), [['T27', U83, 'T30']]);
    const msg = si.laterOwnedMessages(f);
    assert.match(msg.errors[0], /T27 \(onda 1\): o verify roda tests\/acceptance\/f8\/u83-command-bar\.test\.tsx, que só fica verde com T30 \(onda 3\).*\[G38\]/);
    assert.equal(si.laterOwnedMessages(f, { mode: 'warn' }).warnings.length, 1);
  });
  it('a dependency on the owner, or the owner done, clears it', () => {
    assert.equal(si.laterOwnedTests(plan({ T27: { depends_on: ['T30'] } })).length, 0);
    const done = plan();
    done.tasks[1].done = true;
    assert.equal(si.laterOwnedTests(done).length, 0);
  });
  it('a frozen acceptance entry owned by a later task by criterion counts too', () => {
    const p = plan({ acceptance_tests: [{ criterion: 'A27', files: [{ path: 'tests/e2e/a27.spec.ts' }], command: 'x' }] });
    p.tasks[1].acceptance = ['A27'];
    p.tasks[0].verify.commands.push('npx playwright test tests/e2e/a27.spec.ts');
    assert.ok(si.laterOwnedTests(p).some((x) => x.task === 'T27' && x.test === 'tests/e2e/a27.spec.ts' && x.owner === 'T30'));
  });
  it('a vitest argument is a substring filter: .test.ts also runs a later task .test.tsx; -t narrows it (OxeSpace 15/11, F6 T44)', () => {
    const p = {
      acceptance_tests: [
        { task: 'T44', criterion: 'A41', files: ['tests/oxe152/polish/pu03-app-version.test.ts'], command: 'x' },
        { task: 'T59', criterion: 'A56', files: ['tests/oxe152/polish/pu03-app-version.test.tsx'], command: 'y' },
      ],
      tasks: [
        { id: 'T44', wave: 18, files: ['src/version.ts'], verify: { commands: ['node scripts/test-electron.mjs tests/oxe152/polish/pu03-app-version.test.ts --maxWorkers=2'] } },
        { id: 'T59', wave: 33, files: ['src/about.tsx'], verify: { commands: ['node scripts/test-electron.mjs tests/oxe152/polish/pu03-app-version.test.tsx'] } },
      ],
    };
    const f = si.laterOwnedTests(p);
    assert.deepEqual(f.map((x) => [x.task, x.test, x.owner, x.via]), [['T44', 'tests/oxe152/polish/pu03-app-version.test.tsx', 'T59', 'tests/oxe152/polish/pu03-app-version.test.ts']]);
    assert.match(si.laterOwnedMessages(f).errors[0], /casa como filtro de substring do vitest/);
    p.tasks[0].verify.commands[0] += ' -t "version label"';
    assert.equal(si.laterOwnedTests(p).length, 0, '-t narrows the run');
    // cross-review 15/11: -t never hides a later task's file named EXACTLY, nor a second subcommand
    const exact = JSON.parse(JSON.stringify(p));
    exact.tasks[0].verify.commands = ['vitest run tests/oxe152/polish/pu03-app-version.test.tsx -t "x"'];
    assert.equal(si.laterOwnedTests(exact).length, 1, 'exact path with -t');
    const chained = JSON.parse(JSON.stringify(p));
    chained.tasks[0].verify.commands = ['vitest run tests/own.test.ts -t foo && vitest run tests/oxe152/polish/pu03-app-version.test.ts'];
    assert.equal(si.laterOwnedTests(chained).length, 1, 'the second subcommand still counts');
    // a trailing $ anchors; node --test takes exact paths
    const anchored = JSON.parse(JSON.stringify(p));
    anchored.tasks[0].verify.commands = ['vitest run tests/oxe152/polish/pu03-app-version.test.ts$'];
    assert.equal(si.laterOwnedTests(anchored).length, 0);
    const nodeTest = JSON.parse(JSON.stringify(p));
    nodeTest.tasks[0].verify.commands = ['node --test tests/oxe152/polish/pu03-app-version.test.ts'];
    assert.equal(si.laterOwnedTests(nodeTest).length, 0);
  });

  it('a mutable acceptance/ test the task itself writes (a later task only extends it) is its own to run', () => {
    const p = plan();
    p.tasks[0].files.push(U83);
    assert.equal(si.laterOwnedTests(p).filter((x) => x.task === 'T27').length, 0);
    // but a later task's FROZEN entry stays out of reach even when the earlier task lists the file
    p.acceptance_tests = [{ task: 'T30', criterion: 'A27', files: [{ path: U83 }], command: 'x' }];
    assert.equal(si.laterOwnedTests(p).filter((x) => x.task === 'T27').length, 1);
  });
  it('G30 never asks a later task frozen test (nor its data) into an earlier verify — no G30×G38 deadlock', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g38-'));
    dirs.push(dir);
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    w('src/bar.ts', 'export const HINTS = ["a"];\n');
    w('tests/e2e/a27.test.ts', "import { HINTS } from '../../src/bar';\nimport data from './fixtures/a27.json';\ntest('x', () => expect(HINTS).toEqual(data));\n");
    w('tests/e2e/fixtures/a27.json', '["a"]');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const doc = {
      acceptance_tests: [{ task: 'T30', criterion: 'A27', files: [{ path: 'tests/e2e/a27.test.ts' }], command: 'npx vitest run tests/e2e/a27.test.ts' }],
      tasks: [
        { id: 'T27', wave: 1, files: ['src/bar.ts'], notes: 'muda HINTS', verify: { commands: ['npx tsc --noEmit'] } },
        { id: 'T30', wave: 3, files: ['src/cmd.ts'], acceptance: ['A27'], verify: { commands: ['npx vitest run tests/e2e/a27.test.ts'] } },
      ],
    };
    const t27 = si.suiteImpact(dir, doc).filter((f) => f.task === 'T27');
    assert.deepEqual(t27.flatMap((f) => [...f.suites.map((s) => s.test), ...f.data.map((d) => d.file)]), [], JSON.stringify(t27));
    assert.equal(si.laterOwnedTests(doc).length, 0, 'and G38 is quiet while the test stays out of the verify');
  });
});
