"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const contract_exports_1 = require("../src/verification/contract-exports");
const verification_compiler_1 = require("../src/verification/verification-compiler");
// 1.19: o IMPLEMENTATION-PACK declara `symbols`; um módulo "entregue" sem a interface que a próxima
// fase consome não pode passar no contrato.
(0, node_test_1.describe)('extractExports (estático, JS/TS)', () => {
    (0, node_test_1.test)('CommonJS: objeto literal, shorthand, métodos e exports.x', () => {
        const src = `
      function shorten(url, opts) { return url; }
      const isValid = (u) => true;
      class Store {}
      // module.exports = { comentado }
      module.exports = { shorten, isValid, Store, alias: shorten, inline(a, b) { return a; }, ...extra };
      exports.extraFn = function (x) {};
    `;
        const byName = new Map((0, contract_exports_1.extractExports)(src).map((e) => [e.name, e.signature]));
        strict_1.default.deepEqual([...byName.keys()].sort(), ['Store', 'alias', 'extraFn', 'inline', 'isValid', 'shorten']);
        strict_1.default.equal(byName.get('shorten'), '(url, opts)');
        strict_1.default.equal(byName.get('alias'), '(url, opts)');
        strict_1.default.equal(byName.get('isValid'), '(u)');
        strict_1.default.equal(byName.get('Store'), 'class');
        strict_1.default.equal(byName.get('inline'), '(a, b)');
        strict_1.default.equal(byName.get('extraFn'), '(x)');
    });
    (0, node_test_1.test)('CommonJS: module.exports = função única vira default + nome', () => {
        const names = (0, contract_exports_1.extractExports)('function createServer(port) {}\nmodule.exports = createServer;').map((e) => e.name);
        strict_1.default.deepEqual(names.sort(), ['createServer', 'default']);
    });
    (0, node_test_1.test)('ESM/TS: declarações, lista com alias e tipos', () => {
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
        const names = (0, contract_exports_1.extractExports)(src).map((e) => e.name).sort();
        strict_1.default.deepEqual(names, ['Id', 'Item', 'LIMIT', 'Repo', 'default', 'handle', 'main', 'publicInner']);
    });
});
(0, node_test_1.describe)('contrato do pack com exports_expected', () => {
    (0, node_test_1.test)('export ausente reprova; presente passa; linguagem sem suporte só avisa', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-exports-'));
        try {
            fs_1.default.mkdirSync(path_1.default.join(dir, 'src'));
            fs_1.default.writeFileSync(path_1.default.join(dir, 'src', 'store.js'), 'function save(item) {}\nmodule.exports = { save };\n');
            fs_1.default.writeFileSync(path_1.default.join(dir, 'src', 'tool.py'), 'def run():\n  pass\n');
            const suite = (0, verification_compiler_1.compile)({ objective: null, criteria: [] }, {
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
            });
            const check = suite.checks.find((c) => c.id === 'check-pack-t1');
            strict_1.default.equal(check.type, 'contract');
            strict_1.default.equal(check.exports_expected.length, 2, 'duplicados removidos');
            const failed = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(failed.status, 'fail');
            strict_1.default.equal(failed.error, 'exports_missing: src/store.js#load');
            fs_1.default.writeFileSync(path_1.default.join(dir, 'src', 'store.js'), 'function save(item) {}\nfunction load(id) {}\nmodule.exports = { save, load };\n');
            const passed = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(passed.status, 'pass', String(passed.error));
            strict_1.default.match(passed.stdout, /exports ok: src\/store\.js#save, src\/store\.js#load/);
            const outcome = (0, contract_exports_1.checkExpectedExports)(dir, [{ file: 'src/tool.py', name: 'run' }]);
            strict_1.default.deepEqual(outcome, { missing: [], unsupported: ['src/tool.py'] });
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('só exports, sem arquivos contratados, também gera o check', () => {
        const suite = (0, verification_compiler_1.compile)({ objective: null, criteria: [] }, { tasks: [{ id: 'T2', verifyCommand: null, aceite: [], exportsExpected: [{ file: 'a.js', name: 'x' }] }] });
        strict_1.default.ok(suite.checks.some((c) => c.id === 'check-pack-t2'));
    });
});
