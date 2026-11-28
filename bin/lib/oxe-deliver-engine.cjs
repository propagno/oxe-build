'use strict';

/**
 * 1.23.0 (OXB-230-13): Deterministic autonomous delivery state machine (`oxe-cc deliver`).
 * Drives both Chat-Driven (`deliver next` / `deliver advance` + MCP) and Terminal Headless (`deliver run`)
 * over the exact same `.oxe/sessions/<id>/DELIVER.json` contract, enforcing:
 *   - Frozen acceptance test SHA-256 anti-cheat verification
 *   - Anti-stub checks before phase completion
 *   - Cumulative regression across all closed phases F1..F(n-1)
 *   - Controlled PHASE_HEAL auto-recovery with model tier escalation and Circuit Breaker -> PAUSED_BLOCKED
 * Pure Node.js stdlib — zero external production dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ORDER: TIER_ORDER } = require('./oxe-model-tiers.cjs');
const { APPROVAL_PROMPT } = require('./oxe-deliver-intake.cjs');

const STATES = [
  'BOOTSTRAP',
  'INTAKE',
  'CLARIFY',
  'DESIGN_REVIEW',
  'PHASE_FREEZE_TESTS',
  'PHASE_PLAN',
  'PHASE_IMPLEMENT',
  'PHASE_VERIFY',
  'PHASE_HEAL',
  'PHASE_CLOSE',
  'FINAL_SMOKE',
  'DELIVERED',
  'PAUSED_BLOCKED',
  'CANCELLED',
];

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || '').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function sha256File(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return sha256Text(raw);
}

function findDeliverJsonPath(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  if (opts.session) {
    const p = path.join(rootAbs, '.oxe', opts.session, 'DELIVER.json');
    if (fs.existsSync(p)) return p;
  }
  try {
    const health = require('./oxe-project-health.cjs');
    const stateFile = health.oxePaths(rootAbs).state;
    if (fs.existsSync(stateFile)) {
      const activeSession = health.parseActiveSession(fs.readFileSync(stateFile, 'utf8'));
      if (activeSession) {
        const p = path.join(rootAbs, '.oxe', activeSession, 'DELIVER.json');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* fallback below */ }

  const rootDeliver = path.join(rootAbs, '.oxe', 'DELIVER.json');
  if (fs.existsSync(rootDeliver)) return rootDeliver;

  const sessionsDir = path.join(rootAbs, '.oxe', 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const entries = fs.readdirSync(sessionsDir)
      .map((name) => path.join(sessionsDir, name, 'DELIVER.json'))
      .filter((f) => fs.existsSync(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (entries.length > 0) return entries[0];
  }
  return null;
}

function readDeliveryState(projectRoot, opts = {}) {
  const file = findDeliverJsonPath(projectRoot, opts);
  if (!file) return null;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, state };
}

