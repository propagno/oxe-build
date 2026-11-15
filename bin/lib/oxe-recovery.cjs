'use strict';

/**
 * 1.21.2 — guided recovery (user, 15/11: "a user who knows only the main commands, guided by oxe-build itself"). The
 * next step knew the happy path; after a failure it said "em execução — concluir e verificar" and the way out lived
 * only in the CLI. `recoveryStep` reads the failure states the runtime records and returns the next step in the same
 * shape (`step`, `cursorCmd`, `reason`, `artifacts`), most urgent first. Read only: it never writes, spawns or calls
 * the network.
 */

const path = require('path');

const op = () => require('./oxe-operational.cjs');

const pendingTask = (t) => t && t.done !== true && t.status !== 'done' && !t.superseded && !t.merged_into;
const short = (s, n = 160) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const normF = (f) => String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/');

/**
 * @param {string} target project root
 * @param {string|null} activeSession
 * @param {object} [ctx] { run, doc, programDir, phase, head, cfg } (injected by tests; read from disk otherwise)
 * @returns {{ step: string, cursorCmd: string, reason: string, artifacts: string[], recovery: string }|null}
 */
function recoveryStep(target, activeSession, ctx = {}) {
  const injected = ctx.run !== undefined;
  let run = ctx.run;
  if (run === undefined) { try { run = op().readRunState(target, activeSession); } catch { run = null; } }
  let doc = ctx.doc;
  if (doc === undefined) { try { doc = op().readPlanJsonDoc(target, activeSession).doc; } catch { doc = null; } }
  let programDir = ctx.programDir;
  if (programDir === undefined) {
    try { programDir = op().resolveRuntimeArtifactPaths(target, activeSession).programDir || path.join(target, '.oxe', 'program'); } catch { programDir = path.join(target, '.oxe', 'program'); }
  }
  let phase = ctx.phase;
  if (phase === undefined) { try { phase = op().activeProgramPhase(target, activeSession); } catch { phase = null; } }
  const inPhase = (p) => !phase || !p || p === phase.id;
  const out = (recovery, step, cursorCmd, reason, artifacts) => ({ step, cursorCmd, reason, artifacts, recovery });

  // 1. an explicit pause holds everything until resume
  if (run && run.pause_requested) {
    let held = true;
    try { held = injected ? true : Boolean(op().runtimePauseHold(target, activeSession)); } catch { held = true; }
    if (held) {
      const p = run.pause_requested;
      return out('paused', 'resume', 'oxe-cc runtime resume', `run pausado por runtime pause${p.at ? ` em ${p.at}` : ''}${p.reason ? ` (${short(p.reason, 80)})` : ''} — nada roda até retomar; depois: /oxe-execute`, ['.oxe/ACTIVE-RUN.json']);
    }
  }

  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const failed = tasks.filter((t) => pendingTask(t) && t.checkpoint_failed);
  // 2. a failed checkpoint. R42: uncommitted work in the tree comes first (any other command would run over it),
  // then the first failed task in plan order
  if (failed.length) {
    const emptyNoWork = (cf) => cf.kind === 'empty_checkpoint' && !(Array.isArray(cf.leftover) && cf.leftover.length);
    const t = failed.find((x) => x.checkpoint_failed.kind !== 'scope_insufficient' && !emptyNoWork(x.checkpoint_failed)) || failed[0];
    const cf = t.checkpoint_failed;
    if (cf.kind === 'scope_insufficient') {
      const files = (cf.related_red || []).slice(0, 4);
      return out('scope_insufficient', 'plan-scope', `oxe-cc plan scope add ${t.id} ${files.join(' ') || '<arquivo>'} --cr CR-<n> --by <papel> --reason "…"`,
        `${t.id}: testes que importam os arquivos da tarefa ficaram vermelhos fora do escopo dela (${files.join(', ') || 'veja o checkpoint'}) — inclua-os no escopo (ou abra um CR/tarefa) e depois: oxe-cc plan reopen ${t.id}`, ['.oxe/PLAN.json']);
    }
    if (emptyNoWork(cf)) {
      return out('empty_checkpoint', 'plan-done', `oxe-cc plan done ${t.id} --commit <sha>`,
        `${t.id}: a tentativa terminou sem mudar nada e sem checkpoint anterior — se o trabalho já está na base, marque-a com o commit; senão: oxe-cc plan reopen ${t.id}`, ['.oxe/PLAN.json']);
    }
    // the tasks sharing its files: failed ones commit together, pending ones wait for it
    const mine = new Set((t.files || []).map(normF));
    const shares = (o) => (o.files || []).map(normF).some((f) => mine.has(f));
    const waiting = tasks.filter((o) => o !== t && pendingTask(o) && !o.checkpoint_failed && shares(o)).map((o) => o.id);
    const together = failed.filter((o) => o !== t && shares(o) && !emptyNoWork(o.checkpoint_failed)).map((o) => o.id);
    const ids = [t.id, ...together];
    const cmd = `oxe-cc runtime commit-task ${ids.join(',')}${together.length ? ' --together' : ''}`;
    if (cf.kind === 'integration') {
      return out('integration', 'checkpoint-integration', cmd, `${t.id}: check de integração vermelho no commit (${short(cf.reason, 140)}) — corrija o que ele aponta e commite a tarefa`, ['.oxe/PLAN.json']);
    }
    return out('checkpoint_failed', 'commit-task', cmd,
      `${t.id}: o checkpoint falhou e o trabalho ficou na árvore sem commit (${short(cf.reason, 120)})${waiting.length ? ` — ${waiting.join(', ')} espera(m) por arquivos dela` : ''}; commite antes do próximo execute`, ['.oxe/PLAN.json']);
  }

  // 3. an open spec_gap CR of this phase with no SPEC edit yet: the SPEC must change before its tasks redo
  try {
    const change = require('./oxe-change.cjs');
    const records = change.readNdjson(change.changesFile(programDir));
    // R42: any SPEC edit tied to the CR counts (amend, and add with --cr)
    const edited = new Set(records.filter((r) => r && r.kind === 'spec_edit' && r.cr).map((r) => r.cr));
    const gap = change.listChanges(programDir).find((cr) => cr.class === 'spec_gap' && cr.status === 'open' && inPhase(cr.phase) && !cr.spec_edit && !cr.specEdit && !edited.has(cr.id) && !cr.no_amendment);
    if (gap) {
      const a = (gap.criteria || [])[0] || 'A<n>';
      return out('spec_gap', 'spec-amend', `oxe-cc spec amend ${a} --cr ${gap.id} --append "…" --by <papel> --reason "…"`,
        `${gap.id} (spec_gap) aberto em ${(gap.criteria || []).join(', ') || '—'}: ${short(gap.summary, 100)} — emende a SPEC por ele antes de refazer as tarefas`, ['.oxe/SPEC.md', '.oxe/program/changes.ndjson']);
    }
  } catch { /* sem programa */ }

  // 4. deferred tasks of this phase, still open — R42: only once nothing else is left to run (a deferral lets the
  // other waves go on; it is collected before the close, never ahead of the plan)
  try {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const open = require('./oxe-deferred.cjs').open(programDir).filter((e) => inPhase(e.phase) && (!byId.size || pendingTask(byId.get(e.task))));
    if (open.length) {
      const deferredIds = new Set(open.map((e) => e.task));
      const othersPending = tasks.some((t) => pendingTask(t) && !deferredIds.has(t.id));
      if (!othersPending) {
        return out('deferred', 'deferred-retry', 'oxe-cc runtime deferred retry',
          `${deferredIds.size} tarefa(s) adiada(s) ainda aberta(s) (${[...deferredIds].slice(0, 5).join(', ')}) e nada mais a rodar — tente de novo, ou registre o adiamento com dono e risco antes do close`, ['.oxe/program/deferred.ndjson']);
      }
    }
  } catch { /* sem registro */ }

  // 5. a verify that failed: name the first red check, not a generic "fix and verify"
  let closedRun = false;
  try { closedRun = Boolean(run && run.run_id && !injected && op().isClosedPhaseRun(target, activeSession, run.run_id)); } catch { closedRun = false; }
  if (run && !closedRun && Array.isArray(run.verification_check_results) && run.verification_status && run.verification_status !== 'passed') {
    const red = run.verification_check_results.find((c) => c && (c.status === 'fail' || c.status === 'error'));
    if (red) {
      // R42: a verify of an older commit — the fix is committed since: verify again (or the CI close decides)
      let head = ctx.head;
      if (head === undefined) { try { head = require('./oxe-verdicts.cjs').headOf(target); } catch { head = null; } }
      if (run.verification_head && head && run.verification_head !== head) {
        let closeCi = false;
        try { closeCi = require('./oxe-journey.cjs').deliveryMode(ctx.cfg || {}).close === 'ci'; } catch { closeCi = false; }
        if (ctx.cfg === undefined) { try { closeCi = require('./oxe-journey.cjs').deliveryMode(JSON.parse(require('fs').readFileSync(path.join(target, '.oxe', 'config.json'), 'utf8'))).close === 'ci'; } catch { /* sem config */ } }
        if (closeCi) return null;
        return out('verify_stale', 'verify', '/oxe-verify', `o verify reprovou em ${String(run.verification_head).slice(0, 8)} (${red.check_id}); o HEAD mudou depois disso — rode /oxe-verify de novo`, ['.oxe/VERIFY.md']);
      }
      return out('verify_failed', 'execute', '/oxe-execute',
        `verify reprovou: ${red.check_id}${red.acceptance_ref ? ` (${red.acceptance_ref})` : ''}${red.command ? ` — reproduza com \`${short(red.command, 100)}\`` : ''}${red.error ? `: ${short(red.error, 100)}` : ''}; corrija e rode /oxe-verify de novo`, ['.oxe/VERIFY.md']);
    }
  }
  return null;
}

module.exports = { recoveryStep };
