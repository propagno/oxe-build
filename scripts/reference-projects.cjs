#!/usr/bin/env node
'use strict';

/**
 * 1.21 / 1.22.1 · Real reference projects for the maturity scorecard.
 *
 * Builds each project in `scripts/reference-projects/<name>.cjs` end to end with oxe-build and a REAL executor
 * (`claude -p` by default), or offline with `--solution`.
 *
 * Usage:
 *   node scripts/reference-projects.cjs [--project ledger-api|mdlint|all] [--root <dir>]
 *        [--model sonnet] [--plan-model opus] [--execute-model haiku] [--compare <baseline.json>]
 *        [--max-turns 10] [--budget-turns 80] [--fresh] [--plan-only] [--solution]
 *
 * Output: .oxe/release/reference-projects-report.json and scorecard-report.json (oxe-build).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const operational = require(path.join(REPO, 'bin', 'lib', 'oxe-operational.cjs'));
const CLI = path.join(REPO, 'bin', 'oxe-cc.js');
const RELEASE_DIR = path.join(REPO, '.oxe', 'release');

function parseCliArgs(argv = process.argv.slice(2)) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const solution = argv.includes('--solution');
  const rootArg = arg('--root', null);
  const root = rootArg
    ? path.resolve(rootArg)
    : (solution ? fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-reference-solution-')) : path.join(os.homedir(), 'Estudos', 'oxe-reference'));
  const model = arg('--model', 'sonnet');
  const planModel = arg('--plan-model', null);
  const executeModel = arg('--execute-model', null);
  const compare = arg('--compare', null);
  return {
    project: arg('--project', 'all'),
    root,
    model,
    planModel,
    executeModel,
    models: resolveModels({ model, planModel, executeModel }),
    compare: compare ? path.resolve(compare) : null,
    maxTurns: Number(arg('--max-turns', '10')),
    budgetTurns: Number(arg('--budget-turns', '80')),
    fresh: argv.includes('--fresh'),
    planOnly: argv.includes('--plan-only'),
    solution,
    releaseReport: !solution && !argv.includes('--no-release-report'),
  };
}

function resolveModels(opts = {}) {
  const base = String(opts.model || 'sonnet').trim() || 'sonnet';
  const plan = String(opts.planModel || (opts.models && opts.models.plan) || base).trim() || base;
  const execute = String(opts.executeModel || (opts.models && opts.models.execute) || base).trim() || base;
  return { plan, execute };
}

function roundNum(val, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(val) || 0) * factor) / factor;
}

function extractReportTotals(report) {
  const results = Array.isArray(report && report.results) ? report.results : [];
  let cost = 0;
  let turns = 0;
  let farSum = 0;
  let farCount = 0;
  let oracleTotal = 0;
  let oraclePassed = 0;
  let falseGreens = 0;
  let failedProjects = 0;

  for (const r of results) {
    if (!r || r.skipped) continue;
    cost += Number(r.cost_usd) || 0;
    turns += Number(r.turns) || 0;
    if (r.ok === false) failedProjects += 1;
    const metrics = (r.scorecard && Array.isArray(r.scorecard.metrics)) ? r.scorecard.metrics : [];
    const far = metrics.find((m) => m && m.metric === 'first_attempt_rate');
    if (far && typeof far.value === 'number' && !Number.isNaN(far.value)) {
      farSum += far.value;
      farCount += 1;
    }
    for (const ph of Array.isArray(r.phases) ? r.phases : []) {
      if (ph && ph.false_green === true) falseGreens += 1;
      if (ph && ph.oracle && typeof ph.oracle.ok === 'boolean') {
        oracleTotal += 1;
        if (ph.oracle.ok) oraclePassed += 1;
      }
    }
  }
  const firstAttemptRate = farCount > 0 ? roundNum(farSum / farCount, 4) : 1;
  const oracleRate = oracleTotal > 0 ? roundNum(oraclePassed / oracleTotal, 4) : 1;
  return {
    cost_usd: roundNum(cost, 2),
    turns,
    first_attempt_rate: firstAttemptRate,
    oracle_rate: oracleRate,
    false_greens: falseGreens,
    failed_projects: failedProjects,
  };
}

/**
 * Pure ROI comparison between a baseline reference-projects report and a candidate (e.g. model-split) report.
 * Blocks (`regression: true`) if oracle drops below 100%, any `false_green: true` occurs, or any project fails.
 */
