#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const RELEASE_REPORT = path.join(REPO_ROOT, '.oxe', 'release', 'runtime-real-report.json');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

function tasksForScenario(scenario) {
  if (Array.isArray(scenario.tasks) && scenario.tasks.length > 0) return scenario.tasks;
  return [
    {
      id: 'T1',
      title: scenario.taskTitle,
      wave: 1,
      dependsOn: 'nenhum',
      targetPaths: scenario.targetPaths,
      acceptanceId: scenario.acceptanceId,
      symbol: scenario.symbol,
      contract: scenario.contract,
      risk: 'medium',
    },
  ];
}

function planFor(title, tasks) {
  const taskSections = tasks.map((task) => {
    const files = task.targetPaths.map((entry) => `\`${entry}\``).join(', ');
    return `### ${task.id} — ${task.title}

**Onda:** ${task.wave || 1}
**Depende de:** ${task.dependsOn || 'nenhum'}
**Complexidade:** ${task.complexity || 'M'}
**Arquivos prováveis:** ${files}
**Aceite vinculado:** ${task.acceptanceId}
**Decisão vinculada:** ${task.decisionId || 'D-01'}
Comando: \`node scripts/check.js\`

Implementar o menor delta funcional para satisfazer o contrato do fixture.`;
  }).join('\n\n');
  return `# OXE — PLAN

## Resumo

Plano determinístico para fixture de runtime real: ${title}.

${taskSections}

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 93%

| Dimensão | Nota | Evidência |
|---|---:|---|
| Completude dos requisitos | 0.94 | Aceite único e verificável |
| Dependências conhecidas | 0.95 | Sem dependências externas |
| Risco técnico | 0.90 | Fixture determinística |
| Impacto no código existente | 0.94 | Write-set fechado |
| Clareza da validação / testes | 0.93 | Smoke local obrigatório |
| Lacunas externas / decisões pendentes | 0.93 | Sem external-ref |

**Principais incertezas:** nenhuma crítica.
**Alternativas descartadas:** usar LLM real em CI; descartado por não determinismo.
**Condição para replanejar:** qualquer falha no smoke local ou mudança de write-set.

<confidence_vector>
  <global score="0.93" />
  <dimension name="requirements" score="0.94" />
  <dimension name="dependencies" score="0.95" />
  <dimension name="technical_risk" score="0.90" />
  <dimension name="code_impact" score="0.94" />
  <dimension name="validation" score="0.93" />
  <dimension name="open_gaps" score="0.93" />
</confidence_vector>
`;
}

function specFor(title, objective, criteria) {
  const rows = criteria.map((entry) => `| ${entry.id} | ${entry.criterion} | node scripts/check.js |`).join('\n');
  return `# OXE — SPEC

## Objetivo

${objective}

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
${rows}

## Decisões persistentes

| ID | Decisão | Racional |
|---|---|---|
| D-01 | Fixture ${title} deve ser determinística | Evita dependência de LLM/API real na suíte de maturidade |
`;
}

function stateFor(title) {
  return `# OXE — STATE

- **phase:** plan_ready
- **runtime_status:** enterprise
- **plan_review_status:** approved
- **checkpoint_status:** none

## Próximo passo sugerido

- Executar runtime real para ${title}.
`;
}

function implementationPack(tasks) {
  return {
    schema_version: 1,
    ready: true,
    critical_gaps: [],
    tasks: tasks.map((task) => ({
        id: task.id,
        mode: 'mutating',
        ready: true,
        exact_paths: task.targetPaths,
        write_set: 'closed',
        mutation_scope: 'code',
        risk: task.risk || 'medium',
        symbols: [task.symbol],
        imports: [],
        contracts: [task.contract],
        minimum_sequence: ['write deterministic fixture files', 'run node scripts/check.js', 'persist runtime evidence'],
        expected_checks: ['node scripts/check.js'],
        requires_fixture: true,
        snippet_base_local: 'not_applicable',
        rollback: 'remove generated fixture files',
        critical_gaps: [],
      })),
  };
}

