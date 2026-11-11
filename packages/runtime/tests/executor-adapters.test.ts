import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { LlmTaskExecutor } from '../src/executor/llm-task-executor';
import type { LlmExecutorEvent } from '../src/executor/llm-task-executor';
import {
  ClaudeCliAdapter,
  buildSpawnable,
  parseBridgeReply,
  resolveExecutable,
} from '../src/executor/adapters/claude-cli';
import { createExecutorAdapter, detectExecutorAdapters } from '../src/executor/adapters/registry';
import type { GraphNode } from '../src/compiler/graph-compiler';
import type { WorkspaceLease } from '../src/models/workspace';

// 1.18: o executor de referência é o CLI do host (`claude -p` por turno, sem ponte HTTP nem API
// key). O binário é substituído por um shim node que fala o mesmo envelope JSON do `claude -p`.

const SHIM = String.raw`
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

function node(actions: GraphNode['actions']): GraphNode {
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

function lease(root: string): WorkspaceLease {
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

describe('ExecutorAdapter claude-cli (bridge in-process)', () => {
  let tmp: string;
  let shimPath: string;
  let logPath: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-adapter-'));
    shimPath = path.join(tmp, 'claude-shim.js');
    logPath = path.join(tmp, 'shim.ndjson');
    fs.writeFileSync(shimPath, SHIM, 'utf8');
    process.env.OXE_SHIM_LOG = logPath;
  });

  after(() => {
    delete process.env.OXE_SHIM_LOG;
    delete process.env.OXE_SHIM_MODE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function adapter() {
    return new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shimPath], model: 'sonnet' });
  }

  function shimCalls(): Array<{ args: string[]; prompt: string }> {
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  test('detect lê a versão do binário', () => {
    const d = adapter().detect();
    assert.equal(d.available, true, String(d.error));
    assert.equal(d.version, '9.9.9 (shim)');
  });

  test('round-trip: tool calls executadas pelo runtime, custo e uso reportados', async () => {
    fs.rmSync(logPath, { force: true });
    delete process.env.OXE_SHIM_MODE;
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const events: LlmExecutorEvent[] = [];
    const exec = new LlmTaskExecutor(provider, null, (e) => events.push(e), adapter().createCompletion());
    const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);

    assert.equal(result.success, true, result.output);
    assert.equal(result.completed_by, 'finish_task');
    assert.equal(fs.readFileSync(path.join(ws, 'out.txt'), 'utf8'), 'hi\n');

    const calls = shimCalls();
    assert.equal(calls.length, 2, 'um processo por turno');
    assert.deepEqual(calls[0].args.slice(0, 7), ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config']);
    assert.ok(calls[0].args.includes('--model'));
    assert.match(calls[0].prompt, /AVAILABLE TOOLS/);
    assert.match(calls[1].prompt, /TOOL RESULT \(write_file/);

    const usage = events.find((e) => e.type === 'executor_usage');
    assert.ok(usage, 'executor_usage emitido');
    assert.equal(usage!.detail!.turns, 2);
    assert.equal(usage!.detail!.tool_calls, 2);
    assert.deepEqual(usage!.detail!.tools, { write_file: 1, finish_task: 1 });
    assert.ok(Math.abs(Number(usage!.detail!.cost_usd) - 0.02) < 1e-9);
  });

  test('resposta fora do protocolo: retenta e falha como llm, nunca como sucesso', async () => {
    fs.rmSync(logPath, { force: true });
    process.env.OXE_SHIM_MODE = 'garbage';
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const exec = new LlmTaskExecutor(provider, null, null, adapter().createCompletion());
    const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(result.success, false);
    assert.equal(result.failure_class, 'llm');
    assert.equal(shimCalls().length, 3, '1 chamada + 2 retries de parse');
    delete process.env.OXE_SHIM_MODE;
  });

  test('allowlist continua valendo sob o adapter', async () => {
    process.env.OXE_SHIM_MODE = 'denied';
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const events: LlmExecutorEvent[] = [];
    const exec = new LlmTaskExecutor({ ...provider, maxTurns: 1 }, null, (e) => events.push(e), adapter().createCompletion());
    await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.ok(events.some((e) => e.type === 'tool_denied' && e.detail?.tool === 'run_command'));
    delete process.env.OXE_SHIM_MODE;
  });

  test('guarda de memória: pausa o turno até haver memória livre; desiste como env', async () => {
    fs.rmSync(logPath, { force: true });
    delete process.env.OXE_SHIM_MODE;
    let free = 200 * 1024 * 1024;
    const reads: number[] = [];
    const gated = new ClaudeCliAdapter({
      command: process.execPath, prefixArgs: [shimPath], minFreeMemoryMb: 1024, memoryPollMs: 5, memoryWaitMs: 2_000,
      freeMemory: () => { reads.push(free); if (reads.length === 3) free = 2048 * 1024 * 1024; return free; },
    });
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const ok = await new LlmTaskExecutor(provider, null, null, gated.createCompletion()).execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(ok.success, true, ok.output);
    assert.ok(reads.length >= 3, 'esperou a memória voltar antes do primeiro turno');

    const starved = new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shimPath], minFreeMemoryMb: 1024, memoryPollMs: 5, memoryWaitMs: 30, freeMemory: () => 100 * 1024 * 1024 });
    fs.rmSync(logPath, { force: true });
    const failed = await new LlmTaskExecutor(provider, null, null, starved.createCompletion()).execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(failed.success, false);
    assert.equal(failed.failure_class, 'env');
    assert.match(String(failed.output), /memória livre/);
    assert.equal(shimCalls().length, 0, 'nenhum claude -p foi aberto sem memória');
  });

  test('binário ausente: detect indisponível e a tentativa falha como env', async () => {
    const missing = new ClaudeCliAdapter({ command: 'oxe-no-such-claude-binary' });
    assert.equal(missing.detect().available, false);
    const events: LlmExecutorEvent[] = [];
    const exec = new LlmTaskExecutor(provider, null, (e) => events.push(e), missing.createCompletion());
    const result = await exec.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(tmp), 'run-1', 1);
    assert.equal(result.success, false);
    assert.equal(result.failure_class, 'env');
    // O motivo fica no evento de uso, não só no console.
    const usage = events.find((e) => e.type === 'executor_usage')!;
    assert.equal(usage.detail!.failure_class, 'env');
    assert.match(String(usage.detail!.error), /não encontrado no PATH/);
  });
});

describe('claude-cli — protocolo e spawn portável', () => {
  test('parseBridgeReply aceita JSON puro ou cercado e rejeita o resto', () => {
    const plain = parseBridgeReply('{"content":"x","tool_calls":[{"name":"read_file","arguments":{"path":"a"}}]}');
    assert.equal(plain!.tool_calls[0].function.name, 'read_file');
    assert.equal(plain!.tool_calls[0].function.arguments, '{"path":"a"}');
    const fenced = parseBridgeReply('```json\n{"content":"ok","tool_calls":[]}\n```');
    assert.deepEqual(fenced, { content: 'ok', tool_calls: [] });
    assert.equal(parseBridgeReply('sem json aqui'), null);
    assert.equal(parseBridgeReply('{"tool_calls":"nope"}'), null);
    assert.equal(parseBridgeReply('{broken'), null);
  });

  test('buildSpawnable: .cmd passa por cmd.exe verbatim; .exe e posix sem shell', () => {
    const cmd = buildSpawnable('C:\\npm\\claude.cmd', ['-p', '--tools', ''], 'win32');
    assert.equal(cmd.file, 'cmd.exe');
    assert.equal(cmd.windowsVerbatimArguments, true);
    assert.equal(cmd.args[3], '"C:\\npm\\claude.cmd -p --tools """');
    const exe = buildSpawnable('C:\\bin\\claude.exe', ['-p'], 'win32');
    assert.deepEqual(exe, { file: 'C:\\bin\\claude.exe', args: ['-p'], windowsVerbatimArguments: false });
    assert.equal(buildSpawnable('/usr/bin/claude', ['-p'], 'linux').file, '/usr/bin/claude');
  });

  test('resolveExecutable procura no PATH com as extensões do Windows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-path-'));
    try {
      fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\n');
      assert.equal(resolveExecutable('claude', 'win32', dir), path.join(dir, 'claude.cmd'));
      assert.equal(resolveExecutable('oxe-absent', 'win32', dir), null);
      // A posix PATH split on ':' só faz sentido com caminhos posix (no Windows o drive tem ':').
      if (process.platform !== 'win32') {
        assert.equal(resolveExecutable('claude', 'linux', dir), null);
        fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
        assert.equal(resolveExecutable('claude', 'linux', dir), path.join(dir, 'claude'));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('registry: http exige API key, claude e antigravity não', () => {
    assert.equal(createExecutorAdapter('http').requiresApiKey, true);
    assert.equal(createExecutorAdapter('claude').requiresApiKey, false);
    assert.equal(createExecutorAdapter('antigravity').requiresApiKey, false);
    const ids = detectExecutorAdapters({
      claude: { command: 'oxe-no-such-claude-binary' },
      antigravity: { command: 'oxe-no-such-agy-binary' },
    }).map((a) => `${a.id}:${a.available}`);
    assert.deepEqual(ids, ['claude:false', 'antigravity:false', 'http:true']);
  });
});

describe('OXB-148: claude -p failure reasons come from stdout, classified', () => {
  let tmp: string;
  const shim = (body: string) => {
    const p = path.join(tmp, `fail-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(p, `process.stdin.resume(); process.stdin.on('end', () => { ${body} }); process.stdin.on('data', () => {});`, 'utf8');
    return new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [p], parseRetries: 0 });
  };
  const call = (a: ClaudeCliAdapter) => a.createCompletion()({ baseUrl: '', apiKey: '', model: '', messages: [{ role: 'user', content: 'x' }], tools: [] } as any);

  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-adapter-fail-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('exit 1 with empty stderr: the JSON stdout reason (subtype, result) is in the error, prompt-too-long is `context`', async () => {
    const a = shim(`process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Prompt is too long', total_cost_usd: 0.21 })); process.exit(1);`);
    await assert.rejects(call(a), (err: any) => {
      assert.equal(err.kind, 'context');
      assert.equal(err.costUsd, 0.21);
      assert.match(err.message, /claude exit 1 · subtype=error_during_execution · result=Prompt is too long · prompt=\d+ chars/);
      return true;
    });
  });

  test('a usage limit is `quota`; max turns is `llm`; anything else stays `env` with the stdout tail', async () => {
    await assert.rejects(call(shim(`process.stdout.write(JSON.stringify({ is_error: true, result: 'Claude AI usage limit reached|1762650000' })); process.exit(1);`)), (e: any) => e.kind === 'quota');
    await assert.rejects(call(shim(`process.stdout.write(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: '' })); process.exit(1);`)), (e: any) => e.kind === 'llm');
    await assert.rejects(call(shim(`process.stdout.write('boom: not json'); process.exit(1);`)), (e: any) => e.kind === 'env' && /stdout=boom: not json/.test(e.message));
  });

  test('the executor records the class and the cost of the failed call', async () => {
    const a = shim(`process.stdout.write(JSON.stringify({ is_error: true, result: 'Prompt is too long', total_cost_usd: 0.05 })); process.exit(1);`);
    const events: LlmExecutorEvent[] = [];
    const ex = new LlmTaskExecutor(provider, null, (e) => events.push(e), a.createCompletion());
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(res.failure_class, 'context');
    const usage = events.find((e) => e.type === 'executor_usage');
    assert.equal((usage as any).detail.cost_usd, 0.05);
  });
});

