'use strict';

/**
 * 1.23.0 (OXB-230-12): Autonomous Briefing Intake (`oxe-cc deliver init`).
 * Auto-bootstraps `.oxe/` (lean profile) on greenfield or brownfield repos,
 * classifies blocking ambiguities (0..5 max), records approval_mode (`pending_choice` | `single-ok` | `auto`),
 * and generates SPEC.md + ROADMAP.md + DELIVER.json.
 * Pure Node.js stdlib — zero external production dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { detectProjectMode } = require('./oxe-primer.cjs');

const DELIVER_SCHEMA_VERSION = 1;
const APPROVAL_PROMPT =
  'Como prefere conduzir esta entrega? (1) `single-ok` — pauso 1 única vez após gerar SPEC e Fases para seu OK; ou (2) `auto` — sigo 100% automático se não houver ambiguidades bloqueantes. Defina com `oxe-cc deliver mode single-ok` ou `oxe-cc deliver mode auto`.';

function slugifyTitle(text) {
  const clean = String(text || 'entrega')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return clean || 'entrega';
}

function makeDeliverId(slug) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex');
  return `del-${day}-${slug.slice(0, 16)}-${rand}`;
}

function detectDomainSignals(text, env = {}) {
  const low = String(text || '').toLowerCase();
  const stacks = (env && Array.isArray(env.stacks) ? env.stacks : []).map((s) => String(s).toLowerCase());
  const hasWeb = /\b(web|html|react|vue|svelte|next|vite|dashboard|painel|interface|ui|frontend|página|pagina|browser)\b/i.test(low);
  const hasApi = /\b(api|rest|http|endpoint|rota|server|servidor|express|fastify|graphql|webhook|backend)\b/i.test(low);
  const hasCli = /\b(cli|terminal|comando|command|flag|stdout|stdin|script|binário|binario)\b/i.test(low);
  const hasLib = /\b(lib|biblioteca|sdk|pacote|package|módulo|modulo|npm)\b/i.test(low);
  const hasDb = /\b(banco|database|db|sql|sqlite|postgres|mysql|mongo|persist|json|storage|armazen|crud|tabela)\b/i.test(low);
  const hasAuth = /\b(login|auth|autentica|usuário|usuario|senha|jwt|oauth|permiss|papel|rbac|sessão|sessao)\b/i.test(low);
  const hasStackMention =
    /\b(node\.?js|javascript|typescript|python|go|golang|rust|java|c#|dotnet|ruby|php|react|vue|next|express|fastify|flask|fastapi|django)\b/i.test(low)
    || stacks.length > 0;
  const hasStorageSpec =
    /\b(sqlite|postgres|postgresql|mysql|mongodb|redis|json|csv|memória|memoria|in-memory|arquivo|localstorage|indexeddb|duckdb|prisma|drizzle)\b/i.test(low);
  const hasAuthSpec =
    /\b(local|jwt|session|cookie|oauth|oidc|clerk|auth0|basic|token|api[- ]?key|sem auth|sem login)\b/i.test(low);

  return {
    hasWeb,
    hasApi,
    hasCli,
    hasLib,
    hasDb,
    hasAuth,
    hasStackMention,
    hasStorageSpec,
    hasAuthSpec,
    hasAnyInterface: hasWeb || hasApi || hasCli || hasLib,
  };
}

function extractBullets(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const items = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!m) continue;
    const cleaned = m[1].trim();
    if (cleaned.length >= 6 && !/^#/.test(cleaned)) items.push(cleaned);
  }
  return items;
}

function extractTitleAndObjective(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  let title = 'Nova Entrega OXE';
  for (const line of lines) {
    const h = line.match(/^#{1,2}\s+(.+)$/);
    if (h) {
      title = h[1].replace(/`/g, '').trim();
      break;
    }
  }
  if (title === 'Nova Entrega OXE' && lines.length > 0) {
    title = lines[0].replace(/^[-*#\d.)\s]+/, '').slice(0, 72).trim() || title;
  }

  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const objMatch = normalized.match(/(?:^|\n)##\s*(?:Objetivo|Visão|Visao|Resumo|Contexto)\s*\n+([\s\S]*?)(?=\n##\s|$)/i);
  let objective = objMatch ? objMatch[1].trim().split('\n')[0].trim() : '';
  if (!objective) {
    const prose = lines.find((l) => !/^#/.test(l) && !/^[-*+]/.test(l) && l.length >= 15);
    objective = prose || lines[0] || title;
  }
  return { title, objective };
}

/**
 * Classifies a user briefing into structured requirements, verifiable criteria, phases (F1..Fn),
 * inferred safe assumptions, and ONLY blocking ambiguities (strictly capped at 0..5).
 */
