'use strict';

/**
 * OXE 1.19 — PLAN.json canônico + `plan lint`.
 *
 * O PLAN.md parseado por heurística foi a origem da maioria das correções dos benchmarks
 * (escopo `# linkly`, `Comando:` múltiplo, `Arquivos alvo`). Com o PLAN.json ao lado do PLAN.md,
 * o runtime lê dados estruturados; o markdown vira fallback com aviso.
 *
 * Validação sem dependência nova, seguindo `oxe/schemas/plan.schema.json`.
 */

const fs = require('fs');
const path = require('path');

const TASK_ID_RE = /^T\d+$/;
const ACCEPT_RE = /^A\d+$/;
const DECISION_RE = /^D-\d+$/;
const COMPLEXITY = new Set(['XS', 'S', 'M', 'L', 'XL']);

function planJsonPathFor(planMdPath) {
  return planMdPath ? path.join(path.dirname(planMdPath), 'PLAN.json') : null;
}

function isStringArray(value, re) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim() && (!re || re.test(v)));
}

/** Erros de schema (lista vazia = válido). Mensagens com o caminho JSON do problema. */
function validatePlanJson(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['$: PLAN.json deve ser um objeto'];
  if (doc.schema_version !== 1) errors.push('$.schema_version: deve ser 1');
  if (doc.phase != null && !(typeof doc.phase === 'string' && /^F\d+$/.test(doc.phase))) errors.push('$.phase: deve ser "F<n>" ou null');
  if (!Array.isArray(doc.tasks) || doc.tasks.length === 0) {
    errors.push('$.tasks: deve ser uma lista com ao menos 1 tarefa');
    return errors;
  }
  doc.tasks.forEach((task, i) => {
    const at = `$.tasks[${i}]`;
    if (!task || typeof task !== 'object') {
      errors.push(`${at}: deve ser objeto`);
      return;
    }
    if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id)) errors.push(`${at}.id: deve casar ^T\\d+$`);
    if (typeof task.title !== 'string' || !task.title.trim()) errors.push(`${at}.title: obrigatório`);
    if (!Number.isInteger(task.wave) || task.wave < 1) errors.push(`${at}.wave: inteiro ≥ 1`);
    if (task.depends_on != null && !isStringArray(task.depends_on, TASK_ID_RE)) errors.push(`${at}.depends_on: lista de ids T<n>`);
    if (task.files != null && !isStringArray(task.files)) errors.push(`${at}.files: lista de caminhos`);
    if (task.acceptance != null && !isStringArray(task.acceptance, ACCEPT_RE)) errors.push(`${at}.acceptance: lista de A<n>`);
    if (task.decisions != null && !isStringArray(task.decisions, DECISION_RE)) errors.push(`${at}.decisions: lista de D-<n>`);
    if (task.complexity != null && !COMPLEXITY.has(task.complexity)) errors.push(`${at}.complexity: XS|S|M|L|XL`);
    if (task.done != null && typeof task.done !== 'boolean') errors.push(`${at}.done: boolean`);
    if (task.gate != null && (typeof task.gate !== 'object' || Array.isArray(task.gate) || typeof task.gate.reason !== 'string')) errors.push(`${at}.gate: { kind?, reason }`);
    if (task.blocked_by != null && !isStringArray(task.blocked_by)) errors.push(`${at}.blocked_by: lista de dependências externas`);
    if (task.verify != null) {
      if (typeof task.verify !== 'object' || Array.isArray(task.verify)) errors.push(`${at}.verify: objeto`);
      else if (task.verify.commands != null && !isStringArray(task.verify.commands)) errors.push(`${at}.verify.commands: lista de comandos`);
    }
  });
  if (doc.acceptance_tests != null) {
    if (!Array.isArray(doc.acceptance_tests)) errors.push('$.acceptance_tests: lista');
    else doc.acceptance_tests.forEach((entry, i) => {
      const at = `$.acceptance_tests[${i}]`;
      if (!entry || typeof entry !== 'object') return errors.push(`${at}: deve ser objeto`);
      const hasId = typeof entry.id === 'string' && /^[A-Za-z][\w-]*$/.test(entry.id);
      if (entry.id != null && !hasId) errors.push(`${at}.id: identificador (ex.: "CR-03" ou "lint-voice")`);
      if (entry.criterion != null && (typeof entry.criterion !== 'string' || !ACCEPT_RE.test(entry.criterion))) errors.push(`${at}.criterion: A<n>`);
      // Sem critério só para prova transversal (ex.: CR constraint): precisa de id próprio e resolves.
      if (entry.criterion == null && !(hasId && Array.isArray(entry.resolves) && entry.resolves.length)) errors.push(`${at}.criterion: A<n> (ou "id" + "resolves" para uma prova transversal)`);
      if (!isStringArray(entry.files) || entry.files.length === 0) errors.push(`${at}.files: lista com ao menos 1 caminho`);
      if (typeof entry.command !== 'string' || !entry.command.trim()) errors.push(`${at}.command: obrigatório`);
      if (entry.proves != null && !isStringArray(entry.proves)) errors.push(`${at}.proves: lista de nomes de teste`);
      if (entry.resolves != null && !isStringArray(entry.resolves, /^CR-\d+$/)) errors.push(`${at}.resolves: lista de CR-NN`);
      if (entry.version != null && !(Number.isInteger(entry.version) && entry.version >= 1)) errors.push(`${at}.version: inteiro ≥ 1`);
    });
  }
  if (doc.phase_gates != null) {
    if (!Array.isArray(doc.phase_gates)) errors.push('$.phase_gates: lista');
    else doc.phase_gates.forEach((gate, i) => {
      const at = `$.phase_gates[${i}]`;
      if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return errors.push(`${at}: deve ser objeto`);
      if (typeof gate.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(gate.id)) errors.push(`${at}.id: identificador (ex.: "typecheck")`);
      if (gate.kind != null && !['command', 'ci'].includes(gate.kind)) errors.push(`${at}.kind: command | ci`);
      if (gate.kind !== 'ci' && (typeof gate.command !== 'string' || !gate.command.trim())) errors.push(`${at}.command: obrigatório (exceto kind: ci)`);
      if (gate.when != null && !['phase_verify', 'program_close'].includes(gate.when)) errors.push(`${at}.when: phase_verify | program_close`);
      if (gate.runner != null && (typeof gate.runner !== 'string' || !gate.runner.includes('{command}'))) errors.push(`${at}.runner: modelo com {command}`);
      if (gate.timeout_ms != null && !(Number.isInteger(gate.timeout_ms) && gate.timeout_ms > 0)) errors.push(`${at}.timeout_ms: inteiro > 0`);
    });
  }
  return errors;
}