describe('OXB-153: a claude call that times out continues the same attempt', () => {
  let tmp: string;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-adapter-timeout-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('1st call hangs past timeoutMs; the 2nd answers finish_task: success in ONE attempt, with a turn_timeout event', async () => {
    const counter = path.join(tmp, 'calls.txt');
    const shim = path.join(tmp, 'slow.js');
    // first call never answers in time; next calls finish the task (the bridge expects {"content","tool_calls"} JSON in result)
    fs.writeFileSync(shim, `
const fs=require('fs');const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;fs.writeFileSync(${JSON.stringify(counter)},String(n));
process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{
  if(n===1){setTimeout(()=>{},60000);return;}
  const reply=JSON.stringify({content:'ok',tool_calls:[{name:'finish_task',arguments:{summary:'done'}}]});
  process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:reply,total_cost_usd:0.01}));
});`, 'utf8');
    const a = new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], timeoutMs: 2000 }); // 400 ms flaked under a loaded full suite: the 2nd (answering) call also timed out
    const events: LlmExecutorEvent[] = [];
    const ex = new LlmTaskExecutor({ ...provider, maxTurns: 4 }, null, (e) => events.push(e), a.createCompletion());
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(res.success, true, res.output);
    assert.equal(res.completed_by, 'finish_task');
    const t = events.filter((e) => e.type === 'turn_timeout');
    assert.equal(t.length, 1);
    assert.equal((t[0] as any).detail.retry, 1);
  });

  test('timeouts in a row beyond the limit fail the attempt as `timeout` (not `env`)', async () => {
    const shim = path.join(tmp, 'always-slow.js');
    fs.writeFileSync(shim, `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{setTimeout(()=>{},60000)});`, 'utf8');
    const a = new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], timeoutMs: 300 });
    const ex = new LlmTaskExecutor({ ...provider, maxTurns: 4 }, null, null, a.createCompletion());
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const res = await ex.execute(node([{ type: 'generate_patch', targets: ['out.txt'] }]), lease(ws), 'run-1', 1);
    assert.equal(res.success, false);
    assert.equal(res.failure_class, 'timeout');
    assert.match(res.output, /claude -p excedeu 300 ms/);
  });
});
