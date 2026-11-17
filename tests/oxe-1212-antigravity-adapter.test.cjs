'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const agyProvider = require('../bin/lib/oxe-provider-antigravity.cjs');
const modelResolve = require('../bin/lib/oxe-model-resolve.cjs');

// 1.21.2 — OXB-197: Antigravity CLI (`agy`) execution adapter support in `oxe-cc`.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function makeProject(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-agy-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({
    external_dependency_check: false,
    stub_check: false,
    checkpoint_commits: false,
    ...config,
  }, null, 2));
  write(dir, '.oxe/PLAN.json', JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    budget: { max_retries: 1 },
    tasks,
  }, null, 2));
  write(dir, 'src/hello.js', 'module.exports = "old";\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-197: Antigravity CLI (`agy`) execution adapter', () => {
  it('supports runtime.provider.name: "antigravity" in .oxe/config.json and resolves models cleanly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-agy-cfg-'));
    dirs.push(dir);
    write(dir, '.oxe/config.json', JSON.stringify({
      runtime: {
        provider: {
          name: 'antigravity',
          model: 'gemini-3.1-pro',
        },
      },
    }, null, 2));

    const loaded = op.loadRuntimeProviderConfig(dir);
    assert.equal(loaded.name, 'antigravity');
    assert.equal(loaded.adapter, 'antigravity');
    assert.equal(loaded.model, 'gemini-3.1-pro');

    const resolved = modelResolve.resolve({ adapter: loaded.adapter, persisted: loaded, env: {} });
    assert.equal(resolved.adapter, 'antigravity');
    assert.equal(resolved.model, 'gemini-3.1-pro');
    assert.equal(resolved.source, 'runtime.provider.model');
    assert.equal(resolved.operator_chosen, true);

    const resolvedDefault = modelResolve.resolve({ adapter: 'agy', persisted: { name: 'antigravity' }, env: {} });
    assert.equal(resolvedDefault.adapter, 'antigravity');
    assert.equal(resolvedDefault.model, null);
    assert.match(resolvedDefault.source, /Antigravity CLI/);
  });

  it('parses NDJSON stream-json events, tool_call events, structured_output and usage from agy CLI', () => {
    const streamStdout = [
      JSON.stringify({ type: 'init', conversation_id: 'conv-123' }),
      JSON.stringify({ type: 'step_update', state: 'ACTIVE', message: 'Inspecting files' }),
      JSON.stringify({ type: 'step_update', state: 'DONE', message: 'Ready' }),
      JSON.stringify({
        status: 'SUCCESS',
        response: JSON.stringify({
          content: 'writing file',
          tool_calls: [{ name: 'write_file', arguments: { path: 'src/hello.js', content: 'ok' } }],
        }),
        num_turns: 1,
        duration_seconds: 1.4,
        usage: { input_tokens: 420, output_tokens: 85, thinking_tokens: 30, total_tokens: 535, cost_usd: 0.012 },
      }),
    ].join('\n');

    const parsed = agyProvider.parseAntigravityEvents(streamStdout);
    assert.equal(parsed.conversationId, 'conv-123');
    assert.equal(parsed.steps.length, 2);
    assert.equal(parsed.isError, false);
    assert.equal(parsed.usage.promptTokens, 420);
    assert.equal(parsed.usage.completionTokens, 85);
    assert.equal(parsed.usage.thinkingTokens, 30);
    assert.equal(parsed.usage.costUsd, 0.012);
    assert.match(parsed.responseText, /write_file/);

    // Also supports explicit tool_call NDJSON lines + structured_output
    const toolStream = [
      JSON.stringify({ type: 'init', conversation_id: 'conv-456' }),
      JSON.stringify({ type: 'tool_call', id: 'tc-1', name: 'read_file', arguments: { path: 'src/hello.js' } }),
      JSON.stringify({ status: 'SUCCESS', response: '', structured_output: { content: 'reading' } }),
    ].join('\n');
    const parsedTools = agyProvider.parseAntigravityEvents(toolStream);
    assert.equal(parsedTools.toolCalls.length, 1);
    assert.equal(parsedTools.toolCalls[0].function.name, 'read_file');
    assert.equal(parsedTools.toolCalls[0].function.arguments, '{"path":"src/hello.js"}');

    // Classifies RESOURCE_EXHAUSTED / 429 from agy as quota
    const errStream = JSON.stringify({ status: 'ERROR', error: '429 RESOURCE_EXHAUSTED: You have exhausted your capacity on this model.' });
    const parsedErr = agyProvider.parseAntigravityEvents(errStream);
    assert.equal(parsedErr.isError, true);
    const failure = agyProvider.agyFailure({ code: 1, stdout: errStream, stderr: '', parsed: parsedErr });
    assert.equal(failure.kind, 'quota');
  });

  it('executes multi-turn task via `agy -p` / `--model`, forwards allowed env, scrubs live tokens, and emits ExecutorTurn heartbeats', async () => {
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-agy-shim-'));
    dirs.push(shimDir);
    const stateFile = path.join(shimDir, 'calls.json');
    const shimJs = path.join(shimDir, 'agy-shim.cjs');

    fs.writeFileSync(shimJs, `'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  process.stdout.write('1.5.5\\n');
  process.exit(0);
}
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdinData += c; });
process.stdin.on('end', () => {
  const statePath = ${JSON.stringify(stateFile)};
  const prev = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [];
  const pIdx = argv.indexOf('-p');
  const promptArg = pIdx >= 0 ? argv[pIdx + 1] : '';
  const mIdx = argv.indexOf('--model');
  const modelArg = mIdx >= 0 ? argv[mIdx + 1] : null;
  const fullPrompt = stdinData ? (stdinData + '\\n' + promptArg) : promptArg;
  const turn = prev.length + 1;
  prev.push({
    turn,
    argv,
    model: modelArg,
    promptLen: fullPrompt.length,
    geminiKey: process.env.GEMINI_API_KEY || null,
    leakedOxespace: process.env.OXESPACE_MCP_TOKEN || null,
  });
  fs.writeFileSync(statePath, JSON.stringify(prev, null, 2));

  const reply = turn === 1
    ? { content: 'updating hello.js', tool_calls: [{ name: 'write_file', arguments: { path: 'src/hello.js', content: 'module.exports = "antigravity-ok";\\n' } }] }
    : { content: 'done', tool_calls: [{ name: 'finish_task', arguments: { summary: 'updated hello.js via agy' } }] };

  process.stdout.write(JSON.stringify({ type: 'init', conversation_id: 'agy-conv-' + turn }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'step_update', state: 'ACTIVE', message: 'Turn ' + turn }) + '\\n');
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: JSON.stringify(reply),
    num_turns: 1,
    usage: { input_tokens: 100 * turn, output_tokens: 40, cost_usd: 0.005 },
  }) + '\\n');
});
`, 'utf8');

    const dir = makeProject(
      [
        {
          id: 'T1',
          title: 'Update hello via agy',
          wave: 1,
          files: ['src/hello.js'],
          acceptance: ['A1'],
          verify: { commands: ['node -e "const v = require(\'./src/hello.js\'); if (v !== \'antigravity-ok\') process.exit(1);"'] },
        },
      ],
      {
        runtime: {
          provider: {
            name: 'antigravity',
            model: 'gemini-3.1-pro',
          },
        },
      },
    );

    const prevGemini = process.env.GEMINI_API_KEY;
    const prevLeak = process.env.OXESPACE_MCP_TOKEN;
    process.env.GEMINI_API_KEY = 'gem-test-credential-123';
    process.env.OXESPACE_MCP_TOKEN = 'secret-live-token-should-not-leak';

    try {
      const res = await op.runRuntimeExecute(dir, null, {
        skipPreflight: true,
        adapter: 'antigravity',
        adapterOptions: {
          command: process.execPath,
          prefixArgs: [shimJs],
          model: 'gemini-3.1-pro',
        },
      });

      assert.equal(res.result.status, 'completed');
      assert.deepEqual(res.result.completed, ['T1']);
      assert.equal(fs.readFileSync(path.join(dir, 'src/hello.js'), 'utf8'), 'module.exports = "antigravity-ok";\n');

      const calls = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.equal(calls.length, 2, 'executed 2 turns (write_file -> finish_task)');
      assert.equal(calls[0].model, 'gemini-3.1-pro');
      assert.ok(calls[0].argv.includes('-p'), 'passed -p flag to agy');
      assert.ok(calls[0].argv.includes('stream-json'), 'requested stream-json output');
      assert.equal(calls[0].geminiKey, 'gem-test-credential-123', 'forwarded allowed provider credential env');
      assert.equal(calls[0].leakedOxespace, null, 'scrubbed OXESPACE_MCP_TOKEN');

      const events = op.readEvents(dir, null);
      const turnEvents = events.filter((e) => e.type === 'ExecutorTurn' && e.work_item_id === 'T1');
      assert.equal(turnEvents.length, 2, 'emitted ExecutorTurn heartbeats for both turns');
      assert.equal(turnEvents[0].payload.files_written, 1);

      const usageEvent = events.find((e) => e.type === 'ExecutorUsage' && e.work_item_id === 'T1');
      assert.ok(usageEvent, 'emitted ExecutorUsage event');
      assert.equal(usageEvent.payload.adapter, 'antigravity');
      assert.equal(usageEvent.payload.turns, 2);
    } finally {
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
      if (prevLeak === undefined) delete process.env.OXESPACE_MCP_TOKEN;
      else process.env.OXESPACE_MCP_TOKEN = prevLeak;
    }
  });

  it('OXB-C11: parses real agy.exe {event, <event>} nested NDJSON envelope, accumulates ev.result.usage, retries non-JSON reply, and executes end-to-end', async () => {
    const realStream = [
      JSON.stringify({
        event: 'init',
        conversation_id: 'real-agy-conv-1',
        init: { cwd: 'C:/repo', tools: ['read_file'], permission_mode: 'always-proceed' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: 'real-agy-conv-1',
          step_index: 1,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: '\n',
          duration_seconds: 2.13,
          usage: { input_tokens: 9434, output_tokens: 29, thinking_tokens: 24, cache_read_tokens: 0, total_tokens: 9463 },
        },
      }),
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: 'real-agy-conv-1',
          status: 'SUCCESS',
          response: 'OK\n',
          duration_seconds: 2.21,
          num_turns: 1,
          usage: { input_tokens: 9434, output_tokens: 29, thinking_tokens: 24, cache_read_tokens: 0, total_tokens: 9463 },
        },
      }),
    ].join('\n');

    const parsed = agyProvider.parseAntigravityEvents(realStream);
    assert.equal(parsed.conversationId, 'real-agy-conv-1');
    assert.equal(parsed.isError, false);
    assert.equal(parsed.responseText, 'OK\n');
    assert.equal(parsed.steps.length, 1);
    assert.equal(parsed.steps[0].state, 'DONE');
    assert.equal(parsed.usage.promptTokens, 9434);
    assert.equal(parsed.usage.completionTokens, 29);
    assert.equal(parsed.usage.thinkingTokens, 24);
    assert.equal(parsed.usage.totalTokens, 9463);

    // Nested error result envelope (`{ event: 'result', result: { status: 'ERROR', error: '...' } }`)
    const errNested = JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'real-agy-err',
        status: 'ERROR',
        error: '429 RESOURCE_EXHAUSTED: capacity exhausted',
        usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
      },
    });
    const parsedErr = agyProvider.parseAntigravityEvents(errNested);
    assert.equal(parsedErr.isError, true);
    assert.match(parsedErr.errorMessage || '', /429 RESOURCE_EXHAUSTED/);
    assert.equal(agyProvider.agyFailure({ code: 1, stdout: errNested, stderr: '', parsed: parsedErr }).kind, 'quota');

    // Adapter complete(): attempt 1 emits plain "OK\n" in nested result (triggers bridge retryHint), attempt 2 emits valid bridge JSON;
    // tokens from BOTH attempts accumulate via ev.result.usage
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c11-agy-real-'));
    dirs.push(shimDir);
    const shimJs = path.join(shimDir, 'real-agy-shim.cjs');
    const callsFile = path.join(shimDir, 'calls.json');
    fs.writeFileSync(shimJs, `'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('1.6.0\\n'); process.exit(0); }
const pIdx = argv.indexOf('-p');
const promptArg = pIdx >= 0 ? argv[pIdx + 1] : '';
const calls = fs.existsSync(${JSON.stringify(callsFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(callsFile)}, 'utf8')) : [];
const turn = calls.length + 1;
calls.push({ turn, hasRetryHint: /previous reply was not a valid JSON object/i.test(promptArg) });
fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
const resp = turn === 1
  ? 'OK\\n'
  : (turn === 2
    ? JSON.stringify({ content: 'writing', tool_calls: [{ name: 'write_file', arguments: { path: 'src/hello.js', content: 'module.exports = "real-agy-ok";\\n' } }] })
    : JSON.stringify({ content: 'done', tool_calls: [{ name: 'finish_task', arguments: { summary: 'done via real agy stream' } }] }));
process.stdout.write(JSON.stringify({ event: 'init', conversation_id: 'c-' + turn, init: { permission_mode: 'always-proceed' } }) + '\\n');
process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c-' + turn, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\\n', usage: { input_tokens: 1000, output_tokens: 20, thinking_tokens: 10, total_tokens: 1030 } } }) + '\\n');
process.stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: 'c-' + turn, status: 'SUCCESS', response: resp, num_turns: 1, usage: { input_tokens: 1000, output_tokens: 20, thinking_tokens: 10, total_tokens: 1030 } } }) + '\\n');
`, 'utf8');

    const adapter = agyProvider.createAntigravityAdapter({
      command: process.execPath,
      prefixArgs: [shimJs],
      parseRetries: 1,
    });
    const completion = await adapter.createCompletion()({
      baseUrl: '',
      apiKey: '',
      model: 'default',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    });
    assert.equal(completion.tool_calls.length, 1);
    assert.equal(completion.tool_calls[0].function.name, 'write_file');
    // 1000 input + 20 output + 10 thinking on turn 1 ("OK\n") + same on retry turn 2 = 2000 / 40 / 20
    assert.equal(completion.usage.input_tokens, 2000);
    assert.equal(completion.usage.output_tokens, 40);
    assert.equal(completion.usage.thinking_tokens, 20);
    const recordedCalls = JSON.parse(fs.readFileSync(callsFile, 'utf8'));
    assert.equal(recordedCalls[0].hasRetryHint, false);
    assert.equal(recordedCalls[1].hasRetryHint, true);

    // Non-JSON exhaustion still returns non-empty lastText + usage instead of empty response / $0
    const textOnlyAdapter = agyProvider.createAntigravityAdapter({
      command: process.execPath,
      prefixArgs: [shimJs],
      parseRetries: 0,
    });
    fs.unlinkSync(callsFile);
    const plainRes = await textOnlyAdapter.createCompletion()({
      baseUrl: '',
      apiKey: '',
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });
    assert.equal(plainRes.content, 'OK\n');
    assert.equal(plainRes.tool_calls.length, 0);
    assert.equal(plainRes.usage.input_tokens, 1000);
    assert.equal(plainRes.usage.output_tokens, 20);
    assert.equal(plainRes.usage.thinking_tokens, 10);

    // End-to-end `runtime execute --adapter antigravity` with real {event, <event>} NDJSON envelope
    fs.unlinkSync(callsFile);
    const e2eDir = makeProject([
      {
        id: 'T1',
        title: 'Run real agy envelope end-to-end',
        wave: 1,
        files: ['src/hello.js'],
        acceptance: ['A1'],
        verify: { commands: ['node -e "const v = require(\'./src/hello.js\'); if (v !== \'real-agy-ok\') process.exit(1);"'] },
      },
    ]);
    const e2eRes = await op.runRuntimeExecute(e2eDir, null, {
      skipPreflight: true,
      adapter: 'antigravity',
      adapterOptions: {
        command: process.execPath,
        prefixArgs: [shimJs],
        parseRetries: 1,
      },
    });
    assert.equal(e2eRes.result.status, 'completed');
    assert.equal(fs.readFileSync(path.join(e2eDir, 'src/hello.js'), 'utf8'), 'module.exports = "real-agy-ok";\n');
    const e2eUsage = op.readEvents(e2eDir, null).find((e) => e.type === 'ExecutorUsage' && e.work_item_id === 'T1');
    assert.ok(e2eUsage);
    assert.equal(e2eUsage.payload.adapter, 'antigravity');
    assert.ok(e2eUsage.payload.input_tokens >= 3000, `expected accumulated input_tokens >= 3000, got ${e2eUsage.payload.input_tokens}`);

    // Compiled lib/runtime must be in sync with packages/runtime/src
    const srcTs = fs.readFileSync(path.resolve(__dirname, '../packages/runtime/src/executor/adapters/antigravity-cli.ts'), 'utf8');
    const compiledJs = fs.readFileSync(path.resolve(__dirname, '../lib/runtime/executor/adapters/antigravity-cli.js'), 'utf8');
    assert.ok(srcTs.includes('extractErrorString') && compiledJs.includes('extractErrorString'), 'lib/runtime must match compiled TypeScript source');
  });
});