function fixturePack(title, tasks) {
  return {
    schema_version: 1,
    ready: true,
    critical_gaps: [],
    fixtures: tasks.map((task, index) => ({
        id: `FX-${String(index + 1).padStart(2, '0')}`,
        task_id: task.id,
        status: 'ready',
        inputs: [`runtime-real:${title}`],
        expected_outputs: ['node scripts/check.js exits 0'],
        expected_checks: ['node scripts/check.js'],
        critical_fields: ['file existence', 'required content marker'],
        smoke_command: 'node scripts/check.js',
        negative_cases: ['missing generated file fails the smoke check'],
        source_anchor: 'not_applicable',
        critical_gaps: [],
      })),
  };
}

function referenceAnchors() {
  return `# OXE — Reference Anchors

<reference_anchors status="not_applicable" ready="true">
</reference_anchors>
`;
}

function createProject(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-runtime-real-${scenario.name}-`));
  const tasks = tasksForScenario(scenario);
  const criteria = tasks.map((task) => ({ id: task.acceptanceId, criterion: task.criterion || scenario.criterion }));
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  writeFile(path.join(dir, '.oxe', 'STATE.md'), stateFor(scenario.name));
  writeFile(path.join(dir, '.oxe', 'SPEC.md'), specFor(scenario.name, scenario.objective, criteria));
  writeFile(path.join(dir, '.oxe', 'PLAN.md'), planFor(scenario.name, tasks));
  writeJson(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), implementationPack(tasks));
  writeFile(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.md'), `# OXE — Implementation Pack\n\n- Fixture: ${scenario.name}\n- Status: ready\n`);
  writeFile(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), referenceAnchors());
  writeJson(path.join(dir, '.oxe', 'FIXTURE-PACK.json'), fixturePack(scenario.name, tasks));
  writeFile(path.join(dir, '.oxe', 'FIXTURE-PACK.md'), `# OXE — Fixture Pack\n\n- Fixture: ${scenario.name}\n- Status: ready\n`);
  writeFile(path.join(dir, '.oxe', 'execution', 'GATES.json'), '[]\n');
  writeFile(path.join(dir, 'scripts', 'check.js'), scenario.checkScript);
  for (const [relativePath, content] of Object.entries(scenario.seedFiles || {})) {
    writeFile(path.join(dir, relativePath), content);
  }
  return dir;
}

class DeterministicExecutor {
  constructor(scenario) {
    this.scenario = scenario;
  }

  async execute(node, lease, runId, attemptNumber) {
    this.scenario.apply(lease.root_path, node);
    return {
      success: true,
      failure_class: null,
      evidence: [`runtime-real:${this.scenario.name}:${node.id}:attempt-${attemptNumber}`],
      output: `deterministic executor completed ${node.id} for ${runId}`,
      completed_by: 'runtime-real-mock',
    };
  }
}

