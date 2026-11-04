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
const llm_task_executor_1 = require("../src/executor/llm-task-executor");
// Regressão do e2e "linkly": o executor rodava qualquer built-in tool independentemente das
// ações do nó e contava "resposta só em texto" como tarefa concluída.
function node(actions) {
    return {
        id: 'T1',
        title: 'tarefa',
        wave: 1,
        depends_on: [],
        workspace_strategy: 'inplace',
        mutation_scope: [],
        actions,
        verify: { must_pass: [], acceptance_refs: [], command: null },
        policy: { requires_human_approval: false, max_retries: 0 },
    };
}
function lease(root) {
    return {
        workspace_id: 'ws-1',
        strategy: 'inplace',
        isolation_level: 'shared',
        branch: null,
        base_commit: null,
        root_path: root,
        ttl_minutes: 30,
    };
}
function call(name, args) {
    return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
function scripted(responses) {
    let i = 0;
    return async () => responses[Math.min(i++, responses.length - 1)];
}
const provider = { baseUrl: 'http://unused', apiKey: 'x', model: 'fake', maxTurns: 4 };
(0, node_test_1.describe)('LlmTaskExecutor — allowlist, no_tool_call e contenção', () => {
    let tmp;
    (0, node_test_1.test)('setup', () => {
        tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-exec-'));
    });
    (0, node_test_1.test)('tool fora da allowlist do nó é negada e não executa', async () => {
        const events = [];
        const executor = new llm_task_executor_1.LlmTaskExecutor(provider, null, (e) => events.push(e), scripted([
            { content: '', tool_calls: [call('write_file', { path: 'hack.txt', content: 'x' })], finish_reason: 'tool_calls' },
            { content: '', tool_calls: [call('finish_task', { summary: 'done' })], finish_reason: 'tool_calls' },
        ]));
        const result = await executor.execute(node([{ type: 'read_code', targets: [] }]), lease(tmp), 'run', 1);
        strict_1.default.equal(fs_1.default.existsSync(path_1.default.join(tmp, 'hack.txt')), false);
        strict_1.default.ok(events.some((e) => e.type === 'tool_denied' && e.detail?.tool === 'write_file'));
        strict_1.default.equal(result.success, true);
    });
    (0, node_test_1.test)('resposta só em texto numa tarefa mutável falha (no_tool_call)', async () => {
        const executor = new llm_task_executor_1.LlmTaskExecutor(provider, null, null, scripted([
            { content: 'Pronto, criei o arquivo.', tool_calls: [], finish_reason: 'stop' },
        ]));
        const result = await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
        strict_1.default.equal(result.success, false);
        strict_1.default.equal(result.failure_class, 'llm');
        strict_1.default.equal(result.completed_by, 'no_tool_call');
    });
    (0, node_test_1.test)('resposta só em texto numa tarefa só-leitura continua válida', async () => {
        const executor = new llm_task_executor_1.LlmTaskExecutor(provider, null, null, scripted([
            { content: 'O módulo exporta createServer.', tool_calls: [], finish_reason: 'stop' },
        ]));
        const result = await executor.execute(node([{ type: 'read_code', targets: ['src'] }]), lease(tmp), 'run', 1);
        strict_1.default.equal(result.success, true);
        strict_1.default.equal(result.completed_by, 'no_tool_call');
    });
    (0, node_test_1.test)('mutação real seguida de texto conta como trabalho feito', async () => {
        const executor = new llm_task_executor_1.LlmTaskExecutor(provider, null, null, scripted([
            { content: '', tool_calls: [call('write_file', { path: 'out.txt', content: 'ok' })], finish_reason: 'tool_calls' },
            { content: 'Feito.', tool_calls: [], finish_reason: 'stop' },
        ]));
        const result = await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
        strict_1.default.equal(result.success, true);
        strict_1.default.deepEqual(result.evidence, ['out.txt']);
    });
    (0, node_test_1.test)('path fora do workspace vira erro de tool, não escrita', async () => {
        const executor = new llm_task_executor_1.LlmTaskExecutor(provider, null, null, scripted([
            { content: '', tool_calls: [call('write_file', { path: '../escape.txt', content: 'x' })], finish_reason: 'tool_calls' },
            { content: '', tool_calls: [call('finish_task', { summary: 'done' })], finish_reason: 'tool_calls' },
        ]));
        await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
        strict_1.default.equal(fs_1.default.existsSync(path_1.default.join(tmp, '..', 'escape.txt')), false);
    });
    (0, node_test_1.test)('partitionToolCalls: tools desconhecidas são tratadas como mutação (seriais)', () => {
        const [concurrent, serial] = (0, llm_task_executor_1.partitionToolCalls)([
            call('read_file', { path: 'a' }),
            call('mystery_tool', {}),
            call('write_file', { path: 'b', content: '' }),
        ]);
        strict_1.default.deepEqual(concurrent.map((c) => c.function.name), ['read_file']);
        strict_1.default.deepEqual(serial.map((c) => c.function.name), ['mystery_tool', 'write_file']);
    });
    (0, node_test_1.test)('teardown', () => {
        fs_1.default.rmSync(tmp, { recursive: true, force: true });
    });
});
