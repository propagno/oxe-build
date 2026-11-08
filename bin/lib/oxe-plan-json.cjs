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


/** OXB-085: preconditions a task waits on before starting (PLAN.json `blocked_by` objects). */
const PRECONDITION_KINDS = { pr: ['merged', 'closed'], commit: ['on_branch'], file: ['exists'] };

function preconditionProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'texto ("owner/repo#123") ou { kind: "pr"|"commit"|"file", ref, until? }';
  if (!PRECONDITION_KINDS[entry.kind]) return `kind "${entry.kind}" desconhecido — use pr, commit ou file`;
  if (typeof entry.ref !== 'string' || !entry.ref.trim()) return `${entry.kind}: ref obrigatório (ex.: ${entry.kind === 'pr' ? '"#686"' : entry.kind === 'commit' ? '"a1b2c3d"' : '"src/x.ts"'})`;
  if (entry.until != null && !PRECONDITION_KINDS[entry.kind].includes(entry.until)) return `${entry.kind}: until "${entry.until}" inválido — use ${PRECONDITION_KINDS[entry.kind].join(' | ')}`;
  if (entry.branch != null && (entry.kind !== 'commit' || typeof entry.branch !== 'string')) return 'branch só vale para kind "commit" (texto)';
  return null;
}

function preconditionLabel(p) {
  if (p.kind === 'pr') return `${p.ref} (${p.until === 'closed' ? 'PR fechado' : 'PR mergeado'})`;
  if (p.kind === 'commit') return `commit ${p.ref.slice(0, 12)} em ${p.branch || 'origin/main'}`;
  return `arquivo ${p.ref}`;
}

/** String entries of `blocked_by`: work delivered by another path (the task is externally delivered). */
function externalRefs(task) {
  return (Array.isArray(task && task.blocked_by) ? task.blocked_by : []).filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim());
}

