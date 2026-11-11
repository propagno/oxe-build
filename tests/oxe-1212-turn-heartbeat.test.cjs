'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../lib/runtime/index.js');
const { LlmTaskExecutor } = require('../lib/runtime/executor/llm-task-executor');

// 1.21.2 — rc.39: the claude adapter is not forced onto the http default model; OXB-186: turn heartbeat,
// slow-turn report and the no-progress guard.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-hb-')); dirs.push(d); return d; };

// a claude -p stand-in that logs its argv and either reads forever or writes then finishes
const SHIM = `
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (shim)'); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.OXE_SHIM_ARGV, JSON.stringify(args) + '\\n');
  const mode = process.env.OXE_SHIM_MODE;
  const result = mode === 'read'
    ? JSON.stringify({ content: 'ainda lendo o código…', tool_calls: [{ name: 'glob', arguments: { pattern: '**/*' } }] })
    : mode === 'run_cmd_dir'
      ? input.includes('TOOL RESULT (run_command')
        ? JSON.stringify({ content: 'ok', tool_calls: [{ name: 'finish_task', arguments: { summary: 'feito' } }] })
        : JSON.stringify({ content: '', tool_calls: [{ name: 'run_command', arguments: { command: 'node -e "const fs=require(\\\'fs\\\');fs.mkdirSync(\\\'generated/sub\\\',{recursive:true});fs.writeFileSync(\\\'generated/sub/Client.kt\\\',\\\'package gen\\\')"' } }] })
      : mode === 'run_cmd'
      ? input.includes('TOOL RESULT (run_command')
        ? JSON.stringify({ content: 'ok', tool_calls: [{ name: 'finish_task', arguments: { summary: 'feito' } }] })
        : JSON.stringify({ content: '', tool_calls: [{ name: 'run_command', arguments: { command: 'node -e "require(\\\'fs\\\').writeFileSync(\\\'a.txt\\\', \\\'gen\\\')"' } }] })
      : input.includes('TOOL RESULT (write_file')
        ? JSON.stringify({ content: 'ok', tool_calls: [{ name: 'finish_task', arguments: { summary: 'feito' } }] })
        : JSON.stringify({ content: '', tool_calls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] });
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0.01 }));
});
`;

function setup(mode) {
  const dir = tmp();
  const shim = path.join(dir, 'shim.cjs');
  fs.writeFileSync(shim, SHIM);
  const argvLog = path.join(dir, 'argv.ndjson');
  process.env.OXE_SHIM_ARGV = argvLog;
  process.env.OXE_SHIM_MODE = mode;
  const adapter = runtime.createExecutorAdapter('claude', { claude: { command: process.execPath, prefixArgs: [shim] } });
  const node = { id: 'T1', title: 't', mutation_scope: ['a.txt'], actions: [{ type: 'custom', command: null, targets: [] }], verify: { must_pass: [], command: null }, workspace_strategy: 'inplace', policy: { max_retries: 0, requires_human_approval: false } };
  const lease = { root_path: dir, workspace_id: 'w', strategy: 'inplace' };
  return { dir, argvLog, adapter, node, lease };
}
const argvs = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('rc.39: claude adapter model', () => {
  it('without an attempt model, claude -p gets NO --model (the CLI default), even with the http default in provider.model', async () => {
    const s = setup('write');
    const ex = new LlmTaskExecutor({ model: 'claude-sonnet-4-6', maxTurns: 5 }, null, null, s.adapter.createCompletion(), { contextProvider: null });
    const r = await ex.execute(s.node, s.lease, 'r', 1, {});
    assert.equal(r.success, true, r.output);
    for (const a of argvs(s.argvLog)) assert.ok(!a.includes('--model'), JSON.stringify(a));
  });

  it('a tier/override model of the attempt is passed as --model', async () => {
    const s = setup('write');
    const ex = new LlmTaskExecutor({ model: 'claude-sonnet-4-6', maxTurns: 5 }, null, null, s.adapter.createCompletion(), { contextProvider: null });
    await ex.execute(s.node, s.lease, 'r', 2, { model: 'tier-balanced-model' });
    const a = argvs(s.argvLog)[0];
    assert.equal(a[a.indexOf('--model') + 1], 'tier-balanced-model');
  });
});