function syncProgramJsonFromDelivery(projectRoot, deliverFile, state) {
  try {
    const programFile = path.join(path.dirname(deliverFile), 'program', 'PROGRAM.json');
    fs.mkdirSync(path.dirname(programFile), { recursive: true });
    const activePhase = state.phases[state.active_phase_index] && state.phases[state.active_phase_index].status !== 'closed'
      ? state.phases[state.active_phase_index].id
      : null;
    const doc = {
      schema_version: 1,
      roadmap_ref: path.relative(path.resolve(projectRoot), path.join(path.dirname(deliverFile), 'ROADMAP.md')).replace(/\\/g, '/'),
      active_phase: state.status === 'DELIVERED' || state.status === 'CANCELLED' ? null : activePhase,
      phases: (state.phases || []).map((ph) => ({
        id: ph.id,
        title: ph.title,
        requirements: ph.requirements || [],
        acceptance: ph.acceptance || [],
        scope: ph.scope || '',
        status: ph.status || 'pending',
        ...(ph.closed_at ? { closed_at: ph.closed_at } : {}),
      })),
      created_at: state.created_at,
      updated_at: state.updated_at,
    };
    fs.writeFileSync(programFile, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  } catch { /* auxiliary projection */ }
}

function writeDeliveryState(projectRoot, file, state) {
  state.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  syncProgramJsonFromDelivery(projectRoot, file, state);
  return state;
}

function requireDelivery(projectRoot, opts = {}) {
  const found = readDeliveryState(projectRoot, opts);
  if (!found) {
    throw new Error('Nenhuma entrega ativa encontrada (DELIVER.json ausente). Inicie com `oxe-cc deliver init --from <briefing.md>`.');
  }
  return found;
}

function verifyFrozenTestHashes(projectRoot, state) {
  const rootAbs = path.resolve(projectRoot);
  const hashes = (state && state.frozen_test_hashes) || {};
  const tampered = [];
  const checked = [];
  for (const [rel, expected] of Object.entries(hashes)) {
    const abs = path.resolve(rootAbs, rel);
    if (!fs.existsSync(abs)) {
      tampered.push({ file: rel, reason: 'missing', expected, actual: null });
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== expected) {
      tampered.push({ file: rel, reason: 'modified', expected, actual });
    } else {
      checked.push(rel);
    }
  }
  return { ok: tampered.length === 0, checked, tampered };
}

function checkTestFileRigor(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  if (!raw.trim()) return { ok: false, reason: 'arquivo de teste vazio' };
  const hasAssertion = /\b(assert(?:\.[a-zA-Z]+)?|expect\s*\(|strictEqual|deepStrictEqual|ok\s*\(|match\s*\(|raises\s*\()/m.test(raw);
  if (!hasAssertion) return { ok: false, reason: 'teste congelado sem asserção verificável (assert/expect)' };
  return { ok: true };
}

function checkAntiStubFiles(projectRoot, relFiles) {
  const rootAbs = path.resolve(projectRoot);
  const stubCheck = require('./oxe-stub-check.cjs');
  const findings = [];
  for (const rel of relFiles || []) {
    const abs = path.resolve(rootAbs, rel);
    if (!fs.existsSync(abs)) continue;
    let stat = null;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile()) continue;
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/oxe-stub-ok/i.test(line)) return;
      for (const pat of stubCheck.STUB_PATTERNS) {
        if (pat.re.test(line)) {
          findings.push({ file: rel, line: idx + 1, why: pat.why });
          break;
        }
      }
    });
  }
  return { ok: findings.length === 0, findings };
}

function runShellCommand(projectRoot, command, timeoutMs = 120000) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const res = spawnSync(command, {
    cwd: path.resolve(projectRoot),
    shell: true,
    env: childEnv,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  const exitCode = res.status == null ? (res.error ? 1 : 0) : res.status;
  return {
    ok: exitCode === 0 && !res.error,
    exitCode,
    stdout,
    stderr,
    error: res.error ? res.error.message : null,
  };
}

function escalateTier(currentTier) {
  const idx = TIER_ORDER.indexOf(currentTier || 'balanced');
  if (idx < 0) return 'balanced';
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, idx + 1)];
}

/**
 * Sets approval mode (`single-ok` | `auto`). If already in DESIGN_REVIEW and switched to `auto`,
 * auto-approves immediately into PHASE_FREEZE_TESTS.
 */
function setApprovalMode(projectRoot, mode, opts = {}) {
  const { file, state } = requireDelivery(projectRoot, opts);
  const norm = String(mode || '').trim().toLowerCase();
  const normalized = (norm === 'auto' || norm === 'automatic' || norm === 'automatico')
    ? 'auto'
    : (norm === 'single-ok' || norm === 'single' || norm === 'ok')
      ? 'single-ok'
      : null;
  if (!normalized) {
    throw new Error(`Modo de aprovação inválido: "${mode}". Use "single-ok" ou "auto".`);
  }
  const now = new Date().toISOString();
  state.approval_mode = normalized;
  state.history.push({ at: now, event: 'approval_mode_set', approval_mode: normalized });
  if (normalized === 'auto' && state.status === 'DESIGN_REVIEW' && (state.blocking_questions || []).length === 0) {
    state.auto_approved = true;
    state.status = 'PHASE_FREEZE_TESTS';
    if (state.phases[state.active_phase_index]) state.phases[state.active_phase_index].status = 'active';
    state.history.push({ at: now, event: 'auto_approved', status: state.status });
  }
  writeDeliveryState(projectRoot, file, state);
  return { ok: true, deliver_id: state.deliver_id, state };
}

/**
 * Records answers to blocking clarification questions (`CLARIFY` -> `DESIGN_REVIEW` or `PHASE_FREEZE_TESTS`).
 */
