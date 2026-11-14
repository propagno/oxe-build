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
