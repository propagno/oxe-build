'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.18: `runtime execute --adapter claude` roda `claude -p` por turno, sem ponte HTTP nem API key,
// com o contexto do nó (tarefa do PLAN, IMPLEMENTATION-PACK, workspace) no prompt.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

const SHIM = `
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (shim)'); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  if (process.env.OXE_SHIM_LOG) fs.appendFileSync(process.env.OXE_SHIM_LOG, JSON.stringify({ prompt: input }) + '\\n');
  const result = input.includes('TOOL RESULT (write_file')
    ? JSON.stringify({ content: 'ok', tool_calls: [{ name: 'finish_task', arguments: { summary: 'src/a.js criado' } }] })
    : JSON.stringify({ content: '', tool_calls: [{ name: 'write_file', arguments: { path: 'src/a.js', content: 'module.exports = 1;\\n' } }] });
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0.25 }));
});
`;

const SPEC = `# OXE — SPEC

## Objetivo

Fixture do adapter claude.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | Processo termina com 0 | \`node -e "process.exit(0)"\` |
`;

const PLAN = `# OXE — PLAN

## Resumo

Uma tarefa.

### T1 — Criar módulo a

- **Arquivos alvo:** \`src/a.js\`
- **Depende de:** —
- **Onda:** 1
- **Implementar:** exportar a constante 1 (marcador-do-corpo-da-tarefa)
- **Verificar:**
  - Comando: \`node -e "process.exit(0)"\`
- **Aceite vinculado:** A1

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 95%
`;

function makeProject(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# OXE — STATE\n\n- **phase:** plan_ready\n', 'utf8');
  fs.writeFileSync(
    path.join(tmp, '.oxe', 'IMPLEMENTATION-PACK.json'),
    JSON.stringify({ tasks: [{ id: 'T1', mode: 'mutating', exact_paths: ['src/a.js'], symbols: [{ name: 'contrato-simbolo-a' }] }] }),
    'utf8'
  );
  return tmp;
}

/** Executável que o PATH/OXE_CLAUDE_BIN resolveria: .cmd no Windows, script sh no posix. */
function writeShimExecutable(dir, shimJs) {
  if (process.platform === 'win32') {
    const file = path.join(dir, 'claude.cmd');
    fs.writeFileSync(file, `@"${process.execPath}" "${shimJs}" %*\r\n`, 'utf8');
    return file;
  }
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${shimJs}" "$@"\n`, 'utf8');
  fs.chmodSync(file, 0o755);
  return file;
}

describe('runtime execute com adapter claude (claude -p por turno)', () => {
  const dirs = [];
  let shimDir;
  let shimJs;
  let logPath;

  before(() => {
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-claude-shim-'));
    dirs.push(shimDir);
    shimJs = path.join(shimDir, 'shim.js');
    logPath = path.join(shimDir, 'calls.ndjson');
    fs.writeFileSync(shimJs, SHIM, 'utf8');
    process.env.OXE_SHIM_LOG = logPath;
  });

  after(() => {
    delete process.env.OXE_SHIM_LOG;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('executa sem API key, injeta o contexto do nó e registra ExecutorUsage', async () => {
    const tmp = makeProject('oxe-adapter-run-');
    dirs.push(tmp);
    const res = await op.runRuntimeExecute(tmp, null, {
      adapter: 'claude',
      adapterOptions: { command: process.execPath, prefixArgs: [shimJs] },
      providerConfig: { maxTurns: 4 },
      skipPreflight: true,
    });
    assert.equal(res.result.status, 'completed', JSON.stringify(res.result));
    assert.equal(fs.readFileSync(path.join(tmp, 'src', 'a.js'), 'utf8'), 'module.exports = 1;\n');

    const prompts = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l).prompt);
    assert.match(prompts[0], /## Tarefa no PLAN/);
    assert.match(prompts[0], /marcador-do-corpo-da-tarefa/);
    assert.match(prompts[0], /contrato-simbolo-a/);
    assert.match(prompts[0], /`src\/a\.js` — não existe ainda/);

    const usage = op.readEvents(tmp, null).filter((e) => e.type === 'ExecutorUsage');
    assert.equal(usage.length, 1);
    assert.equal(usage[0].work_item_id, 'T1');
    assert.equal(usage[0].payload.adapter, 'claude');
    assert.equal(usage[0].payload.turns, 2);
    assert.equal(usage[0].payload.cost_usd, 0.5);

    op.projectRuntimeArtifacts(tmp, null, { write: true });
    const summaryPath = path.join(tmp, '.oxe', 'execution', 'RUN-SUMMARY.md');
    const summary = fs.existsSync(summaryPath)
      ? fs.readFileSync(summaryPath, 'utf8')
      : fs.readFileSync(path.join(tmp, '.oxe', 'RUN-SUMMARY.md'), 'utf8');
    assert.match(summary, /### Executor usage/);
    assert.match(summary, /\| T1 \| 1 \| 2 \| 2 \| \$0\.50 \|/);
  });

  it('CLI: sem API key e com claude instalado, execute escolhe o adapter claude', () => {
    const tmp = makeProject('oxe-adapter-cli-');
    dirs.push(tmp);
    const bin = writeShimExecutable(shimDir, shimJs);
    const env = { ...process.env, OXE_CLAUDE_BIN: bin, NO_COLOR: '1' };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.OXE_BASE_URL;

    const providers = spawnSync(process.execPath, [CLI, 'runtime', 'providers', '--json', '--dir', tmp], { env, encoding: 'utf8' });
    const json = JSON.parse(providers.stdout.slice(providers.stdout.indexOf('{')));
    const claude = json.adapters.find((a) => a.id === 'claude');
    assert.equal(claude.available, true, claude.error);
    assert.equal(claude.version, '9.9.9 (shim)');

    const run = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--dir', tmp], { env, encoding: 'utf8', timeout: 120000 });
    const out = `${run.stdout}\n${run.stderr}`;
    assert.match(out, /Adapter:\s*claude/);
    assert.doesNotMatch(out, /executor LLM não configurado/);
  });

  it('CLI: --adapter http sem API key continua exigindo a chave', () => {
    const tmp = makeProject('oxe-adapter-http-');
    dirs.push(tmp);
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    const run = spawnSync(process.execPath, [CLI, 'runtime', 'execute', '--adapter', 'http', '--dir', tmp], { env, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /executor LLM não configurado/);
  });
});