function classifyBriefingGaps(briefingText, env = {}) {
  const raw = String(briefingText || '').trim();
  const projectMode = env.project_mode || 'greenfield';
  const signals = detectDomainSignals(raw, env);
  const { title, objective } = extractTitleAndObjective(raw);
  const bullets = extractBullets(raw);

  const blockingQuestions = [];
  const assumptions = [];

  const isTooVague = raw.length < 60 && bullets.length < 2;
  if (isTooVague) {
    blockingQuestions.push({
      id: 'Q1',
      topic: 'scope',
      question: 'Quais são as 2–4 funcionalidades concretas obrigatórias da primeira versão (v1) e o que fica fora?',
      recommended: 'Definir um MVP enxuto com fluxo principal completo + testes automatizados.',
    });
  }
  if (projectMode === 'greenfield' && !signals.hasAnyInterface && blockingQuestions.length < 5) {
    blockingQuestions.push({
      id: `Q${blockingQuestions.length + 1}`,
      topic: 'interface',
      question: 'Qual será o formato principal da entrega: CLI local, API HTTP, App Web ou Biblioteca?',
      recommended: 'CLI/API local em Node.js com testes automatizados e comando único para rodar.',
    });
  }
  if (projectMode === 'greenfield' && !signals.hasStackMention && blockingQuestions.length < 5) {
    blockingQuestions.push({
      id: `Q${blockingQuestions.length + 1}`,
      topic: 'stack',
      question: 'Há preferência obrigatória de linguagem/stack (ex.: Node.js/TypeScript, Python) ou podemos usar Node.js 18+ stdlib?',
      recommended: 'Node.js 18+ (zero dependências extras desnecessárias).',
    });
  }
  if (signals.hasAuth && !signals.hasAuthSpec && blockingQuestions.length < 5) {
    blockingQuestions.push({
      id: `Q${blockingQuestions.length + 1}`,
      topic: 'auth',
      question: 'Qual estratégia de autenticação usar na v1: sessão/JWT local com usuários em banco ou integração OAuth externa?',
      recommended: 'Autenticação local simples com hash seguro de senha (sem dependência externa na v1).',
    });
  }
  if (signals.hasDb && !signals.hasStorageSpec && projectMode === 'greenfield' && blockingQuestions.length < 5) {
    blockingQuestions.push({
      id: `Q${blockingQuestions.length + 1}`,
      topic: 'storage',
      question: 'Qual persistência prefere na v1: arquivo JSON/SQLite local (zero setup) ou banco externo (Postgres/MySQL)?',
      recommended: 'Persistência local em JSON/SQLite para rodar imediatamente sem containers extras.',
    });
  }

  // Safe non-blocking assumptions (recorded transparently instead of nagging the user)
  if (signals.hasCli) assumptions.push('Interface principal: CLI executável com saída determinística e `--help`.');
  if (signals.hasApi) assumptions.push('API HTTP local configurável via `PORT` (padrão porta livre no smoke test).');
  if (signals.hasWeb) assumptions.push('Interface Web responsiva servida localmente sem credenciais externas obrigatórias.');
  if (signals.hasStorageSpec) assumptions.push('Persistência local isolável por diretório/caminho para testes determinísticos.');
  if (projectMode === 'brownfield') assumptions.push('Preservar arquitetura, convenções e suíte de testes existentes no repositório.');
  if (!assumptions.length) assumptions.push('Implementação local-first com testes automatizados e smoke test real antes da entrega.');

  // Requirements & Acceptance Criteria
  const reqSources = bullets.length >= 2
    ? bullets.filter((b) => !/^(node\.?js|python|sem depend|armazenamento)/i.test(b)).slice(0, 12)
    : [objective, 'Smoke test automatizado comprovando execução real da entrega'];
  const effectiveReqs = reqSources.length >= 2 ? reqSources : [objective, ...reqSources];

  const requirements = effectiveReqs.map((text, idx) => ({
    id: `R${idx + 1}`,
    text,
  }));

  const criteria = requirements.map((r, idx) => ({
    id: `A${idx + 1}`,
    requirement: r.id,
    criterion: `Atender integralmente: ${r.text}`,
    risk: idx === 0 ? 'P1' : 'P2',
    verify: `tests/acceptance/a${idx + 1}-${slugifyTitle(r.text).slice(0, 24)}.test.cjs`,
  }));

  // Group criteria into 1..3 clean incremental phases
  const phases = [];
  const chunkSize = criteria.length <= 3 ? criteria.length : Math.ceil(criteria.length / Math.min(3, Math.ceil(criteria.length / 2)));
  let phaseIdx = 1;
  for (let i = 0; i < criteria.length; i += chunkSize) {
    const slice = criteria.slice(i, i + chunkSize);
    const phaseTitle = phaseIdx === 1
      ? (criteria.length <= chunkSize ? 'Implementação Completa & Verificação' : 'Fundação e Fluxo Principal')
      : phaseIdx === 2
        ? 'Funcionalidades Complementares & Integração'
        : 'Acabamento, Qualidade & Smoke Final';
    phases.push({
      id: `F${phaseIdx}`,
      title: phaseTitle,
      requirements: slice.map((c) => c.requirement),
      acceptance: slice.map((c) => c.id),
      scope: slice.map((c) => c.criterion).join(' · ').slice(0, 220),
      status: 'pending',
      frozen_tests: [],
      attempts: 0,
      closed_at: null,
    });
    phaseIdx += 1;
  }

  return {
    title,
    objective,
    project_mode: projectMode,
    signals,
    requirements,
    criteria,
    phases,
    assumptions,
    blocking_questions: blockingQuestions.slice(0, 5),
  };
}