function answerClarification(projectRoot, answers = {}, opts = {}) {
  const { file, state } = requireDelivery(projectRoot, opts);
  if (state.status !== 'CLARIFY' && !opts.force) {
    return { ok: false, error: `Entrega está em estado "${state.status}", não em CLARIFY.`, state };
  }
  state.answers = { ...(state.answers || {}), ...(answers && typeof answers === 'object' ? answers : {}) };
  const remaining = (state.blocking_questions || []).filter((q) => {
    const val = state.answers[q.id] || state.answers[q.topic];
    return !val || !String(val).trim();
  });
  const now = new Date().toISOString();
  state.blocking_questions = remaining;
  state.history.push({ at: now, event: 'clarification_answered', remaining: remaining.length });

  if (remaining.length === 0 || opts.force) {
    if (state.approval_mode === 'auto') {
      state.auto_approved = true;
      state.status = 'PHASE_FREEZE_TESTS';
      if (state.phases[state.active_phase_index]) state.phases[state.active_phase_index].status = 'active';
      state.history.push({ at: now, event: 'auto_approved', status: state.status });
    } else {
      state.status = 'DESIGN_REVIEW';
      state.history.push({ at: now, event: 'ready_for_design_review', status: state.status });
    }
  }
  writeDeliveryState(projectRoot, file, state);
  return { ok: true, deliver_id: state.deliver_id, remaining: remaining.length, state };
}

/**
 * Approves the SPEC + Phases plan (`DESIGN_REVIEW` -> `PHASE_FREEZE_TESTS`).
 */
function approveDelivery(projectRoot, opts = {}) {
  const { file, state } = requireDelivery(projectRoot, opts);
  if (state.status !== 'DESIGN_REVIEW' && !(state.status === 'CLARIFY' && opts.force)) {
    return { ok: false, error: `Aprovação só se aplica em DESIGN_REVIEW (estado atual: ${state.status}).`, state };
  }
  const now = new Date().toISOString();
  if (state.approval_mode === 'pending_choice') state.approval_mode = 'single-ok';
  state.approved_at = now;
  state.approved_by = opts.by || 'user';
  state.status = 'PHASE_FREEZE_TESTS';
  if (state.phases[state.active_phase_index]) state.phases[state.active_phase_index].status = 'active';
  state.history.push({ at: now, event: 'approved', by: state.approved_by, status: state.status });
  writeDeliveryState(projectRoot, file, state);
  return { ok: true, deliver_id: state.deliver_id, state };
}

/**
 * Returns ONE crisp, self-contained atomic contract for the agent (chat or headless runner).
 */
