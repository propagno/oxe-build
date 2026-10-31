#!/usr/bin/env node
'use strict';

/**
 * e2e "linkly-class" com oráculo independente.
 *
 * Reproduz o fluxo compile → execute → verify do runtime sobre um projeto Node pequeno e
 * compara o veredito do OXE com um oráculo que não depende do OXE (os testes do fixture
 * rodados diretamente + existência dos arquivos-alvo). O KPI é a taxa de falso verde: o OXE
 * dizer "passed" quando o oráculo falha. Foi exatamente o que aconteceu no e2e real de
 * 2026-10-30 (T6 "verificada" sem `test/api.test.js`; `runtime verify` 18/18 passed).
 *
 * Modos:
 *   --mock (padrão, determinístico — roda no `npm test`)
 *   --real [--adapter claude|http] [--model <m>]  modelo real dirigindo `runtime execute`; mede
 *          tentativas, turnos, custo e `run_command` por tarefa (KPIs da 1.18). `http` usa
 *          ANTHROPIC_API_KEY/OPENAI_API_KEY e OXE_BASE_URL.
 *   --oracle <dir>  reaplica o oráculo de referência a um projeto mantido com --keep
 *   --keep  mantém os diretórios temporários para inspeção
 *
 * Saída: .oxe/release/e2e-linkly-report.json (mock) ou e2e-linkly-real-report.json (real);
 * OXE_RELEASE_PROJECT_ROOT sobrescreve a raiz.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const REPORT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT) : REPO_ROOT;
const KEEP = process.argv.includes('--keep');
const REAL = process.argv.includes('--real');
const REPORT_PATH = path.join(REPORT_ROOT, '.oxe', 'release', REAL ? 'e2e-linkly-real-report.json' : 'e2e-linkly-report.json');

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ─── Fixture: encurtador mínimo (3 tarefas, 2 ondas) ─────────────────────────

const TASKS = [
  {
    id: 'T1',
    wave: 1,
    title: 'Validação de URL',
    goal: 'Criar src/validate.js exportando validateUrl(input): true só para URLs http/https válidas; e test/validate.test.js (node:test) com casos [A1].',
    files: ['src/validate.js', 'test/validate.test.js'],
    test: 'test/validate.test.js',
    aceite: 'A1',
    criterion: 'URL http/https válida é aceita, outras rejeitadas',
    source: {
      'src/validate.js': "'use strict';\nfunction validateUrl(input) {\n  try {\n    const u = new URL(String(input));\n    return u.protocol === 'http:' || u.protocol === 'https:';\n  } catch { return false; }\n}\nmodule.exports = { validateUrl };\n",
      'test/validate.test.js': "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst { validateUrl } = require('../src/validate.js');\ntest('[A1] aceita https', () => assert.equal(validateUrl('https://a.b'), true));\ntest('[A1] rejeita ftp', () => assert.equal(validateUrl('ftp://a.b'), false));\n",
    },
  },
  {
    id: 'T2',
    wave: 1,
    title: 'Gerador de códigos',
    goal: 'Criar src/code.js exportando newCode(): string de 6 caracteres base62; e test/code.test.js (node:test) com caso [A2].',
    files: ['src/code.js', 'test/code.test.js'],
    test: 'test/code.test.js',
    aceite: 'A2',
    criterion: 'código tem 6 caracteres base62',
    source: {
      'src/code.js': "'use strict';\nconst A = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';\nfunction newCode() { let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }\nmodule.exports = { newCode };\n",
      'test/code.test.js': "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst { newCode } = require('../src/code.js');\ntest('[A2] 6 chars base62', () => assert.match(newCode(), /^[0-9A-Za-z]{6}$/));\n",
    },
  },
  {
    id: 'T3',
    wave: 2,
    title: 'Suíte de API',
    goal: 'Criar src/api.js exportando shorten(url): { code } para URL válida (usa validateUrl e newCode) ou { error } caso contrário; e test/api.test.js (node:test) com casos [A3].',
    files: ['src/api.js', 'test/api.test.js'],
    test: 'test/api.test.js',
    aceite: 'A3',
    criterion: 'shorten devolve código válido para URL válida',
    // O verify junta o teste novo com um existente: `node --test faltando.js existente.js` sai 0.
    verify: 'node --test test/api.test.js test/validate.test.js',
    dependsOn: ['T1', 'T2'],
    source: {
      'src/api.js': "'use strict';\nconst { validateUrl } = require('./validate.js');\nconst { newCode } = require('./code.js');\nfunction shorten(url) { return validateUrl(url) ? { code: newCode() } : { error: 'invalid url' }; }\nmodule.exports = { shorten };\n",
      'test/api.test.js': "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst { shorten } = require('../src/api.js');\ntest('[A3] shorten ok', () => assert.match(shorten('https://x.y').code, /^[0-9A-Za-z]{6}$/));\ntest('[A3] shorten rejeita', () => assert.ok(shorten('nope').error));\n",
    },
  },
];

function specMd() {
  const rows = TASKS.map((t) => `| ${t.aceite} | ${t.criterion} | \`node --test ${t.test}\` |`).join('\n');
  return `# OXE — SPEC\n\n## Objetivo\n\nEncurtador mínimo para o e2e com oráculo.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n${rows}\n`;
}

function planMd() {
  const blocks = TASKS.map((t) => `### ${t.id} — ${t.title}

- **Arquivos alvo:** ${t.files.map((f) => `\`${f}\``).join(', ')}
- **Depende de:** ${t.dependsOn ? t.dependsOn.join(', ') : '—'}
- **Onda:** ${t.wave}
- **Implementar:** ${t.goal}
- **Verificar:**
  - Comando: \`${t.verify || `node --test ${t.test}`}\`
- **Aceite vinculado:** ${t.aceite}
`).join('\n');
  return `# OXE — PLAN\n\n## Tarefas\n\n${blocks}\n## Autoavaliação do Plano\n\n**Melhor plano atual:** sim\n**Confiança:** 95%\n`;
}

function makeProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-e2e-${name}-`));
  writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'linkly', private: true, scripts: { test: 'node --test' } }, null, 2));
  writeFile(path.join(dir, '.oxe', 'SPEC.md'), specMd());
  writeFile(path.join(dir, '.oxe', 'PLAN.md'), planMd());
  writeFile(path.join(dir, '.oxe', 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n');
  writeFile(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify({
    tasks: TASKS.map((t) => ({ id: t.id, mode: 'mutating', exact_paths: t.files, write_set: 'closed' })),
  }, null, 2));
  return dir;
}

// ─── Executores determinísticos ──────────────────────────────────────────────

/** `liarTasks`: reportam sucesso sem escrever o próprio teste (o comportamento da T6 real). */
function scriptedExecutor(liarTasks = new Set()) {
  return {
    async execute(node, lease) {
      const task = TASKS.find((t) => t.id === node.id);
      if (!task) return { success: false, failure_class: 'env', evidence: [], output: `unknown ${node.id}` };
      for (const [rel, content] of Object.entries(task.source)) {
        if (liarTasks.has(task.id) && rel === task.test) continue;
        writeFile(path.join(lease.root_path, rel), content);
      }
      return { success: true, failure_class: null, evidence: Object.keys(task.source), output: `${task.id} ok`, completed_by: 'e2e-mock' };
    },
  };
}