function renderSpecFromBriefing(intake) {
  const lines = [
    `# SPEC — ${intake.title}`,
    '',
    '## Objetivo',
    '',
    intake.objective,
    '',
    '## Requisitos',
    '',
    ...intake.requirements.map((r) => `- **${r.id}:** ${r.text}`),
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Risco | Como verificar |',
    '|----|----------|-------|----------------|',
    ...intake.criteria.map((c) => `| ${c.id} | ${c.criterion.replace(/\|/g, '/')} | ${c.risk} | \`node --test ${c.verify}\` |`),
    '',
    '## Premissas Assumidas',
    '',
    ...intake.assumptions.map((a) => `- ${a}`),
    '',
    '## Bordas e Proibições',
    '',
    '1. Não alterar testes congelados de aceitação durante a implementação.',
    '2. Zero código incompleto, placeholder ou retornos simulados mascarando funcionalidade real.',
    '3. Não executar `git push`, criar PR remoto ou `npm publish` sem autorização explícita.',
    '',
  ];
  return lines.join('\n');
}

function renderRoadmapFromPhases(intake) {
  const lines = [`# ROADMAP — ${intake.title}`, ''];
  for (let i = 0; i < intake.phases.length; i += 1) {
    const ph = intake.phases[i];
    lines.push(
      `## Fase ${i + 1} — ${ph.title}`,
      `- **Requisitos:** ${ph.requirements.join(', ')}`,
      `- **Critérios de aceite:** ${ph.acceptance.join(', ')}`,
      `- **Escopo:** ${ph.scope}`,
      '',
    );
  }
  return lines.join('\n');
}