const scenarios = [
  {
    name: 'static-html-js',
    objective: 'Criar uma página HTML/JS didática mínima para aprendizado de estrutura de dados, sem servidor HTTP e sem fetch().',
    taskTitle: 'Criar app educacional estático',
    acceptanceId: 'A1',
    criterion: 'A página contém visualização de pilha, jornada de 15 dias e script JS carregável.',
    targetPaths: ['index.html', 'app.js'],
    symbol: 'html:DataStructureLearningPage(index.html)',
    contract: { name: 'static educational app', input: 'browser load', output: 'interactive learning shell' },
    checkScript: `const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('app.js','utf8');
if(!html.includes('Jornada de 15 dias')) throw new Error('missing journey');
if(!html.includes('app.js')) throw new Error('missing script');
if(!js.includes('Stack')) throw new Error('missing stack content');
console.log('static-html-js ok');
`,
    apply(root) {
      writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><h1>Jornada de 15 dias</h1><div id="app"></div><script src="app.js"></script></body></html>\n');
      writeFile(path.join(root, 'app.js'), 'const structures = [{ name: "Stack", operations: ["push", "pop"] }]; console.log(structures[0].name);\n');
    },
  },
  {
    name: 'node-cli-api',
    objective: 'Criar um app Node pequeno com função pública reutilizável e CLI mínima.',
    taskTitle: 'Criar módulo Node e CLI',
    acceptanceId: 'A1',
    criterion: 'O módulo exporta greet() e a CLI imprime uma saudação determinística.',
    targetPaths: ['package.json', 'src/index.js', 'bin/hello.js'],
    symbol: 'function:greet(name:string):string',
    contract: { name: 'greet api', input: 'name string', output: 'Hello, <name>!' },
    checkScript: `const { greet } = require('../src/index.js');
if(greet('OXE') !== 'Hello, OXE!') throw new Error('bad greet');
console.log('node-cli-api ok');
`,
    apply(root) {
      writeJson(path.join(root, 'package.json'), { name: 'runtime-real-node-cli', version: '0.0.0', type: 'commonjs' });
      writeFile(path.join(root, 'src', 'index.js'), 'function greet(name) { return `Hello, ${name}!`; }\nmodule.exports = { greet };\n');
      writeFile(path.join(root, 'bin', 'hello.js'), '#!/usr/bin/env node\nconst { greet } = require("../src/index.js");\nconsole.log(greet(process.argv[2] || "world"));\n');
    },
  },
  {
    name: 'brownfield-docs',
    objective: 'Atualizar documentação operacional de um projeto brownfield sem alterar código legado.',
    taskTitle: 'Criar guia operacional brownfield',
    acceptanceId: 'A1',
    criterion: 'A documentação registra contexto legado, riscos e comando de smoke.',
    targetPaths: ['docs/OPERATIONS.md'],
    symbol: 'doc:BrownfieldOperationsGuide(docs/OPERATIONS.md)',
    contract: { name: 'brownfield guide', input: 'legacy notes', output: 'operations markdown' },
    seedFiles: {
      'legacy/main.txt': 'legacy batch baseline\n',
    },
    checkScript: `const fs=require('fs');
const doc=fs.readFileSync('docs/OPERATIONS.md','utf8');
if(!doc.includes('Contexto legado')) throw new Error('missing legacy context');
if(!doc.includes('Smoke')) throw new Error('missing smoke');
console.log('brownfield-docs ok');
`,
    apply(root) {
      writeFile(path.join(root, 'docs', 'OPERATIONS.md'), '# Operação Brownfield\n\n## Contexto legado\n\nBaseline em `legacy/main.txt`.\n\n## Smoke\n\n`node scripts/check.js`\n');
    },
  },
  {
    name: 'multi_file_mutation',
    objective: 'Validar runtime execute em mutação determinística multi-file com contrato de app estático modular, sem servidor HTTP e sem fetch().',
    taskTitle: 'Criar app estático modular multi-file',
    acceptanceId: 'A1',
    criterion: 'HTML, CSS e JS são materializados e o JS exporta dados de conteúdo verificáveis.',
    targetPaths: ['index.html', 'styles.css', 'src/content.js', 'src/app.js'],
    symbol: 'module:LearningApp(index.html,styles.css,src/content.js,src/app.js)',
    contract: { name: 'multi file static app', input: 'browser load', output: 'modular educational shell' },
    checkScript: `const fs=require('fs');
for (const file of ['index.html','styles.css','src/content.js','src/app.js']) {
  if(!fs.existsSync(file)) throw new Error('missing '+file);
}
const content=fs.readFileSync('src/content.js','utf8');
if(!content.includes('arrays') || !content.includes('linked-list')) throw new Error('missing content model');
console.log('multi_file_mutation ok');
`,
    apply(root) {
      writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main id="app"></main><script type="module" src="src/app.js"></script></body></html>\n');
      writeFile(path.join(root, 'styles.css'), ':root{--ink:#101820} body{font-family:sans-serif;color:var(--ink)}\n');
      writeFile(path.join(root, 'src', 'content.js'), 'export const modules = [{ id: "arrays" }, { id: "linked-list" }];\n');
      writeFile(path.join(root, 'src', 'app.js'), 'import { modules } from "./content.js"; document.querySelector("#app").textContent = modules.map(m => m.id).join(",");\n');
    },
  },
  {
    name: 'multi_wave_app',
    objective: 'Validar runtime compile/execute em plano multi-wave com dependência entre camada de dados e renderização.',
    criterion: 'As duas ondas materializam conteúdo e renderização com contrato verificável.',
    tasks: [
      {
        id: 'T1',
        title: 'Criar modelo de conteúdo',
        wave: 1,
        dependsOn: 'nenhum',
        targetPaths: ['src/content.js'],
        acceptanceId: 'A1',
        symbol: 'module:content.modules',
        contract: { name: 'content model', input: 'none', output: 'learning modules array' },
        criterion: 'Modelo de conteúdo exporta estruturas e operações.',
      },
      {
        id: 'T2',
        title: 'Criar renderização que consome o modelo',
        wave: 2,
        dependsOn: 'T1',
        targetPaths: ['index.html', 'src/app.js'],
        acceptanceId: 'A2',
        symbol: 'function:renderLearningModules()',
        contract: { name: 'renderer', input: 'content modules', output: 'html list' },
        criterion: 'Renderização consome o modelo de conteúdo e expõe jornada.',
      },
    ],
    checkScript: `const fs=require('fs');
const content=fs.readFileSync('src/content.js','utf8');
const app=fs.readFileSync('src/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
if(!content.includes('Queue') || !content.includes('Tree')) throw new Error('missing model');
if(!app.includes('renderLearningModules')) throw new Error('missing renderer');
if(!html.includes('Jornada')) throw new Error('missing shell');
console.log('multi_wave_app ok');
`,
    apply(root) {
      writeFile(path.join(root, 'src', 'content.js'), 'export const modules = [{ name: "Queue" }, { name: "Tree" }];\n');
      writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><h1>Jornada</h1><ul id="app"></ul><script type="module" src="src/app.js"></script></body></html>\n');
      writeFile(path.join(root, 'src', 'app.js'), 'import { modules } from "./content.js"; export function renderLearningModules(){ return modules.map(m=>m.name).join(","); }\n');
    },
  },
];

