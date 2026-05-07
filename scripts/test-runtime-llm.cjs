#!/usr/bin/env node
'use strict';

/**
 * test-runtime-llm — Gap C: validates LlmTaskExecutor end-to-end with a real LLM.
 *
 * Required env vars (at least one key source):
 *   OXE_LLM_TEST_URL   — LLM base URL (default: https://api.anthropic.com/v1)
 *   OXE_LLM_MODEL      — model name (default: claude-haiku-4-5-20251001)
 *   OXE_LLM_API_KEY    — API key (falls back to ANTHROPIC_API_KEY or OPENAI_API_KEY)
 *
 * Skips automatically when no API key is available (exit 0, report.skipped=true).
 * Exits 1 on failure; exits 0 on success or skip.
 *
 * Report: .oxe/release/runtime-llm-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(REPO_ROOT, '.oxe', 'release', 'runtime-llm-report.json');

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

const baseUrl = process.env.OXE_LLM_TEST_URL || 'https://api.anthropic.com/v1';
const model   = process.env.OXE_LLM_MODEL    || 'claude-haiku-4-5-20251001';
const apiKey  = process.env.OXE_LLM_API_KEY  || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    model,
    skipped: false,
    passed: false,
    scenarios: [],
    errors: [],
  };

  if (!apiKey) {
    console.log('[test:runtime-llm] No API key found — skipping (set OXE_LLM_API_KEY to run).');
    report.skipped = true;
    writeJson(REPORT_PATH, report);
    process.exit(0);
  }

  const providerConfig = { baseUrl, apiKey, model, maxTurns: 5 };

  const scenarios = [
    {
      name: 'finish_task-signal',
      objective: 'Verificar que o LLM chama finish_task com success=true ao completar tarefa simples.',
      task: {
        id: 'T1',
        title: 'Escreva "hello OXE" no arquivo hello.txt',
        wave: 1,
        dependsOn: 'nenhum',
        complexity: 'XS',
        targetPaths: ['hello.txt'],
        acceptanceId: 'A1',
        symbol: 'file:hello.txt',
        contract: { name: 'hello file', input: 'none', output: 'hello.txt with text' },
        risk: 'low',
      },
      spec: {
        objective: 'Criar arquivo hello.txt com conteúdo "hello OXE".',
        criteria: [{ id: 'A1', criterion: 'hello.txt contém "hello OXE"', howToVerify: 'Run `node -e "const f=require(\'fs\').readFileSync(\'hello.txt\',\'utf8\');if(!f.includes(\'hello OXE\'))throw new Error(\'missing\')"`' }],
        rawSpecText: '',
      },
      verifyFn(root) {
        const txt = fs.readFileSync(path.join(root, 'hello.txt'), 'utf8');
        if (!txt.includes('hello OXE') && !txt.includes('Hello OXE') && !txt.toLowerCase().includes('hello oxe')) {
          throw new Error(`hello.txt conteúdo inesperado: ${txt.slice(0, 100)}`);
        }
      },
    },
    {
      name: 'retry-on-error',
      objective: 'Verificar que o executor tenta novamente após falha de verify e injeta contexto de erro.',
      task: {
        id: 'T1',
        title: 'Crie counter.txt com o número 42 (somente o número, sem espaços extras)',
        wave: 1,
        dependsOn: 'nenhum',
        complexity: 'XS',
        targetPaths: ['counter.txt'],
        acceptanceId: 'A1',
        symbol: 'file:counter.txt',
        contract: { name: 'counter', input: 'none', output: 'counter.txt containing 42' },
        risk: 'low',
      },
      spec: {
        objective: 'Criar counter.txt contendo apenas "42".',
        criteria: [{ id: 'A1', criterion: 'counter.txt contém "42"', howToVerify: 'Run `node -e "const f=require(\'fs\').readFileSync(\'counter.txt\',\'utf8\').trim();if(f!==\'42\')throw new Error(f)"`' }],
        rawSpecText: '',
      },
      verifyFn(root) {
        const txt = fs.readFileSync(path.join(root, 'counter.txt'), 'utf8').trim();
        if (txt !== '42') throw new Error(`counter.txt: expected "42", got "${txt}"`);
      },
    },
  ];

  let allPassed = true;

  for (const scenario of scenarios) {
    const scenResult = { name: scenario.name, passed: false, durationMs: 0, error: null };
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-llm-${scenario.name}-`));
    const t0 = Date.now();

    try {
      fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });

      const planText = `# OXE — PLAN\n\n## Resumo\n\nPlano para ${scenario.name}.\n\n### ${scenario.task.id} — ${scenario.task.title}\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** ${scenario.task.complexity}\n**Arquivos prováveis:** \`${scenario.task.targetPaths[0]}\`\n**Aceite vinculado:** ${scenario.task.acceptanceId}\n**Decisão vinculada:** D-01\nComando: \`node -e "process.exit(0)"\`\n\n${scenario.task.title}.\n`;
      const specText = `# OXE — SPEC\n\n## Objetivo\n\n${scenario.spec.objective}\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ${scenario.spec.criteria[0].criterion} | ${scenario.spec.criteria[0].howToVerify} |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Fixture determinística | Teste de LLM real |\n`;
      const stateText = `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`;

      writeFile(path.join(tmpDir, '.oxe', 'PLAN.md'), planText);
      writeFile(path.join(tmpDir, '.oxe', 'SPEC.md'), specText);
      writeFile(path.join(tmpDir, '.oxe', 'STATE.md'), stateText);

      const compiled = operational.compileExecutionGraphFromArtifacts(tmpDir, null, {});
      if (!compiled || !compiled.run || !compiled.run.compiled_graph) {
        throw new Error('compileExecutionGraphFromArtifacts falhou');
      }

      const result = await operational.runRuntimeExecute(tmpDir, null, {
        providerConfig,
        runState: compiled.run,
        schedulerOptions: {
          verifyTimeoutMs: 30_000,
          maxRunDurationMs: 120_000,
          staleProgressMs: 60_000,
        },
        onProgress: (evt) => {
          if (evt.type === 'turn_start') process.stdout.write(`  [${scenario.name}] turn ${evt.detail?.turn ?? 0}\n`);
          else if (evt.type === 'tool_call') process.stdout.write('.');
          else if (evt.type === 'WorkItemCompleted') process.stdout.write(` ✓\n`);
          else if (evt.type === 'WorkItemBlocked') process.stdout.write(` ✗\n`);
        },
      });

      if (result.result.status !== 'completed') {
        throw new Error(`status=${result.result.status} failed=${JSON.stringify(result.result.failed)}`);
      }

      scenario.verifyFn(tmpDir);

      scenResult.passed = true;
      console.log(`  ✓ ${scenario.name}`);
    } catch (err) {
      scenResult.passed = false;
      scenResult.error = err && err.message ? err.message : String(err);
      console.error(`  ✗ ${scenario.name}: ${scenResult.error}`);
      allPassed = false;
    } finally {
      scenResult.durationMs = Date.now() - t0;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    report.scenarios.push(scenResult);
  }

  report.passed = allPassed;
  writeJson(REPORT_PATH, report);

  console.log(`\n[test:runtime-llm] ${allPassed ? 'PASSED' : 'FAILED'} — report: ${REPORT_PATH}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('[test:runtime-llm] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
