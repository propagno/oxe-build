'use strict';

/**
 * 1.21.2 — the guided SDLC journey. `suggestNextStep` (oxe-project-health) stays the single source of the next step;
 * this module adds what it did not know: the grill and the spec approval (upstream), the ALM writes (stories after the
 * spec, tasks after the plan, the MCP queue), and the delivery after a green verify (PR → CI/merge → deploy → close)
 * when `delivery: { mode: "pr" }`. Read-only: nothing here writes, spawns or calls the network.
 */

const fs = require('fs');
const path = require('path');

const op = () => require('./oxe-operational.cjs');

function readConfig(target) {
  try { return JSON.parse(fs.readFileSync(path.join(target, '.oxe', 'config.json'), 'utf8')); } catch { return {}; }
}

/** `delivery: "pr"` or `{ mode: "pr", deploy_env: "staging" }`; anything else keeps the local close (the default). */
function deliveryMode(cfg) {
  const d = cfg && cfg.delivery;
  // close: "ci" (OxeSpace 15/11, user decision): the phase closes on its green CI (program close --by-ci), no final verify
  const close = d && typeof d === 'object' && d.close === 'ci' ? 'ci' : 'verify';
  if (d === 'pr' || (d && typeof d === 'object' && d.mode === 'pr')) return { mode: 'pr', deploy_env: d && typeof d === 'object' && d.deploy_env ? String(d.deploy_env) : null, close };
  return { mode: 'local', deploy_env: null, close };
}

function almState(target, activeSession, cfg) {
  try {
    const alm = require('./oxe-alm.cjs');
    const acfg = alm.almConfig(cfg, { defaultProgram: path.basename(path.resolve(target)) });
    if (!acfg) return null;
    const paths = op().resolveRuntimeArtifactPaths(target, activeSession);
    const programDir = paths.programDir || path.join(target, '.oxe', 'program');
    const queue = alm.readQueue(programDir).ops;
    return { cfg: acfg, links: alm.links(programDir), queue, queuedRefs: new Set(queue.filter((o) => o.op === 'ensure').map((o) => o.ref)) };
  } catch { return null; }
}

