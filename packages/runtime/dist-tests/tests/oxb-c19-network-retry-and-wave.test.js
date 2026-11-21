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
const scheduler_1 = require("../src/scheduler/scheduler");
const inplace_1 = require("../src/workspace/strategies/inplace");
function makeNode(id, dependsOn = []) {
    return {
        id,
        title: `Task ${id}`,
        description: `Execute ${id}`,
        wave: 1,
        depends_on: dependsOn,
        acceptance_criteria: [],
        mutation_scope: [`src/${id}.ts`],
        actions: [{ type: 'edit', target: `src/${id}.ts` }],
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
(0, node_test_1.describe)('OXB-C19: transient network backoff & intra-wave dependency progression', () => {
    (0, node_test_1.it)('1) LlmTaskExecutor retries transient network errors (wsasend / TLS handshake timeout / 503) in-place with exponential backoff', async () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-c19-net-'));
        try {
            const sleeps = [];
            const events = [];
            let calls = 0;
            const executor = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 3 }, null, (ev) => { events.push({ type: ev.type, detail: ev.detail }); }, async () => {
                calls += 1;
                if (calls === 1) {
                    const err = new Error('agy exit 1 · stderr=wsasend: An existing connection was forcibly closed by the remote host · kind=env');
                    err.kind = 'env';
                    throw err;
                }
                if (calls === 2) {
                    const err = new Error('agy exit 1 · stderr=TLS handshake timeout · kind=env');
                    err.kind = 'env';
                    throw err;
                }
                if (calls === 3) {
                    const err = new Error('HTTP 503 Service Unavailable');
                    err.kind = 'env';
                    throw err;
                }
                return {
                    content: 'done after network recovery',
                    tool_calls: [
                        {
                            id: 'tc-finish',
                            type: 'function',
                            function: {
                                name: 'finish_task',
                                arguments: JSON.stringify({ summary: 'done after network recovery' }),
                            },
                        },
                    ],
                    finish_reason: 'tool_calls',
                    usage: { input_tokens: 10, output_tokens: 5 },
                };
            }, {
                sleep: async (ms) => { sleeps.push(ms); },
            });
            const res = await executor.execute(makeNode('T15'), makeLease(tmp, 'T15'), 'run-c19', 1);
            strict_1.default.equal(res.success, true, res.output);
            strict_1.default.equal(calls, 4);
            strict_1.default.deepEqual(sleeps, [5000, 15000, 30000]);
            const netEvents = events.filter((e) => e.type === 'network_retry');
            strict_1.default.equal(netEvents.length, 3);
            strict_1.default.equal(netEvents[0]?.detail?.wait_ms, 5000);
            strict_1.default.equal(netEvents[1]?.detail?.wait_ms, 15000);
            strict_1.default.equal(netEvents[2]?.detail?.wait_ms, 30000);
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('1b) LlmTaskExecutor fails as env after exhausting all configured network retry delays', async () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-c19-net-exhaust-'));
        try {
            const sleeps = [];
            let calls = 0;
            const executor = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 3 }, null, null, async () => {
                calls += 1;
                const err = new Error('read tcp: ECONNRESET');
                err.kind = 'env';
                throw err;
            }, {
                networkRetryDelaysMs: [100, 200],
                sleep: async (ms) => { sleeps.push(ms); },
            });
            const res = await executor.execute(makeNode('T15'), makeLease(tmp, 'T15'), 'run-c19', 1);
            strict_1.default.equal(res.success, false);
            strict_1.default.equal(res.failure_class, 'env');
            strict_1.default.equal(calls, 3);
            strict_1.default.deepEqual(sleeps, [100, 200]);
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('2) Scheduler runWave progresses through intra-wave dependencies (T11 -> T12 -> T13) instead of blocking T12..T13 up-front', async () => {
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'oxe-c19-wave-'));
        try {
            const n11 = makeNode('T11', []);
            const n12 = makeNode('T12', ['T11']);
            const n13 = makeNode('T13', ['T12']);
            const graph = {
                graph_version: '1.0',
                run_id: 'run-c19-wave',
                nodes: new Map([['T11', n11], ['T12', n12], ['T13', n13]]),
                waves: [{ wave_number: 1, node_ids: ['T11', 'T12', 'T13'] }],
                edges: [
                    { from: 'T11', to: 'T12', type: 'depends_on' },
                    { from: 'T12', to: 'T13', type: 'depends_on' },
                ],
            };
            const executed = [];
            const scheduler = new scheduler_1.Scheduler();
            const result = await scheduler.run(graph, {
                projectRoot: tmp,
                sessionId: null,
                runId: 'run-c19-wave',
                workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp),
                executor: {
                    async execute(node) {
                        executed.push(node.id);
                        return { success: true, failure_class: null, evidence: [], output: `ok ${node.id}` };
                    },
                },
            });
            strict_1.default.equal(result.status, 'completed');
            strict_1.default.deepEqual(executed, ['T11', 'T12', 'T13']);
            strict_1.default.deepEqual(result.completed, ['T11', 'T12', 'T13']);
            strict_1.default.deepEqual(result.blocked, []);
            strict_1.default.deepEqual(result.failed, []);
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
