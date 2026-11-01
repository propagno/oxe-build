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
const verification_compiler_1 = require("../src/verification/verification-compiler");
const llm_task_executor_1 = require("../src/executor/llm-task-executor");
const node_context_1 = require("../src/executor/node-context");
// e2e real 1.19: o executor leu mal o requisito (createApi devolveu { handle } em vez da função),
// escreveu o próprio teste com a mesma leitura e o verify ficou verde. O aceite agora é do plano:
// escrito antes, congelado por hash, protegido do executor.
const ACCEPT = "const t=require('node:test');const a=require('node:assert');t('A1',()=>a.equal(typeof require('./api.js').createApi(), 'function'));\n";
function tmpDir() {
    return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-accept-'));
}
(0, node_test_1.describe)('teste de aceite congelado no verify', () => {
    (0, node_test_1.test)('gera check-accept-*, passa intacto e reprova adulterado/ausente/não congelado', async () => {
        const dir = tmpDir();
        try {
            fs_1.default.writeFileSync(path_1.default.join(dir, 'accept.test.js'), ACCEPT);
            fs_1.default.writeFileSync(path_1.default.join(dir, 'api.js'), 'module.exports = { createApi: () => () => 1 };\n');
            const sha = (0, verification_compiler_1.sha256File)(path_1.default.join(dir, 'accept.test.js'));
            const suite = (0, verification_compiler_1.compile)({ objective: null, criteria: [] }, { tasks: [], acceptanceTests: [{ criterion: 'A1', command: 'node --test accept.test.js', files: [{ path: 'accept.test.js', sha256: sha }] }] });
            const check = suite.checks.find((c) => c.id === 'check-accept-a1');
            strict_1.default.equal(check.acceptance_ref, 'A1');
            strict_1.default.equal(check.type, 'unit');
            const ok = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(ok.status, 'pass', `${ok.error} ${ok.stderr}`);
            // Implementação com a leitura errada: o aceite do plano reprova.
            fs_1.default.writeFileSync(path_1.default.join(dir, 'api.js'), 'module.exports = { createApi: () => ({ handle() {} }) };\n');
            strict_1.default.equal((await (0, verification_compiler_1.runCheck)(check, dir)).status, 'fail');
            // Executor "ajusta" o teste para passar: adulterado.
            fs_1.default.writeFileSync(path_1.default.join(dir, 'accept.test.js'), ACCEPT.replace("'function'", "'object'"));
            const tampered = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(tampered.status, 'fail');
            strict_1.default.equal(tampered.error, 'acceptance_tampered: accept.test.js');
            fs_1.default.rmSync(path_1.default.join(dir, 'accept.test.js'));
            strict_1.default.equal((await (0, verification_compiler_1.runCheck)(check, dir)).error, 'acceptance_missing: accept.test.js');
            const unlocked = { ...check, frozen_files: [{ path: 'api.js', sha256: null }] };
            strict_1.default.match(String((await (0, verification_compiler_1.runCheck)(unlocked, dir)).error), /^acceptance_not_frozen: api\.js/);
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
});
(0, node_test_1.describe)('executor não escreve o aceite do plano', () => {
    (0, node_test_1.test)('write_file em arquivo protegido é negado; outros arquivos passam', async () => {
        const dir = tmpDir();
        try {
            fs_1.default.mkdirSync(path_1.default.join(dir, 'test', 'acceptance'), { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(dir, 'test', 'acceptance', 'a1.test.js'), ACCEPT);
            let turn = 0;
            const complete = async () => {
                turn += 1;
                if (turn === 1) {
                    return {
                        content: '',
                        finish_reason: 'tool_calls',
                        tool_calls: [
                            { id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'test\\acceptance\\a1.test.js', content: 'hacked' }) } },
                            { id: 'c2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'api.js', content: 'ok' }) } },
                        ],
                    };
                }
                return { content: 'done', finish_reason: 'tool_calls', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'finish_task', arguments: '{"summary":"x"}' } }] };
            };
            const events = [];
            const node = {
                id: 'T1', title: 'api', wave: 1, depends_on: [], workspace_strategy: 'inplace', mutation_scope: ['api.js'],
                actions: [{ type: 'generate_patch', targets: ['api.js'] }],
                verify: { must_pass: [], acceptance_refs: ['A1'], command: null },
                policy: { requires_human_approval: false, max_retries: 0 },
            };
            const exec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => events.push(e), complete, {
                protectedPaths: ['test/acceptance/a1.test.js'],
            });
            const result = await exec.execute(node, {
                workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5,
            }, 'r', 1);
            strict_1.default.equal(result.success, true);
            strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(dir, 'test', 'acceptance', 'a1.test.js'), 'utf8'), ACCEPT, 'aceite intacto');
            strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(dir, 'api.js'), 'utf8'), 'ok');
            const denied = events.find((e) => e.type === 'tool_denied');
            strict_1.default.equal(denied?.detail?.reason, 'frozen_acceptance_test');
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('o prompt traz o aceite como especificação executável', () => {
        const text = (0, node_context_1.renderNodeContext)({ acceptanceTests: [{ criterion: 'A1', path: 'test/acceptance/a1.test.js', command: 'node --test x', content: ACCEPT }] }).join('\n');
        strict_1.default.match(text, /## Testes de aceite do plano \(congelados\)/);
        strict_1.default.match(text, /- A1: `test\/acceptance\/a1\.test\.js` — `node --test x`/);
        strict_1.default.match(text, /typeof require\('\.\/api\.js'\)\.createApi\(\)/);
    });
});