function getNextDeliveryStep(projectRoot, opts = {}) {
  const { state } = requireDelivery(projectRoot, opts);
  const phase = state.phases[state.active_phase_index] || null;
  const phaseMeta = phase
    ? { id: phase.id, index: state.active_phase_index + 1, total: state.phases.length, title: phase.title, acceptance: phase.acceptance || [] }
    : null;
  const baseConstraints = [
    'Nunca modificar testes congelados (hash SHA-256 verificado em cada advance).',
    'Zero código placeholder ou retorno simulado; validar com testes reais.',
    'Nunca executar git push, abrir PR remoto ou rodar npm publish sem OK explícito.',
  ];

  let instruction = '';
  let advanceCmd = 'oxe-cc deliver advance --json';
  let verifyCmd = null;
  let allowedFiles = [];
  let frozenTests = phase ? (phase.frozen_tests || []) : [];

  if (state.status === 'CLARIFY') {
    instruction = state.approval_mode === 'pending_choice'
      ? 'Pergunte ao usuário o modo de aprovação (single-ok vs. auto) e as questões bloqueantes listadas em blocking_questions.'
      : 'Faça ao usuário apenas as perguntas bloqueantes em blocking_questions e registre as respostas via `oxe-cc deliver answer`.';
    advanceCmd = 'oxe-cc deliver answer --json';
  } else if (state.status === 'DESIGN_REVIEW') {
    instruction = state.approval_mode === 'pending_choice'
      ? 'Apresente SPEC + Fases e pergunte se prefere `single-ok` (aprovar agora) ou `auto` (seguir automático).'
      : 'Apresente o resumo da SPEC e das Fases F1..Fn e aguarde o OK único (`oxe-cc deliver approve`).';
    advanceCmd = 'oxe-cc deliver approve --json';
  } else if (state.status === 'PHASE_FREEZE_TESTS') {
    instruction = `Escreva testes executáveis de aceitação para os critérios ${(phaseMeta && phaseMeta.acceptance.join(', ')) || 'da fase'} ANTES de escrever código de produção e chame deliver advance --frozen-tests <arquivos>.`;
    advanceCmd = 'oxe-cc deliver advance --frozen-tests <arquivo.test.cjs> --json';
  } else if (state.status === 'PHASE_PLAN') {
    instruction = `Defina as tarefas da fase ${phaseMeta ? phaseMeta.id : ''} cobrindo ${(phaseMeta && phaseMeta.acceptance.join(', ')) || 'todos os critérios'} e chame deliver advance.`;
    advanceCmd = 'oxe-cc deliver advance --json';
  } else if (state.status === 'PHASE_IMPLEMENT' || state.status === 'PHASE_VERIFY') {
    const tasks = (phase && Array.isArray(phase.tasks) ? phase.tasks : []);
    allowedFiles = [...new Set(tasks.flatMap((t) => t.files || []))];
    verifyCmd = frozenTests.length ? `node --test ${frozenTests.join(' ')}` : null;
    instruction = `Implemente os arquivos da fase ${phaseMeta ? phaseMeta.id : ''} até todos os testes congelados passarem e chame deliver advance.`;
  } else if (state.status === 'PHASE_HEAL') {
    const tasks = (phase && Array.isArray(phase.tasks) ? phase.tasks : []);
    allowedFiles = [...new Set(tasks.flatMap((t) => t.files || []))];
    verifyCmd = frozenTests.length ? `node --test ${frozenTests.join(' ')}` : null;
    instruction = `Corrija a causa raiz da falha (tentativa ${(state.heal_state && state.heal_state.attempt) || 1}/${state.budget.max_attempts_per_task}, tier ${(state.heal_state && state.heal_state.tier) || 'powerful'}) sem alterar testes congelados e chame deliver advance.`;
  } else if (state.status === 'FINAL_SMOKE') {
    instruction = 'Execute o smoke real do produto entregue e gere DELIVERY.md via `oxe-cc deliver advance --json`.';
  } else if (state.status === 'PAUSED_BLOCKED') {
    instruction = `Entrega pausada pelo circuit breaker (${state.blocked_reason || 'falha persistente'}). Apresente o diagnóstico ao usuário e aguarde orientação para retomar com \`oxe-cc deliver resume\`.`;
    advanceCmd = 'oxe-cc deliver resume --json';
  } else if (state.status === 'DELIVERED') {
    instruction = 'Entrega concluída e verificada! Apresente o resumo de DELIVERY.md ao usuário com os comandos de como rodar agora.';
    advanceCmd = null;
  }

  return {
    ok: true,
    oxeDeliverNextSchema: 1,
    deliver_id: state.deliver_id,
    title: state.title,
    state: state.status,
    approval_mode: state.approval_mode,
    approval_prompt: state.approval_mode === 'pending_choice' ? APPROVAL_PROMPT : null,
    phase: phaseMeta,
    tasks: (phase && phase.tasks) || [],
    allowed_files: allowedFiles,
    frozen_tests: frozenTests,
    blocking_questions: state.blocking_questions || [],
    constraints: baseConstraints,
    instruction,
    verify_cmd: verifyCmd,
    advance_cmd: advanceCmd,
    heal_state: state.heal_state || null,
    budget: {
      spent_usd: state.budget.spent_usd,
      limit_usd: state.budget.max_usd,
      attempt: (state.heal_state && state.heal_state.attempt) || 0,
      max_attempts: state.budget.max_attempts_per_task,
    },
    blocked_reason: state.blocked_reason || null,
  };
}

function collectCumulativeFrozenTests(state, upToIndex) {
  const out = [];
  for (let i = 0; i <= upToIndex && i < (state.phases || []).length; i += 1) {
    const ph = state.phases[i];
    for (const f of (ph.frozen_tests || [])) {
      if (!out.includes(f)) out.push(f);
    }
  }
  return out;
}

/**
 * Mechanically verifies the gate for the active state and advances DELIVER.json.
 */