/** Steps before the program / plan engine: MCP queue, grill, approval, ALM stories and tasks. */
function upstreamStep(target, activeSession, cfgIn = {}) {
  // callers pass a partial config (or {}): the file is the base, the caller's keys win
  const cfg = { ...readConfig(target), ...(cfgIn || {}) };
  const o = op();
  const alm = almState(target, activeSession, cfg);
  if (alm && alm.cfg.transport === 'mcp' && alm.queue.length) {
    return { step: 'alm-queue', cursorCmd: 'oxe-cc alm queue', reason: `${alm.queue.length} operação(ões) do ALM esperando o agente executar com as ferramentas MCP (criar/mover itens) — rode a fila e confirme cada uma com oxe-cc alm ack`, artifacts: ['.oxe/program/alm-mcp-queue.json'] };
  }
  const grill = require('./oxe-grill.cjs');
  const gp = o.grillPaths(target, activeSession);
  const grillUsed = grill.readRecords(gp.dir).length > 0;
  const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
  const hasPlan = Boolean(paths.plan && fs.existsSync(paths.plan));
  if (grillUsed) {
    const s = grill.status(gp.dir);
    if (!s.closed) {
      return { step: 'spec', cursorCmd: '/oxe-spec', reason: `grill aberto — ${s.next_branch ? `próximo ramo: ${s.next_branch}; ` : ''}${s.blockers.length} pendência(s) até o close. Retome com /oxe-spec (uma pergunta por vez, com a recomendada).`, artifacts: [path.relative(target, path.join(gp.dir, 'GRILL.md')).replace(/\\/g, '/')] };
    }
    const approval = o.specApproval(target, activeSession);
    if (!hasPlan && (!approval || approval.changed_since)) {
      return { step: 'spec-approve', cursorCmd: 'oxe-cc spec check', reason: approval ? 'a SPEC mudou depois da aprovação — rode o spec check e aprove de novo (oxe-cc spec approve --by <papel>)' : 'grill fechado — gere SPEC/ROADMAP/PRD a partir dele, rode o spec check (e o spec probe) e aprove com oxe-cc spec approve --by <papel>', artifacts: ['.oxe/SPEC.md', '.oxe/PRD.md', '.oxe/GLOSSARY.md'] };
    }
  }
  if (alm) {
    const prdFile = o.prdPathFor(target, activeSession);
    const prd = fs.existsSync(prdFile) ? require('./oxe-prd.cjs').readPrd(prdFile) : null;
    const stories = prd ? prd.stories.map((s) => s.id) : [];
    if (stories.length && !stories.some((id) => alm.links.has(id) || alm.queuedRefs.has(id))) {
      return { step: 'alm-push', cursorCmd: 'oxe-cc alm push --stories-only --dry-run', reason: `ALM ${alm.cfg.provider}: as ${stories.length} história(s) do PRD ainda não viraram itens — confira o ensaio e rode sem --dry-run com o OK do usuário`, artifacts: ['.oxe/PRD.md'] };
    }
    let doc = null;
    try { doc = o.readPlanJsonDoc(target, activeSession).doc; } catch { doc = null; }
    const phase = (() => { try { return o.activeProgramPhase(target, activeSession); } catch { return null; } })();
    const phaseId = phase ? phase.id : (doc && doc.phase) || null;
    const pending = doc && Array.isArray(doc.tasks) && (!phase || doc.phase === phase.id) ? doc.tasks.filter((t) => t && !t.done) : [];
    const ref = (t) => (phaseId ? `${phaseId}-${t.id}` : t.id);
    if (pending.length && !pending.some((t) => alm.links.has(ref(t)) || alm.queuedRefs.has(ref(t)))) {
      return { step: 'alm-push', cursorCmd: 'oxe-cc alm push --tasks-only --dry-run', reason: `ALM ${alm.cfg.provider}: as ${pending.length} tarefa(s) do plano ainda não viraram itens — envie antes do execute (a chave entra no branch, no commit e no PR)`, artifacts: ['.oxe/PLAN.json'] };
    }
  }
  return null;
}

/**
 * After a green verify, with `delivery.mode: "pr"`: open the PR, follow CI and merge, attach the deploy, then close.
 * @returns {object|null} the step, or null when the phase can close
 */
function deliveryStep(target, activeSession, phase, ctx = {}) {
  const cfg = ctx.cfg || readConfig(target);
  const mode = deliveryMode(cfg);
  if (mode.mode !== 'pr') return null;
  const o = op();
  const since = phase.started_at ? Date.parse(phase.started_at) : 0;
  let events = [];
  try { events = o.readEvents(target, activeSession); } catch { events = []; }
  const after = (e) => !since || !e.timestamp || Date.parse(e.timestamp) >= since;
  const promoted = events.filter((e) => e.type === 'TaskPromoted' && e.payload && e.payload.pr && after(e));
  const merged = new Set(events.filter((e) => e.type === 'AlmMerged').map((e) => e.work_item_id));
  const label = ctx.label || phase.id;
  const base = { artifacts: ['.oxe/program/PROGRAM.json'], ...(ctx.program ? { program: ctx.program } : {}) };
  if (!promoted.length) return { step: 'ship', cursorCmd: '/oxe-ship', reason: `${label}: verify verde — entregar: o /oxe-ship abre o PR (runtime promote, com a chave do ALM) e guia CI, merge, deploy e close.`, ...base };
  const open = promoted.filter((e) => !merged.has(e.work_item_id));
  if (open.length) return { step: 'ship-wait', cursorCmd: 'oxe-cc ship status', reason: `${label}: ${open.length} PR(s) aberto(s) (${open.map((e) => e.payload.pr).slice(0, 3).join(', ')}) — acompanhe o CI e o merge; oxe-cc ship status confere de novo.`, ...base };
  if (mode.deploy_env) {
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const programDir = paths.programDir || path.join(target, '.oxe', 'program');
    let deploys = [];
    try { deploys = require('./oxe-phase-gates.cjs').readDeploys(programDir, phase.id); } catch { deploys = []; }
    if (!deploys.some((d) => d.env === mode.deploy_env && d.ok !== false)) {
      return { step: 'deploy', cursorCmd: `oxe-cc runtime deploy --attach ${mode.deploy_env} --version <v> --ref <tag|url> --check "<cmd>"`, reason: `${label}: merge feito — anexe o deploy em ${mode.deploy_env} (o OXE registra e roda as checagens, nunca faz o deploy).`, ...base };
    }
  }
  return null;
}