function compareReferenceReports(baseline, candidate) {
  const b = extractReportTotals(baseline);
  const c = extractReportTotals(candidate);
  const costDelta = roundNum(c.cost_usd - b.cost_usd, 2);
  const costSavingsPct = b.cost_usd > 0 ? roundNum(((b.cost_usd - c.cost_usd) / b.cost_usd) * 100, 2) : 0;
  const turnsDelta = c.turns - b.turns;
  const farDelta = roundNum(c.first_attempt_rate - b.first_attempt_rate, 4);

  const reasons = [];
  if (c.false_greens > 0) reasons.push(`false_green detectado no candidato (${c.false_greens})`);
  if (c.oracle_rate < 1) reasons.push(`oráculo do candidato abaixo de 100% (${Math.round(c.oracle_rate * 100)}%)`);
  if (c.oracle_rate < b.oracle_rate) reasons.push(`regressão no oráculo vs baseline (${b.oracle_rate} -> ${c.oracle_rate})`);
  if (c.failed_projects > 0) reasons.push(`${c.failed_projects} projeto(s) falharam no candidato`);

  return {
    baseline_models: (baseline && baseline.models) || resolveModels({ model: baseline && baseline.model }),
    candidate_models: (candidate && candidate.models) || resolveModels({ model: candidate && candidate.model }),
    baseline_cost_usd: b.cost_usd,
    candidate_cost_usd: c.cost_usd,
    cost_delta_usd: costDelta,
    cost_savings_pct: costSavingsPct,
    baseline_turns: b.turns,
    candidate_turns: c.turns,
    turns_delta: turnsDelta,
    baseline_first_attempt_rate: b.first_attempt_rate,
    candidate_first_attempt_rate: c.first_attempt_rate,
    first_attempt_rate_delta: farDelta,
    false_greens: c.false_greens,
    oracle_ok: c.oracle_rate === 1 && c.false_greens === 0 && c.failed_projects === 0,
    regression: reasons.length > 0,
    regression_reasons: reasons,
  };
}

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
const acceptancePath = (a, def = null) => (def && def.stack === 'python'
  ? `tests/acceptance/test_${a.toLowerCase()}.py`
  : `test/acceptance/${a.toLowerCase()}.test.js`);

function testCommandFor(def, a, pyBin) {
  const rel = acceptancePath(a, def);
  return def && def.stack === 'python' ? `${pyBin} ${rel} -v` : `node --test ${rel}`;
}

/**
 * Resolves a real Python >= 3.9 executable across Windows (`python` / `py -3`, avoiding the MS Store stub)
 * and POSIX (`python3` / `python`). Returns null when unavailable.
 */
