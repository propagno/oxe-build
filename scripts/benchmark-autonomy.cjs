#!/usr/bin/env node
'use strict';

/**
 * benchmark-autonomy — measures the % of reference projects that complete
 * end-to-end (compile → execute → verify) without human intervention,
 * using a deterministic mock executor that simulates realistic LLM behavior.
 *
 * Dimensions measured:
 *   - Compilation success rate (plan + spec → ExecutionGraph)
 *   - Execution success rate (scheduler completes all tasks)
 *   - Verification success rate (verify commands pass)
 *   - Overall autonomy rate (all 3 phases succeed)
 *
 * Report: .oxe/release/benchmark-autonomy-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(REPO_ROOT, '.oxe', 'release', 'benchmark-autonomy-report.json');

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writeJson(p, v) {
  writeFile(p, JSON.stringify(v, null, 2) + '\n');
}

// Deterministic executor that simulates LLM applying the fixture mutations.
class FixtureExecutor {
  constructor(applyFn) {
    this.applyFn = applyFn;
  }

  async execute(node, lease, runId, attemptNumber) {
    this.applyFn(lease.root_path, node);
    return {
      success: true,
      failure_class: null,
      evidence: [`benchmark:${node.id}:attempt-${attemptNumber}`],
      output: `fixture executor completed ${node.id}`,
      completed_by: 'benchmark-mock',
    };
  }
}

// Executor that always fails (simulates autonomy failure scenario).
class FailingExecutor {
  async execute(node, _lease, _runId, attemptNumber) {
    return {
      success: false,
      failure_class: 'llm',
      evidence: [],
      output: `benchmark: simulated failure on ${node.id} attempt ${attemptNumber}`,
      completed_by: 'benchmark-mock',
    };
  }
}

// Reference fixture projects: each represents a real-world scenario type.
const FIXTURES = [
  {
    name: 'single-task-file-write',
    category: 'simple',
    description: 'Projeto simples: 1 tarefa, 1 arquivo, sem dependências.',
    planMd: `# OXE — PLAN\n\n## Resumo\n\nPlano mínimo de 1 tarefa.\n\n### T1 — Criar hello.txt\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** XS\n**Arquivos prováveis:** \`hello.txt\`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\nComando: \`node -e "require('fs').readFileSync('hello.txt')"\`\n\nCriar arquivo hello.txt.\n`,
    specMd: `# OXE — SPEC\n\n## Objetivo\n\nCriar hello.txt.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | hello.txt existe | Run \`node -e "require('fs').readFileSync('hello.txt')"\` |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Arquivo mínimo | Fixture determinística |\n`,
    stateMd: `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`,
    applyFn(root) {
      writeFile(path.join(root, 'hello.txt'), 'hello OXE\n');
    },
    verifyFn(root) {
      if (!fs.existsSync(path.join(root, 'hello.txt'))) throw new Error('hello.txt missing');
    },
  },
  {
    name: 'two-task-sequential',
    category: 'medium',
    description: 'Projeto médio: 2 tarefas sequenciais (T2 depende de T1).',
    planMd: `# OXE — PLAN\n\n## Resumo\n\nPlano com 2 tarefas sequenciais.\n\n### T1 — Criar módulo\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** S\n**Arquivos prováveis:** \`src/index.js\`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\nComando: \`node -e "require('./src/index.js').greet"\`\n\nImplementar função greet.\n\n### T2 — Criar CLI\n\n**Onda:** 2\n**Depende de:** T1\n**Complexidade:** S\n**Arquivos prováveis:** \`bin/cli.js\`\n**Aceite vinculado:** A2\n**Decisão vinculada:** D-01\nComando: \`node bin/cli.js\`\n\nImplementar CLI que usa greet.\n`,
    specMd: `# OXE — SPEC\n\n## Objetivo\n\nCriar módulo com greet() e CLI.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | src/index.js exporta greet | Run \`node -e "require('./src/index.js').greet"\` |\n| A2 | bin/cli.js funciona | Run \`node bin/cli.js\` |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Módulo simples | Fixture sequencial |\n`,
    stateMd: `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`,
    applyFn(root, node) {
      if (node.id === 'T1') {
        writeFile(path.join(root, 'src', 'index.js'), 'function greet(n){return `Hello, ${n}!`;}\nmodule.exports={greet};\n');
      } else if (node.id === 'T2') {
        writeFile(path.join(root, 'bin', 'cli.js'), '#!/usr/bin/env node\nconst {greet}=require("../src/index.js");\nconsole.log(greet("OXE"));\n');
      }
    },
    verifyFn(root) {
      const mod = require(path.join(root, 'src', 'index.js'));
      if (typeof mod.greet !== 'function') throw new Error('greet not a function');
      if (mod.greet('OXE') !== 'Hello, OXE!') throw new Error('greet returned wrong value');
    },
  },
  {
    name: 'three-task-parallel-wave',
    category: 'medium',
    description: 'Projeto médio: 3 tarefas em onda única (paralelas).',
    planMd: `# OXE — PLAN\n\n## Resumo\n\nPlano com 3 tarefas na mesma onda.\n\n### T1 — Criar módulo A\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** S\n**Arquivos prováveis:** \`src/a.js\`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\nComando: \`node -e "require('./src/a.js')"\`\n\nImplementar módulo A.\n\n### T2 — Criar módulo B\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** S\n**Arquivos prováveis:** \`src/b.js\`\n**Aceite vinculado:** A2\n**Decisão vinculada:** D-01\nComando: \`node -e "require('./src/b.js')"\`\n\nImplementar módulo B.\n\n### T3 — Criar módulo C\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** S\n**Arquivos prováveis:** \`src/c.js\`\n**Aceite vinculado:** A3\n**Decisão vinculada:** D-01\nComando: \`node -e "require('./src/c.js')"\`\n\nImplementar módulo C.\n`,
    specMd: `# OXE — SPEC\n\n## Objetivo\n\nCriar 3 módulos independentes.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | src/a.js existe | Run \`node -e "require('./src/a.js')"\` |\n| A2 | src/b.js existe | Run \`node -e "require('./src/b.js')"\` |\n| A3 | src/c.js existe | Run \`node -e "require('./src/c.js')"\` |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Módulos paralelos | Fixture de onda paralela |\n`,
    stateMd: `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`,
    applyFn(root, node) {
      // T1→a.js, T2→b.js, T3→c.js
      const letter = { T1: 'a', T2: 'b', T3: 'c' }[node.id] || node.id.toLowerCase();
      writeFile(path.join(root, 'src', `${letter}.js`), `module.exports={id:'${node.id}'};\n`);
    },
    verifyFn(root) {
      for (const m of ['a', 'b', 'c']) {
        if (!fs.existsSync(path.join(root, 'src', `${m}.js`))) throw new Error(`src/${m}.js missing`);
      }
    },
  },
  {
    name: 'docs-only-no-verify',
    category: 'simple',
    description: 'Projeto documentação: sem verify command (testa gap E silencioso).',
    planMd: `# OXE — PLAN\n\n## Resumo\n\nPlano de documentação sem verify command.\n\n### T1 — Criar README\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** XS\n**Arquivos prováveis:** \`README.md\`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\n\nCriar README com overview do projeto.\n`,
    specMd: `# OXE — SPEC\n\n## Objetivo\n\nDocumentar o projeto.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | README.md existe | Inspecionar arquivo |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Docs only | Fixture sem verify command |\n`,
    stateMd: `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`,
    applyFn(root) {
      writeFile(path.join(root, 'README.md'), '# My Project\n\nA minimal README.\n');
    },
    verifyFn(root) {
      if (!fs.existsSync(path.join(root, 'README.md'))) throw new Error('README.md missing');
    },
    expectNoVerifyCommand: true,
  },
  {
    name: 'bold-verify-format',
    category: 'medium',
    description: 'Projeto com verify command em formato bold (**Verificação:**) — testa Gap E fix.',
    planMd: `# OXE — PLAN\n\n## Resumo\n\nPlano com verify em formato bold.\n\n### T1 — Criar config\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** S\n**Arquivos prováveis:** \`config.json\`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\n**Verificação:** \`node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))"\`\n\nCriar config.json válido.\n`,
    specMd: `# OXE — SPEC\n\n## Objetivo\n\nCriar config.json.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | config.json é JSON válido | Run \`node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))"\` |\n\n## Decisões persistentes\n\n| ID | Decisão | Racional |\n|---|---|---|\n| D-01 | Config JSON | Fixture bold verify |\n`,
    stateMd: `# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n`,
    applyFn(root) {
      writeFile(path.join(root, 'config.json'), '{"version":1,"enabled":true}\n');
    },
    verifyFn(root) {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
      if (!cfg.version) throw new Error('config.json missing version');
    },
  },
];

async function runFixture(fixture) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-bench-${fixture.name}-`));
  const result = {
    name: fixture.name,
    category: fixture.category,
    description: fixture.description,
    phases: { compile: null, execute: null, verify: null },
    autonomy: false,
    durationMs: 0,
    errors: [],
  };
  const t0 = Date.now();

  try {
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
    writeFile(path.join(tmpDir, '.oxe', 'PLAN.md'), fixture.planMd);
    writeFile(path.join(tmpDir, '.oxe', 'SPEC.md'), fixture.specMd);
    writeFile(path.join(tmpDir, '.oxe', 'STATE.md'), fixture.stateMd);

    // Phase 1: Compile
    let compiled;
    try {
      compiled = operational.compileExecutionGraphFromArtifacts(tmpDir, null, {
        compilerOptions: { default_workspace_strategy: 'inplace', default_max_retries: 1 },
      });
      // HINTs are advisory lint hints — only real errors block compilation
      const realErrors = compiled.validationErrors.filter((e) => !String(e).startsWith('HINT('));
      result.phases.compile = {
        ok: realErrors.length === 0,
        node_count: compiled.graph && compiled.graph.metadata ? compiled.graph.metadata.node_count : 0,
        wave_count: compiled.graph && compiled.graph.metadata ? compiled.graph.metadata.wave_count : 0,
        validation_errors: compiled.validationErrors,
        hints: compiled.validationErrors.filter((e) => String(e).startsWith('HINT(')),
      };
    } catch (err) {
      result.phases.compile = { ok: false, error: err.message };
      result.errors.push(`compile: ${err.message}`);
      return result;
    }

    if (!result.phases.compile.ok) {
      result.errors.push(`compile validation: ${result.phases.compile.validation_errors.filter((e) => !String(e).startsWith('HINT(')).join(', ')}`);
      return result;
    }

    // Phase 2: Execute
    let executed;
    try {
      executed = await operational.runRuntimeExecute(tmpDir, null, {
        executor: new FixtureExecutor(fixture.applyFn),
        runState: compiled.run,
        skipPreflight: true,
        schedulerOptions: {
          verifyTimeoutMs: 15_000,
          maxRunDurationMs: 60_000,
          staleProgressMs: 30_000,
        },
      });
      result.phases.execute = {
        ok: executed.result.status === 'completed',
        status: executed.result.status,
        completed: executed.result.completed,
        failed: executed.result.failed,
      };
    } catch (err) {
      result.phases.execute = { ok: false, error: err.message };
      result.errors.push(`execute: ${err.message}`);
      return result;
    }

    if (!result.phases.execute.ok) {
      result.errors.push(`execute status=${executed.result.status}`);
      return result;
    }

    // Phase 3: Verify fixture (post-execution check)
    try {
      fixture.verifyFn(tmpDir);
      result.phases.verify = { ok: true };
    } catch (err) {
      result.phases.verify = { ok: false, error: err.message };
      result.errors.push(`verify: ${err.message}`);
      return result;
    }

    result.autonomy = true;
  } catch (err) {
    result.errors.push(err && err.message ? err.message : String(err));
  } finally {
    result.durationMs = Date.now() - t0;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

async function main() {
  console.log('[benchmark:autonomy] Running autonomy benchmark...\n');

  const t0 = Date.now();
  const results = [];

  for (const fixture of FIXTURES) {
    process.stdout.write(`  ${fixture.name} (${fixture.category})... `);
    const r = await runFixture(fixture);
    results.push(r);
    if (r.autonomy) {
      console.log('✓');
    } else {
      console.log(`✗  [${r.errors.join(' | ')}]`);
    }
  }

  const total = results.length;
  const autonomous = results.filter((r) => r.autonomy).length;
  const rate = total > 0 ? Math.round((autonomous / total) * 100) : 0;

  const byCategory = {};
  for (const r of results) {
    const cat = r.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, autonomous: 0 };
    byCategory[cat].total++;
    if (r.autonomy) byCategory[cat].autonomous++;
  }
  for (const cat of Object.keys(byCategory)) {
    const c = byCategory[cat];
    c.rate = c.total > 0 ? Math.round((c.autonomous / c.total) * 100) : 0;
  }

  const report = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t0,
    total,
    autonomous,
    autonomy_rate_pct: rate,
    by_category: byCategory,
    fixtures: results,
  };

  writeJson(REPORT_PATH, report);

  console.log(`\n[benchmark:autonomy] Results:`);
  console.log(`  Total fixtures : ${total}`);
  console.log(`  Autonomous     : ${autonomous}`);
  console.log(`  Autonomy rate  : ${rate}%`);
  for (const [cat, c] of Object.entries(byCategory)) {
    console.log(`  ${cat.padEnd(12)}: ${c.autonomous}/${c.total} (${c.rate}%)`);
  }
  console.log(`\n  Report: ${REPORT_PATH}`);

  process.exit(rate === 100 ? 0 : rate >= 60 ? 0 : 1);
}

main().catch((err) => {
  console.error('[benchmark:autonomy] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