/**
 * A phase being planned that needs its technical proposal decided first: a draft RFC of the phase waiting, or
 * `rfc.required` risk/always with a P0/P1 criterion (or any) and no accepted RFC.
 */
function rfcStep(target, activeSession, phase, ctx = {}) {
  try {
    const cfg = ctx.cfg || readConfig(target);
    const rfcLib = require('./oxe-rfc.cjs');
    const mode = rfcLib.rfcMode(cfg);
    if (mode === 'never') return null;
    const rfcs = rfcLib.list(target).filter((r) => r.phase === phase.id);
    if (rfcs.some((r) => r.status === 'accepted')) return null;
    const draft = rfcs.find((r) => r.status === 'draft');
    const o = op();
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const risks = require('./oxe-risk-decision.cjs').criterionRisks(fs.existsSync(paths.spec || '') ? fs.readFileSync(paths.spec, 'utf8') : '');
    const risky = (phase.acceptance || []).filter((a) => /^P[01]$/.test(String(risks.get(a) || '')));
    const required = mode === 'always' || (mode === 'risk' && risky.length > 0);
    if (!draft && !required) return null;
    const label = ctx.label || phase.id;
    return {
      step: 'discuss',
      cursorCmd: '/oxe-discuss --rfc',
      reason: draft ? `${label}: ${draft.id} em rascunho — decida a proposta técnica (aceitar/recusar) antes do plano.` : `${label}: ${mode === 'always' ? 'rfc.required "always"' : `critério(s) de risco ${risky.join(', ')}`} — escreva e decida o RFC antes do plano.`,
      artifacts: draft && draft.file ? [path.relative(target, draft.file).replace(/\\/g, '/')] : ['.oxe/rfc/'],
      ...(ctx.program ? { program: ctx.program } : {}),
    };
  } catch { return null; }
}

const STAGES = [
  { n: 0, id: 'prepare', title: 'Preparar', cmd: '/oxe' },
  { n: 1, id: 'discover', title: 'Descobrir (grill)', cmd: '/oxe-spec' },
  { n: 2, id: 'validate', title: 'Validar a spec', cmd: 'oxe-cc spec check' },
  { n: 3, id: 'program', title: 'Programar (fases, ALM)', cmd: '/oxe' },
  { n: 4, id: 'decide', title: 'Decidir (DISCUSS, RFC)', cmd: '/oxe-discuss' },
  { n: 5, id: 'plan', title: 'Planejar', cmd: '/oxe-plan' },
  { n: 6, id: 'build', title: 'Construir', cmd: '/oxe-execute' },
  { n: 7, id: 'verify', title: 'Verificar', cmd: '/oxe-verify' },
  { n: 8, id: 'deliver', title: 'Entregar (PR, deploy, close)', cmd: '/oxe-ship' },
  { n: 9, id: 'operate', title: 'Operar (defeitos, mudanças)', cmd: '/oxe-ship --defect' },
];

const STEP_STAGE = {
  scan: 'prepare', oxe: 'prepare', doctor: 'prepare', 'azure-auth': 'prepare', 'azure-sync': 'prepare',
  spec: 'discover', 'spec-approve': 'validate', 'program-start': 'program', 'alm-push': 'program', 'alm-queue': 'program',
  discuss: 'decide', plan: 'plan', dashboard: 'plan', execute: 'build', signoff: 'verify', verify: 'verify', retro: 'verify',
  ship: 'deliver', 'ship-wait': 'deliver', deploy: 'deliver', 'program-close': 'deliver', quick: 'build',
};

