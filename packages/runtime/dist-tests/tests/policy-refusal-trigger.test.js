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
    (0, node_test_1.test)('the outputs are saved verbatim next to the attempt log; the hint says the trigger is not in the pack (OxeChat F4 T12)', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-policy-out-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(dir, 'thread-fixtures.ts'), "export const rows = [{ phase: 'reasoning', text: 'linha 171' }];\n");
            let turn = 0;
            const exec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => { }, async () => {
                turn += 1;
                if (turn === 1)
                    return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'thread-fixtures.ts' }) } }] };
                throw refusal();
            });
            const result = await exec.execute(node, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 }, 'run-x', 3);
            const saved = path_1.default.join(dir, '.oxe', 'runs', 'run-x', 'attempts', 'T9-3.policy-tools.txt');
            strict_1.default.ok(fs_1.default.existsSync(saved), 'saved next to the attempt log');
            strict_1.default.match(fs_1.default.readFileSync(saved, 'utf8'), /===== read_file thread-fixtures\.ts \(\d+ chars\) =====[\s\S]*phase: 'reasoning'/);
            strict_1.default.match(result.output, /O gatilho veio de saídas de ferramenta do turno anterior, salvas na íntegra em \.oxe\/runs\/run-x\/attempts\/T9-3\.policy-tools\.txt — não do pack/);
            strict_1.default.doesNotMatch(result.output, /tire o trecho que dispara a recusa/);
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('context soft cap: warn once by default; "retry" closes the attempt as contexto cheio (T12, 277k chars)', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-ctx-cap-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(dir, 'big.txt'), 'x'.repeat(5000));
            let id = 0;
            const reads = () => ({ content: '', finish_reason: 'tool_calls', tool_calls: [{ id: `c${id++}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'big.txt' }) } }] });
            const lease = { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 };
            const warnEvents = [];
            let n = 0;
            const warnComplete = async () => { n += 1; return n < 4 ? reads() : { content: 'ok', finish_reason: 'stop', tool_calls: [] }; };
            const warn = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => warnEvents.push(e), warnComplete, { maxContextChars: 800, noProgressTurns: 0 });
            await warn.execute(node, lease, 'r', 1);
            const capWarn = warnEvents.filter((e) => e.type === 'executor_context_cap');
            strict_1.default.equal(capWarn.length, 1, 'warned once');
            strict_1.default.equal(capWarn[0].detail.action, 'warn');
            let m = 0;
            const retryComplete = async () => { m += 1; return reads(); };
            const retry = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => { }, retryComplete, { maxContextChars: 800, maxContextAction: 'retry', noProgressTurns: 0 });
            const res = await retry.execute(node, lease, 'r', 1);
            strict_1.default.equal(res.success, false);
            strict_1.default.match(res.output, /^contexto cheio: \d+ caracteres acumulados no turno 1/);
            strict_1.default.equal(m, 1, 'no further paid request once full');
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('R44: the file goes to projectRoot (never a disposed worktree); tool-call arguments count toward the cap', async () => {
        const lease = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-lease-'));
        const root = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-root-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(lease, 'f.ts'), 'x');
            let t = 0;
            const refuse = async () => { t += 1; if (t === 1)
                return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'f.ts' }) } }] }; throw refusal(); };
            const exec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => { }, refuse, { projectRoot: root });
            await exec.execute(node, { workspace_id: 'w', strategy: 'git_worktree', isolation_level: 'isolated', branch: null, base_commit: null, root_path: lease, ttl_minutes: 5 }, 'run-y', 1);
            strict_1.default.ok(fs_1.default.existsSync(path_1.default.join(root, '.oxe', 'runs', 'run-y', 'attempts', 'T9-1.policy-tools.txt')));
            strict_1.default.ok(!fs_1.default.existsSync(path_1.default.join(lease, '.oxe')), 'nothing in the lease');
            // a large write_file: null content, the code in the arguments — it counts
            const big = 'y'.repeat(4000);
            let w = 0;
            const writes = async () => { w += 1; return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: `w${w}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.kt', content: big }) } }] }; };
            const capExec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => { }, writes, { maxContextChars: 3000, maxContextAction: 'retry', noProgressTurns: 0 });
            const res = await capExec.execute(node, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: lease, ttl_minutes: 5 }, 'r', 1);
            strict_1.default.equal(res.completed_by, 'context_cap');
            strict_1.default.equal(w, 1, 'closed after the first write: its arguments are over the cap');
        }
        finally {
            fs_1.default.rmSync(lease, { recursive: true, force: true });
            fs_1.default.rmSync(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('the context size at the refusal is recorded; a long context with small tool outputs names the size, not the files (F6 T36, 360k)', async () => {
        let t = 0;
        const big = 'z'.repeat(210000);
        const { result, events } = await run(async () => {
            t += 1;
            if (t === 1)
                return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.kt', content: big }) } }] };
            throw refusal();
        });
        strict_1.default.equal(result.failure_class, 'policy');
        strict_1.default.match(result.output, /O contexto tinha \d{6,} chars no turno 1\./);
        strict_1.default.match(result.output, /o tamanho do contexto é o suspeito, não o conteúdo — considere execute\.max_context_chars/);
        strict_1.default.doesNotMatch(result.output, /restrinja o escopo da tarefa/);
        const u = events.find((e) => e.type === 'executor_usage')?.detail;
        strict_1.default.ok((u.policy_context_chars ?? 0) > 200000);
        // a short context: the size is still recorded, the content hint stays
        const { result: small } = await run(async () => { t += 1; if (t === 3)
            return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'Conversation.kt' }) } }] }; throw refusal(); });
        strict_1.default.match(small.output, /O contexto tinha \d+ chars no turno 1\.$/);
        strict_1.default.match(small.output, /restrinja o escopo da tarefa/);
    });
    (0, node_test_1.test)('at the first request: the trigger is in the starting prompt (even when over 200k chars)', async () => {
        const { result } = await run(async () => { throw refusal(); });
        strict_1.default.equal(result.failure_class, 'policy');
        strict_1.default.match(result.output, /primeira requisição: o gatilho está no prompt inicial/);
        const bigNode = { ...node, title: 'z'.repeat(210000) };
        const lease = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-pol0-'));
        try {
            const exec = new llm_task_executor_1.LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 2 }, null, () => { }, async () => { throw refusal(); });
            const r0 = await exec.execute(bigNode, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: lease, ttl_minutes: 5 }, 'run-0', 1);
            strict_1.default.doesNotMatch(r0.output, /As saídas do último turno somam só 0 chars/);
        }
        finally {
            fs_1.default.rmSync(lease, { recursive: true, force: true });
        }
    });
});