async function runScenario(scenario) {
  const projectRoot = createProject(scenario);
  const result = {
    name: scenario.name,
    project_root: projectRoot,
    ok: false,
    phases: {},
    failures: [],
  };
  try {
    const compiled = operational.compileExecutionGraphFromArtifacts(projectRoot, null, {
      compilerOptions: {
        default_workspace_strategy: 'inplace',
        default_max_retries: 0,
      },
    });
    result.phases.compile = {
      ok: compiled.validationErrors.length === 0,
      run_id: compiled.run.run_id,
      node_count: compiled.graph.metadata.node_count,
      wave_count: compiled.graph.metadata.wave_count,
      validation_errors: compiled.validationErrors,
    };
    if (compiled.validationErrors.length) result.failures.push(...compiled.validationErrors);

    const executed = await operational.runRuntimeExecute(projectRoot, null, {
      executor: new DeterministicExecutor(scenario),
      runState: compiled.run,
      schedulerOptions: {
        verifyTimeoutMs: 10_000,
        maxRunDurationMs: 30_000,
        staleProgressMs: 30_000,
      },
    });
    result.phases.execute = {
      ok: executed.result.status === 'completed',
      status: executed.result.status,
      completed: executed.result.completed,
      failed: executed.result.failed,
      blocked: executed.result.blocked,
      preflight: executed.preflight,
    };
    if (executed.result.status !== 'completed') {
      result.failures.push(`execute:${executed.result.status}`);
    }

    const verified = await operational.runRuntimeVerify(projectRoot, null, {
      runId: compiled.run.run_id,
      workItemId: 'T1',
      timeoutMs: 10_000,
    });
    const manifestSummary = verified.report.manifest && verified.report.manifest.summary;
    const coverage = verified.report.evidence_coverage;
    result.phases.verify = {
      ok: verified.report.status === 'passed'
        && manifestSummary
        && manifestSummary.fail === 0
        && manifestSummary.error === 0
        && coverage
        && coverage.coverage_percent === 100,
      status: verified.report.status,
      manifest_summary: manifestSummary || null,
      evidence_coverage: coverage || null,
      gaps: verified.report.gaps,
    };
    if (!result.phases.verify.ok) {
      result.failures.push(`verify:${verified.report.status}`);
    }

    const projected = operational.projectRuntimeArtifacts(projectRoot, null, { write: true });
    result.phases.project = {
      ok: fs.existsSync(projected.paths.verify) && fs.existsSync(projected.paths.runSummary),
      verify_path: projected.paths.verify,
      run_summary_path: projected.paths.runSummary,
    };
    if (!result.phases.project.ok) result.failures.push('project:missing_projection');

    const status = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'oxe-cc.js'), 'status', '--json', projectRoot], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    let statusJson = null;
    try {
      statusJson = JSON.parse(status.stdout || '{}');
    } catch {
      statusJson = null;
    }
    result.phases.status = {
      ok: status.status === 0
        && statusJson
        && statusJson.runtimeMode
        && statusJson.runtimeMode.runtime_mode === 'enterprise'
        && statusJson.executionRationalityReady === true
        && statusJson.verificationSummary
        && statusJson.verificationSummary.status !== 'missing',
      exit_code: status.status,
      runtime_mode: statusJson && statusJson.runtimeMode,
      execution_rationality_ready: statusJson && statusJson.executionRationalityReady,
      verification_summary: statusJson && statusJson.verificationSummary,
      stderr: status.stderr,
    };
    if (!result.phases.status.ok) result.failures.push('status:runtime_readiness_missing');

    result.ok = Object.values(result.phases).every((phase) => phase && phase.ok === true);
  } catch (error) {
    result.failures.push(error && error.stack ? error.stack : String(error));
  }
  return result;
}

