'use strict';

/**
 * 1.21.2 — guided recovery (user, 15/11: "a user who knows only the main commands, guided by oxe-build itself"). The
 * next step knew the happy path; after a failure it said "em execução — concluir e verificar" and the way out lived
 * only in the CLI. `recoveryStep` reads the failure states the runtime records and returns the next step in the same
 * shape (`step`, `cursorCmd`, `reason`, `artifacts`), most urgent first. Read only: it never writes, spawns or calls
 * the network.
 */

const fs = require('fs');
const path = require('path');

const op = () => require('./oxe-operational.cjs');

const pendingTask = (t) => t && t.done !== true && t.status !== 'done' && !t.superseded && !t.merged_into;
const short = (s, n = 160) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/**
 * @param {string} target project root
 * @param {string|null} activeSession
 * @param {object} [ctx] { run, doc, programDir } (injected by tests; read from disk otherwise)
 * @returns {{ step: string, cursorCmd: string, reason: string, artifacts: string[], recovery: string }|null}
 */
function recoveryStep(target, activeSession, ctx = {}) {
  let run = ctx.run;
  if (run === undefined) { try { run = op().readRunState(target, activeSession); } catch { run = null; } }
  let doc = ctx.doc;
  if (doc === undefined) { try { doc = op().readPlanJsonDoc(target, activeSession).doc; } catch { doc = null; } }
  let programDir = ctx.programDir;
  if (programDir === undefined) {
    try { programDir = op().resolveRuntimeArtifactPaths(target, activeSession).programDir || path.join(target, '.oxe', 'program'); } catch { programDir = path.join(target, '.oxe', 'program'); }
  }
  const out = (recovery, step, cursorCmd, reason, artifacts) => ({ step, cursorCmd, reason, artifacts, recovery });

  // 1. an explicit pause holds everything until resume
  if (run && run.pause_requested) {
    let held = true;
    try { held = ctx.run !== undefined ? true : Boolean(op().runtimePauseHold(target, activeSession)); } catch { held = true; }
    if (held) {
      const p = run.pause_requested;
      return out('paused', 'resume', 'oxe-cc runtime resume', `run pausado por runtime pause${p.at ? ` em ${p.at}` : ''}${p.reason ? ` (${short(p.reason, 80)})` : ''} — nada roda até retomar; depois: /oxe-execute`, ['.oxe/ACTIVE-RUN.json']);
    }
  }

  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const failed = tasks.filter((t) => pendingTask(t) && t.checkpoint_failed);
  // 2. a checkpoint that failed: the work is in the tree, uncommitted — the chain stopped there
  for (const t of failed) {
    const cf = t.checkpoint_failed;
    if (cf.kind === 'scope_insufficient') {
      const files = (cf.related_red || []).slice(0, 4);
      return out('scope_insufficient', 'plan-scope', `oxe-cc plan scope add ${t.id} ${files.join(' ') || '<arquivo>'} --cr CR-<n> --by <papel> --reason "…"`,
        `${t.id}: testes que importam os arquivos da tarefa ficaram vermelhos fora do escopo dela (${files.join(', ') || 'veja o checkpoint'}) — inclua-os no escopo (ou abra um CR/tarefa) e depois: oxe-cc plan reopen ${t.id}`, ['.oxe/PLAN.json']);
    }
  }
  for (const t of failed) {
    const cf = t.checkpoint_failed;
    if (cf.kind === 'empty_checkpoint' && !(Array.isArray(cf.leftover) && cf.leftover.length)) {
      return out('empty_checkpoint', 'plan-done', `oxe-cc plan done ${t.id} --commit <sha>`,
        `${t.id}: a tentativa terminou sem mudar nada e sem checkpoint anterior — se o trabalho já está na base, marque-a com o commit; senão: oxe-cc plan reopen ${t.id}`, ['.oxe/PLAN.json']);
    }
  }
  // the first failed checkpoint (plan order) — the chain stopped there
  if (failed.length) {
    const t = failed[0];
    const cf = t.checkpoint_failed;
    // other tasks waiting on this one's files are committed together
    const norm = (f) => String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/');
    const mine = new Set((t.files || []).map(norm));
    const waiting = tasks.filter((o) => o !== t && pendingTask(o) && !o.checkpoint_failed && (o.files || []).map(norm).some((f) => mine.has(f))).map((o) => o.id);
    const together = failed.filter((o) => o !== t && (o.files || []).map(norm).some((f) => mine.has(f))).map((o) => o.id);
    const ids = [t.id, ...together];
    if (cf.kind === 'integration') {
      return out('integration', 'checkpoint-integration', `oxe-cc runtime commit-task ${ids.join(',')}${together.length ? ' --together' : ''}`,
        `${t.id}: check de integração vermelho no commit (${short(cf.reason, 140)}) — corrija o que ele aponta e commite a tarefa`, ['.oxe/PLAN.json']);
    }
    return out('checkpoint_failed', 'commit-task', `oxe-cc runtime commit-task ${ids.join(',')}${together.length ? ' --together' : ''}`,
      `${t.id}: o checkpoint falhou e o trabalho ficou na árvore sem commit (${short(cf.reason, 120)})${waiting.length ? ` — ${waiting.join(', ')} espera(m) por arquivos dela` : ''}; commite antes do próximo execute`, ['.oxe/PLAN.json']);
  }

  // 3. an open spec_gap CR with no amendment yet: the SPEC must change before its tasks redo
  try {
    const change = require('./oxe-change.cjs');
    const records = change.readNdjson(change.changesFile(programDir));
    const amended = new Set(records.filter((r) => r && r.kind === 'spec_edit' && r.action === 'amend_criterion' && r.cr).map((r) => r.cr));
    const gap = change.listChanges(programDir).find((cr) => cr.class === 'spec_gap' && cr.status === 'open' && !cr.spec_edit && !cr.specEdit && !amended.has(cr.id) && !cr.no_amendment);
    if (gap) {
      const a = (gap.criteria || [])[0] || 'A<n>';
      return out('spec_gap', 'spec-amend', `oxe-cc spec amend ${a} --cr ${gap.id} --append "…" --by <papel> --reason "…"`,
        `${gap.id} (spec_gap) aberto em ${(gap.criteria || []).join(', ') || '—'}: ${short(gap.summary, 100)} — emende a SPEC por ele antes de refazer as tarefas`, ['.oxe/SPEC.md', '.oxe/program/changes.ndjson']);
    }
  } catch { /* sem programa */ }

  // 4. deferred tasks (a failure accepted for later) still open
  try {
    const open = require('./oxe-deferred.cjs').open(programDir);
    if (open.length) {
      const ids = [...new Set(open.map((e) => e.task))];
      return out('deferred', 'deferred-retry', 'oxe-cc runtime deferred retry',
        `${open.length} tarefa(s) adiada(s) ainda aberta(s) (${ids.slice(0, 5).join(', ')}) — tente de novo, ou registre o adiamento com dono e risco antes do close`, ['.oxe/program/deferred.ndjson']);
    }
  } catch { /* sem registro */ }

  // 5. a verify that failed: name the first red check, not a generic "fix and verify"
  let closedRun = false;
  try { closedRun = Boolean(run && run.run_id && ctx.run === undefined && op().isClosedPhaseRun(target, activeSession, run.run_id)); } catch { closedRun = false; }
  if (run && !closedRun && Array.isArray(run.verification_check_results) && run.verification_status && run.verification_status !== 'passed') {
    const red = run.verification_check_results.find((c) => c && (c.status === 'fail' || c.status === 'error'));
    if (red) {
      return out('verify_failed', 'execute', '/oxe-execute',
        `verify reprovou: ${red.check_id}${red.acceptance_ref ? ` (${red.acceptance_ref})` : ''}${red.command ? ` — reproduza com \`${short(red.command, 100)}\`` : ''}${red.error ? `: ${short(red.error, 100)}` : ''}; corrija e rode /oxe-verify de novo`, ['.oxe/VERIFY.md']);
    }
  }
  return null;
}

module.exports = { recoveryStep };