/** The journey map: each stage done / current / pending / optional, plus the next step. */
function journey(target, next, activeSession = null) {
  const o = op();
  const has = (f) => { try { return fs.existsSync(f); } catch { return false; } };
  const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
  const grill = require('./oxe-grill.cjs');
  const gp = o.grillPaths(target, activeSession);
  const g = grill.readRecords(gp.dir).length ? grill.status(gp.dir) : null;
  const approval = o.specApproval(target, activeSession);
  let program = null;
  try { program = o.runtimeProgramStatus(target, activeSession); } catch { program = null; }
  const phase = program && program.progress ? program.progress.phase : null;
  const done = {
    prepare: has(path.join(target, '.oxe', 'STATE.md')),
    discover: g ? Boolean(g.closed) : has(paths.spec),
    validate: Boolean(approval && !approval.changed_since),
    program: Boolean(program && program.exists),
    decide: has(path.join(target, '.oxe', 'DISCUSS.md')) || has(path.join(path.dirname(paths.spec || ''), 'DISCUSS.md')),
    plan: Boolean(paths.plan && has(paths.plan)),
    build: Boolean(phase && ['verifying', 'closed'].includes(phase.status)),
    verify: Boolean(phase && phase.status === 'closed'),
    deliver: Boolean(program && program.progress && program.progress.closed > 0),
    operate: false,
  };
  const optional = new Set(['decide', 'operate', ...(g ? [] : ['validate']), ...(program && program.exists ? [] : ['program'])]);
  const current = next ? STEP_STAGE[next.step] || null : null;
  return {
    stages: STAGES.map((s) => ({ ...s, state: s.id === current ? 'current' : done[s.id] ? 'done' : optional.has(s.id) ? 'optional' : 'pending' })),
    current,
    next,
    phase: phase ? { id: phase.id, status: phase.status, index: program.progress.index, total: program.progress.total } : null,
  };
}

/**
 * `delivery.close: "ci"`: with the phase's work done, the steps are the delivery (PR, merge, deploy — when
 * mode is pr), then a CI run attached to the phase, then `program close --by-ci`. Null when the config closes by verify.
 */
function ciCloseStep(target, activeSession, phase, ctx = {}) {
  const cfg = ctx.cfg || readConfig(target);
  const mode = deliveryMode(cfg);
  if (mode.close !== 'ci') return null;
  const o = op();
  let work = null;
  try { work = o.runtimePhaseWork(target, activeSession); } catch { work = null; }
  if (!work || !work.complete) return null;
  if (mode.mode === 'pr') {
    const d = deliveryStep(target, activeSession, phase, { ...ctx, cfg });
    if (d) return d;
  }
  const label = ctx.label || phase.id;
  const base = { artifacts: ['.oxe/program/PROGRAM.json', '.oxe/program/ci.ndjson'], ...(ctx.program ? { program: ctx.program } : {}) };
  const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
  const programDir = paths.programDir || path.join(target, '.oxe', 'program');
  let attached = [];
  try { attached = fs.readFileSync(path.join(programDir, 'ci.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.kind === 'ci' && (!r.phase || r.phase === phase.id)); } catch { attached = []; }
  if (!attached.length) return { step: 'ci-attach', cursorCmd: 'oxe-cc runtime ci --attach <run|url>', reason: `${label}: trabalho da fase pronto — anexe o run de CI verde que contém a fase (o dos PRs dela, ou o de main depois do merge); o close é pelo CI, sem verify final.`, ...base };
  return { step: 'program-close', cursorCmd: 'oxe-cc runtime program close --by-ci --by <papel> --reason "…"', reason: `${label}: CI anexado (${attached[attached.length - 1].run}) — feche a fase pelo CI (confere que o run está verde e contém o HEAD; dossiê, sign-offs e drift continuam valendo).`, ...base };
}

module.exports = { upstreamStep, deliveryStep, deliveryMode, ciCloseStep, rfcStep, journey, STAGES, STEP_STAGE };
