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
// OxeSpace 15/11 (Celular F3 T9): a policy refusal at turn 2 after reading five files — which one triggered it? The
// failure names what the previous turn added to the prompt (the only new content between the two requests).
const node = {
    id: 'T9', title: 'tela', wave: 1, depends_on: [], workspace_strategy: 'inplace', mutation_scope: ['a.kt'],
    actions: [{ type: 'generate_patch', targets: ['a.kt'] }],
    verify: { must_pass: [], acceptance_refs: [], command: null },
    policy: { requires_human_approval: false, max_retries: 0 },
};
async function run(complete) {
    const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-policy-trig-'));
    try {
        fs_1.default.writeFileSync(path_1.default.join(dir, 'Conversation.kt'), 'class Conversation');
        fs_1.default.writeFileSync(path_1.default.join(dir, 'ThreadScreen.kt'), 'fun ThreadScreen() {}');
        const events = [];
        const exec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => events.push(e), complete);
        const result = await exec.execute(node, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 }, 'r', 1);
        return { result, events };
    }
    finally {
        fs_1.default.rmSync(dir, { recursive: true, force: true });
    }
}
const refusal = () => Object.assign(new Error('API Error: safeguards flagged this request [reasoning_extraction]'), { kind: 'policy' });
(0, node_test_1.describe)('policy refusal names its likely trigger', () => {
    (0, node_test_1.test)('at turn 2: the tool results of turn 1, with sizes; the hint offers --retry-policy-once', async () => {
        let turn = 0;
        const { result, events } = await run(async () => {
            turn += 1;
            if (turn === 1) {
                return {
                    content: '', finish_reason: 'tool_calls',
                    tool_calls: [
                        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'Conversation.kt' }) } },
                        { id: 'c2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'ThreadScreen.kt' }) } },
                    ],
                };
            }
            throw refusal();
        });
        strict_1.default.equal(result.success, false);
        strict_1.default.equal(result.failure_class, 'policy');
        strict_1.default.match(result.output, /Conteúdo novo desde a requisição anterior[^\n]*read_file Conversation\.kt \(\d+ chars\) · read_file ThreadScreen\.kt/);
        strict_1.default.match(result.output, /--retry-policy-once/);
        const u = events.find((e) => e.type === 'executor_usage')?.detail;
        strict_1.default.deepEqual(u.policy_trigger_candidates?.map((t) => t.target), ['Conversation.kt', 'ThreadScreen.kt']);
    });
    (0, node_test_1.test)('at the first request: the trigger is in the starting prompt', async () => {
        const { result } = await run(async () => { throw refusal(); });
        strict_1.default.equal(result.failure_class, 'policy');
        strict_1.default.match(result.output, /primeira requisição: o gatilho está no prompt inicial/);
    });
});
