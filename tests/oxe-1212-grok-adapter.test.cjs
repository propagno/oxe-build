'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const grokProvider = require('../bin/lib/oxe-provider-grok.cjs');
const modelResolve = require('../bin/lib/oxe-model-resolve.cjs');
const runtime = require('../lib/runtime/index.js');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function makeProject(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-grok-'));
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

describe('adapter grok', () => {
  it('normaliza o id, resolve o modelo e monta os args sem pôr o prompt no argv', () => {
    assert.equal(runtime.normalizeExecutorAdapterId('grok'), 'grok');
    assert.equal(runtime.EXECUTOR_ADAPTER_IDS.includes('grok'), true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-grok-cfg-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    op.saveRuntimeProviderConfig(dir, { name: 'grok', model: 'grok-4' });
    const persisted = op.loadRuntimeProviderConfig(dir);
    assert.equal(persisted.adapter, 'grok');
    assert.equal(persisted.name, 'grok');
    assert.equal(persisted.baseUrl, undefined);
    const resolved = grokProvider.resolveGrokOptions({ persisted, cwd: dir, env: {} });
    assert.equal(resolved.model, 'grok-4');
    assert.equal(resolved.cwd, dir);
    const model = modelResolve.resolve({ adapter: 'grok', persisted, env: {} });
    assert.equal(model.model, 'grok-4');
    const args = runtime.buildGrokArgs(path.join(dir, 'prompt.txt'), { model: 'grok-4', cwd: dir });
    assert.equal(args.includes('--prompt-file'), true);
    assert.equal(args.includes('-p'), false);
    assert.equal(args.includes('--output-format'), true);
    assert.equal(args.includes('json'), true);
    assert.equal(args.includes('--max-turns'), true);
    assert.equal(args.includes('--json-schema'), true);
    const denied = args[args.indexOf('--disallowed-tools') + 1];
    assert.match(denied, /(^|,)read_file(,|$)/);
    assert.match(denied, /(^|,)grep(,|$)/);
    assert.match(denied, /(^|,)list_dir(,|$)/);
    assert.match(denied, /(^|,)search_tool(,|$)/);
    assert.match(denied, /(^|,)use_tool(,|$)/);
    assert.match(denied, /(^|,)todo_write(,|$)/);
    const bridge = { content: 'ok', tool_calls: [{ name: 'read_file', arguments: { path: 'a' } }] };
    const salvaged = runtime.grokTurnOutcome({
      code: 1,
      stdout: JSON.stringify({ text: JSON.stringify(bridge), stopReason: 'max_turn_requests', total_cost_usd: 0.01 }),
      stderr: 'Error: max turns reached',
      promptChars: 100,
    });
    assert.equal(salvaged.ok, true);
    assert.equal(JSON.parse(salvaged.text).tool_calls[0].name, 'read_file');
    assert.equal(salvaged.costUsd, 0.01);
    const bare = runtime.grokTurnOutcome({
      code: 1,
      stdout: JSON.stringify({ text: '', stopReason: 'max_turn_requests' }),
      stderr: 'Error: max turns reached',
      promptChars: 100,
    });
    assert.equal(bare.ok, false);
    assert.match(bare.error.message, /stopReason=max_turn_requests/);
    assert.match(bare.error.message, /stderr=Error: max turns reached/);
    const refusal = runtime.grokTurnOutcome({
      code: 1,
      stdout: JSON.stringify({ text: JSON.stringify(bridge), stopReason: 'refusal' }),
      stderr: '',
    });
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error.kind, 'policy');
    const structured = runtime.grokBridgeText({
      text: 'prose',
      structuredOutput: { content: 'ok', tool_calls: [{ name: 'read_file', arguments: { path: 'a' } }] },
    });
    assert.equal(JSON.parse(structured).tool_calls[0].name, 'read_file');
    assert.equal(args[args.indexOf('--model') + 1], 'grok-4');
    const env = runtime.parseGrokStdout('{"text":"{\\"content\\":\\"ok\\",\\"tool_calls\\":[]}","stopReason":"end_turn","total_cost_usd":0.01}\n');
    assert.equal(env.stopReason, 'end_turn');
    assert.equal(env.total_cost_usd, 0.01);
    const quota = runtime.grokFailure({ code: 1, stdout: '', stderr: '', envelope: { type: 'error', message: 'quota exhausted' } });
    assert.equal(quota.kind, 'quota');
  });

  it('CLI: --adapter desconhecido cita grok entre os adapters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-grok-cli-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}\n');
    const unknown = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--adapter', 'nope', '--dir', dir], { encoding: 'utf8' });
    assert.equal(unknown.status, 1);
    assert.match(`${unknown.stdout}\n${unknown.stderr}`, /use claude, antigravity, grok ou http/);
  });

  it('executa um turno de ponte: prompt em arquivo, tools no runtime, XAI_API_KEY segue e o token do OXESpace não', async () => {
    const stateFile = path.join(os.tmpdir(), `oxe-grok-shim-${process.pid}-${Date.now()}.json`);
    const shimJs = path.join(os.tmpdir(), `oxe-grok-shim-${process.pid}.js`);
    fs.writeFileSync(shimJs, `'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('grok-test 0.0.0\\n'); process.exit(0); }
const fileIdx = argv.indexOf('--prompt-file');
const prompt = fileIdx >= 0 ? fs.readFileSync(argv[fileIdx + 1], 'utf8') : '';
const statePath = ${JSON.stringify(stateFile)};
const prev = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [];
const turn = prev.length + 1;
const mIdx = argv.indexOf('--model');
prev.push({
  turn,
  argv,
  model: mIdx >= 0 ? argv[mIdx + 1] : null,
  promptHasBridge: prompt.includes('AVAILABLE TOOLS'),
  promptOnArgv: argv.includes('-p'),
  xaiKey: process.env.XAI_API_KEY || null,
  leakedOxespace: process.env.OXESPACE_MCP_TOKEN || null,
});
fs.writeFileSync(statePath, JSON.stringify(prev, null, 2));
const reply = turn === 1
  ? { content: 'updating hello.js', tool_calls: [{ name: 'write_file', arguments: { path: 'src/hello.js', content: 'module.exports = "grok-ok";\\n' } }] }
  : { content: 'done', tool_calls: [{ name: 'finish_task', arguments: { summary: 'updated hello.js via grok' } }] };
process.stdout.write(JSON.stringify({ text: JSON.stringify(reply), stopReason: 'end_turn', total_cost_usd: 0.002, sessionId: 'g-' + turn }));
`, 'utf8');

    const dir = makeProject(
      [
        {
          id: 'T1',
          title: 'Update hello via grok',
          wave: 1,
          files: ['src/hello.js'],
          acceptance: ['A1'],
          verify: { commands: ['node -e "const v = require(\'./src/hello.js\'); if (v !== \'grok-ok\') process.exit(1);"'] },
        },
      ],
      { runtime: { provider: { name: 'grok', model: 'grok-4' } } },
    );

    const prevKey = process.env.XAI_API_KEY;
    const prevLeak = process.env.OXESPACE_MCP_TOKEN;
    process.env.XAI_API_KEY = 'xai-test-credential';
    process.env.OXESPACE_MCP_TOKEN = 'secret-live-token-should-not-leak';
    try {
      const res = await op.runRuntimeExecute(dir, null, {
        skipPreflight: true,
        adapter: 'grok',
        adapterOptions: {
          command: process.execPath,
          prefixArgs: [shimJs],
          model: 'grok-4',
        },
      });
      assert.equal(res.result.status, 'completed');
      assert.deepEqual(res.result.completed, ['T1']);
      assert.equal(fs.readFileSync(path.join(dir, 'src/hello.js'), 'utf8'), 'module.exports = "grok-ok";\n');
      const calls = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.equal(calls.length, 2);
      assert.equal(calls[0].model, 'grok-4');
      assert.equal(calls[0].promptHasBridge, true);
      assert.equal(calls[0].promptOnArgv, false);
      assert.ok(calls[0].argv.includes('--prompt-file'));
      assert.ok(calls[0].argv.includes('--output-format'));
      assert.equal(calls[0].xaiKey, 'xai-test-credential');
      assert.equal(calls[0].leakedOxespace, null);
      const usage = op.readEvents(dir, null).find((e) => e.type === 'ExecutorUsage' && e.work_item_id === 'T1');
      assert.equal(usage.payload.adapter, 'grok');
      assert.equal(usage.payload.turns, 2);
      const left = fs.readdirSync(path.join(dir, '.oxe', 'tmp')).filter((name) => name.startsWith('grok-bridge-'));
      assert.equal(left.length, 0);
    } finally {
      if (prevKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = prevKey;
      if (prevLeak === undefined) delete process.env.OXESPACE_MCP_TOKEN; else process.env.OXESPACE_MCP_TOKEN = prevLeak;
      fs.rmSync(shimJs, { force: true });
      fs.rmSync(stateFile, { force: true });
    }
  });
});