// ─── Oráculo independente ────────────────────────────────────────────────────

function oracle(dir) {
  const missing = TASKS.flatMap((t) => t.files).filter((f) => !fs.existsSync(path.join(dir, f)));
  const tests = TASKS.map((t) => t.test).filter((f) => fs.existsSync(path.join(dir, f)));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = tests.length
    ? spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, encoding: 'utf8', env })
    : { status: 1, stdout: '' };
  const executed = Number(((run.stdout || '').match(/^# tests (\d+)/m) || [])[1] || 0);
  const expected = 5;
  const ok = missing.length === 0 && run.status === 0 && executed === expected;
  return { ok, missing_files: missing, tests_executed: executed, tests_expected: expected, exit_code: run.status };
}

/**
 * Oráculo do modo real: os testes de referência do fixture (não os escritos pelo modelo) rodam
 * contra o `src/` produzido, numa cópia isolada. Contar os testes do próprio modelo não mede nada —
 * ele pode escrever mais, menos ou testes triviais.
 */
function referenceOracle(dir) {
  const missing = TASKS.flatMap((t) => t.files).filter((f) => !fs.existsSync(path.join(dir, f)));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-e2e-oracle-'));
  try {
    if (fs.existsSync(path.join(dir, 'src'))) fs.cpSync(path.join(dir, 'src'), path.join(sandbox, 'src'), { recursive: true });
    const refTests = TASKS.map((t) => {
      const rel = t.test.replace(/^test\//, 'oracle-test/');
      writeFile(path.join(sandbox, rel), t.source[t.test]);
      return rel;
    });
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', ...refTests], { cwd: sandbox, encoding: 'utf8', env });
    const executed = Number(((run.stdout || '').match(/^# tests (\d+)/m) || [])[1] || 0);
    const passed = Number(((run.stdout || '').match(/^# pass (\d+)/m) || [])[1] || 0);
    const expected = 5;
    const own = oracle(dir);
    return {
      ok: missing.length === 0 && run.status === 0 && executed === expected && passed === expected && own.exit_code === 0,
      missing_files: missing,
      reference_tests_executed: executed,
      reference_tests_passed: passed,
      reference_tests_expected: expected,
      model_tests_executed: own.tests_executed,
      model_tests_exit_code: own.exit_code,
      failures: run.status === 0 ? [] : String(run.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).slice(0, 10),
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ─── Cenários ────────────────────────────────────────────────────────────────

async function runScenario(name, liarTasks) {
  const dir = makeProject(name);
  const started = Date.now();
  try {
    operational.compileExecutionGraphFromArtifacts(dir, null, {});
    const executed = await operational.runRuntimeExecute(dir, null, {
      executor: scriptedExecutor(liarTasks),
      skipPreflight: true,
    });
    const verified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 60_000 });
    operational.projectRuntimeArtifacts(dir, null, { write: true });

    const events = operational.readEvents(dir, null);
    const ids = events.map((e) => e.event_id);
    const run = operational.readRunState(dir, null);
    const truth = oracle(dir);
    const oxeSaysPass = executed.result.status === 'completed' && verified.report.status === 'passed';
    const result = {
      name,
      liar_tasks: [...liarTasks],
      oxe: {
        execute_status: executed.result.status,
        completed: executed.result.completed,
        failed: executed.result.failed,
        verify_status: verified.report.status,
        manifest: verified.report.manifest ? verified.report.manifest.summary : null,
        evidence_coverage: verified.report.evidence_coverage ? verified.report.evidence_coverage.coverage_percent : null,
        run_status: run && run.status,
        says_pass: oxeSaysPass,
      },
      oracle: truth,
      checks: {
        false_green: oxeSaysPass && !truth.ok,
        false_red: !oxeSaysPass && truth.ok,
        duplicate_event_ids: ids.length - new Set(ids).size,
        // Pre-1.17 duplicates carried distinct ids; one RunStarted per execute catches them too.
        run_started_events: events.filter((e) => e.type === 'RunStarted').length,
        run_state_synced: Boolean(run && run.status !== 'planned' && run.status !== 'running'),
      },
      duration_ms: Date.now() - started,
      dir: KEEP ? dir : null,
    };
    result.ok = !result.checks.false_green
      && !result.checks.false_red
      && result.checks.duplicate_event_ids === 0
      && result.checks.run_started_events === 1
      && result.checks.run_state_synced;
    return result;
  } finally {
    if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Modo real: modelo de verdade via adapter ────────────────────────────────

async function runRealScenario() {
  const adapter = argValue('--adapter', 'claude');
  const model = argValue('--model', null);
  const dir = makeProject('real');
  const started = Date.now();
  const toolCalls = {};
  try {
    operational.compileExecutionGraphFromArtifacts(dir, null, {});
    const executed = await operational.runRuntimeExecute(dir, null, {
      adapter,
      adapterOptions: adapter === 'claude' ? { model } : {},
      providerConfig: {
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OXE_BASE_URL || 'https://api.anthropic.com/v1',
        model: model || process.env.OXE_MODEL || 'claude-sonnet-4-6',
        maxTurns: 15,
      },
      skipPreflight: true,
      onProgress: (event) => {
        if (event && event.type === 'tool_call' && event.detail && event.detail.tool) {
          toolCalls[event.detail.tool] = (toolCalls[event.detail.tool] || 0) + 1;
        }
      },
    });
    const verified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 120_000 });
    operational.projectRuntimeArtifacts(dir, null, { write: true });
    const events = operational.readEvents(dir, null);
    const ids = events.map((e) => e.event_id);
    const usage = operational.readExecutorUsageRows(dir, null, executed.result.run_id);
    const perTask = {};
    for (const row of usage) {
      const t = perTask[row.work_item_id] || (perTask[row.work_item_id] = { attempts: 0, turns: 0, tool_calls: 0, cost_usd: 0 });
      t.attempts += 1;
      t.turns += row.turns || 0;
      t.tool_calls += row.tool_calls || 0;
      t.cost_usd += row.cost_usd || 0;
    }
    const truth = referenceOracle(dir);
    const oxeSaysPass = executed.result.status === 'completed' && verified.report.status === 'passed';
    const result = {
      name: `real-${adapter}`,
      adapter,
      model,
      oxe: {
        execute_status: executed.result.status,
        completed: executed.result.completed,
        failed: executed.result.failed,
        verify_status: verified.report.status,
        manifest: verified.report.manifest ? verified.report.manifest.summary : null,
        says_pass: oxeSaysPass,
      },
      oracle: truth,
      usage: {
        per_task: perTask,
        attempts: usage.length,
        first_try_tasks: Object.values(perTask).filter((t) => t.attempts === 1).length,
        turns: usage.reduce((sum, r) => sum + (r.turns || 0), 0),
        cost_usd: Number(usage.reduce((sum, r) => sum + (r.cost_usd || 0), 0).toFixed(4)),
        tool_calls: toolCalls,
        run_command_calls: toolCalls.run_command || 0,
      },
      checks: {
        false_green: oxeSaysPass && !truth.ok,
        false_red: !oxeSaysPass && truth.ok,
        duplicate_event_ids: ids.length - new Set(ids).size,
        run_started_events: events.filter((e) => e.type === 'RunStarted').length,
      },
      duration_ms: Date.now() - started,
      dir: KEEP ? dir : null,
    };
    result.ok = oxeSaysPass && truth.ok && result.checks.duplicate_event_ids === 0;
    return result;
  } finally {
    if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function mainReal() {
  const r = await runRealScenario();
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    suite: 'e2e-linkly',
    mode: 'real',
    kpis: {
      false_green_count: r.checks.false_green ? 1 : 0,
      oracle_agreement: !r.checks.false_green && !r.checks.false_red ? 1 : 0,
      tasks_completed: r.oxe.completed.length,
      tasks_total: TASKS.length,
      first_try_tasks: r.usage.first_try_tasks,
      attempts: r.usage.attempts,
      turns: r.usage.turns,
      cost_usd: r.usage.cost_usd,
      run_command_calls: r.usage.run_command_calls,
    },
    summary: { total: 1, pass: r.ok ? 1 : 0, fail: r.ok ? 0 : 1, all_passed: r.ok },
    results: [r],
  };
  writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  const k = report.kpis;
  const line = `${k.tasks_completed}/${k.tasks_total} tarefas · ${k.first_try_tasks} na 1ª tentativa · ${k.turns} turnos · US$ ${k.cost_usd.toFixed(2)} · run_command ${k.run_command_calls} · oráculo ${r.oracle.ok ? 'ok' : 'FALHOU'} · falso verde ${k.false_green_count}`;
  if (!r.ok) {
    console.error(`e2e-linkly --real: FAIL · ${line}`);
    console.error(`report: ${REPORT_PATH}`);
    process.exit(1);
  }
  console.log(`e2e-linkly --real (${r.adapter}): OK · ${line}`);
  console.log(`report: ${REPORT_PATH}`);
}

(async () => {
  const oracleDir = argValue('--oracle', null);
  if (oracleDir) {
    // Reaplica o oráculo de referência a um projeto mantido com --keep, sem chamar o modelo de novo.
    const truth = referenceOracle(path.resolve(oracleDir));
    console.log(JSON.stringify(truth, null, 2));
    process.exit(truth.ok ? 0 : 1);
  }
  if (REAL) return mainReal();
  const results = [
    await runScenario('honest', new Set()),
    await runScenario('liar-api-test', new Set(['T3'])),
  ];
  const saidPass = results.filter((r) => r.oxe.says_pass).length;
  const falseGreen = results.filter((r) => r.checks.false_green).length;
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    suite: 'e2e-linkly',
    mode: 'mock',
    kpis: {
      false_green_rate: saidPass === 0 ? 0 : falseGreen / saidPass,
      false_green_count: falseGreen,
      oracle_agreement: results.filter((r) => !r.checks.false_green && !r.checks.false_red).length / results.length,
      duplicate_event_ids: results.reduce((sum, r) => sum + r.checks.duplicate_event_ids, 0),
    },
    summary: {
      total: results.length,
      pass: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      all_passed: results.every((r) => r.ok),
    },
    results,
  };
  writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  if (!report.summary.all_passed) {
    console.error(`e2e-linkly: FAIL (${report.summary.fail}/${report.summary.total})`);
    for (const r of results.filter((x) => !x.ok)) console.error(`- ${r.name}: ${JSON.stringify(r.checks)} oxe=${JSON.stringify(r.oxe)} oracle=${JSON.stringify(r.oracle)}`);
    console.error(`report: ${REPORT_PATH}`);
    process.exit(1);
  }
  console.log(`e2e-linkly: OK (${report.summary.pass}/${report.summary.total}) · falso verde ${(report.kpis.false_green_rate * 100).toFixed(0)}% · concordância oráculo ${(report.kpis.oracle_agreement * 100).toFixed(0)}%`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