function advanceDelivery(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const { file, state } = requireDelivery(rootAbs, opts);
  const now = new Date().toISOString();

  if (Number.isFinite(Number(opts.costUsd)) && Number(opts.costUsd) > 0) {
    state.budget.spent_usd = Math.round((state.budget.spent_usd + Number(opts.costUsd)) * 10000) / 10000;
  }

  const phase = state.phases[state.active_phase_index] || null;

  if (state.status === 'DELIVERED' || state.status === 'CANCELLED') {
    return { ok: true, deliver_id: state.deliver_id, state, note: `Entrega já finalizada (${state.status}).` };
  }

  if (state.status === 'PAUSED_BLOCKED') {
    return { ok: false, deliver_id: state.deliver_id, state, error: `Entrega pausada (${state.blocked_reason}). Use \`oxe-cc deliver resume\` após corrigir.` };
  }

  if (state.status === 'CLARIFY' || state.status === 'DESIGN_REVIEW') {
    return { ok: false, deliver_id: state.deliver_id, state, error: `Estado "${state.status}" requer ação explícita (${state.status === 'CLARIFY' ? 'deliver answer' : 'deliver approve'}).` };
  }

  // Gate 1: PHASE_FREEZE_TESTS -> PHASE_PLAN
  if (state.status === 'PHASE_FREEZE_TESTS') {
    let candidateTests = Array.isArray(opts.frozenTests) ? opts.frozenTests.map(normPath).filter(Boolean) : [];
    if (!candidateTests.length) {
      const accDir = path.join(rootAbs, 'tests', 'acceptance');
      if (fs.existsSync(accDir)) {
        candidateTests = fs.readdirSync(accDir)
          .filter((f) => /\.(test|spec)\.[cm]?[jt]s$/i.test(f))
          .map((f) => `tests/acceptance/${f}`);
      }
    }
    if (!candidateTests.length) {
      return { ok: false, deliver_id: state.deliver_id, state, error: 'Nenhum teste de aceitação encontrado para congelar em PHASE_FREEZE_TESTS.' };
    }
    for (const rel of candidateTests) {
      const abs = path.resolve(rootAbs, rel);
      if (!fs.existsSync(abs)) {
        return { ok: false, deliver_id: state.deliver_id, state, error: `Teste congelado inexistente: ${rel}` };
      }
      const rigor = checkTestFileRigor(abs);
      if (!rigor.ok) {
        return { ok: false, deliver_id: state.deliver_id, state, error: `Teste ${rel} reprovado no rigor check: ${rigor.reason}` };
      }
      state.frozen_test_hashes[rel] = sha256File(abs);
    }
    if (phase) {
      phase.frozen_tests = [...new Set([...(phase.frozen_tests || []), ...candidateTests])];
    }
    state.status = 'PHASE_PLAN';
    state.history.push({ at: now, event: 'PHASE_FREEZE_TESTS', phase: phase && phase.id, frozen_tests: candidateTests });
    writeDeliveryState(rootAbs, file, state);
    return { ok: true, deliver_id: state.deliver_id, state, frozen_tests: candidateTests };
  }

  // Gate 2: PHASE_PLAN -> PHASE_IMPLEMENT
  if (state.status === 'PHASE_PLAN') {
    let tasks = Array.isArray(opts.planTasks) ? opts.planTasks : null;
    if (!tasks || !tasks.length) {
      const planPath = path.join(rootAbs, '.oxe', 'PLAN.json');
      if (fs.existsSync(planPath)) {
        try {
          const doc = JSON.parse(fs.readFileSync(planPath, 'utf8'));
          if (doc && Array.isArray(doc.tasks) && doc.tasks.length) tasks = doc.tasks;
        } catch { /* fallback */ }
      }
    }
    if (!tasks || !tasks.length) {
      tasks = [
        {
          id: 'T1',
          title: `Implementar fase ${phase ? phase.id : 'F1'}`,
          files: [],
          acceptance: (phase && phase.acceptance) || [],
          verify: phase && phase.frozen_tests && phase.frozen_tests.length
            ? `node --test ${phase.frozen_tests.join(' ')}`
            : null,
        },
      ];
    }
    const covered = new Set(tasks.flatMap((t) => t.acceptance || []));
    const missingCriteria = ((phase && phase.acceptance) || []).filter((a) => !covered.has(a));
    if (missingCriteria.length > 0) {
      return {
        ok: false,
        deliver_id: state.deliver_id,
        state,
        error: `Plano da fase ${phase.id} deixou critérios sem cobertura: ${missingCriteria.join(', ')}`,
      };
    }
    if (phase) phase.tasks = tasks;
    const planOut = {
      schema_version: 1,
      phase: phase ? phase.id : null,
      tasks,
      acceptance_tests: ((phase && phase.frozen_tests) || []).map((f) => ({
        file: f,
        command: `node --test ${f}`,
      })),
    };
    fs.mkdirSync(path.join(rootAbs, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(rootAbs, '.oxe', 'PLAN.json'), `${JSON.stringify(planOut, null, 2)}\n`, 'utf8');
    state.status = 'PHASE_IMPLEMENT';
    state.history.push({ at: now, event: 'PHASE_PLAN', phase: phase && phase.id, tasks: tasks.length });
    writeDeliveryState(rootAbs, file, state);
    return { ok: true, deliver_id: state.deliver_id, state };
  }

  // Gate 3: PHASE_IMPLEMENT / PHASE_HEAL / PHASE_VERIFY -> Verify -> PHASE_CLOSE (or PHASE_HEAL / PAUSED_BLOCKED)
  if (state.status === 'PHASE_IMPLEMENT' || state.status === 'PHASE_HEAL' || state.status === 'PHASE_VERIFY') {
    // 3a. Anti-cheat: verify SHA-256 of ALL frozen tests (current + prior phases)
    const hashCheck = verifyFrozenTestHashes(rootAbs, state);
    if (!hashCheck.ok) {
      const names = hashCheck.tampered.map((t) => `${t.file} (${t.reason})`).join(', ');
      state.history.push({ at: now, event: 'anti_cheat_blocked', tampered: hashCheck.tampered });
      writeDeliveryState(rootAbs, file, state);
      return {
        ok: false,
        deliver_id: state.deliver_id,
        state,
        tampered: hashCheck.tampered,
        error: `Anti-cheat: teste congelado adulterado ou removido (${names}) — restaure o teste original antes de avançar.`,
      };
    }

    // 3b. Anti-stub check on phase task files
    const taskFiles = (phase && Array.isArray(phase.tasks) ? phase.tasks : []).flatMap((t) => t.files || []);
    const stubRes = checkAntiStubFiles(rootAbs, taskFiles);
    if (!stubRes.ok) {
      const msg = stubRes.findings.map((f) => `${f.file}:${f.line} (${f.why})`).join('; ');
      state.history.push({ at: now, event: 'anti_stub_blocked', findings: stubRes.findings });
      writeDeliveryState(rootAbs, file, state);
      return {
        ok: false,
        deliver_id: state.deliver_id,
        state,
        error: `Anti-stub bloqueou conclusão da fase: ${msg}`,
      };
    }

    // 3c. Execute verification + cumulative regression
    const cumulativeTests = collectCumulativeFrozenTests(state, state.active_phase_index);
    const verifyCmd = opts.verifyCommand
      || (cumulativeTests.length ? `node --test ${cumulativeTests.map((f) => `"${f}"`).join(' ')}` : null);

    let verifyRes = { ok: true, exitCode: 0, stdout: 'no-op', stderr: '' };
    if (verifyCmd) {
      verifyRes = typeof opts.runCommand === 'function'
        ? opts.runCommand(verifyCmd, rootAbs)
        : runShellCommand(rootAbs, verifyCmd);
    }

    state.history.push({
      at: now,
      event: 'PHASE_VERIFY',
      status: 'PHASE_VERIFY',
      phase: phase && phase.id,
      ok: Boolean(verifyRes.ok),
      command: verifyCmd,
    });

    if (!verifyRes.ok) {
      const rawErr = `${verifyRes.stderr || ''}\n${verifyRes.stdout || ''}`.trim() || `exit=${verifyRes.exitCode}`;
      const normalizedErr = rawErr
        .replace(/\d+(?:\.\d+)?\s*ms/gi, '0ms')
        .replace(/duration_ms[^\n]*/gi, 'duration_ms')
        .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, '<ts>')
        .replace(/\r\n/g, '\n');
      const errTail = rawErr.slice(-600);
      const errHash = sha256Text(normalizedErr.slice(-600));
      const heal = state.heal_state || { attempt: 0, last_error_hash: null, repeated_error_count: 0, tier: 'balanced' };
      heal.attempt = (heal.attempt || 0) + 1;
      heal.repeated_error_count = heal.last_error_hash === errHash ? (heal.repeated_error_count || 1) + 1 : 1;
      heal.last_error_hash = errHash;
      heal.last_failure = errTail;
      heal.tier = escalateTier(heal.tier);
      state.heal_state = heal;
      if (phase) phase.attempts = (phase.attempts || 0) + 1;

      const budgetExceeded = state.budget.spent_usd >= state.budget.max_usd;
      const repeatedLoop = heal.repeated_error_count >= 2;
      const maxAttemptsHit = heal.attempt >= state.budget.max_attempts_per_task;

      if (budgetExceeded || repeatedLoop || maxAttemptsHit) {
        const why = budgetExceeded
          ? `orçamento atingido ($${state.budget.spent_usd}/$${state.budget.max_usd})`
          : repeatedLoop
            ? 'mesmo erro repetido 2x seguidas (loop detectado pelo circuit breaker)'
            : `limite de tentativas atingido (${heal.attempt}/${state.budget.max_attempts_per_task})`;
        state.status = 'PAUSED_BLOCKED';
        state.blocked_reason = `Circuit breaker acionado na fase ${phase ? phase.id : ''}: ${why}`;
        state.history.push({ at: now, event: 'circuit_breaker_tripped', reason: state.blocked_reason });
        writeDeliveryState(rootAbs, file, state);
        return {
          ok: false,
          deliver_id: state.deliver_id,
          blocked: true,
          state,
          error: state.blocked_reason,
          failure_tail: errTail,
        };
      }

      state.status = 'PHASE_HEAL';
      state.history.push({ at: now, event: 'PHASE_HEAL', attempt: heal.attempt, tier: heal.tier });
      writeDeliveryState(rootAbs, file, state);
      return {
        ok: false,
        deliver_id: state.deliver_id,
        healing: true,
        state,
        error: `Verificação falhou na fase ${phase ? phase.id : ''} — entrando em PHASE_HEAL (tentativa ${heal.attempt}/${state.budget.max_attempts_per_task}, tier ${heal.tier}).`,
        failure_tail: errTail,
      };
    }

    // Verification + regression passed! Close phase cleanly.
    state.heal_state = { attempt: 0, last_error_hash: null, repeated_error_count: 0, last_failure: null, tier: 'balanced' };
    if (phase) {
      phase.status = 'closed';
      phase.closed_at = now;
    }
    state.history.push({ at: now, event: 'PHASE_CLOSE', status: 'PHASE_CLOSE', phase: phase && phase.id });

    const nextIdx = state.active_phase_index + 1;
    if (nextIdx < state.phases.length) {
      state.active_phase_index = nextIdx;
      state.phases[nextIdx].status = 'active';
      state.status = 'PHASE_FREEZE_TESTS';
    } else {
      state.status = 'FINAL_SMOKE';
    }
    writeDeliveryState(rootAbs, file, state);
    return { ok: true, deliver_id: state.deliver_id, state, closed_phase: phase && phase.id };
  }

  // Gate 4: FINAL_SMOKE -> DELIVERED
  if (state.status === 'FINAL_SMOKE') {
    let smokeResult = null;
    let handoffResult = null;
    const handoffPath = path.join(__dirname, 'oxe-deliver-handoff.cjs');
    if (fs.existsSync(handoffPath)) {
      const handoffMod = require('./oxe-deliver-handoff.cjs');
      smokeResult = handoffMod.runFinalSmoke(rootAbs, {
        smokeCommand: opts.smokeCommand || null,
        runCommand: opts.runCommand || null,
      });
      if (!smokeResult.ok) {
        state.smoke = smokeResult;
        state.status = 'PHASE_HEAL';
        state.heal_state.last_failure = smokeResult.error || smokeResult.stderr || 'FINAL_SMOKE falhou';
        state.history.push({ at: now, event: 'final_smoke_failed', error: state.heal_state.last_failure });
        writeDeliveryState(rootAbs, file, state);
        return { ok: false, deliver_id: state.deliver_id, state, smoke: smokeResult, error: `FINAL_SMOKE falhou: ${state.heal_state.last_failure}` };
      }
      handoffResult = handoffMod.generateDeliveryHandoff(rootAbs, state, smokeResult, { deliverFile: file });
      state.smoke = smokeResult;
      state.handoff = {
        delivery_md: path.relative(rootAbs, handoffResult.deliveryMdPath).replace(/\\/g, '/'),
        delivery_json: path.relative(rootAbs, handoffResult.deliveryJsonPath).replace(/\\/g, '/'),
        run_commands: handoffResult.payload.how_to_run,
      };
    } else {
      const cmd = opts.smokeCommand || null;
      if (cmd) {
        const sr = typeof opts.runCommand === 'function' ? opts.runCommand(cmd, rootAbs) : runShellCommand(rootAbs, cmd);
        if (!sr.ok) {
          return { ok: false, deliver_id: state.deliver_id, state, error: `FINAL_SMOKE falhou: ${sr.stderr || sr.stdout}` };
        }
        state.smoke = { ok: true, command: cmd, exitCode: sr.exitCode };
      } else {
        state.smoke = { ok: true, command: null, skipped: false, note: 'all phases verified' };
      }
    }
    state.status = 'DELIVERED';
    state.delivered_at = now;
    state.history.push({ at: now, event: 'DELIVERED', status: 'DELIVERED' });
    writeDeliveryState(rootAbs, file, state);
    return { ok: true, deliver_id: state.deliver_id, state, smoke: state.smoke, handoff: handoffResult };
  }

  return { ok: false, deliver_id: state.deliver_id, state, error: `Estado desconhecido: ${state.status}` };
}