function ensureLeanBootstrap(projectRoot, sessionRel, title, opts = {}) {
  const oxeDir = path.join(projectRoot, '.oxe');
  fs.mkdirSync(oxeDir, { recursive: true });
  const cfgPath = path.join(oxeDir, 'config.json');
  const hadConfig = fs.existsSync(cfgPath);
  if (!hadConfig) {
    const cfg = {
      profile: 'lean',
      plan_ceremony: 'lean',
      agents: { auto_lease: true },
      models: { auto_route: false },
    };
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  }
  const statePath = path.join(oxeDir, 'STATE.md');
  if (!fs.existsSync(statePath)) {
    const stateMd = [
      '# OXE — Estado',
      '',
      '## Fase atual',
      '',
      '`spec_ready`',
      '',
      '## Sessão ativa',
      '',
      `- **active_session:** \`${sessionRel}\``,
      '',
      `> Gerado automaticamente por \`oxe-cc deliver init\` (${title}).`,
      '',
    ].join('\n');
    fs.writeFileSync(statePath, stateMd, 'utf8');
  }
  if (!opts.skipGitInit && !fs.existsSync(path.join(projectRoot, '.git'))) {
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
    } catch { /* git optional */ }
  }
}

function readDeliveryPaths(projectRoot, sessionRel) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const baseDir = sessionRel ? path.join(rootAbs, '.oxe', sessionRel) : path.join(rootAbs, '.oxe');
  return {
    baseDir,
    deliverJson: path.join(baseDir, 'DELIVER.json'),
    briefing: path.join(baseDir, 'BRIEFING.md'),
    spec: path.join(baseDir, 'SPEC.md'),
    roadmap: path.join(baseDir, 'ROADMAP.md'),
    programJson: path.join(baseDir, 'program', 'PROGRAM.json'),
    deliveryMd: path.join(baseDir, 'DELIVERY.md'),
    deliveryJson: path.join(baseDir, 'DELIVERY.json'),
  };
}

/**
 * Initializes an autonomous delivery session from a user briefing.
 * Supports `approval: 'single-ok' | 'auto'` or omits it to ask the user upfront (`pending_choice`).
 */
