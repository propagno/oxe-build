#!/usr/bin/env node
'use strict';

/**
 * 1.21 · Real reference projects for the maturity scorecard.
 *
 * Builds each project in `scripts/reference-projects/<name>.cjs` end to end with oxe-build and a REAL executor
 * (`claude -p` by default), the way the manual recommends:
 *   ROADMAP → program init → per phase: program start → SPEC/PLAN.json/PACK + frozen acceptance tests (planner) →
 *   plan lint → compile → execute (preflight ON, checkpoint commits, run budget) → verify (+ phase gates) →
 *   dossier handoff → program close.
 * An independent oracle (never shown to the executor) checks each phase for false greens. At the end the project's
 * scorecard is computed and upserted into oxe-build's `.oxe/release/scorecard-report.json`.
 *
 * Usage:
 *   node scripts/reference-projects.cjs [--project ledger-api|mdlint|all] [--root <dir>] [--model sonnet]
 *        [--max-turns 10] [--budget-turns 80] [--fresh]
 * Resumable: a phase already closed is skipped; `--fresh` deletes the project directory first.
 * Output: .oxe/release/reference-projects-report.json and scorecard-report.json (oxe-build).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const operational = require(path.join(REPO, 'bin', 'lib', 'oxe-operational.cjs'));
const CLI = path.join(REPO, 'bin', 'oxe-cc.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PROJECT = arg('--project', 'all');
const ROOT = path.resolve(arg('--root', path.join(os.homedir(), 'Estudos', 'oxe-reference')));
const MODEL = arg('--model', 'sonnet');
const MAX_TURNS = Number(arg('--max-turns', '10'));
const BUDGET_TURNS = Number(arg('--budget-turns', '80'));
const FRESH = process.argv.includes('--fresh');
const PLAN_ONLY = process.argv.includes('--plan-only');
const RELEASE_DIR = path.join(REPO, '.oxe', 'release');

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
}
function log(...parts) {
  console.log(`[ref] ${parts.join(' ')}`);
}
const acceptancePath = (a) => `test/acceptance/${a.toLowerCase()}.test.js`;

// ── project scaffolding ─────────────────────────────────────────────────────────

const LINT_SCRIPT = `'use strict';
// Repo gate: every JavaScript file under src/ and bin/ parses, and src/ never logs to the console.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const problems = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) {
      const r = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
      if (r.status !== 0) problems.push(full + ': syntax error\\n' + r.stderr);
      if (full.includes(path.sep + 'src' + path.sep) && /console\\.log\\(/.test(fs.readFileSync(full, 'utf8'))) problems.push(full + ': console.log in src/ (use the returned values)');
    }
  }
};
walk(path.join(__dirname, '..', 'src'));
walk(path.join(__dirname, '..', 'bin'));
if (problems.length) { console.error(problems.join('\\n')); process.exit(1); }
console.log('lint ok');
`;

function scaffold(def, dir) {
  fs.mkdirSync(dir, { recursive: true });
  writeFile(path.join(dir, 'package.json'), `${JSON.stringify({
    name: def.name, version: '0.1.0', private: true, description: def.description,
    scripts: { test: 'node --test', lint: 'node scripts/lint.cjs' },
    engines: { node: '>=20' },
  }, null, 2)}\n`);
  writeFile(path.join(dir, '.gitignore'), '.oxe/\nnode_modules/\n');
  writeFile(path.join(dir, 'scripts', 'lint.cjs'), LINT_SCRIPT);
  writeFile(path.join(dir, 'AGENTS.md'), [
    `# ${def.name}`,
    '',
    def.objective,
    '',
    '## Regras do repositório',
    '',
    '- Never add dependencies: plain Node (>= 20) and its built-in modules only.',
    '- Always use CommonJS (`require` / `module.exports`) and `\'use strict\';` at the top of each file.',
    '- Never write `console.log` in `src/`: functions return values; only `bin/` writes to the terminal.',
    '- Never edit `test/acceptance/`: those tests are the specification.',
    '',
  ].join('\n'));
  writeFile(path.join(dir, 'README.md'), `# ${def.name}\n\n${def.description}\n\n${def.objective}\n\nBuilt end to end with [oxe-build](https://www.npmjs.com/package/oxe-cc) as a 1.21 reference project.\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'oxe-reference@local']);
  git(dir, ['config', 'user.name', 'OXE reference']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'chore: scaffold the project']);

  const init = spawnSync(process.execPath, [CLI, 'init-oxe', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1', OXE_NO_BANNER: '1' } });
  if (init.status !== 0) throw new Error(`init-oxe falhou: ${init.stderr || init.stdout}`);
  const cfgPath = path.join(dir, '.oxe', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  Object.assign(cfg, {
    acceptance_tests_required: true,
    checkpoint_commits: true,
    phase_gates: [
      { id: 'test', command: 'node --test', description: 'suíte completa do projeto' },
      { id: 'lint', command: 'node scripts/lint.cjs', description: 'sintaxe e regras do repositório' },
    ],
    commit_convention: {
      template: '{type}({scope}): {title}',
      type: 'feat',
      scope: def.name,
      pattern: '^(feat|fix|test|docs|chore|refactor)(\\([^)]+\\))?: .+',
      trailers: ['Co-Authored-By: Claude <noreply@anthropic.com>'],
      require_task_message: true,
    },
  });
  writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  writeFile(path.join(dir, '.oxe', 'ROADMAP.md'), roadmapMd(def));
  // Greenfield: no external reference (docs, designs, other repos) drives the plan — said explicitly, not omitted.
  writeFile(path.join(dir, '.oxe', 'FIXTURE-PACK.json'), `${JSON.stringify({ schema_version: '1', ready: true, fixtures: [], status: 'not_applicable', reason: 'os testes de aceite congelados trazem os próprios dados; não há parser de formato externo nem layout a reproduzir' }, null, 2)}\n`);
  writeFile(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), `# REFERENCE-ANCHORS — ${def.name}\n\n<reference_anchors version="1" ready="true" status="not_applicable">\n  <!-- Projeto novo, sem referência externa: a especificação são a SPEC e os testes de aceite congelados. -->\n</reference_anchors>\n`);
}

// ── planner artifacts ───────────────────────────────────────────────────────────

function roadmapMd(def) {
  const blocks = def.phases.map((p, i) => `## Fase ${i + 1} — ${p.title}\n\n**Requisitos:** R${i + 1}\n**Critérios de aceite:** ${p.tasks.map((t) => t.aceite).join(', ')}\n**Escopo:** ${p.scope}\n`);
  return `---\noxe_doc: roadmap\nstatus: approved\n---\n\n# Roteiro de Entrega — ${def.name}\n\n${def.objective}\n\n${blocks.join('\n')}`;
}

function specMd(def, phase) {
  const rows = phase.tasks.map((t) => `| ${t.aceite} | ${t.criterion} | \`node --test ${acceptancePath(t.aceite)}\` |`).join('\n');
  return `# OXE — SPEC (${def.name} · ${phase.id})\n\n## Objetivo\n\n${def.objective}\n\nFase ${phase.id} — ${phase.title}: ${phase.scope}.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n${rows}\n\n## Fora de escopo\n\n- Dependências externas, persistência em disco além do pedido e qualquer interface não descrita acima.\n`;
}

function planMd(def, phase) {
  const blocks = phase.tasks.map((t) => `### ${t.id} — ${t.title}

- **Arquivos alvo:** ${t.files.map((f) => `\`${f}\``).join(', ')}
- **Depende de:** ${t.dependsOn && t.dependsOn.length ? t.dependsOn.join(', ') : '—'}
- **Onda:** ${t.wave}
- **Implementar:** ${t.goal}
- **Verificar:**
  - Comando: \`node --test ${acceptancePath(t.aceite)}\`
- **Aceite vinculado:** ${t.aceite}
`).join('\n');
  return `# OXE — PLAN (${def.name} · ${phase.id})

## Tarefas

${blocks}
## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 92%

| Dimensão | Nota |
|---|---|
| Completude dos requisitos | alta: cada critério tem teste de aceite congelado |
| Dependências conhecidas | altas: só Node e módulos nativos |
| Risco técnico | baixo |
| Impacto no código existente | baixo: arquivos novos, escopo fechado por tarefa |
| Clareza da validação / testes | alta: testes do planner + gates do repositório |
| Lacunas externas / decisões pendentes | nenhuma |

**Principais incertezas:** interpretação de casos-limite não cobertos pelos testes (o oráculo independente mede).
**Alternativas descartadas:** dependências de terceiros (fora da regra do repositório); uma tarefa por fase (perde o paralelismo por onda).
**Condição para replanejar:** um teste de aceite que se prove ambíguo ou um gate do repositório que reprove por motivo de plano.

<confidence_vector>
  <global score="0.92" />
  <dimension name="requirements" score="0.95" />
  <dimension name="dependencies" score="0.95" />
  <dimension name="technical_risk" score="0.9" />
  <dimension name="code_impact" score="0.95" />
  <dimension name="validation" score="0.95" />
  <dimension name="open_gaps" score="0.85" />
</confidence_vector>
`;
}

function planJson(phase) {
  return {
    schema_version: 1,
    phase: phase.id,
    budget: { max_retries: 2 },
    tasks: phase.tasks.map((t) => ({
      id: t.id, title: t.title, wave: t.wave, depends_on: t.dependsOn || [], files: t.files,
      verify: { commands: [`node --test ${acceptancePath(t.aceite)}`] }, acceptance: [t.aceite], complexity: 'S', commit: t.commit,
    })),
    acceptance_tests: phase.tasks.map((t) => ({
      criterion: t.aceite,
      files: [acceptancePath(t.aceite)],
      command: `node --test ${acceptancePath(t.aceite)}`,
    })),
  };
}

function packJson(phase) {
  return {
    schema_version: 1,
    ready: true,
    critical_gaps: [],
    tasks: phase.tasks.map((t) => ({
      id: t.id, mode: 'mutating', ready: true, exact_paths: t.files, write_set: 'closed', mutation_scope: 'code', risk: 'low',
      symbols: t.symbols.map(([file, name]) => ({ kind: 'function', name, path: file })),
      contracts: [{ name: `${t.id}-contract`, input_shape: acceptancePath(t.aceite), output_shape: 'exports declarados em symbols', invariants: ['teste de aceite inalterado', 'sem dependências externas'], not_allowed: ['editar test/acceptance/', 'console.log em src/'] }],
      expected_checks: ['acceptance tests', 'phase gates: test, lint'],
      requires_fixture: false,
    })),
  };
}

// ── oracle ──────────────────────────────────────────────────────────────────────

function oracle(dir, phases) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ref-oracle-'));
  try {
    for (const sub of ['src', 'bin']) if (fs.existsSync(path.join(dir, sub))) fs.cpSync(path.join(dir, sub), path.join(sandbox, sub), { recursive: true });
    const per = {};
    for (const phase of phases) {
      const file = path.join(sandbox, `oracle-${phase.id}.test.js`);
      writeFile(file, phase.oracle);
      const res = spawnSync(process.execPath, ['--test', file], { cwd: sandbox, encoding: 'utf8', timeout: 120000 });
      per[phase.id] = res.status === 0;
      if (res.status !== 0) per[`${phase.id}_output`] = (res.stdout + res.stderr).split('\n').filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 8).join('\n');
    }
    return { ok: phases.every((p) => per[p.id]), phases: per };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ── one phase ───────────────────────────────────────────────────────────────────

function writeHandoff(dir, def, phase) {
  const r = operational.runtimeDossier(dir, null, { phase: phase.id });
  const file = path.join(r.dir, 'plan.md');
  const exportsList = phase.tasks.map((t) => `- \`${t.files.join('`, `')}\`: ${t.symbols.map((s) => `\`${s[1]}\``).join(', ')}`).join('\n');
  const body = fs.readFileSync(file, 'utf8').replace('(preencher antes do `program close`)', `A fase ${phase.id} (${phase.title}) entrega estes módulos; a próxima fase importa por estes nomes e não muda as assinaturas:\n\n${exportsList}\n\nRegras que continuam valendo: sem dependências, CommonJS, sem console.log em src/.`);
  fs.writeFileSync(file, body, 'utf8');
}

async function runPhase(def, dir, phase, priorPhases) {
  const program = operational.runtimeProgramStatus(dir, null);
  const phases = program && program.state && Array.isArray(program.state.phases) ? program.state.phases : [];
  const status = (phases.find((p) => p.id === phase.id) || {}).status || null;
  if (status === 'closed') {
    log(def.name, phase.id, 'já fechada — pulando');
    return { phase: phase.id, skipped: true, closed: true };
  }
  if (status !== 'executing' && status !== 'verifying' && status !== 'planning') operational.runtimeProgramStart(dir, null, phase.id);

  const planJsonPath = path.join(dir, '.oxe', 'PLAN.json');
  const existing = fs.existsSync(planJsonPath) ? JSON.parse(fs.readFileSync(planJsonPath, 'utf8')) : null;
  if (!existing || existing.phase !== phase.id) {
    writeFile(path.join(dir, '.oxe', 'SPEC.md'), specMd(def, phase));
    writeFile(path.join(dir, '.oxe', 'PLAN.md'), planMd(def, phase));
    writeFile(planJsonPath, `${JSON.stringify(planJson(phase), null, 2)}\n`);
    writeFile(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), `${JSON.stringify(packJson(phase), null, 2)}\n`);
    for (const t of phase.tasks) writeFile(path.join(dir, acceptancePath(t.aceite)), phase.acceptance[t.aceite]);
    git(dir, ['add', 'test/acceptance']);
    git(dir, ['commit', '-qm', `test(${def.name}): frozen acceptance tests for ${phase.id}`]);
  }

  const lint = operational.runtimePlanLint(dir, null, { dryVerify: true });
  log(def.name, phase.id, `plan lint: ${lint.ok ? 'ok' : 'FALHOU'}`, lint.errors.join(' | '));
  if (!lint.ok) return { phase: phase.id, lint, closed: false, aborted: 'plan_lint' };
  if (PLAN_ONLY) {
    const compiled = operational.compileExecutionGraphFromArtifacts(dir, null, {});
    const preflight = operational.buildRuntimeExecutePreflight(dir, null, compiled.run);
    log(def.name, phase.id, `preflight: ${preflight.ok ? 'ready' : 'BLOCKED'}`, preflight.blockers.join(' | '), preflight.warnings.length ? `avisos: ${preflight.warnings.join(' | ')}` : '');
    return { phase: phase.id, lint_ok: lint.ok, preflight, closed: false, aborted: 'plan_only' };
  }

  const executions = [];
  let verified = null;
  for (let round = 1; round <= 2; round += 1) {
    operational.compileExecutionGraphFromArtifacts(dir, null, { runState: round === 1 ? undefined : null });
    const executed = await operational.runRuntimeExecute(dir, null, {
      adapter: 'claude',
      adapterOptions: { model: MODEL },
      providerConfig: { baseUrl: '', apiKey: '', model: MODEL, maxTurns: MAX_TURNS },
      checkpointCommits: true,
      budgetTurns: BUDGET_TURNS,
      onProgress: (event) => {
        if (event && event.type === 'executor_usage') log(def.name, phase.id, event.nodeId, `tentativa ${event.attempt}: ${event.detail && event.detail.turns} turnos, US$ ${Number(event.detail && event.detail.cost_usd || 0).toFixed(2)}${event.detail && event.detail.success === false ? ` (${event.detail.failure_class})` : ''}`);
      },
    });
    executions.push({ round, status: executed.result.status, completed: executed.result.completed, failed: executed.result.failed, blocked: executed.result.blocked, reason: executed.result.reason || null, budget: executed.budget || null, preflight: executed.preflight ? { ok: executed.preflight.ok, blockers: executed.preflight.blockers } : null });
    log(def.name, phase.id, `execute r${round}: ${executed.result.status}`, executed.result.reason || '', executed.preflight && !executed.preflight.ok ? executed.preflight.blockers.join(' | ') : '');
    if (executed.result.status === 'blocked' && (executed.mode === 'preflight' || executed.mode === 'budget')) break;
    verified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 180000 });
    log(def.name, phase.id, `verify r${round}: ${verified.report.status}`, verified.gates ? `gates ${verified.gates.passed.length}/${verified.gates.total}` : '');
    if (verified.report.status === 'passed') break;
  }
  const truth = oracle(dir, [...priorPhases, phase]);
  let closed = { closed: false, gate: null };
  if (verified && verified.report.status === 'passed') {
    writeHandoff(dir, def, phase);
    closed = operational.runtimeProgramClose(dir, null, { message: `feat(${def.name}): close phase ${phase.id} — ${phase.title}` });
  }
  log(def.name, phase.id, `close: ${closed.closed ? 'fechada' : 'NÃO fechada'}`, closed.gate && closed.gate.reasons ? closed.gate.reasons.join(' | ') : '', `· oráculo ${truth.ok ? 'verde' : 'VERMELHO'}`);
  return {
    phase: phase.id,
    lint_ok: lint.ok,
    executions,
    verify_status: verified ? verified.report.status : null,
    gates: verified ? verified.gates : null,
    closed: closed.closed === true,
    gate_reasons: closed.gate ? closed.gate.reasons : [],
    oracle: truth,
    false_green: closed.closed === true && !truth.ok,
  };
}

async function runProject(def) {
  const dir = path.join(ROOT, def.name);
  if (FRESH && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'))) {
    if (!fs.existsSync(path.join(dir, '.oxe'))) scaffold(def, dir);
    operational.runtimeProgramInit(dir, null);
  }
  const started = Date.now();
  const phases = [];
  for (let i = 0; i < def.phases.length; i += 1) {
    const rec = await runPhase(def, dir, def.phases[i], def.phases.slice(0, i));
    phases.push(rec);
    if (!rec.closed) break;
  }
  const card = operational.runtimeScorecard(dir, null, { write: true, releaseReport: path.join(RELEASE_DIR, 'scorecard-report.json'), name: def.name });
  const usage = operational.readExecutorUsageRows(dir, null, null) || [];
  const cost = usage.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const turns = usage.reduce((s, r) => s + (Number(r.turns) || 0), 0);
  log(def.name, `scorecard ${card.ok ? 'dentro das metas' : 'FORA das metas'}`, JSON.stringify(card.metrics.map((m) => [m.metric, m.value])), `· ${turns} turnos · US$ ${cost.toFixed(2)}`);
  return {
    name: def.name,
    dir,
    ok: phases.length === def.phases.length && phases.every((p) => p.closed && !p.false_green) && card.ok,
    phases,
    scorecard: card,
    turns,
    cost_usd: Math.round(cost * 100) / 100,
    duration_ms: Date.now() - started,
  };
}

async function main() {
  const names = PROJECT === 'all' ? ['ledger-api', 'mdlint'] : [PROJECT];
  const results = [];
  for (const name of names) {
    const def = require(path.join(__dirname, 'reference-projects', `${name}.cjs`));
    results.push(await runProject(def));
  }
  const reportPath = path.join(RELEASE_DIR, 'reference-projects-report.json');
  const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { results: [] };
  const merged = [...(previous.results || []).filter((r) => !names.includes(r.name)), ...results];
  writeFile(reportPath, `${JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), model: MODEL, results: merged }, null, 2)}\n`);
  log(`relatório: ${reportPath}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