async function runGateBlockedExecute() {
  const scenario = scenarios.find((item) => item.name === 'static-html-js');
  const projectRoot = createProject({ ...scenario, name: 'gate_blocked_execute' });
  const result = {
    name: 'gate_blocked_execute',
    project_root: projectRoot,
    ok: false,
    phases: {},
    failures: [],
  };
  try {
    const compiled = operational.compileExecutionGraphFromArtifacts(projectRoot, null, {
      compilerOptions: { default_workspace_strategy: 'inplace', default_max_retries: 0 },
    });
    writeJson(path.join(projectRoot, '.oxe', 'execution', 'GATES.json'), [
      {
        gate_id: 'gate-runtime-real-1',
        scope: 'work_item',
        run_id: compiled.run.run_id,
        work_item_id: 'T1',
        action: 'execute',
        requested_at: new Date().toISOString(),
        context: { description: 'runtime-real pending gate', evidence_refs: [], risks: ['operator_gate'], rationale: null, policy_decision_id: null },
        status: 'pending',
      },
    ]);
    const executed = await operational.runRuntimeExecute(projectRoot, null, {
      executor: new DeterministicExecutor(scenario),
      runState: compiled.run,
    });
    result.phases.execute = {
      ok: executed.result.status === 'blocked'
        && Array.isArray(executed.preflight.blockers)
        && executed.preflight.blockers.some((blocker) => /pending_gates/i.test(blocker)),
      status: executed.result.status,
      preflight: executed.preflight,
    };
    if (!result.phases.execute.ok) result.failures.push('execute não bloqueou com gate pendente');
    result.ok = result.phases.execute.ok;
  } catch (error) {
    result.failures.push(error && error.stack ? error.stack : String(error));
  }
  return result;
}