function initDelivery(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  fs.mkdirSync(rootAbs, { recursive: true });

  let briefingText = typeof opts.briefingText === 'string' ? opts.briefingText : '';
  if (!briefingText && opts.from) {
    const srcPath = path.resolve(rootAbs, opts.from);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Arquivo de briefing não encontrado: ${opts.from}`);
    }
    briefingText = fs.readFileSync(srcPath, 'utf8');
  }
  if (!briefingText || !briefingText.trim()) {
    throw new Error('Briefing vazio: passe --from <arquivo.md> ou --text "<descrição>".');
  }

  const projectMode = detectProjectMode(rootAbs);
  let stacks = [];
  try {
    const pack = require('./oxe-onboard.cjs').buildOnboardingPack(rootAbs);
    stacks = (pack.project && pack.project.stacks) || [];
  } catch { /* optional */ }

  const intake = classifyBriefingGaps(briefingText, { project_mode: projectMode, stacks });
  const slug = slugifyTitle(opts.slug || intake.title);
  const deliverId = makeDeliverId(slug);
  const sessionRel = opts.session || `sessions/s-${slug}`;
  const paths = readDeliveryPaths(rootAbs, sessionRel);

  ensureLeanBootstrap(rootAbs, sessionRel, intake.title, { skipGitInit: Boolean(opts.skipGitInit) });
  fs.mkdirSync(paths.baseDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.programJson), { recursive: true });

  const rawApproval = opts.approval ? String(opts.approval).trim().toLowerCase() : null;
  let approvalMode = 'pending_choice';
  if (rawApproval === 'auto' || rawApproval === 'automatic' || rawApproval === 'automatico') {
    approvalMode = 'auto';
  } else if (rawApproval === 'single-ok' || rawApproval === 'single' || rawApproval === 'ok') {
    approvalMode = 'single-ok';
  } else if (rawApproval) {
    throw new Error(`Modo de aprovação inválido: "${opts.approval}". Use "single-ok" ou "auto".`);
  }

  const hasQuestions = intake.blocking_questions.length > 0;
  let status = 'DESIGN_REVIEW';
  let autoApproved = false;
  if (hasQuestions) {
    status = 'CLARIFY';
  } else if (approvalMode === 'auto') {
    status = 'PHASE_FREEZE_TESTS';
    autoApproved = true;
  }

  const now = new Date().toISOString();
  const maxBudgetUsd = Number.isFinite(Number(opts.maxBudgetUsd)) && Number(opts.maxBudgetUsd) > 0
    ? Number(opts.maxBudgetUsd)
    : 10;
  const maxAttempts = Number.isFinite(Number(opts.maxAttempts)) && Number(opts.maxAttempts) >= 1
    ? Math.floor(Number(opts.maxAttempts))
    : 3;

  const state = {
    schema_version: DELIVER_SCHEMA_VERSION,
    deliver_id: deliverId,
    session: sessionRel,
    slug,
    title: intake.title,
    objective: intake.objective,
    project_mode: projectMode,
    approval_mode: approvalMode,
    auto_approved: autoApproved,
    status,
    active_phase_index: 0,
    phases: intake.phases,
    requirements: intake.requirements,
    criteria: intake.criteria,
    assumptions: intake.assumptions,
    blocking_questions: intake.blocking_questions,
    answers: {},
    frozen_test_hashes: {},
    heal_state: {
      attempt: 0,
      last_error_hash: null,
      repeated_error_count: 0,
      last_failure: null,
      tier: 'balanced',
    },
    budget: {
      max_usd: maxBudgetUsd,
      spent_usd: 0,
      max_attempts_per_task: maxAttempts,
    },
    smoke: null,
    handoff: null,
    blocked_reason: null,
    history: [
      { at: now, event: 'deliver_initialized', status, approval_mode: approvalMode, project_mode: projectMode },
    ],
    created_at: now,
    updated_at: now,
  };

  if (autoApproved && state.phases.length > 0) {
    state.phases[0].status = 'active';
    state.history.push({ at: now, event: 'auto_approved', phase: state.phases[0].id });
  }

  fs.writeFileSync(paths.briefing, `${briefingText.trim()}\n`, 'utf8');
  fs.writeFileSync(paths.spec, renderSpecFromBriefing(intake), 'utf8');
  fs.writeFileSync(paths.roadmap, renderRoadmapFromPhases(intake), 'utf8');
  fs.writeFileSync(paths.deliverJson, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const programState = {
    schema_version: 1,
    roadmap_ref: path.relative(rootAbs, paths.roadmap).replace(/\\/g, '/'),
    active_phase: autoApproved && state.phases.length ? state.phases[0].id : null,
    phases: state.phases.map((ph) => ({
      id: ph.id,
      title: ph.title,
      requirements: ph.requirements,
      acceptance: ph.acceptance,
      scope: ph.scope,
      status: ph.status,
    })),
    created_at: now,
    updated_at: now,
  };
  fs.writeFileSync(paths.programJson, `${JSON.stringify(programState, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    deliver_id: deliverId,
    state,
    paths,
    approval_prompt: approvalMode === 'pending_choice' ? APPROVAL_PROMPT : null,
    summary: {
      title: intake.title,
      project_mode: projectMode,
      approval_mode: approvalMode,
      status,
      phases: state.phases.length,
      criteria: state.criteria.length,
      blocking_questions: state.blocking_questions.length,
    },
  };
}

module.exports = {
  DELIVER_SCHEMA_VERSION,
  APPROVAL_PROMPT,
  slugifyTitle,
  detectDomainSignals,
  classifyBriefingGaps,
  renderSpecFromBriefing,
  renderRoadmapFromPhases,
  readDeliveryPaths,
  initDelivery,
};
