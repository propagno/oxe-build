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
const built_in_tools_1 = require("../src/executor/built-in-tools");
const llm_task_executor_1 = require("../src/executor/llm-task-executor");
const claude_cli_1 = require("../src/executor/adapters/claude-cli");
// 1.21.2 - OXB-148 defect 2: F2-T1's prompt reached 2.29M chars (~1.37M tokens, window 1M) although the task's scope
// was 231 KB: a grep over the repo matched minified bundles in out/ (multi-MB lines) and whole results stayed in the
// conversation re-sent every turn.
(0, node_test_1.describe)('OXB-148: tool results and the conversation stay inside the window', () => {
    let ws;
    (0, node_test_1.before)(() => {
        ws = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-prompt-size-'));
        fs_1.default.mkdirSync(path_1.default.join(ws, 'src'), { recursive: true });
        fs_1.default.mkdirSync(path_1.default.join(ws, 'out', 'renderer'), { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(ws, 'src', 'a.ts'), `export const memory = 1;\n${'x'.repeat(5000)} memory\n`);
        fs_1.default.writeFileSync(path_1.default.join(ws, 'out', 'renderer', 'monaco.js'), `var a=1;${'y'.repeat(3000000)}memory;`);
        fs_1.default.writeFileSync(path_1.default.join(ws, 'big.txt'), Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'));
    });
    (0, node_test_1.after)(() => fs_1.default.rmSync(ws, { recursive: true, force: true }));
    (0, node_test_1.test)('grep skips generated trees (out/) and cuts long lines around the match', async () => {
        const res = await built_in_tools_1.BUILT_IN_TOOLS.grep.execute({ pattern: 'memory' }, ws);
        strict_1.default.doesNotMatch(res, /out\/renderer/);
        strict_1.default.ok(res.length < 2000, `${res.length} chars`);
        strict_1.default.match(res, /src\/a\.ts:2: …x+ memory… \[linha com 5007 chars\]/);
    });
    (0, node_test_1.test)('read_file returns a window by default, with how to read the rest', async () => {
        const res = await built_in_tools_1.BUILT_IN_TOOLS.read_file.execute({ path: 'big.txt' }, ws);
        strict_1.default.equal(res.split('\n').filter((l) => l.startsWith('line ')).length, 800);
        strict_1.default.match(res, /4200 linha\(s\) a mais: use offset\/limit/);
    });
    (0, node_test_1.test)('any single tool result is capped; old results are elided before the hard limit', () => {
        const capped = (0, llm_task_executor_1.capToolResult)('z'.repeat(100000));
        strict_1.default.ok(capped.length < llm_task_executor_1.TOOL_RESULT_MAX_CHARS + 200);
        strict_1.default.match(capped, /resultado cortado: 100000 chars/);
        const msgs = [{ role: 'user', content: 'task' }];
        for (let i = 0; i < 20; i += 1)
            msgs.push({ role: 'tool', tool_call_id: String(i), name: 'read_file', content: 'r'.repeat(40000) });
        const fitted = (0, claude_cli_1.fitTranscript)(msgs);
        const total = fitted.reduce((n, m) => n + String(m.content).length, 0);
        strict_1.default.ok(total <= 600000, `${total}`);
        strict_1.default.equal(String(fitted[fitted.length - 1].content).length, 40000, "the latest results are kept");
        strict_1.default.match(String(fitted[1].content), /resultado antigo omitido/);
    });
    (0, node_test_1.test)('a prompt over the hard limit fails fast as `context`, without spawning claude', async () => {
        const marker = path_1.default.join(ws, 'spawned.flag');
        const shim = path_1.default.join(ws, 'shim.js');
        fs_1.default.writeFileSync(shim, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.stdout.write('{}');`);
        const a = new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], parseRetries: 0, maxPromptChars: 50000 });
        await strict_1.default.rejects(a.createCompletion()({ baseUrl: '', apiKey: '', model: '', messages: [{ role: 'user', content: 'q'.repeat(80000) }], tools: [] }), (e) => e.kind === 'context' && /prompt_over_limit/.test(e.message));
        strict_1.default.ok(!fs_1.default.existsSync(marker), 'claude was never called');
    });
});
