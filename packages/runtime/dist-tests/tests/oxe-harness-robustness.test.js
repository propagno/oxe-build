"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const llm_task_executor_1 = require("../src/executor/llm-task-executor");
const ephemeral_container_1 = require("../src/workspace/strategies/ephemeral-container");
function makeNode(id, scope = ['src/app.ts', 'src/data.json']) {
    return {
        id,
        title: `Task ${id}`,
        description: `Execute ${id}`,
        wave: 1,
        depends_on: [],
        acceptance_criteria: [],
        mutation_scope: scope,
        actions: [{ type: 'edit', target: scope[0] || 'src/app.ts' }],
        verify: { must_pass: [], commands: [] },
        verification: { commands: [] },
        policy: { max_retries: 1 },
    };
}
function makeLease(rootPath, taskId) {
    return {
        workspace_id: `ws-${taskId}`,
        strategy: 'inplace',
        root_path: rootPath,
        leased_to: taskId,
        leased_at: new Date().toISOString(),
    };
}
(0, node_test_1.describe)('Harness robustness (Items #2, #3, #6)', () => {
    (0, node_test_1.it)('Item #2: compactMessages shrinks verbose intermediate tool outputs while preserving head and tail', () => {
        const msgs = [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'initial task' },
            { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
            { role: 'tool', tool_call_id: '1', name: 'read_file', content: `line1\n${'x'.repeat(2000)}` },
            { role: 'assistant', content: null, tool_calls: [{ id: '2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } }] },
            { role: 'tool', tool_call_id: '2', name: 'read_file', content: `line2\n${'y'.repeat(2000)}` },
            { role: 'assistant', content: 'recent assistant' },
            { role: 'tool', tool_call_id: '3', name: 'write_file', content: 'ok' },
        ];
        const { compacted, removedChars, summarizedCount } = (0, llm_task_executor_1.compactMessages)(msgs, 800);
        strict_1.default.ok(removedChars > 3000, `expected >3000 chars removed, got ${removedChars}`);
        strict_1.default.ok(summarizedCount >= 2);
        strict_1.default.equal(compacted[0]?.content, 'system prompt');
        strict_1.default.equal(compacted[compacted.length - 1]?.content, 'ok');
    });
    (0, node_test_1.it)('Item #2b: LlmTaskExecutor compacts context in-place when maxContextAction is "compact"', async () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-compact-'));
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.join(tmp, 'src'), { recursive: true });
            node_fs_1.default.writeFileSync(node_path_1.default.join(tmp, 'src', 'big.txt'), 'A'.repeat(2500), 'utf8');
            const events = [];
            let turn = 0;
            const executor = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 6 }, null, (ev) => { events.push({ type: ev.type, detail: ev.detail }); }, async () => {
                turn += 1;
                if (turn === 1 || turn === 2) {
                    return {
                        content: '',
                        tool_calls: [{ id: `tc-${turn}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/big.txt' }) } }],
                        finish_reason: 'tool_calls',
                        usage: { input_tokens: 10, output_tokens: 5 },
                    };
                }
                return {
                    content: 'done',
                    tool_calls: [{ id: 'tc-fin', type: 'function', function: { name: 'finish_task', arguments: JSON.stringify({ summary: 'compacted ok' }) } }],
                    finish_reason: 'tool_calls',
                    usage: { input_tokens: 10, output_tokens: 5 },
                };
            }, { maxContextChars: 1500, maxContextAction: 'compact' });
            const res = await executor.execute(makeNode('T1', ['src/big.txt']), makeLease(tmp, 'T1'), 'run-compact', 1);
            strict_1.default.equal(res.success, true, res.output);
            const compactEv = events.find((e) => e.type === 'context_compacted');
            strict_1.default.ok(compactEv, 'expected context_compacted event');
            strict_1.default.ok(Number(compactEv.detail?.removed_chars) > 0);
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('Item #3 & #6: preWrite blocks invalid JSON and custom violations before disk flush, and protects control-plane paths', async () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-prewrite-'));
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.join(tmp, 'src'), { recursive: true });
            const toolResults = [];
            let turn = 0;
            const executor = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 6 }, null, null, async (opts) => {
                const lastTool = [...opts.messages].reverse().find((m) => m.role === 'tool');
                if (lastTool && typeof lastTool.content === 'string')
                    toolResults.push(lastTool.content);
                turn += 1;
                if (turn === 1) {
                    // Try writing control-plane file (.github/workflows/ci.yml)
                    return {
                        content: '',
                        tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: '.github/workflows/ci.yml', content: 'hack' }) } }],
                        finish_reason: 'tool_calls',
                        usage: {},
                    };
                }
                if (turn === 2) {
                    // Try writing broken JSON
                    return {
                        content: '',
                        tool_calls: [{ id: 't2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/data.json', content: '{broken' }) } }],
                        finish_reason: 'tool_calls',
                        usage: {},
                    };
                }
                if (turn === 3) {
                    // Try writing code rejected by custom preWrite hook
                    return {
                        content: '',
                        tool_calls: [{ id: 't3', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/app.ts', content: 'export const x = TODO_STUB;' }) } }],
                        finish_reason: 'tool_calls',
                        usage: {},
                    };
                }
                return {
                    content: 'done',
                    tool_calls: [{ id: 't4', type: 'function', function: { name: 'finish_task', arguments: JSON.stringify({ summary: 'self-healed' }) } }],
                    finish_reason: 'tool_calls',
                    usage: {},
                };
            }, {
                preWrite: ({ content }) => content.includes('TODO_STUB')
                    ? { ok: false, reason: 'stub_detected', diagnostics: ['remove TODO_STUB'] }
                    : { ok: true },
            });
            const res = await executor.execute(makeNode('T2'), makeLease(tmp, 'T2'), 'run-prewrite', 1);
            strict_1.default.equal(res.success, true);
            strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(tmp, '.github', 'workflows', 'ci.yml')), false);
            strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(tmp, 'src', 'data.json')), false);
            strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(tmp, 'src', 'app.ts')), false);
            strict_1.default.ok(toolResults.some((r) => /control-plane path/.test(r)));
            strict_1.default.ok(toolResults.some((r) => /invalid JSON syntax/.test(r)));
            strict_1.default.ok(toolResults.some((r) => /stub_detected/.test(r)));
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('Item #6b: buildDockerRunArgs enforces --network none, --rm, resource caps, and read-only control-plane mounts', () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-docker-args-'));
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.join(tmp, '.oxe'), { recursive: true });
            node_fs_1.default.mkdirSync(node_path_1.default.join(tmp, '.github', 'workflows'), { recursive: true });
            const args = (0, ephemeral_container_1.buildDockerRunArgs)(tmp, {
                image: 'node:20-alpine',
                mountPath: '/workspace',
                memoryLimit: '2g',
                cpus: '2',
            });
            strict_1.default.ok(args.includes('--rm'));
            strict_1.default.ok(args.includes('--network') && args.includes('none'));
            strict_1.default.ok(args.includes('--memory') && args.includes('2g'));
            strict_1.default.ok(args.includes('--cpus') && args.includes('2'));
            strict_1.default.ok(args.some((a) => a.endsWith(':/workspace/.oxe:ro')));
            strict_1.default.ok(args.some((a) => a.endsWith(':/workspace/.github/workflows:ro')));
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