/** PLAN.json → mesmo formato de `sdk.parsePlan` (o graph compiler e o verify não mudam). */
function planJsonToParsedPlan(doc) {
  const tasks = doc.tasks.map((task) => {
    const commands = task.verify && Array.isArray(task.verify.commands) ? task.verify.commands.map((c) => c.trim()).filter(Boolean) : [];
    return {
      id: task.id,
      title: task.title,
      wave: task.wave,
      dependsOn: Array.isArray(task.depends_on) ? [...task.depends_on] : [],
      files: Array.isArray(task.files) ? [...task.files] : [],
      verifyCommand: commands.length ? [...new Set(commands)].join(' && ') : null,
      aceite: Array.isArray(task.acceptance) ? [...task.acceptance] : [],
      decisions: Array.isArray(task.decisions) ? [...task.decisions] : [],
      done: task.done === true,
      meta: {
        source: 'PLAN.json',
        complexity: task.complexity || null,
        ...(task.gate ? { gate: task.gate } : {}),
        ...(Array.isArray(task.blocked_by) && task.blocked_by.length ? { blocked_by: [...task.blocked_by] } : {}),
      },
    };
  });
  const waves = {};
  for (const task of tasks) {
    if (!waves[task.wave]) waves[task.wave] = [];
    waves[task.wave].push(task.id);
  }
  // Testes de aceite do plano (1.19): escritos antes da execução, congelados por hash no compile.
  const acceptanceTests = (Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []).map((entry) => ({
    id: typeof entry.id === 'string' ? entry.id : null,
    criterion: typeof entry.criterion === 'string' ? entry.criterion : null,
    files: [...new Set(entry.files.map((f) => String(f).trim()))],
    command: entry.command.trim(),
    proves: Array.isArray(entry.proves) ? entry.proves.map((name) => String(name).trim()).filter(Boolean) : [],
    resolves: Array.isArray(entry.resolves) ? [...entry.resolves] : [],
    version: Number.isInteger(entry.version) ? entry.version : 1,
  }));
  // Gates do projeto (1.21, OXB-020): rodam uma vez no verify da fase; normalizados por oxe-phase-gates.cjs.
  const phaseGates = Array.isArray(doc.phase_gates) ? doc.phase_gates.map((gate) => ({ ...gate })) : [];
  return { tasks, waves, totalTasks: tasks.length, source: 'PLAN.json', phase: doc.phase || null, acceptanceTests, phaseGates };
}

