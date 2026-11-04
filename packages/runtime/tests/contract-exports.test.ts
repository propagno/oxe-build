import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { extractExports, checkExpectedExports } from '../src/verification/contract-exports';
import { compile, runCheck } from '../src/verification/verification-compiler';

// 1.19: o IMPLEMENTATION-PACK declara `symbols`; um módulo "entregue" sem a interface que a próxima
// fase consome não pode passar no contrato.

describe('extractExports (estático, JS/TS)', () => {
  test('CommonJS: objeto literal, shorthand, métodos e exports.x', () => {
    const src = `
      function shorten(url, opts) { return url; }
      const isValid = (u) => true;
      class Store {}
      // module.exports = { comentado }
      module.exports = { shorten, isValid, Store, alias: shorten, inline(a, b) { return a; }, ...extra };
      exports.extraFn = function (x) {};
    `;
    const byName = new Map(extractExports(src).map((e) => [e.name, e.signature]));
    assert.deepEqual([...byName.keys()].sort(), ['Store', 'alias', 'extraFn', 'inline', 'isValid', 'shorten']);
    assert.equal(byName.get('shorten'), '(url, opts)');
    assert.equal(byName.get('alias'), '(url, opts)');
    assert.equal(byName.get('isValid'), '(u)');
    assert.equal(byName.get('Store'), 'class');
    assert.equal(byName.get('inline'), '(a, b)');
    assert.equal(byName.get('extraFn'), '(x)');
  });

  test('CommonJS: module.exports = função única vira default + nome', () => {
    const names = extractExports('function createServer(port) {}\nmodule.exports = createServer;').map((e) => e.name);
    assert.deepEqual(names.sort(), ['createServer', 'default']);
  });

  test('ESM/TS: declarações, lista com alias e tipos', () => {
    const src = `
      export async function handle(req: Request, res: Response): Promise<void> {}
      export const LIMIT = 10;
      export class Repo {}
      export interface Item { id: string }
      export type Id = string;
      function inner() {}
      export { inner as publicInner };
      export default function main() {}
      const s = "export function fake() {}";
    `;
    const names = extractExports(src).map((e) => e.name).sort();
    assert.deepEqual(names, ['Id', 'Item', 'LIMIT', 'Repo', 'default', 'handle', 'main', 'publicInner']);
  });
});

describe('contrato do pack com exports_expected', () => {
  test('export ausente reprova; presente passa; linguagem sem suporte só avisa', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-exports-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src', 'store.js'), 'function save(item) {}\nmodule.exports = { save };\n');
      fs.writeFileSync(path.join(dir, 'src', 'tool.py'), 'def run():\n  pass\n');

      const suite = compile(
        { objective: null, criteria: [] },
        {
          tasks: [
            {
              id: 'T1',
              verifyCommand: null,
              aceite: [],
              filesExist: ['src/store.js'],
              exportsExpected: [
                { file: 'src/store.js', name: 'save' },
                { file: 'src/store.js', name: 'load' },
                { file: 'src/store.js', name: 'load' },
              ],
            },
          ],
        },
      );
      const check = suite.checks.find((c) => c.id === 'check-pack-t1')!;
      assert.equal(check.type, 'contract');
      assert.equal(check.exports_expected!.length, 2, 'duplicados removidos');

      const failed = await runCheck(check, dir);
      assert.equal(failed.status, 'fail');
      assert.equal(failed.error, 'exports_missing: src/store.js#load');

      fs.writeFileSync(path.join(dir, 'src', 'store.js'), 'function save(item) {}\nfunction load(id) {}\nmodule.exports = { save, load };\n');
      const passed = await runCheck(check, dir);
      assert.equal(passed.status, 'pass', String(passed.error));
      assert.match(passed.stdout, /exports ok: src\/store\.js#save, src\/store\.js#load/);

      const outcome = checkExpectedExports(dir, [{ file: 'src/tool.py', name: 'run' }]);
      assert.deepEqual(outcome, { missing: [], unsupported: ['src/tool.py'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('só exports, sem arquivos contratados, também gera o check', () => {
    const suite = compile(
      { objective: null, criteria: [] },
      { tasks: [{ id: 'T2', verifyCommand: null, aceite: [], exportsExpected: [{ file: 'a.js', name: 'x' }] }] },
    );
    assert.ok(suite.checks.some((c) => c.id === 'check-pack-t2'));
  });
});
