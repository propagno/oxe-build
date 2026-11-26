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
      const artifacts = ['.oxe/SPEC.md', '.oxe/PRD.md', '.oxe/GLOSSARY.md'];
      // no SPEC yet: the grill closed and the /oxe-spec writes SPEC/ROADMAP/PRD from it
      if (!paths.spec || !fs.existsSync(paths.spec)) {
        return { step: 'spec-approve', cursorCmd: '/oxe-spec', reason: 'grill fechado — gere SPEC/ROADMAP/PRD a partir dele com /oxe-spec; depois oxe-cc spec check e oxe-cc spec approve --by <papel>', artifacts };
      }
      // the check green: the next command is the approval itself (not the check again)
      let check = null;
      try { check = o.runtimeSpecCheck(target, activeSession, {}); } catch { check = null; }
      // rfc.required risk/always: the check refuses a risky SPEC with no RFC — the way out is the draft (item 18)
      if (check && !check.ok && (check.errors || []).some((e) => /sem RFC/.test(String(e)))) {
        const rfc = grillRfcStep(target, activeSession, cfg, s);
        if (rfc && rfc.step === 'rfc') return rfc;
      }
      if (check && check.ok) {
        return { step: 'spec-approve', cursorCmd: 'oxe-cc spec approve --by <papel>', reason: `${approval ? 'a SPEC mudou depois da aprovação e' : 'grill fechado e'} o spec check está verde${check.warnings && check.warnings.length ? ` (${check.warnings.length} aviso(s))` : ''} — aprove com oxe-cc spec approve --by <papel>`, artifacts };
      }
      return { step: 'spec-approve', cursorCmd: 'oxe-cc spec check', reason: `${approval ? 'a SPEC mudou depois da aprovação' : 'grill fechado'} — o spec check ainda reprova${check && check.errors && check.errors.length ? ` (${check.errors.length} erro(s): ${String(check.errors[0]).slice(0, 120)})` : ''}; corrija SPEC/ROADMAP/PRD e aprove com oxe-cc spec approve --by <papel>`, artifacts };
    }
    // grill closed, SPEC approved, no plan and no program: a P0/P1 criterion or a new component asks for an RFC
    if (!hasPlan) {
      let programExists = false;
      try { programExists = Boolean(o.runtimeProgramStatus(target, activeSession).exists); } catch { programExists = false; }
      if (!programExists) {
        const rfc = grillRfcStep(target, activeSession, cfg, s);
        if (rfc) return rfc;
      }
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
 * The RFCs that settle a phase (or, with `phaseId` null, the delivery without a program): the phase's own, plus a
 * global one (no phase). A global accepted RFC covers when it cites every risky criterion (or there is none) — the
 * same rule as `lintPhaseRfc`.
 */
function rfcCoverage(rfcs, phaseId, risky = [], opts = {}) {
  const own = phaseId ? rfcs.filter((r) => r.phase === phaseId) : [];
  const global = rfcs.filter((r) => !r.phase);
  const cited = (r, a) => {
    const body = `${r.motivation || ''} ${r.summary || ''} ${r.proposal || ''}`;
    const parent = String(a).replace(/\.\d+$/, '');
    return new RegExp(`\\b${String(a).replace('.', '\\.')}\\b`).test(body) || (parent !== a && new RegExp(`\\b${parent}\\b`).test(body));
  };
  const missingOf = (r) => risky.filter((a) => !cited(r, a));
  const accepted = own.find((r) => r.status === 'accepted') || global.find((r) => r.status === 'accepted' && !missingOf(r).length) || null;
  // revisão 21/11 (achado 5): a phase's own draft always waits for its decision; a global draft (no phase) only blocks
  // when the RFC is required (risk/always) — in advisory it never held the plan of every phase
  const draft = own.find((r) => r.status === 'draft') || (opts.required === false ? null : global.find((r) => r.status === 'draft')) || null;
  // a global accepted RFC that does not cite every risky criterion: say WHICH ones are missing (not a blind rfc new)
  const partial = !accepted ? global.filter((r) => r.status === 'accepted').map((r) => ({ rfc: r, missing: missingOf(r) })).sort((x, y) => x.missing.length - y.missing.length)[0] || null : null;
  // the last rejected one (own first): its decision is recorded, the next step says so instead of a blind rfc new
  const rejected = [...own, ...global].filter((r) => r.status === 'rejected').pop() || null;
  return { accepted, draft, uncited: partial, rejected };
}

/** The reason/step when no RFC covers yet: a partial global RFC (criteria to cite) or a rejected one (decide anew). */
function rfcGapStep(target, cov, label, ctx = {}) {
  const rel = (r) => (r && r.file ? path.relative(target, r.file).replace(/\\/g, '/') : '.oxe/rfc/');
  if (cov.uncited && cov.uncited.missing.length) {
    const r = cov.uncited.rfc;
    return { step: 'rfc', cursorCmd: '/oxe-discuss --rfc', reason: `${label}: ${r.id} (aceito, global) não cita o(s) critério(s) de risco ${cov.uncited.missing.join(', ')} — cite-os na Motivação/Proposta de ${rel(r)} (ou escreva um RFC da fase com oxe-cc rfc new --phase <F>) antes do plano.`, artifacts: [rel(r)], ...(ctx.program ? { program: ctx.program } : {}) };
  }
  if (cov.rejected) {
    const r = cov.rejected;
    return { step: 'rfc', cursorCmd: '/oxe-discuss --rfc', reason: `${label}: ${r.id} foi recusado — decida a alternativa no /oxe-discuss --rfc e registre-a num RFC novo (oxe-cc rfc new --title "…") para aceitar; o RFC é exigido (rfc.required), então o plano espera essa decisão.`, artifacts: [rel(r)], ...(ctx.program ? { program: ctx.program } : {}) };
  }
  return null;
}

/**
 * Item 18: the grill closed and the SPEC approved, no program (a program decides per phase in `rfcStep`): a P0/P1
 * criterion or a new component asks for the RFC before the plan. A draft waiting → decide it (/oxe-discuss --rfc);
 * `rfc.required` risk/always and none written → `oxe-cc rfc new` (the draft is the template; the agent fills it).
 * Advisory (the default) never blocks the plan: the hint goes in the plan's reason (`grillRfcHint`).
 */
function grillRfcStep(target, activeSession, cfg, grillStatus) {
  try {
    const rfcLib = require('./oxe-rfc.cjs');
    const mode = rfcLib.rfcMode(cfg);
    if (mode === 'never') return null;
    const o = op();
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const specText = paths.spec && fs.existsSync(paths.spec) ? fs.readFileSync(paths.spec, 'utf8') : '';
    const sug = require('./oxe-grill.cjs').rfcSuggestion(grillStatus, specText);
    const required = mode === 'always' || (mode === 'risk' && sug.needed);
    // without a program every RFC is global: a draft only holds the plan when the RFC is required (advisory: the hint)
    const cov = rfcCoverage(rfcLib.list(target), null, sug.risky, { required });
    if (cov.accepted) return null;
    if (cov.draft) {
      return { step: 'discuss', cursorCmd: '/oxe-discuss --rfc', reason: `${cov.draft.id} em rascunho — decida a proposta técnica (oxe-cc rfc accept ${cov.draft.id} | rfc reject) antes do plano.`, artifacts: cov.draft.file ? [path.relative(target, cov.draft.file).replace(/\\/g, '/')] : ['.oxe/rfc/'] };
    }
    if (!required) return null;
    const gap = rfcGapStep(target, cov, 'grill fechado');
    if (gap) return gap;
    return { step: 'rfc', cursorCmd: `oxe-cc rfc new --title "${sug.title.replace(/"/g, "'").slice(0, 60)}"`, reason: `grill fechado com ${sug.reasons.join('; ') || 'rfc.required "always"'} — escreva o rascunho do RFC (proposta, alternativas, riscos) e decida-o com /oxe-discuss --rfc antes do plano.`, artifacts: ['.oxe/rfc/'] };
  } catch { return null; }
}

/** Advisory hint for the plan step (rfc mode advisory): the grill asked for an RFC and none was written. */
function grillRfcHint(target, activeSession, cfg = {}) {
  try {
    const o = op();
    const merged = { ...readConfig(target), ...(cfg || {}) };
    const rfcLib = require('./oxe-rfc.cjs');
    if (rfcLib.rfcMode(merged) !== 'advisory') return null;
    const grill = require('./oxe-grill.cjs');
    const gp = o.grillPaths(target, activeSession);
    if (!grill.readRecords(gp.dir).length) return null;
    const s = grill.status(gp.dir);
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const sug = grill.rfcSuggestion(s, paths.spec && fs.existsSync(paths.spec) ? fs.readFileSync(paths.spec, 'utf8') : '');
    if (!sug.needed) return null;
    const cov = rfcCoverage(rfcLib.list(target), null, sug.risky);
    if (cov.accepted || cov.draft) return null;
    return `o grill pede RFC (${sug.reasons.join('; ')}): oxe-cc rfc new --title "…" antes do plano é recomendado`;
  } catch { return null; }
}

/** Number of phases in ROADMAP.md (the same heading the program parser reads). */
function roadmapPhaseCount(text) {
  return [...String(text || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/^##\s+(?:Fase|Phase)\s+\d+/gim)].length;
}

/**
 * Item 4: the SPEC approved, a ROADMAP of 2+ phases and no program yet → `oxe-cc runtime program init` (spec.md:
 * "aprovada com ROADMAP de 2+ fases → program init"). Null with a plan already made (a single-cycle delivery).
 */
function programInitStep(target, activeSession) {
  try {
    const o = op();
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    if (paths.plan && fs.existsSync(paths.plan)) return null;
    let st = null;
    try { st = o.runtimeProgramStatus(target, activeSession); } catch { st = null; }
    if (st && st.exists) return null;
    const n = paths.roadmap && fs.existsSync(paths.roadmap) ? roadmapPhaseCount(fs.readFileSync(paths.roadmap, 'utf8')) : 0;
    if (n < 2) return null;
    const approval = o.specApproval(target, activeSession);
    // revisão 21/11 (achado 4): sem grill (ex. /oxe-spec --fast) ninguém pedia a aprovação, e o ROADMAP de 2+ fases ia
    // direto ao /oxe-plan. A aprovação vem antes do program init, com ou sem grill: check → approve → program init.
    if (!approval || approval.changed_since) {
      if (!paths.spec || !fs.existsSync(paths.spec)) return null;
      // without a grill the check/approve run in the fast mode (/oxe-spec --fast): `--fast` confirms it
      let grillUsed = false;
      try { grillUsed = require('./oxe-grill.cjs').readRecords(o.grillPaths(target, activeSession).dir).length > 0; } catch { grillUsed = false; }
      const fast = grillUsed ? '' : ' --fast';
      let check = null;
      try { check = o.runtimeSpecCheck(target, activeSession, { fast: !grillUsed }); } catch { check = null; }
      const artifacts = ['.oxe/SPEC.md', '.oxe/ROADMAP.md'];
      const why = `${approval ? 'a SPEC mudou depois da aprovação' : 'SPEC sem aprovação'} e ROADMAP com ${n} fases (programa por fases)`;
      if (check && check.ok) return { step: 'spec-approve', cursorCmd: `oxe-cc spec approve --by <papel>${fast}`, reason: `${why} — o spec check${fast} está verde${check.warnings && check.warnings.length ? ` (${check.warnings.length} aviso(s))` : ''}: aprove com oxe-cc spec approve --by <papel>${fast}; depois oxe-cc runtime program init.`, artifacts };
      return { step: 'spec-approve', cursorCmd: `oxe-cc spec check${fast}`, reason: `${why} — confira com oxe-cc spec check${fast}${check && check.errors && check.errors.length ? ` (${check.errors.length} erro(s): ${String(check.errors[0]).slice(0, 120)})` : ''}, aprove com oxe-cc spec approve --by <papel>${fast} e então oxe-cc runtime program init.`, artifacts };
    }
    return { step: 'program-init', cursorCmd: 'oxe-cc runtime program init', reason: `SPEC aprovada e ROADMAP com ${n} fases — crie o programa por fases (lê o ROADMAP e grava PROGRAM.json); depois oxe-cc runtime program start.`, artifacts: ['.oxe/ROADMAP.md', '.oxe/program/PROGRAM.json'] };
  } catch { return null; }
}

/**
 * After a green verify, with `delivery.mode: "pr"`: open the PR, follow CI and merge, attach the deploy, then close.
 * Without a program, `phase` is `{ id: null, started_at: <cycle start> }` (the delivery of the whole SPEC/PLAN).
 * @returns {object|null} the step, or null when the phase (or the cycle) can close
 */
function deliveryStep(target, activeSession, phase, ctx = {}) {
  const cfg = ctx.cfg || readConfig(target);
  const mode = deliveryMode(cfg);
  if (mode.mode !== 'pr') return null;
  const o = op();
  phase = phase || { id: null, started_at: null };
  const since = phase.started_at ? Date.parse(phase.started_at) : 0;
  let events = [];
  try { events = o.readEvents(target, activeSession); } catch { events = []; }
  const after = (e) => !since || !e.timestamp || Date.parse(e.timestamp) >= since;
  // a quick (ctx.quick = its id) is delivered by its own PR (quick promote --open-pr → QuickPromoted); a plan by its tasks'
  const promoted = ctx.quick
    ? events.filter((e) => e.type === 'QuickPromoted' && e.work_item_id === ctx.quick && e.payload && e.payload.pr)
    : events.filter((e) => e.type === 'TaskPromoted' && e.payload && e.payload.pr && after(e));
  const merged = new Set(events.filter((e) => e.type === 'AlmMerged').map((e) => e.work_item_id));
  const label = ctx.label || phase.id || 'Entrega';
  const base = { artifacts: [phase.id ? '.oxe/program/PROGRAM.json' : '.oxe/VERIFY.md'], ...(ctx.program ? { program: ctx.program } : {}) };
  if (!promoted.length) return { step: 'ship', cursorCmd: '/oxe-ship', reason: `${label}: verify verde — entregar: o /oxe-ship abre o PR (runtime promote, com a chave do ALM) e guia CI, merge, deploy e close.`, ...base };
  const open = promoted.filter((e) => !merged.has(e.work_item_id));
  if (open.length) return { step: 'ship-wait', cursorCmd: 'oxe-cc ship status', reason: `${label}: ${open.length} PR(s) aberto(s) (${open.map((e) => e.payload.pr).slice(0, 3).join(', ')}) — acompanhe o CI e o merge; oxe-cc ship status confere de novo.`, ...base };
  if (mode.deploy_env) {
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const programDir = paths.programDir || path.join(target, '.oxe', 'program');
    let deploys = [];
    try { deploys = require('./oxe-phase-gates.cjs').readDeploys(programDir, phase.id); } catch { deploys = []; }
    // without a phase every deploy record matches: only the ones of this cycle count
    if (!phase.id && since) deploys = deploys.filter((d) => !d.at || Date.parse(d.at) >= since);
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
    const o = op();
    const paths = o.resolveRuntimeArtifactPaths(target, activeSession);
    const risks = require('./oxe-risk-decision.cjs').criterionRisks(fs.existsSync(paths.spec || '') ? fs.readFileSync(paths.spec, 'utf8') : '');
    const risky = (phase.acceptance || []).filter((a) => /^P[01]$/.test(String(risks.get(a) || '')));
    // item 10: a global RFC (no phase) counts too, like in lintPhaseRfc — accepted when it cites the risky criteria
    const required = mode === 'always' || (mode === 'risk' && risky.length > 0);
    const cov = rfcCoverage(rfcLib.list(target), phase.id, risky, { required });
    if (cov.accepted) return null;
    const draft = cov.draft;
    if (!draft && !required) return null;
    const label = ctx.label || phase.id;
    if (!draft) {
      const gap = rfcGapStep(target, cov, label, ctx);
      if (gap) return gap;
    }
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
  // guided recovery and the CI close (R42): the map marks the stage they belong to
  resume: 'build', 'plan-scope': 'build', 'plan-amend-test': 'build', 'plan-done': 'build', 'checkpoint-integration': 'build', 'commit-task': 'build',
  'spec-amend': 'validate', 'deferred-retry': 'build', 'ci-attach': 'deliver',
  // item 17: the journey steps the map did not know — program init, the RFC draft, the closed cycle (next demand)
  'program-init': 'program', rfc: 'decide', next: 'operate',
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
  // without a program (or with it closed) the phase status says nothing: the stages behind the current one of the
  // delivery (plan → build → verify → deliver) are done; a closed cycle (next demand) has all of them done
  if (!phase && current) {
    const cur = STAGES.find((s) => s.id === current);
    for (const s of STAGES) {
      if (['plan', 'build', 'verify', 'deliver'].includes(s.id) && cur && s.n < cur.n && (s.id !== 'plan' || done.plan)) done[s.id] = true;
    }
  }
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

module.exports = { upstreamStep, deliveryStep, deliveryMode, ciCloseStep, rfcStep, rfcCoverage, grillRfcStep, grillRfcHint, programInitStep, roadmapPhaseCount, journey, STAGES, STEP_STAGE };
