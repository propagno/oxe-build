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
const claude_cli_1 = require("../src/executor/adapters/claude-cli");
const registry_1 = require("../src/executor/adapters/registry");
// 1.18: o executor de referência é o CLI do host (`claude -p` por turno, sem ponte HTTP nem API
// key). O binário é substituído por um shim node que fala o mesmo envelope JSON do `claude -p`.
const SHIM = String.raw `
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (shim)'); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  if (process.env.OXE_SHIM_LOG) fs.appendFileSync(process.env.OXE_SHIM_LOG, JSON.stringify({ args, prompt: input }) + '\n');
  const mode = process.env.OXE_SHIM_MODE || 'ok';
  let result;
  if (mode === 'garbage') result = 'Acho que está tudo certo.';
  else if (mode === 'denied') result = JSON.stringify({ content: '', tool_calls: [{ name: 'run_command', arguments: { command: 'echo hacked' } }] });
  else if (!input.includes('TOOL RESULT (write_file')) result = JSON.stringify({ content: '', tool_calls: [{ name: 'write_file', arguments: { path: 'out.txt', content: 'hi\n' } }] });
  else result = '\u0060\u0060\u0060json\n' + JSON.stringify({ content: 'done', tool_calls: [{ name: 'finish_task', arguments: { summary: 'wrote out.txt' } }] }) + '\n\u0060\u0060\u0060';
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0.01 }));
});
`;
function node(actions) {
    return {
        id: 'T1',
        title: 'escrever out.txt',
        wave: 1,
        depends_on: [],
        workspace_strategy: 'inplace',
        mutation_scope: ['out.txt'],
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
const provider = { baseUrl: '', apiKey: '', model: '', maxTurns: 4 };
(0, node_test_1.describe)('ExecutorAdapter claude-cli (bridge in-process)', () => {
    let tmp;
    let shimPath;
    let logPath;
    (0, node_test_1.before)(() => {
        tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-adapter-'));
        shimPath = path_1.default.join(tmp, 'claude-shim.js');
        logPath = path_1.default.join(tmp, 'shim.ndjson');
        fs_1.default.writeFileSync(shimPath, SHIM, 'utf8');
        process.env.OXE_SHIM_LOG = logPath;
    });
    (0, node_test_1.after)(() => {
        delete process.env.OXE_SHIM_LOG;
        delete process.env.OXE_SHIM_MODE;
        fs_1.default.rmSync(tmp, { recursive: true, force: true });
    });
    function adapter() {
        return new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shimPath], model: 'sonnet' });
    }
    function shimCalls() {
        if (!fs_1.default.existsSync(logPath))
            return [];
        return fs_1.default.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    }
    (0, node_test_1.test)('detect lê a versão do binário', () => {
        const d = adapter().detect();
        strict_1.default.equal(d.available, true, String(d.error));
        strict_1.default.equal(d.version, '9.9.9 (shim)');
    });
    (0, node_test_1.test)('round-trip: tool calls executadas pelo runtime, custo e uso reportados', async () => {
        fs_1.default.rmSync(logPath, { force: true });
        delete process.env.OXE_SHIM_MODE;
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const events = [];
        const exec = new llm_task_executor_1.LlmTaskExecutor(provider, null, (e) => events.push(e), adapter().createCompletion());
        const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(result.success, true, result.output);
        strict_1.default.equal(result.completed_by, 'finish_task');
        strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(ws, 'out.txt'), 'utf8'), 'hi\n');
        const calls = shimCalls();
        strict_1.default.equal(calls.length, 2, 'um processo por turno');
        strict_1.default.deepEqual(calls[0].args.slice(0, 7), ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config']);
        strict_1.default.ok(calls[0].args.includes('--model'));
        strict_1.default.match(calls[0].prompt, /AVAILABLE TOOLS/);
        strict_1.default.match(calls[1].prompt, /TOOL RESULT \(write_file/);
        const usage = events.find((e) => e.type === 'executor_usage');
        strict_1.default.ok(usage, 'executor_usage emitido');
        strict_1.default.equal(usage.detail.turns, 2);
        strict_1.default.equal(usage.detail.tool_calls, 2);
        strict_1.default.deepEqual(usage.detail.tools, { write_file: 1, finish_task: 1 });
        strict_1.default.ok(Math.abs(Number(usage.detail.cost_usd) - 0.02) < 1e-9);
    });
    (0, node_test_1.test)('resposta fora do protocolo: retenta e falha como llm, nunca como sucesso', async () => {
        fs_1.default.rmSync(logPath, { force: true });
        process.env.OXE_SHIM_MODE = 'garbage';
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const exec = new llm_task_executor_1.LlmTaskExecutor(provider, null, null, adapter().createCompletion());
        const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(result.success, false);
        strict_1.default.equal(result.failure_class, 'llm');
        strict_1.default.equal(shimCalls().length, 3, '1 chamada + 2 retries de parse');
        delete process.env.OXE_SHIM_MODE;
    });
    (0, node_test_1.test)('allowlist continua valendo sob o adapter', async () => {
        process.env.OXE_SHIM_MODE = 'denied';
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const events = [];
        const exec = new llm_task_executor_1.LlmTaskExecutor({ ...provider, maxTurns: 1 }, null, (e) => events.push(e), adapter().createCompletion());
        await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.ok(events.some((e) => e.type === 'tool_denied' && e.detail?.tool === 'run_command'));
        delete process.env.OXE_SHIM_MODE;
    });
    (0, node_test_1.test)('guarda de memória: pausa o turno até haver memória livre; desiste como env', async () => {
        fs_1.default.rmSync(logPath, { force: true });
        delete process.env.OXE_SHIM_MODE;
        let free = 200 * 1024 * 1024;
        const reads = [];
        const gated = new claude_cli_1.ClaudeCliAdapter({
            command: process.execPath, prefixArgs: [shimPath], minFreeMemoryMb: 1024, memoryPollMs: 5, memoryWaitMs: 2000,
            freeMemory: () => { reads.push(free); if (reads.length === 3)
                free = 2048 * 1024 * 1024; return free; },
        });
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const ok = await new llm_task_executor_1.LlmTaskExecutor(provider, null, null, gated.createCompletion()).execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(ok.success, true, ok.output);
        strict_1.default.ok(reads.length >= 3, 'esperou a memória voltar antes do primeiro turno');
        const starved = new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shimPath], minFreeMemoryMb: 1024, memoryPollMs: 5, memoryWaitMs: 30, freeMemory: () => 100 * 1024 * 1024 });
        fs_1.default.rmSync(logPath, { force: true });
        const failed = await new llm_task_executor_1.LlmTaskExecutor(provider, null, null, starved.createCompletion()).execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(failed.success, false);
        strict_1.default.equal(failed.failure_class, 'env');
        strict_1.default.match(String(failed.output), /memória livre/);
        strict_1.default.equal(shimCalls().length, 0, 'nenhum claude -p foi aberto sem memória');
    });
    (0, node_test_1.test)('binário ausente: detect indisponível e a tentativa falha como env', async () => {
        const missing = new claude_cli_1.ClaudeCliAdapter({ command: 'oxe-no-such-claude-binary' });
        strict_1.default.equal(missing.detect().available, false);
        const events = [];
        const exec = new llm_task_executor_1.LlmTaskExecutor(provider, null, (e) => events.push(e), missing.createCompletion());
        const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(tmp), 'run-1', 1);
        strict_1.default.equal(result.success, false);
        strict_1.default.equal(result.failure_class, 'env');
        // O motivo fica no evento de uso, não só no console.
        const usage = events.find((e) => e.type === 'executor_usage');
        strict_1.default.equal(usage.detail.failure_class, 'env');
        strict_1.default.match(String(usage.detail.error), /não encontrado no PATH/);
    });
});
(0, node_test_1.describe)('claude-cli — protocolo e spawn portável', () => {
    (0, node_test_1.test)('parseBridgeReply aceita JSON puro ou cercado e rejeita o resto', () => {
        const plain = (0, claude_cli_1.parseBridgeReply)('{"content":"x","tool_calls":[{"name":"read_file","arguments":{"path":"a"}}]}');
        strict_1.default.equal(plain.tool_calls[0].function.name, 'read_file');
        strict_1.default.equal(plain.tool_calls[0].function.arguments, '{"path":"a"}');
        const fenced = (0, claude_cli_1.parseBridgeReply)('```json\n{"content":"ok","tool_calls":[]}\n```');
        strict_1.default.deepEqual(fenced, { content: 'ok', tool_calls: [] });
        strict_1.default.equal((0, claude_cli_1.parseBridgeReply)('sem json aqui'), null);
        strict_1.default.equal((0, claude_cli_1.parseBridgeReply)('{"tool_calls":"nope"}'), null);
        strict_1.default.equal((0, claude_cli_1.parseBridgeReply)('{broken'), null);
    });
    (0, node_test_1.test)('buildSpawnable: .cmd passa por cmd.exe verbatim; .exe e posix sem shell', () => {
        const cmd = (0, claude_cli_1.buildSpawnable)('C:\\npm\\claude.cmd', ['-p', '--tools', ''], 'win32');
        strict_1.default.equal(cmd.file, 'cmd.exe');
        strict_1.default.equal(cmd.windowsVerbatimArguments, true);
        strict_1.default.equal(cmd.args[3], '"C:\\npm\\claude.cmd -p --tools """');
        const exe = (0, claude_cli_1.buildSpawnable)('C:\\bin\\claude.exe', ['-p'], 'win32');
        strict_1.default.deepEqual(exe, { file: 'C:\\bin\\claude.exe', args: ['-p'], windowsVerbatimArguments: false });
        strict_1.default.equal((0, claude_cli_1.buildSpawnable)('/usr/bin/claude', ['-p'], 'linux').file, '/usr/bin/claude');
    });
    (0, node_test_1.test)('resolveExecutable procura no PATH com as extensões do Windows', () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-path-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(dir, 'claude.cmd'), '@echo off\n');
            strict_1.default.equal((0, claude_cli_1.resolveExecutable)('claude', 'win32', dir), path_1.default.join(dir, 'claude.cmd'));
            strict_1.default.equal((0, claude_cli_1.resolveExecutable)('oxe-absent', 'win32', dir), null);
            // A posix PATH split on ':' só faz sentido com caminhos posix (no Windows o drive tem ':').
            if (process.platform !== 'win32') {
                strict_1.default.equal((0, claude_cli_1.resolveExecutable)('claude', 'linux', dir), null);
                fs_1.default.writeFileSync(path_1.default.join(dir, 'claude'), '#!/bin/sh\n');
                strict_1.default.equal((0, claude_cli_1.resolveExecutable)('claude', 'linux', dir), path_1.default.join(dir, 'claude'));
            }
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('registry: http exige API key, claude não', () => {
        strict_1.default.equal((0, registry_1.createExecutorAdapter)('http').requiresApiKey, true);
        strict_1.default.equal((0, registry_1.createExecutorAdapter)('claude').requiresApiKey, false);
        const ids = (0, registry_1.detectExecutorAdapters)({ claude: { command: 'oxe-no-such-claude-binary' } }).map((a) => `${a.id}:${a.available}`);
        strict_1.default.deepEqual(ids, ['claude:false', 'http:true']);
    });
});
(0, node_test_1.describe)('OXB-148: claude -p failure reasons come from stdout, classified', () => {
    let tmp;
    const shim = (body) => {
        const p = path_1.default.join(tmp, `fail-${Math.random().toString(36).slice(2)}.js`);
        fs_1.default.writeFileSync(p, `process.stdin.resume(); process.stdin.on('end', () => { ${body} }); process.stdin.on('data', () => {});`, 'utf8');
        return new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [p], parseRetries: 0 });
    };
    const call = (a) => a.createCompletion()({ baseUrl: '', apiKey: '', model: '', messages: [{ role: 'user', content: 'x' }], tools: [] });
    (0, node_test_1.before)(() => { tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-adapter-fail-')); });
    (0, node_test_1.after)(() => { fs_1.default.rmSync(tmp, { recursive: true, force: true }); });
    (0, node_test_1.test)('exit 1 with empty stderr: the JSON stdout reason (subtype, result) is in the error, prompt-too-long is `context`', async () => {
        const a = shim(`process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Prompt is too long', total_cost_usd: 0.21 })); process.exit(1);`);
        await strict_1.default.rejects(call(a), (err) => {
            strict_1.default.equal(err.kind, 'context');
            strict_1.default.equal(err.costUsd, 0.21);
            strict_1.default.match(err.message, /claude exit 1 · subtype=error_during_execution · result=Prompt is too long · prompt=\d+ chars/);
            return true;
        });
    });
    (0, node_test_1.test)('a usage limit is `quota`; max turns is `llm`; anything else stays `env` with the stdout tail', async () => {
        await strict_1.default.rejects(call(shim(`process.stdout.write(JSON.stringify({ is_error: true, result: 'Claude AI usage limit reached|1762650000' })); process.exit(1);`)), (e) => e.kind === 'quota');
        await strict_1.default.rejects(call(shim(`process.stdout.write(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: '' })); process.exit(1);`)), (e) => e.kind === 'llm');
        await strict_1.default.rejects(call(shim(`process.stdout.write('boom: not json'); process.exit(1);`)), (e) => e.kind === 'env' && /stdout=boom: not json/.test(e.message));
    });
    (0, node_test_1.test)('the executor records the class and the cost of the failed call', async () => {
        const a = shim(`process.stdout.write(JSON.stringify({ is_error: true, result: 'Prompt is too long', total_cost_usd: 0.05 })); process.exit(1);`);
        const events = [];
        const ex = new llm_task_executor_1.LlmTaskExecutor(provider, null, (e) => events.push(e), a.createCompletion());
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(res.failure_class, 'context');
        const usage = events.find((e) => e.type === 'executor_usage');
        strict_1.default.equal(usage.detail.cost_usd, 0.05);
    });
});
(0, node_test_1.describe)('OXB-153: a claude call that times out continues the same attempt', () => {
    let tmp;
    (0, node_test_1.before)(() => { tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-adapter-timeout-')); });
    (0, node_test_1.after)(() => { fs_1.default.rmSync(tmp, { recursive: true, force: true }); });
    (0, node_test_1.test)('1st call hangs past timeoutMs; the 2nd answers finish_task: success in ONE attempt, with a turn_timeout event', async () => {
        const counter = path_1.default.join(tmp, 'calls.txt');
        const shim = path_1.default.join(tmp, 'slow.js');
        // first call never answers in time; next calls finish the task (the bridge expects {"content","tool_calls"} JSON in result)
        fs_1.default.writeFileSync(shim, `
const fs=require('fs');const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;fs.writeFileSync(${JSON.stringify(counter)},String(n));
process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{
  if(n===1){setTimeout(()=>{},60000);return;}
  const reply=JSON.stringify({content:'ok',tool_calls:[{name:'finish_task',arguments:{summary:'done'}}]});
  process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:reply,total_cost_usd:0.01}));
});`, 'utf8');
        const a = new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], timeoutMs: 400 });
        const events = [];
        const ex = new llm_task_executor_1.LlmTaskExecutor({ ...provider, maxTurns: 4 }, null, (e) => events.push(e), a.createCompletion());
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(res.success, true, res.output);
        strict_1.default.equal(res.completed_by, 'finish_task');
        const t = events.filter((e) => e.type === 'turn_timeout');
        strict_1.default.equal(t.length, 1);
        strict_1.default.equal(t[0].detail.retry, 1);
    });
    (0, node_test_1.test)('timeouts in a row beyond the limit fail the attempt as `timeout` (not `env`)', async () => {
        const shim = path_1.default.join(tmp, 'always-slow.js');
        fs_1.default.writeFileSync(shim, `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{setTimeout(()=>{},60000)});`, 'utf8');
        const a = new claude_cli_1.ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], timeoutMs: 300 });
        const ex = new llm_task_executor_1.LlmTaskExecutor({ ...provider, maxTurns: 4 }, null, null, a.createCompletion());
        const ws = fs_1.default.mkdtempSync(path_1.default.join(tmp, 'ws-'));
        const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
        strict_1.default.equal(res.success, false);
        strict_1.default.equal(res.failure_class, 'timeout');
        strict_1.default.match(res.output, /claude -p excedeu 300 ms/);
    });
});