/**
 * Plano do runtime: PLAN.json válido ao lado do PLAN.md vence; inválido é erro (não cai em
 * silêncio para o markdown); ausente → parser markdown com `source: 'PLAN.md'`.
 */
function readPlanArtifact(planMdPath, planMdText, parseMarkdown) {
  const jsonPath = planJsonPathFor(planMdPath);
  if (jsonPath && fs.existsSync(jsonPath)) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      throw new Error(`PLAN.json inválido (${jsonPath}): ${err.message}`);
    }
    const errors = validatePlanJson(doc);
    if (errors.length) throw new Error(`PLAN.json não segue o schema (${jsonPath}):\n  - ${errors.join('\n  - ')}`);
    return planJsonToParsedPlan(doc);
  }
  const parsed = parseMarkdown(planMdText || '');
  return { ...parsed, source: 'PLAN.md' };
}

function hasCycle(tasks) {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn || []]));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const dep of deps.get(id) || []) if (deps.has(dep) && visit(dep)) return true;
    state.set(id, 2);
    return false;
  };
  return tasks.some((t) => visit(t.id));
}

/**
 * Lint estrutural do plano: torna mecânicas as regras de quality gate de `oxe/workflows/plan.md`.
 * @param {{ plan: any, spec?: any, pack?: any, phase?: any, maxTasksPerWave?: number }} input
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function lintPlan(input) {
  const errors = [];
  const warnings = [];
  const tasks = input.plan && Array.isArray(input.plan.tasks) ? input.plan.tasks : [];
  if (tasks.length === 0) errors.push('plano sem tarefas');
  if (input.plan && input.plan.source === 'PLAN.md') {
    warnings.push('PLAN.json ausente: o runtime usa o parser heurístico do PLAN.md (grave PLAN.json no /oxe-plan)');
  }

  const ids = new Map();
  for (const task of tasks) ids.set(task.id, (ids.get(task.id) || 0) + 1);
  for (const [id, count] of ids) if (count > 1) errors.push(`id duplicado: ${id} (${count}x)`);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    if (task.wave == null) errors.push(`${task.id}: sem onda`);
    for (const dep of task.dependsOn || []) {
      const target = byId.get(dep);
      if (!target) errors.push(`${task.id}: depende de ${dep}, que não existe`);
      else if (dep === task.id) errors.push(`${task.id}: depende de si mesma`);
      else if (target.wave != null && task.wave != null && target.wave >= task.wave) {
        errors.push(`${task.id} (onda ${task.wave}) depende de ${dep} (onda ${target.wave}): a dependência deve estar numa onda anterior`);
      }
    }
    if (!task.verifyCommand && !task.done) warnings.push(`${task.id}: sem comando de verificação`);
  }
  if (tasks.length && hasCycle(tasks)) errors.push('dependência circular entre tarefas');

  const waves = new Map();
  for (const task of tasks) {
    // Uma tarefa concluída não roda de novo: num replan ela não disputa escopo nem lugar na onda (OXB-015).
    if (task.wave == null || task.done) continue;
    if (!waves.has(task.wave)) waves.set(task.wave, []);
    waves.get(task.wave).push(task);
  }
  const waveNumbers = [...waves.keys()].sort((a, b) => a - b);
  waveNumbers.forEach((wave, i) => {
    if (i > 0 && wave !== waveNumbers[i - 1] + 1) warnings.push(`onda ${waveNumbers[i - 1] + 1} vazia (ondas: ${waveNumbers.join(', ')})`);
  });
  for (const [wave, list] of waves) {
    if (input.maxTasksPerWave && list.length > input.maxTasksPerWave) {
      errors.push(`onda ${wave}: ${list.length} tarefas > plan_max_tasks_per_wave (${input.maxTasksPerWave})`);
    }
    const owner = new Map();
    for (const task of list) {
      for (const file of task.files || []) {
        if (owner.has(file)) errors.push(`onda ${wave}: ${owner.get(file)} e ${task.id} escrevem ${file} (escopos devem ser disjuntos na mesma onda)`);
        else owner.set(file, task.id);
      }
    }
  }

  const criteria = input.spec && Array.isArray(input.spec.criteria) ? input.spec.criteria.map((c) => c.id) : [];
  const covered = new Set(tasks.flatMap((t) => t.aceite || []));
  if (criteria.length) {
    const known = new Set(criteria);
    for (const task of tasks) {
      for (const ref of task.aceite || []) if (!known.has(ref)) errors.push(`${task.id}: aceite ${ref} não existe na SPEC`);
    }
  }

  const phase = input.phase || null;
  if (phase && Array.isArray(phase.acceptance) && phase.acceptance.length) {
    const allowed = new Set(phase.acceptance);
    const outside = [...covered].filter((ref) => !allowed.has(ref));
    if (outside.length) errors.push(`fase ${phase.id}: o plano usa A* de outras fases: ${outside.join(', ')}`);
    const missing = phase.acceptance.filter((ref) => !covered.has(ref));
    if (missing.length) errors.push(`fase ${phase.id}: A* da fase sem tarefa: ${missing.join(', ')}`);
    if (input.plan && input.plan.phase && input.plan.phase !== phase.id) {
      errors.push(`PLAN.json declara fase ${input.plan.phase}, mas a fase ativa é ${phase.id}`);
    }
  } else if (criteria.length) {
    const missing = criteria.filter((ref) => !covered.has(ref));
    if (missing.length) warnings.push(`A* da SPEC sem tarefa: ${missing.join(', ')}`);
  }

  // Aceite congelado: o teste que prova o A* é do plano, não do executor.
  const acceptanceTests = input.plan && Array.isArray(input.plan.acceptanceTests) ? input.plan.acceptanceTests : [];
  const testedCriteria = new Set(acceptanceTests.map((entry) => entry.criterion).filter(Boolean));
  const ownedByTasks = new Map();
  for (const task of tasks) for (const file of task.files || []) ownedByTasks.set(file, task.id);
  for (const entry of acceptanceTests) {
    if (entry.criterion && criteria.length && !criteria.includes(entry.criterion)) errors.push(`teste de aceite ${entry.criterion}: critério não existe na SPEC`);
    for (const file of entry.files) {
      if (input.projectRoot && !fs.existsSync(path.resolve(input.projectRoot, file))) {
        errors.push(`teste de aceite ${entry.criterion}: ${file} não existe (escreva-o no /oxe-plan, antes da execução)`);
      }
      if (ownedByTasks.has(file)) {
        errors.push(`teste de aceite ${entry.criterion}: ${file} está no escopo de ${ownedByTasks.get(file)} — o executor não pode escrever o próprio aceite`);
      }
    }
  }
  // Prova executada: o runner precisa listar os nomes dos testes que passaram.
  for (const entry of acceptanceTests) {
    if (!entry.proves || !entry.proves.length) continue;
    const verbose = /--reporter[= ]verbose|--verbose|--test-reporter[= ](tap|spec)|node\s+--test|\s-v\b|junit/i.test(entry.command);
    if (!verbose) warnings.push(`teste de aceite ${entry.criterion}: 'proves' exige saída com nomes de teste — use um reporter verbose (ex.: vitest --reporter=verbose)`);
  }
  // Emenda de SPEC (CR spec_gap): teste de aceite de versão anterior está stale até ser reescrito.
  const required = input.requiredVersions instanceof Map ? input.requiredVersions : new Map();
  for (const [criterion, version] of required) {
    const entry = acceptanceTests.find((a) => a.criterion === criterion);
    if (!entry) errors.push(`${criterion}@v${version}: emenda sem teste de aceite (escreva-o com "version": ${version})`);
    else if ((entry.version || 1) < version) errors.push(`${criterion}: teste de aceite v${entry.version || 1} está stale — a SPEC foi emendada para v${version}`);
  }
  const scopeAcceptance = phase && Array.isArray(phase.acceptance) && phase.acceptance.length ? phase.acceptance : [...covered];
  const untested = scopeAcceptance.filter((ref) => !testedCriteria.has(ref));
  if (untested.length) {
    (input.requireAcceptanceTests ? errors : warnings).push(`A* sem teste de aceite congelado: ${untested.join(', ')}`);
  }

  const pack = input.pack && Array.isArray(input.pack.tasks) ? input.pack.tasks : null;
  if (pack) {
    const packIds = new Set(pack.map((t) => String((t && (t.id || t.task_id)) || '').trim()));
    for (const task of tasks) {
      if ((task.files || []).length && !task.done && !packIds.has(task.id)) {
        errors.push(`${task.id}: tarefa mutável sem entrada no IMPLEMENTATION-PACK`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  planJsonPathFor,
  validatePlanJson,
  planJsonToParsedPlan,
  readPlanArtifact,
  lintPlan,
};