function resolvePythonBinary(options = {}) {
  const spawn = options.spawn || spawnSync;
  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : (process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']);
  for (const cand of candidates) {
    const args = cand === 'py'
      ? ['-3', '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")']
      : ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'];
    const r = spawn(cand, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (!r || r.error || r.status !== 0) continue;
    const m = /^(\d+)\.(\d+)/.exec(String(r.stdout || '').trim());
    if (m && Number(m[1]) === 3 && Number(m[2]) >= 9) {
      return cand === 'py' ? 'py -3' : cand;
    }
  }
  return null;
}

const PY_LINT_SCRIPT = `import os
import py_compile
import sys

problems = []
for root, _dirs, files in os.walk("src"):
    for name in sorted(files):
        if name.endswith(".py"):
            full = os.path.join(root, name)
            try:
                py_compile.compile(full, doraise=True)
            except Exception as exc:
                problems.append(f"{full}: {exc}")

if problems:
    sys.stderr.write("\\n".join(problems) + "\\n")
    sys.exit(1)
print("lint ok")
`;

function spawnPy(pyBin, extraArgs, opts) {
  const parts = String(pyBin).split(/\s+/).filter(Boolean);
  return spawnSync(parts[0], [...parts.slice(1), ...extraArgs], opts);
}

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

function scaffold(def, dir, pyBin = null) {
  fs.mkdirSync(dir, { recursive: true });
  if (def.stack === 'python') {
    writeFile(path.join(dir, 'pyproject.toml'), `[project]\nname = "${def.name}"\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndescription = "${def.description}"\n`);
    writeFile(path.join(dir, '.gitignore'), '.oxe/\n__pycache__/\n*.pyc\n');
    writeFile(path.join(dir, 'scripts', 'lint.py'), PY_LINT_SCRIPT);
    writeFile(path.join(dir, 'src', def.name, '__init__.py'), '"""pycsv package."""\n');
    writeFile(path.join(dir, 'AGENTS.md'), [
      `# ${def.name}`,
      '',
      def.objective,
      '',
      '## Regras do repositório',
      '',
      '- Zero dependências pip: usar exclusivamente Python 3 (>= 3.9) stdlib.',
      '- Não editar `test/acceptance/`: os testes congelados são a especificação.',
      '',
    ].join('\n'));
  } else {
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
  }
  writeFile(path.join(dir, 'README.md'), `# ${def.name}\n\n${def.description}\n\n${def.objective}\n\nBuilt end to end with [oxe-build](https://www.npmjs.com/package/oxe-cc) as a reference project.\n`);
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
    phase_gates: def.stack === 'python'
      ? [
        { id: 'test', command: `${pyBin} -m unittest discover -s tests/acceptance -v`, description: 'suíte completa unittest Python' },
        { id: 'lint', command: `${pyBin} scripts/lint.py`, description: 'sintaxe e compilação Python stdlib' },
      ]
      : [
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
  writeFile(path.join(dir, '.oxe', 'FIXTURE-PACK.json'), `${JSON.stringify({ schema_version: '1', ready: true, fixtures: [], status: 'not_applicable', reason: 'os testes de aceite congelados trazem os próprios dados; não há parser de formato externo nem layout a reproduzir' }, null, 2)}\n`);
  writeFile(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), `# REFERENCE-ANCHORS — ${def.name}\n\n<reference_anchors version="1" ready="true" status="not_applicable">\n  <!-- Projeto novo, sem referência externa: a especificação são a SPEC e os testes de aceite congelados. -->\n</reference_anchors>\n`);
}

// ── planner artifacts ───────────────────────────────────────────────────────────

function roadmapMd(def) {
  const blocks = def.phases.map((p, i) => `## Fase ${i + 1} — ${p.title}\n\n**Requisitos:** R${i + 1}\n**Critérios de aceite:** ${p.tasks.map((t) => t.aceite).join(', ')}\n**Escopo:** ${p.scope}\n`);
  return `---\noxe_doc: roadmap\nstatus: approved\n---\n\n# Roteiro de Entrega — ${def.name}\n\n${def.objective}\n\n${blocks.join('\n')}`;
}

function specMd(def, phase, pyBin = null) {
  const rows = phase.tasks.map((t) => `| ${t.aceite} | ${t.criterion} | \`${testCommandFor(def, t.aceite, pyBin)}\` |`).join('\n');
  return `# OXE — SPEC (${def.name} · ${phase.id})\n\n## Objetivo\n\n${def.objective}\n\nFase ${phase.id} — ${phase.title}: ${phase.scope}.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n${rows}\n\n## Fora de escopo\n\n- Dependências externas, persistência em disco além do pedido e qualquer interface não descrita acima.\n`;
}

function planMd(def, phase, pyBin = null) {
  const blocks = phase.tasks.map((t) => `### ${t.id} — ${t.title}

- **Arquivos alvo:** ${t.files.map((f) => `\`${f}\``).join(', ')}
- **Depende de:** ${t.dependsOn && t.dependsOn.length ? t.dependsOn.join(', ') : '—'}
- **Onda:** ${t.wave}
- **Implementar:** ${t.goal}
- **Verificar:**
  - Comando: \`${testCommandFor(def, t.aceite, pyBin)}\`
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

function planJson(def, phase, pyBin = null) {
  return {
    schema_version: 1,
    phase: phase.id,
    budget: { max_retries: 2 },
    tasks: phase.tasks.map((t) => ({
      id: t.id, title: t.title, wave: t.wave, depends_on: t.dependsOn || [], files: t.files,
      verify: { commands: [testCommandFor(def, t.aceite, pyBin)] }, acceptance: [t.aceite], complexity: 'S', commit: t.commit,
    })),
    acceptance_tests: phase.tasks.map((t) => ({
      criterion: t.aceite,
      files: [acceptancePath(t.aceite, def)],
      command: testCommandFor(def, t.aceite, pyBin),
    })),
  };
}

function packJson(def, phase) {
  return {
    schema_version: 1,
    ready: true,
    critical_gaps: [],
    tasks: phase.tasks.map((t) => ({
      id: t.id, mode: 'mutating', ready: true, exact_paths: t.files, write_set: 'closed', mutation_scope: 'code', risk: 'low',
      symbols: t.symbols.map(([file, name]) => ({ kind: 'function', name, path: file })),
      contracts: [{ name: `${t.id}-contract`, input_shape: acceptancePath(t.aceite, def), output_shape: 'exports declarados em symbols', invariants: ['teste de aceite inalterado', 'sem dependências externas'], not_allowed: ['editar test/acceptance/'] }],
      expected_checks: ['acceptance tests', 'phase gates: test, lint'],
      requires_fixture: false,
    })),
  };
}

// ── oracle ──────────────────────────────────────────────────────────────────────

function oracle(dir, phases, def = null, pyBin = null) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ref-oracle-'));
  try {
    for (const sub of ['src', 'bin']) if (fs.existsSync(path.join(dir, sub))) fs.cpSync(path.join(dir, sub), path.join(sandbox, sub), { recursive: true });
    const per = {};
    for (const phase of phases) {
      if (def && def.stack === 'python') {
        const file = path.join(sandbox, `oracle_${phase.id}.py`);
        writeFile(file, `import os, sys\nsys.path.insert(0, os.path.abspath("src"))\n${phase.oracle}`);
        const res = spawnPy(pyBin, [file, '-v'], { cwd: sandbox, encoding: 'utf8', timeout: 120000, windowsHide: true });
        per[phase.id] = res.status === 0;
        if (res.status !== 0) per[`${phase.id}_output`] = (res.stdout + res.stderr).split('\n').slice(-10).join('\n');
      } else {
        const file = path.join(sandbox, `oracle-${phase.id}.test.js`);
        writeFile(file, phase.oracle);
        const res = spawnSync(process.execPath, ['--test', file], { cwd: sandbox, encoding: 'utf8', timeout: 120000 });
        per[phase.id] = res.status === 0;
        if (res.status !== 0) per[`${phase.id}_output`] = (res.stdout + res.stderr).split('\n').filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 8).join('\n');
      }
    }
    return { ok: phases.every((p) => per[p.id]), phases: per };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ── scripted executor (offline mode) ────────────────────────────────────────────

function solutionExecutor(def, phase) {
  const base = path.join(__dirname, 'reference-projects', 'solutions', def.name);
  return {
    async execute(node, lease) {
      const task = phase.tasks.find((t) => t.id === node.id);
      if (!task) return { success: false, failure_class: 'env', evidence: [], output: `tarefa desconhecida ${node.id}` };
      for (const rel of task.files) {
        const from = path.join(base, rel);
        if (!fs.existsSync(from)) return { success: false, failure_class: 'env', evidence: [], output: `solução sem ${rel}` };
        writeFile(path.join(lease.root_path, rel), fs.readFileSync(from, 'utf8'));
      }
      return { success: true, failure_class: null, evidence: [...task.files], output: 'solution', completed_by: 'finish_task' };
    },
  };
}

// ── one phase ───────────────────────────────────────────────────────────────────

function writeHandoff(dir, def, phase) {
  const r = operational.runtimeDossier(dir, null, { phase: phase.id });
  const file = path.join(r.dir, 'plan.md');
  const exportsList = phase.tasks.map((t) => `- \`${t.files.join('`, `')}\`: ${t.symbols.map((s) => `\`${s[1]}\``).join(', ')}`).join('\n');
  const body = fs.readFileSync(file, 'utf8').replace('(preencher antes do `program close`)', `A fase ${phase.id} (${phase.title}) entrega estes módulos; a próxima fase importa por estes nomes e não muda as assinaturas:\n\n${exportsList}\n\nRegras que continuam valendo: sem dependências, CommonJS, sem console.log em src/.`);
  fs.writeFileSync(file, body, 'utf8');
}

async function runPhase(def, dir, phase, priorPhases, opts) {
  const models = resolveModels(opts);
  const program = operational.runtimeProgramStatus(dir, null);
  const phases = program && program.state && Array.isArray(program.state.phases) ? program.state.phases : [];
  const status = (phases.find((p) => p.id === phase.id) || {}).status || null;
  if (status === 'closed') {
    log(def.name, phase.id, 'já fechada — pulando');
    return { phase: phase.id, skipped: true, closed: true, turns: 0, cost_usd: 0 };
  }
  if (status !== 'executing' && status !== 'verifying' && status !== 'planning') operational.runtimeProgramStart(dir, null, phase.id);

  const pyBin = opts.pyBin || null;
  const planJsonPath = path.join(dir, '.oxe', 'PLAN.json');
  const existing = fs.existsSync(planJsonPath) ? JSON.parse(fs.readFileSync(planJsonPath, 'utf8')) : null;
  if (!existing || existing.phase !== phase.id) {
    writeFile(path.join(dir, '.oxe', 'SPEC.md'), specMd(def, phase, pyBin));
    writeFile(path.join(dir, '.oxe', 'PLAN.md'), planMd(def, phase, pyBin));
    writeFile(planJsonPath, `${JSON.stringify(planJson(def, phase, pyBin), null, 2)}\n`);
    writeFile(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), `${JSON.stringify(packJson(def, phase), null, 2)}\n`);
    for (const t of phase.tasks) {
      const body = def.stack === 'python'
        ? `import os, sys\nsys.path.insert(0, os.path.abspath("src"))\n${phase.acceptance[t.aceite]}`
        : phase.acceptance[t.aceite];
      writeFile(path.join(dir, acceptancePath(t.aceite, def)), body);
    }
    git(dir, ['add', def.stack === 'python' ? 'tests/acceptance' : 'test/acceptance']);
    git(dir, ['commit', '-qm', `test(${def.name}): frozen acceptance tests for ${phase.id}`]);
  }

  const lint = operational.runtimePlanLint(dir, null, { dryVerify: true });
  log(def.name, phase.id, `plan lint: ${lint.ok ? 'ok' : 'FALHOU'}`, lint.errors.join(' | '));
  if (!lint.ok) return { phase: phase.id, lint, closed: false, aborted: 'plan_lint', turns: 0, cost_usd: 0 };
  if (opts.planOnly) {
    const compiled = operational.compileExecutionGraphFromArtifacts(dir, null, {});
    const preflight = operational.buildRuntimeExecutePreflight(dir, null, compiled.run);
    log(def.name, phase.id, `preflight: ${preflight.ok ? 'ready' : 'BLOCKED'}`, preflight.blockers.join(' | '), preflight.warnings.length ? `avisos: ${preflight.warnings.join(' | ')}` : '');
    return { phase: phase.id, lint_ok: lint.ok, preflight, closed: false, aborted: 'plan_only', turns: 0, cost_usd: 0 };
  }

  const usageBefore = (operational.readExecutorUsageRows(dir, null, null) || []).length;
  const executions = [];
  let verified = null;
  for (let round = 1; round <= 2; round += 1) {
    operational.compileExecutionGraphFromArtifacts(dir, null, { runState: round === 1 ? undefined : null });
    const executorOptions = opts.solution
      ? { executor: solutionExecutor(def, phase) }
      : { adapter: 'claude', adapterOptions: { model: models.execute }, providerConfig: { baseUrl: '', apiKey: '', model: models.execute, maxTurns: opts.maxTurns } };
    const executed = await operational.runRuntimeExecute(dir, null, {
      ...executorOptions,
      checkpointCommits: true,
      budgetTurns: opts.budgetTurns,
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
  const usageRows = (operational.readExecutorUsageRows(dir, null, null) || []).slice(usageBefore);
  const phaseTurns = usageRows.reduce((s, r) => s + (Number(r.turns) || 0), 0);
  const phaseCost = roundNum(usageRows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0), 2);

  const truth = oracle(dir, [...priorPhases, phase], def, pyBin);
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
    turns: phaseTurns,
    cost_usd: phaseCost,
  };
}

async function runProject(def, opts = {}) {
  const models = resolveModels(opts);
  const pyBin = def.stack === 'python'
    ? (Object.prototype.hasOwnProperty.call(opts, 'pythonBin') ? opts.pythonBin : resolvePythonBinary())
    : null;
  if (def.stack === 'python' && !pyBin) {
    log(def.name, 'pulado: Python >= 3.9 indisponível no ambiente');
    return {
      name: def.name,
      stack: 'python',
      dir: null,
      ok: true,
      skipped: true,
      reason: 'Python >= 3.9 indisponível no ambiente',
      models,
      cost_by_tier: { plan: 0, execute: 0 },
      turns_by_phase: {},
      phases: [],
      scorecard: null,
      turns: 0,
      cost_usd: 0,
      duration_ms: 0,
    };
  }
  const root = opts.root || fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-reference-'));
  const dir = path.join(root, def.name);
  if (opts.fresh && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'))) {
    if (!fs.existsSync(path.join(dir, '.oxe'))) scaffold(def, dir, pyBin);
    operational.runtimeProgramInit(dir, null);
  }
  const started = Date.now();
  const phases = [];
  const turnsByPhase = {};
  const phaseOpts = { ...opts, pyBin };
  for (let i = 0; i < def.phases.length; i += 1) {
    const rec = await runPhase(def, dir, def.phases[i], def.phases.slice(0, i), phaseOpts);
    phases.push(rec);
    turnsByPhase[def.phases[i].id] = Number(rec.turns) || 0;
    if (!rec.closed) break;
  }
  const card = operational.runtimeScorecard(dir, null, { write: true, ...(opts.releaseReport ? { releaseReport: path.join(RELEASE_DIR, 'scorecard-report.json'), name: def.name } : {}) });
  const usage = operational.readExecutorUsageRows(dir, null, null) || [];
  const executeCost = usage.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const planCost = 0;
  const cost = planCost + executeCost;
  const turns = usage.reduce((s, r) => s + (Number(r.turns) || 0), 0);
  log(def.name, `scorecard ${card.ok ? 'dentro das metas' : 'FORA das metas'}`, JSON.stringify(card.metrics.map((m) => [m.metric, m.value])), `· ${turns} turnos · US$ ${cost.toFixed(2)}`);
  return {
    name: def.name,
    dir,
    ok: phases.length === def.phases.length && phases.every((p) => p.closed && !p.false_green) && card.ok,
    models,
    cost_by_tier: {
      plan: roundNum(planCost, 2),
      execute: roundNum(executeCost, 2),
    },
    turns_by_phase: turnsByPhase,
    phases,
    scorecard: card,
    turns,
    cost_usd: roundNum(cost, 2),
    duration_ms: Date.now() - started,
  };
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseCliArgs(argv);
  const names = opts.project === 'all'
    ? ['ledger-api', 'mdlint']
    : (opts.project === 'all-stacks' ? ['ledger-api', 'mdlint', 'pycsv'] : [opts.project]);
  const results = [];
  for (const name of names) {
    const def = require(path.join(__dirname, 'reference-projects', `${name}.cjs`));
    results.push(await runProject(def, opts));
  }
  const reportPath = opts.releaseReport ? path.join(RELEASE_DIR, 'reference-projects-report.json') : path.join(opts.root, 'reference-projects-report.json');
  const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { results: [] };
  const merged = [...(previous.results || []).filter((r) => !names.includes(r.name)), ...results];
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model: opts.models.execute,
    models: opts.models,
    results: merged,
  };
  let comparison = null;
  if (opts.compare && fs.existsSync(opts.compare)) {
    const baseline = JSON.parse(fs.readFileSync(opts.compare, 'utf8'));
    comparison = compareReferenceReports(baseline, report);
    report.comparison = comparison;
    log(`compare vs ${opts.compare}: cost_delta=${comparison.cost_delta_usd} (${comparison.cost_savings_pct}% savings) · regression=${comparison.regression}`);
  }
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log(`relatório: ${reportPath}`);
  const ok = results.every((r) => r.ok) && (!comparison || !comparison.regression);
  process.exitCode = ok ? 0 : 1;
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  resolveModels,
  resolvePythonBinary,
  compareReferenceReports,
  runPhase,
  runProject,
  main,
};