describe('OXB-186: turn heartbeat and no-progress guard', () => {
  it('8 turns without a write or finish_task end the attempt as no_progress; every turn emits a heartbeat with the prompt size', async () => {
    const s = setup('read');
    const events = [];
    const ex = new LlmTaskExecutor({ model: 'x', maxTurns: 60 }, null, (e) => events.push(e), s.adapter.createCompletion(), { contextProvider: null, slowTurnMs: 1 });
    const r = await ex.execute(s.node, s.lease, 'r', 1, {});
    assert.equal(r.failure_class, 'no_progress');
    assert.match(r.output, /^no_progress: 8 turnos seguidos sem escrever arquivo nem chamar finish_task \(turno 8\/60/);
    assert.match(r.output, /ainda lendo o código/);
    const beats = events.filter((e) => e.type === 'executor_turn');
    assert.equal(beats.length, 8);
    assert.deepEqual([beats[0].detail.turn, beats[0].detail.max_turns, beats[0].detail.files_written], [1, 60, 0]);
    assert.ok(beats[7].detail.prompt_chars > beats[0].detail.prompt_chars);
    assert.ok(events.some((e) => e.type === 'executor_slow_turn' && e.detail.prompt_chars > 0), 'slow turns reported with the prompt size');
  });

  it('a write resets the count; 0 disables the guard', async () => {
    const s = setup('write');
    const ex = new LlmTaskExecutor({ model: 'x', maxTurns: 10 }, null, null, s.adapter.createCompletion(), { contextProvider: null, noProgressTurns: 1 });
    const r = await ex.execute(s.node, s.lease, 'r', 1, {});
    assert.equal(r.success, true, r.output);
    const s2 = setup('read');
    const ex2 = new LlmTaskExecutor({ model: 'x', maxTurns: 10 }, null, null, s2.adapter.createCompletion(), { contextProvider: null, noProgressTurns: 0 });
    const r2 = await ex2.execute(s2.node, s2.lease, 'r', 1, {});
    assert.equal(r2.failure_class, 'turns_exhausted');
  });

  it('OXB-196: run_command that modifies a file in scope resets no_progress_turns and counts files_written', async () => {
    const s = setup('run_cmd');
    const events = [];
    const ex = new LlmTaskExecutor({ model: 'x', maxTurns: 10 }, null, (e) => events.push(e), s.adapter.createCompletion(), { contextProvider: null, noProgressTurns: 1 });
    const r = await ex.execute(s.node, s.lease, 'r', 1, {});
    assert.equal(r.success, true, r.output);
    const beats = events.filter((e) => e.type === 'executor_turn');
    assert.ok(beats.length >= 1);
    assert.ok(beats.some((b) => b.detail.files_written > 0), 'files_written counted from run_command file modification');
    assert.equal(fs.readFileSync(path.join(s.dir, 'a.txt'), 'utf8'), 'gen');
  });

  it('OXB-196: run_command that creates a brand-new file under an in-scope directory or glob resets no_progress_turns and counts files_written', async () => {
    for (const scopeEntry of ['generated', 'generated/**']) {
      const s = setup('run_cmd_dir');
      s.node.mutation_scope = [scopeEntry];
      const events = [];
      const ex = new LlmTaskExecutor({ model: 'x', maxTurns: 10 }, null, (e) => events.push(e), s.adapter.createCompletion(), { contextProvider: null, noProgressTurns: 1 });
      const r = await ex.execute(s.node, s.lease, 'r', 1, {});
      assert.equal(r.success, true, `${scopeEntry}: ${r.output}`);
      const beats = events.filter((e) => e.type === 'executor_turn');
      assert.ok(beats.some((b) => b.detail.files_written === 1), `${scopeEntry}: files_written counted new nested file`);
      const usageEvt = events.find((e) => e.type === 'executor_usage');
      assert.ok(usageEvt.detail.writes.includes('generated/sub/Client.kt'), `${scopeEntry}: recorded exact generated relative path`);
    }
  });
});