/** Object entries of `blocked_by`, normalized, with a label for the status ("aguardando #686 (PR mergeado)"). */
function taskPreconditions(task) {
  return (Array.isArray(task && task.blocked_by) ? task.blocked_by : [])
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && !preconditionProblem(e))
    .map((e) => {
      const p = { kind: e.kind, ref: e.ref.trim(), until: e.until || PRECONDITION_KINDS[e.kind][0], ...(e.branch ? { branch: e.branch } : {}) };
      return { ...p, label: preconditionLabel(p) };
    });
}

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
    // OXB-086: name the offending value — FRONTEND's prose criteria failed with only "lista de A<n>".
    if (task.acceptance != null) {
      if (!Array.isArray(task.acceptance)) errors.push(`${at}.acceptance: lista de ids A<n> (ex.: ["A12"]), não ${typeof task.acceptance === 'string' ? `o texto "${task.acceptance.slice(0, 60)}"` : typeof task.acceptance}`);
      else {
        const bad = task.acceptance.filter((v) => typeof v !== 'string' || !ACCEPT_RE.test(v));
        if (bad.length) errors.push(`${at}.acceptance: ${bad.map((v) => JSON.stringify(typeof v === 'string' ? v.slice(0, 60) : v)).join(', ')} não ${bad.length > 1 ? 'são ids' : 'é id'} A<n> — critérios são ids A da SPEC; a prosa vai em "notes"`);
      }
    }
    if (task.decisions != null && !isStringArray(task.decisions, DECISION_RE)) errors.push(`${at}.decisions: lista de D-<n>`);
    if (task.complexity != null && !COMPLEXITY.has(task.complexity)) errors.push(`${at}.complexity: XS|S|M|L|XL`);
    if (task.done != null && typeof task.done !== 'boolean') errors.push(`${at}.done: boolean`);
    if (task.done_at != null && typeof task.done_at !== 'string') errors.push(`${at}.done_at: data ISO`);
    if (task.done_commit != null && typeof task.done_commit !== 'string') errors.push(`${at}.done_commit: sha do checkpoint`);
    if (task.reopened != null && !Array.isArray(task.reopened)) errors.push(`${at}.reopened: histórico de reaberturas`);
    if (task.commit != null && (typeof task.commit !== 'string' || !task.commit.trim())) errors.push(`${at}.commit: mensagem do checkpoint`);
    if (task.kind != null && !['code', 'spike', 'verify_only', 'external_delivery'].includes(task.kind)) errors.push(`${at}.kind: code | spike | verify_only | external_delivery`);
    if (task.question != null && typeof task.question !== 'string') errors.push(`${at}.question: texto`);
    if (task.gate != null && (typeof task.gate !== 'object' || Array.isArray(task.gate) || typeof task.gate.reason !== 'string')) errors.push(`${at}.gate: { kind?, reason }`);
    // OXB-085: an entry is a string (work delivered by another path, e.g. "owner/repo#594") or a precondition object
    // { kind: "pr"|"commit"|"file", ref, until? } the task waits on before it starts (it is still this plan's work).
    if (task.blocked_by != null) {
      if (!Array.isArray(task.blocked_by)) errors.push(`${at}.blocked_by: lista de dependências externas`);
      else task.blocked_by.forEach((entry, k) => {
        if (typeof entry === 'string') { if (!entry.trim()) errors.push(`${at}.blocked_by[${k}]: texto vazio`); return; }
        const problem = preconditionProblem(entry);
        if (problem) errors.push(`${at}.blocked_by[${k}]: ${problem}`);
      });
    }
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
      if (entry.proves != null && !isStringArray(entry.proves)) errors.push(`${at}.proves: lista de nomes de teste${entry.proves && typeof entry.proves === 'object' && !Array.isArray(entry.proves) ? ' — o formato { arquivo: [títulos] } é de plano por papel: junte com oxe-cc plan merge' : ''}`);
      if (entry.resolves != null && !isStringArray(entry.resolves, /^CR-\d+$/)) errors.push(`${at}.resolves: lista de CR-NN`);
      if (entry.version != null && !(Number.isInteger(entry.version) && entry.version >= 1)) errors.push(`${at}.version: inteiro ≥ 1`);
    });
  }
  if (doc.budget != null) {
    const b = doc.budget;
    if (typeof b !== 'object' || Array.isArray(b)) errors.push('$.budget: { turns?, usd?, max_retries? }');
    else {
      if (b.turns != null && !(Number.isInteger(b.turns) && b.turns > 0)) errors.push('$.budget.turns: inteiro > 0');
      if (b.usd != null && !(typeof b.usd === 'number' && b.usd > 0)) errors.push('$.budget.usd: número > 0');
      if (b.max_retries != null && !(Number.isInteger(b.max_retries) && b.max_retries >= 0)) errors.push('$.budget.max_retries: inteiro ≥ 0');
    }
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

/**
 * OXB-073: test titles a JS/TS test file declares (`it`/`test` with a literal title, any `.only/.skip/.each` chain).
 * Template literals with `${…}` are skipped (their title is only known at run time).
 */
function declaredTestTitles(text) {
  const out = [];
  const re = /\b(?:it|test)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const m of String(text || '').matchAll(re)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    out.push(m[2].replace(/\\(['"`\\])/g, '$1'));
  }
  return out;
}

/** PLAN.json → mesmo formato de `sdk.parsePlan` (o graph compiler e o verify não mudam). */
function planJsonToParsedPlan(doc) {
  const spikeLib = require('./oxe-spike.cjs');
  const tasks = doc.tasks.map((task) => {
    const commands = task.verify && Array.isArray(task.verify.commands) ? task.verify.commands.map((c) => c.trim()).filter(Boolean) : [];
    // OXB-007: a spike writes only its report and is verified by it (question, answer, evidence).
    const spike = task.kind === 'spike';
    if (spike) commands.push(spikeLib.spikeVerifyCommand(task.id));
    const files = Array.isArray(task.files) && task.files.length ? [...task.files] : spike ? [spikeLib.spikeReportPath(task.id)] : [];
    return {
      id: task.id,
      title: task.title,
      wave: task.wave,
      dependsOn: Array.isArray(task.depends_on) ? [...task.depends_on] : [],
      files,
      verifyCommand: commands.length ? [...new Set(commands)].join(' && ') : null,
      aceite: Array.isArray(task.acceptance) ? [...task.acceptance] : [],
      decisions: Array.isArray(task.decisions) ? [...task.decisions] : [],
      done: task.done === true,
      meta: {
        source: 'PLAN.json',
        complexity: task.complexity || null,
        ...(typeof task.commit === 'string' && task.commit.trim() ? { commit: task.commit.trim() } : {}),
        ...(task.done_commit ? { done_commit: task.done_commit } : {}),
        ...(task.kind ? { kind: task.kind } : {}),
        ...(typeof task.question === 'string' ? { question: task.question } : {}),
        ...(task.gate ? { gate: task.gate } : {}),
        ...(externalRefs(task).length ? { blocked_by: externalRefs(task) } : {}),
        ...(taskPreconditions(task).length ? { waits_on: taskPreconditions(task) } : {}),
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
    // OXB-072: own timeout for a slow suite (e.g. Electron).
    ...(Number.isInteger(entry.timeout_ms) && entry.timeout_ms > 0 ? { timeout_ms: entry.timeout_ms } : {}),
  }));
  // Gates do projeto (1.21, OXB-020): rodam uma vez no verify da fase; normalizados por oxe-phase-gates.cjs.
  const phaseGates = Array.isArray(doc.phase_gates) ? doc.phase_gates.map((gate) => ({ ...gate })) : [];
  // Teto da execução (1.21, OXB-023): turnos/US$ por run e tentativas por tarefa.
  const budget = doc.budget && typeof doc.budget === 'object' && !Array.isArray(doc.budget) ? { ...doc.budget } : null;
  return { tasks, waves, totalTasks: tasks.length, source: 'PLAN.json', phase: doc.phase || null, acceptanceTests, phaseGates, budget };
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

/**
 * OXB-025: a task that finished (verify green) is marked `done` in PLAN.json with when and which checkpoint, so the
 * next compile skips it instead of paying for it again. Atomic write; the rest of the document is kept as is.
 * @returns {boolean} whether PLAN.json changed
 */
/**
 * OXB-087: PLAN.json is written by the running execute (done) and by `plan append` (new tasks) at the same time; both
 * read-modify-write under this lock file so neither drops the other's change. A lock older than 30 s is stale.
 */
function withPlanLock(jsonPath, fn) {
  const lock = `${jsonPath}.lock`;
  const deadline = Date.now() + 10_000;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) { fs.rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (Date.now() > deadline) throw new Error(`PLAN.json ocupado (${lock}) — tente de novo`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* */ }
    fs.rmSync(lock, { force: true });
  }
}

function markPlanTaskDone(planMdPath, taskId, info = {}) {
  const jsonPath = planJsonPathFor(planMdPath);
  if (!jsonPath || !fs.existsSync(jsonPath)) return false;
  return withPlanLock(jsonPath, () => markPlanTaskDoneUnlocked(jsonPath, taskId, info));
}

function markPlanTaskDoneUnlocked(jsonPath, taskId, info) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return false;
  }
  const task = Array.isArray(doc.tasks) ? doc.tasks.find((t) => t && t.id === taskId) : null;
  if (!task) return false;
  if (task.done === true && (!info.commit || task.done_commit === info.commit)) return false;
  task.done = true;
  task.done_at = info.at || new Date().toISOString();
  if (info.commit) task.done_commit = info.commit;
  const tmp = `${jsonPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, jsonPath);
  return true;
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
  const { lintSpikeTask } = require('./oxe-spike.cjs');
  for (const task of tasks) if (!task.done) errors.push(...lintSpikeTask(task));
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
    // OXB-073: each `proves` must name a test the files DECLARE. Paraphrased proves ("ratchet (LIMIT_SELECTED) stays at
    // 22 or lower, never raised" for the test "ratchet stays at 22 or lower (never raised)") can never be found among
    // the passed tests: the verify said proof_not_executed although every test passed.
    if (input.projectRoot) {
      const declared = [];
      for (const file of entry.files || []) {
        let text = '';
        try { text = fs.readFileSync(path.resolve(input.projectRoot, file), 'utf8'); } catch { continue; }
        declared.push(...declaredTestTitles(text));
      }
      if (declared.length) {
        const norm = (s) => String(s).toLowerCase().replace(/[›>]/g, ' ').replace(/\s+/g, ' ').trim();
        const haystack = declared.map(norm);
        for (const proof of entry.proves) {
          const wanted = norm(String(proof).includes('›') ? String(proof).split('›').slice(1).join('›') : proof);
          if (!haystack.some((name) => name.includes(wanted))) {
            errors.push(`teste de aceite ${entry.id || entry.criterion}: proves "${proof}" não é o nome de nenhum teste declarado em ${entry.files.join(', ')} — use o nome exato (ou um trecho dele). Testes declarados: ${declared.slice(0, 8).map((n) => `"${n}"`).join('; ')}`);
          }
        }
      }
    }
  }
  // Emenda de SPEC (CR spec_gap): teste de aceite de versão anterior está stale até ser reescrito.
  // OXB-062: `amendments` tells an additive amendment (earlier tests stay valid, one new test carries the version)
  // from a changing one (every earlier test is stale). Plain `requiredVersions` means changing.
  const amendments = input.amendments instanceof Map
    ? input.amendments
    : new Map([...(input.requiredVersions instanceof Map ? input.requiredVersions : new Map())].map(([c, v]) => [c, { required: v, staleBelow: v }]));
  for (const [criterion, req] of amendments) {
    const entries = acceptanceTests.filter((a) => a.criterion === criterion);
    if (!entries.some((e) => (e.version || 1) >= req.required)) {
      errors.push(entries.length && req.staleBelow < req.required
        ? `${criterion}@v${req.required}: emenda aditiva sem teste novo (adicione um teste com "version": ${req.required}; os anteriores continuam valendo)`
        : entries.length
          ? `${criterion}: teste de aceite v${Math.max(...entries.map((e) => e.version || 1))} está stale — a SPEC foi emendada para v${req.required}`
          : `${criterion}@v${req.required}: emenda sem teste de aceite (escreva-o com "version": ${req.required})`);
    }
    for (const e of entries) {
      const v = e.version || 1;
      if (v < req.staleBelow && entries.some((o) => (o.version || 1) >= req.required)) {
        errors.push(`${criterion}: teste de aceite v${v}${e.files && e.files[0] ? ` (${e.files[0]})` : ''} está stale — a SPEC foi emendada para v${req.staleBelow}`);
      }
    }
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
    // OXB-022: the very rules the execute preflight applies — nothing passes here and blocks there.
    // (spikes declare a docs_only pack entry: they write only their report in .oxe/spikes/)
    const { validatePackTask } = require('./oxe-rationality.cjs');
    const pending = new Set(tasks.filter((task) => !task.done).map((task) => task.id));
    for (const entry of pack) {
      const id = String((entry && (entry.id || entry.task_id)) || '').trim();
      if (id && !pending.has(id)) continue;
      errors.push(...validatePackTask(entry).gaps);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 1.21.1 (OXB-053/046): the task(s) that complete each criterion. A criterion's own verification (the SPEC
 * "Como verificar" / its phase-wide acceptance test) can only pass after the LAST of its tasks: in the oxespace 1.5.0
 * F1 the A4 test checked every dialog in src/ and ran in the verify of T8 and T9 too, failing 12 times (US$ 37.52).
 * The closer is the single task of the criterion that no other task of the same criterion depends on (transitively).
 * With several such sinks the criterion is only checked at phase verify.
 * @returns {Map<string, { closer: string|null, tasks: string[], sinks: string[] }>}
 */
function criterionClosers(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((t) => [t.id, t]));
  const deps = (t) => (Array.isArray(t.dependsOn) ? t.dependsOn : Array.isArray(t.depends_on) ? t.depends_on : []);
  const ancestors = new Map();
  const ancestorsOf = (id, seen = new Set()) => {
    if (ancestors.has(id)) return ancestors.get(id);
    const out = new Set();
    for (const d of deps(byId.get(id) || {})) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.add(d);
      for (const a of ancestorsOf(d, seen)) out.add(a);
    }
    ancestors.set(id, out);
    return out;
  };
  const result = new Map();
  const criteria = new Set(list.flatMap((t) => (Array.isArray(t.aceite) ? t.aceite : Array.isArray(t.acceptance) ? t.acceptance : [])));
  for (const criterion of criteria) {
    const members = list.filter((t) => (t.aceite || t.acceptance || []).includes(criterion)).map((t) => t.id);
    const sinks = members.filter((id) => !members.some((other) => other !== id && ancestorsOf(other).has(id)));
    result.set(criterion, { closer: sinks.length === 1 ? sinks[0] : null, tasks: members, sinks });
  }
  return result;
}

/**
 * 1.21.1: reopens a done task (rework after a CR or a failed phase verify). Since execute recompiles from the plan and
 * skips done tasks, "run it again" means reopening it explicitly — never a stale graph re-running finished work.
 * @returns {boolean} whether PLAN.json changed
 */
function markPlanTaskOpen(planMdPath, taskId, info = {}) {
  const jsonPath = planJsonPathFor(planMdPath);
  if (!jsonPath || !fs.existsSync(jsonPath)) return false;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return false;
  }
  const task = Array.isArray(doc.tasks) ? doc.tasks.find((t) => t && t.id === taskId) : null;
  if (!task || task.done !== true) return false;
  task.done = false;
  task.reopened = [...(Array.isArray(task.reopened) ? task.reopened : []), { at: new Date().toISOString(), by: info.by || null, previous_commit: task.done_commit || null }];
  delete task.done_at;
  delete task.done_commit;
  const tmp = `${jsonPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, jsonPath);
  return true;
}

module.exports = {
  withPlanLock,
  ACCEPT_RE,
  externalRefs,
  taskPreconditions,
  preconditionProblem,
  declaredTestTitles,
  markPlanTaskOpen,
  criterionClosers,
  markPlanTaskDone,
  planJsonPathFor,
  validatePlanJson,
  planJsonToParsedPlan,
  readPlanArtifact,
  lintPlan,
};