/**
 * Resumes a delivery paused by the circuit breaker (`PAUSED_BLOCKED` -> `PHASE_IMPLEMENT`).
 */
function resumeDelivery(projectRoot, opts = {}) {
  const { file, state } = requireDelivery(projectRoot, opts);
  if (state.status !== 'PAUSED_BLOCKED' && !opts.force) {
    return { ok: false, deliver_id: state.deliver_id, state, error: `Entrega não está pausada (estado atual: ${state.status}).` };
  }
  const now = new Date().toISOString();
  state.blocked_reason = null;
  state.heal_state = { attempt: 0, last_error_hash: null, repeated_error_count: 0, last_failure: null, tier: 'balanced' };
  if (Number.isFinite(Number(opts.addBudgetUsd)) && Number(opts.addBudgetUsd) > 0) {
    state.budget.max_usd = Math.round((state.budget.max_usd + Number(opts.addBudgetUsd)) * 100) / 100;
  }
  state.status = opts.targetState || 'PHASE_IMPLEMENT';
  state.history.push({ at: now, event: 'resumed', note: opts.note || null, status: state.status });
  writeDeliveryState(projectRoot, file, state);
  return { ok: true, deliver_id: state.deliver_id, state };
}

function cancelDelivery(projectRoot, opts = {}) {
  const { file, state } = requireDelivery(projectRoot, opts);
  const now = new Date().toISOString();
  state.status = 'CANCELLED';
  state.cancelled_reason = opts.reason || 'cancelled by user';
  state.history.push({ at: now, event: 'cancelled', reason: state.cancelled_reason });
  writeDeliveryState(projectRoot, file, state);
  return { ok: true, deliver_id: state.deliver_id, state };
}

function getDeliveryStatus(projectRoot, opts = {}) {
  const found = readDeliveryState(projectRoot, opts);
  if (!found) {
    return { oxeDeliverSchema: 1, exists: false, state: null };
  }
  const { file, state } = found;
  const closedPhases = (state.phases || []).filter((p) => p.status === 'closed').length;
  const totalPhases = (state.phases || []).length;
  return {
    oxeDeliverSchema: 1,
    exists: true,
    file,
    deliver_id: state.deliver_id,
    progress: {
      closed: closedPhases,
      total: totalPhases,
      pct: totalPhases ? Math.round((closedPhases / totalPhases) * 100) : 0,
    },
    state,
  };
}

module.exports = {
  STATES,
  findDeliverJsonPath,
  readDeliveryState,
  writeDeliveryState,
  verifyFrozenTestHashes,
  checkTestFileRigor,
  setApprovalMode,
  answerClarification,
  approveDelivery,
  getNextDeliveryStep,
  advanceDelivery,
  resumeDelivery,
  cancelDelivery,
  getDeliveryStatus,
};