async function runPartialVerifyReplan() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-runtime-real-partial_verify_replan-'));
  fs.mkdirSync(path.join(projectRoot, '.oxe'), { recursive: true });
  writeFile(path.join(projectRoot, '.oxe', 'STATE.md'), stateFor('partial_verify_replan'));
  writeFile(path.join(projectRoot, '.oxe', 'SPEC.md'), '# OXE — SPEC\n\n## Objetivo\n\nValidar verify parcial quando não há critérios executáveis.\n');
  writeFile(path.join(projectRoot, '.oxe', 'PLAN.md'), '# OXE — PLAN\n\n## Resumo\n\nPlano intencionalmente sem tarefa executável para validar gap de verify.\n\n## Autoavaliação do Plano\n\n**Melhor plano atual:** sim\n**Confiança:** 93%\n');
  const result = {
    name: 'partial_verify_replan',
    project_root: projectRoot,
    ok: false,
    phases: {},
    failures: [],
  };
  try {
    const compiled = operational.compileVerificationSuiteFromArtifacts(projectRoot, null, {});
    const verified = await operational.runRuntimeVerify(projectRoot, null, {
      runId: compiled.run.run_id,
      timeoutMs: 10_000,
    });
    result.phases.verify = {
      ok: verified.report.status === 'partial' && Array.isArray(verified.report.gaps) && verified.report.gaps.length > 0,
      status: verified.report.status,
      gaps: verified.report.gaps,
    };
    if (!result.phases.verify.ok) result.failures.push(`verify parcial inesperado: ${verified.report.status}`);
    result.ok = result.phases.verify.ok;
  } catch (error) {
    result.failures.push(error && error.stack ? error.stack : String(error));
  }
  return result;
}

async function runPromotionBlockedByRisk() {
  const scenario = scenarios.find((item) => item.name === 'node-cli-api');
  const projectRoot = createProject({ ...scenario, name: 'promotion_blocked_by_risk' });
  const result = {
    name: 'promotion_blocked_by_risk',
    project_root: projectRoot,
    ok: false,
    phases: {},
    failures: [],
  };
  try {
    const compiled = operational.compileExecutionGraphFromArtifacts(projectRoot, null, {
      compilerOptions: { default_workspace_strategy: 'inplace', default_max_retries: 0 },
    });
    try {
      await operational.runRuntimePromotion(projectRoot, null, { runState: compiled.run, targetKind: 'pr_draft' });
      result.failures.push('promotion avançou sem manifest de verify');
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      result.phases.promote = {
        ok: /Manifest de verify ausente/i.test(message),
        status: 'blocked',
        blocker: message,
      };
      if (!result.phases.promote.ok) result.failures.push(`blocker inesperado: ${message}`);
    }
    result.ok = Boolean(result.phases.promote && result.phases.promote.ok);
  } catch (error) {
    result.failures.push(error && error.stack ? error.stack : String(error));
  }
  return result;
}

(async () => {
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  results.push(await runGateBlockedExecute());
  results.push(await runPartialVerifyReplan());
  results.push(await runPromotionBlockedByRisk());
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    suite: 'runtime-real',
    summary: {
      total: results.length,
      pass: results.filter((item) => item.ok).length,
      fail: results.filter((item) => !item.ok).length,
      all_passed: results.every((item) => item.ok),
    },
    results,
  };
  writeJson(RELEASE_REPORT, report);
  if (!report.summary.all_passed) {
    console.error(`runtime-real-suite: FAIL (${report.summary.fail}/${report.summary.total})`);
    for (const result of results.filter((item) => !item.ok)) {
      console.error(`- ${result.name}: ${result.failures.join('; ')}`);
    }
    console.error(`report: ${RELEASE_REPORT}`);
    process.exit(1);
  }
  console.log(`runtime-real-suite: OK (${report.summary.pass}/${report.summary.total})`);
  console.log(`runtime-real-suite: report escrito em ${RELEASE_REPORT}`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
