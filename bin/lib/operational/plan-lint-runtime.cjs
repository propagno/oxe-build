'use strict';

/**
 * 1.23.0 (OXB-230-10 / ADR D-6 Fatia 3): Plan mutation, verify-prune/edit/add, pack-sync/fix/ready,
 * and task-fold/reopen runtime operations extracted from bin/lib/oxe-operational.cjs.
 * Zero circular requires back to oxe-operational.cjs — all helpers are injected via `deps`.
 */

const fs = require('fs');
const path = require('path');

function createPlanLintRuntime(deps) {
  const {
    readTextIfExists,
    resolveRuntimeArtifactPaths,
    readJsonQuiet,
    clearTaskResidualRunState,
    readProjectConfig,
    writeTextAtomic,
    requireEditReason,
    readPlanJsonDoc,
    isFrozenTestPathCandidate,
    hasTaskExecutionStarted,
    readTaskVerifyCommands,
    syncImplementationPackExpectedChecks,
    syncImplementationPackTaskPaths,
    buildPackEntryFromAppendTask,
    taskPhaseContext,
    appendEvent,
  } = deps;

  function runtimePlanScopeAdd(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const programLib = require('../oxe-program.cjs');
    const taskId = String(options.task || '').toUpperCase();
    if (!/^T\d+$/.test(taskId)) throw new Error('use: oxe-cc plan scope add T<n> <arquivo…> (--cr CR-n | --auto-cr) --by <papel> --reason "…"');
    const add = [...new Set((options.paths || []).map((p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))];
    if (!add.length) throw new Error('informe ao menos um arquivo');
    if (add.some((p) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..'))) throw new Error('caminho relativo ao repositório, sem ".." nem absoluto');
    const by = String(options.by || '').trim();
    const reason = String(options.reason || '').trim();
    if (!by) throw new Error('informe quem decide (--by <papel>)');
    if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "…")');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const autoCr = Boolean(options.autoCr);
    let crId = String(options.cr || '').toUpperCase();
    let autoCrCreated = false;
    if (!autoCr || crId) {
      const cr = changeLib.listChanges(programDir).find((c) => c.id === crId);
      if (!cr) throw new Error(`--cr ${options.cr || '(ausente)'}: o escopo de uma fase em andamento só cresce por um CR aberto (oxe-cc runtime feedback … ou passe --auto-cr)`);
      if (cr.status !== 'open') throw new Error(`${crId} está ${cr.status}: use um CR aberto`);
      if (!(cr.tasks || []).map((t) => String(t).toUpperCase()).includes(taskId)) throw new Error(`${crId} não reabre ${taskId} (tasks: ${(cr.tasks || []).join(', ') || '—'})`);
    }
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan scope add exige PLAN.json');
    const result = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const task = (doc.tasks || []).find((t) => t && String(t.id).toUpperCase() === taskId);
      if (!task) throw new Error(`Tarefa ${taskId} não encontrada em PLAN.json`);
      if (task.done === true && !autoCr) throw new Error(`${taskId} está done: reabra antes (oxe-cc plan reopen ${taskId}) ou passe --auto-cr`);
      const bad = add.filter((p) => isFrozenTestPathCandidate(doc, p));
      if (bad.length) {
        throw new Error(
          `${bad.join(', ')}: teste congelado NUNCA entra em files de tarefa (o plan lint reprova). Para liberar/atualizar teste congelado por CR, edite-o num quick e rode: oxe-cc plan amend-test ${bad[0]} --reason ${crId || 'CR-<n>'} --by ${by || '<papel>'} (ou oxe-cc spec freeze --from <sha|#PR> --cr ${crId || 'CR-<n>'})`,
        );
      }
      const have = new Set((task.files || []).map((f) => String(f).replace(/\\/g, '/')));
      const added = add.filter((p) => !have.has(p));
      let packUpdated = false;
      let clearedScopeFailure = false;
      let reopened = false;
      if (added.length) {
        // Create the audited CR only AFTER validating task existence and frozen-test guards (zero orphan CRs on error).
        if (autoCr && !crId) {
          const programState = programLib.readProgram(programDir);
          const created = changeLib.recordChange({
            programDir,
            program: programState,
            plan: doc,
            class: 'constraint',
            summary: `ampliação de escopo (${taskId}): ${reason}`,
            criteria: Array.isArray(task.acceptance) ? task.acceptance : [],
            tasks: [taskId],
            by,
          });
          crId = created.cr.id;
          autoCrCreated = true;
          appendEvent(projectRoot, activeSession, {
            type: 'ChangeRequested',
            work_item_id: taskId,
            payload: { id: crId, class: created.cr.class, phase: created.cr.phase, criteria: created.cr.criteria || [], tasks: [taskId], by, auto_cr: true },
          });
        }
        if (task.done === true && autoCr) {
          task.done = false;
          task.reopened_for_scope = { cr: crId, by, reason, at: new Date().toISOString() };
          reopened = true;
        }
        task.files = [...(task.files || []), ...added];
        task.scope_added = [...(Array.isArray(task.scope_added) ? task.scope_added : []), { paths: added, cr: crId, by, reason, at: new Date().toISOString(), ...(autoCrCreated ? { auto_cr: true } : {}) }];
        if (task.checkpoint_failed && task.checkpoint_failed.kind === 'scope_insufficient') {
          const normF = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
          const under = (a, b) => a === b || b.startsWith(`${a.replace(/\/+$/, '')}/`);
          const reds = Array.isArray(task.checkpoint_failed.related_red) ? task.checkpoint_failed.related_red.map(normF).filter(Boolean) : [];
          const mine = task.files.map(normF).filter(Boolean);
          if (reds.length && reds.every((red) => mine.some((m) => under(m, red)))) {
            delete task.checkpoint_failed;
            clearedScopeFailure = true;
          }
        }
        const tmp = `${jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, jsonPath);
        packUpdated = syncImplementationPackTaskPaths(paths, jsonPath, taskId, { addPaths: added });
      }
      return {
        added,
        existed: add.filter((p) => have.has(p)),
        ...(autoCrCreated ? { auto_cr_created: true } : {}),
        ...(reopened ? { reopened: true } : {}),
        ...(packUpdated ? { pack_updated: true } : {}),
        ...(clearedScopeFailure ? { cleared_checkpoint_failed: true } : {}),
      };
    });
    if (result.added.length) {
      if (result.cleared_checkpoint_failed) {
        clearTaskResidualRunState(projectRoot, activeSession, [taskId], { clearFailedAndBlocked: true });
      }
      if (result.reopened) {
        appendEvent(projectRoot, activeSession, { type: 'TaskReopenedForScope', work_item_id: taskId, payload: { task: taskId, cr: crId, by, reason } });
      }
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'scope', id: crId, task: taskId, paths: result.added, by, reason, at: new Date().toISOString(), ...(result.auto_cr_created ? { auto_cr: true } : {}), ...(result.reopened ? { reopened: true } : {}), ...(result.pack_updated ? { pack_updated: true } : {}) });
      appendEvent(projectRoot, activeSession, { type: 'PlanScopeAmended', work_item_id: taskId, payload: { task: taskId, paths: result.added, cr: crId, by, reason, ...(result.auto_cr_created ? { auto_cr: true } : {}), ...(result.reopened ? { reopened: true } : {}), ...(result.pack_updated ? { pack_updated: true } : {}), ...(result.cleared_checkpoint_failed ? { cleared_checkpoint_failed: true } : {}) } });
    }
    return { task: taskId, cr: crId, by, ...result };
  }

  /**
   * `oxe-cc plan task edit T<n> [--wave <n>] [--depends-on T1,T2 | --depends-on none] [--add-paths a,b] [--remove-paths a,b] [--notes "…"]
   * --by <papel> --reason "…" [--cr CR-n]` (OxeSpace 14/11, Celular F3): edits a non-done task in PLAN.json and keeps
   * `IMPLEMENTATION-PACK.json` `exact_paths` in sync. `--add-paths` works directly when the task never started (or with an open CR).
   */
  function runtimePlanTaskEdit(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const taskId = String(options.task || '').toUpperCase();
    if (!/^T\d+$/.test(taskId)) throw new Error('use: oxe-cc plan task edit T<n> [--wave n] [--depends-on T1,T2|none] [--add-paths a,b] [--remove-paths a,b] [--notes "…"] --by <papel> --reason "…"');
    const by = String(options.by || '').trim();
    const reason = String(options.reason || '').trim();
    if (!by) throw new Error('informe quem decide (--by <papel>)');
    if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "…")');
    const wave = options.wave != null && options.wave !== '' ? Number(options.wave) : null;
    if (wave != null && !(Number.isInteger(wave) && wave > 0)) throw new Error('--wave: um número inteiro ≥ 1');
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    const deps = options.dependsOn == null ? null : String(options.dependsOn).trim().toLowerCase() === 'none' ? [] : list(options.dependsOn).map((d) => d.toUpperCase());
    const add = [...new Set(list(options.addPaths).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))];
    const remove = list(options.removePaths).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
    if (add.some((p) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..'))) throw new Error('--add-paths: caminho relativo ao repositório, sem ".." nem absoluto');
    const notes = options.notes != null ? String(options.notes) : null;
    const addVerify = (Array.isArray(options.addVerify) ? options.addVerify : options.addVerify ? [options.addVerify] : [])
      .map((c) => String(c || '').trim())
      .filter(Boolean);
    // OXB-C24-1: plan task edit Tn --budget-usd N (per-task budget, recorded in PLAN.json)
    const budgetUsd = options.budgetUsd != null && options.budgetUsd !== '' ? Number(options.budgetUsd) : null;
    if (budgetUsd != null && !(Number.isFinite(budgetUsd) && budgetUsd > 0)) throw new Error('--budget-usd: um valor em US$ maior que 0');
    if (wave == null && deps == null && !add.length && !remove.length && notes == null && !addVerify.length && budgetUsd == null) {
      throw new Error('nada a editar: --wave, --depends-on, --add-paths, --remove-paths, --add-verify, --budget-usd ou --notes');
    }
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan task edit exige PLAN.json');
    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const tasks = (doc.tasks || []).filter(Boolean);
      const task = tasks.find((t) => String(t.id).toUpperCase() === taskId);
      if (!task) throw new Error(`Tarefa ${taskId} não encontrada em PLAN.json`);
      if (task.done === true) throw new Error(`${taskId} está done: reabra antes (oxe-cc plan reopen ${taskId})`);
      const before = { wave: task.wave ?? null, depends_on: [...(task.depends_on || [])], files: [...(task.files || [])], notes: task.notes ?? null };
      if (deps) {
        const ids = new Set(tasks.map((t) => String(t.id).toUpperCase()));
        const unknown = deps.filter((d) => !ids.has(d));
        if (unknown.length) throw new Error(`--depends-on: ${unknown.join(', ')} não existe(m) no plano`);
        if (deps.includes(taskId)) throw new Error(`--depends-on: ${taskId} não depende de si mesma`);
        const depsOf = (id) => (id === taskId ? deps : ((tasks.find((t) => String(t.id).toUpperCase() === id) || {}).depends_on || []).map((d) => String(d).toUpperCase()));
        const seen = new Set();
        const stack = [...deps];
        while (stack.length) {
          const id = stack.pop();
          if (id === taskId) throw new Error(`--depends-on: forma um ciclo de dependência com ${taskId}`);
          if (seen.has(id)) continue;
          seen.add(id);
          stack.push(...depsOf(id));
        }
        task.depends_on = deps;
      }
      if (wave != null) task.wave = wave;
      let addedPaths = [];
      if (add.length) {
        const started = hasTaskExecutionStarted(projectRoot, activeSession, task);
        if (started) {
          const crId = String(options.cr || '').toUpperCase();
          const cr = crId ? changeLib.listChanges(programDir).find((c) => c.id === crId) : null;
          if (!cr || cr.status !== 'open' || !(cr.tasks || []).map((t) => String(t).toUpperCase()).includes(taskId)) {
            throw new Error(`${taskId} já iniciou execução — para ampliar escopo de tarefa iniciada, use \`oxe-cc plan scope add ${taskId} ${add.join(' ')} --cr CR-n --by ${by} --reason "…"\``);
          }
        }
        const badFrozen = add.filter((p) => isFrozenTestPathCandidate(doc, p));
        if (badFrozen.length) {
          throw new Error(`${badFrozen.join(', ')}: teste congelado NUNCA entra em files de tarefa (use plan amend-test / spec freeze)`);
        }
        const have = new Set((task.files || []).map((f) => String(f).replace(/\\/g, '/')));
        addedPaths = add.filter((p) => !have.has(p));
        if (addedPaths.length) task.files = [...(task.files || []), ...addedPaths];
      }
      if (remove.length) {
        const frozen = new Set((doc.acceptance_tests || []).flatMap((a) => (a && a.files) || []).map((f) => String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/')));
        const taskFilesNorm = new Set((task.files || []).map((f) => String(f).replace(/\\/g, '/')));
        const bad = remove.filter((p) => frozen.has(p) && !taskFilesNorm.has(p));
        if (bad.length) throw new Error(`${bad.join(', ')}: teste congelado não sai por aqui (um CR e spec freeze)`);
        const missing = remove.filter((p) => !taskFilesNorm.has(p));
        if (missing.length) throw new Error(`${missing.join(', ')} não está(ão) em files de ${taskId}`);
        task.files = (task.files || []).filter((f) => !remove.includes(String(f).replace(/\\/g, '/')));
      }
      if (notes != null) task.notes = notes;
      if (budgetUsd != null) task.budget_usd = budgetUsd;
      let addedVerify = [];
      if (addVerify.length) {
        const beforeCmds = readTaskVerifyCommands(task);
        const beforeSet = new Set(beforeCmds);
        addedVerify = [...new Set(addVerify)].filter((c) => !beforeSet.has(c));
        if (addedVerify.length) {
          const nextCmds = [...beforeCmds, ...addedVerify];
          task.verify = { ...(task.verify && typeof task.verify === 'object' && !Array.isArray(task.verify) ? task.verify : {}), commands: nextCmds };
          if (task.verify.command) delete task.verify.command;
          if (task.verifyCommand) delete task.verifyCommand;
        }
      }
      const after = {
        wave: task.wave ?? null,
        depends_on: [...(task.depends_on || [])],
        files: [...(task.files || [])],
        notes: task.notes ?? null,
        ...(addedVerify.length ? { verify_commands: readTaskVerifyCommands(task) } : {}),
      };
      task.edits = [...(Array.isArray(task.edits) ? task.edits : []), { by, reason, cr: options.cr ? String(options.cr).toUpperCase() : null, at: new Date().toISOString(), ...(wave != null ? { wave } : {}), ...(deps ? { depends_on: deps } : {}), ...(addedPaths.length ? { added_paths: addedPaths } : {}), ...(remove.length ? { removed_paths: remove } : {}), ...(addedVerify.length ? { added_verify: addedVerify } : {}), ...(notes != null ? { notes: true } : {}) }];
      const tmp = `${jsonPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, jsonPath);
      const packPathsUpdated = (addedPaths.length || remove.length)
        ? syncImplementationPackTaskPaths(paths, jsonPath, taskId, { addPaths: addedPaths, removePaths: remove })
        : false;
      const packVerifyUpdated = addedVerify.length
        ? syncImplementationPackExpectedChecks(paths, jsonPath, taskId, readTaskVerifyCommands(task))
        : false;
      const packUpdated = packPathsUpdated || packVerifyUpdated;
      return { before, after, ...(addedPaths.length ? { added_paths: addedPaths } : {}), ...(addedVerify.length ? { added_verify: addedVerify } : {}), ...(packUpdated ? { pack_updated: true } : {}) };
    });
    changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'task_edit', task: taskId, ...out, cr: options.cr ? String(options.cr).toUpperCase() : null, by, reason, at: new Date().toISOString() });
    appendEvent(projectRoot, activeSession, { type: 'PlanTaskEdited', work_item_id: taskId, payload: { task: taskId, by, reason, before: out.before, after: out.after, ...(out.added_paths ? { added_paths: out.added_paths } : {}), ...(out.pack_updated ? { pack_updated: true } : {}) } });
    return { task: taskId, by, ...out };
  }

  /**
   * A verify command without some test arguments (`drop`), or with some anchored (`anchor`, vitest `arg$`), per
   * SUBCOMMAND (R31): `a.test.ts && npm run typecheck` keeps the typecheck; a subcommand whose test arguments all went
   * goes away with its separator — never a bare `vitest run` (the whole suite). R32: the command is never rewritten as a
   * whole (a `-t "v1\.5"` keeps its backslash); a path matches with either separator; the replacement is a function.
   */
  function pruneVerifyCommand(c, drop, anchor) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const TEST_ARG = /[^\s"'`]+\.(test|spec)\.[cm]?[jt]sx?/g;
    const pat = (s) => esc(String(s).replace(/\\/g, '/')).replace(/\//g, '[\\\\/]');
    const parts = String(c).split(/(\s*(?:&&|\|\||;)\s*)/);
    const keep = [];
    for (let i = 0; i < parts.length; i += 2) {
      let n = parts[i];
      for (const arg of drop || []) n = n.replace(new RegExp(`(^|\\s)(["'\`]?)${pat(arg)}\\$?\\2(?=\\s|$)`, 'g'), (_m, p1) => p1);
      for (const arg of anchor || []) n = n.replace(new RegExp(`(^|\\s)(["'\`]?)(${pat(arg)})\\2(?=\\s|$)`, 'g'), (_m, p1, q, a) => `${p1}${q}${a}$${q}`);
      if (n !== parts[i]) n = n.replace(/\s{2,}/g, ' ').trim();
      const had = (parts[i].match(TEST_ARG) || []).length;
      const has = (n.match(TEST_ARG) || []).length;
      if (had && !has) continue;
      if (n) keep.push({ sep: i ? parts[i - 1] : null, text: n });
    }
    return keep.map((k, j) => (j ? (k.sep || ' && ') : '') + k.text).join('');
  }

  /** pruneVerifyCommand over a task's verify.commands, verify.command and verifyCommand; null when nothing changes. */
  function pruneTaskVerify(t, drop, anchor, { apply = true } = {}) {
    const before = { commands: t.verify && Array.isArray(t.verify.commands) ? [...t.verify.commands] : null, command: t.verify && t.verify.command ? t.verify.command : null, verifyCommand: t.verifyCommand || null };
    const after = {
      commands: before.commands ? before.commands.map((c) => pruneVerifyCommand(c, drop, anchor)).filter(Boolean) : null,
      command: before.command ? pruneVerifyCommand(before.command, drop, anchor) || null : null,
      verifyCommand: before.verifyCommand ? pruneVerifyCommand(before.verifyCommand, drop, anchor) || null : null,
    };
    const flat = (x) => [...(x.commands || []), ...(x.command ? [x.command] : []), ...(x.verifyCommand ? [x.verifyCommand] : [])];
    if (JSON.stringify(flat(after)) === JSON.stringify(flat(before))) return null;
    if (apply) {
      if (before.commands) t.verify.commands = after.commands;
      if (before.command) { if (after.command) t.verify.command = after.command; else delete t.verify.command; }
      if (before.verifyCommand) { if (after.verifyCommand) t.verifyCommand = after.verifyCommand; else delete t.verifyCommand; }
    }
    return { before: flat(before), after: flat(after) };
  }

  /**
   * OxeSpace 15/11 (OxeChat F4: T10/T11 superseded by AG-10/AG-11, user decision): `oxe-cc plan task supersede
   * T10,T11 --by-phase "…" --by <papel> --reason "…" [--cr CR-n] [--dry-run]`. For a plan with or without a program:
   * the tasks become done with `superseded` (never scheduled, never reopened), their criteria leave them, the frozen
   * entries of criteria only they held move to `superseded_tests` (kept, not run, nothing released), and those test
   * files leave the pending tasks' verify (per subcommand). Refused for a task with a checkpoint or with pending dependents.
   */
  function runtimePlanTaskSupersede(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const ids = String(options.tasks || '').split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!ids.length || ids.some((id) => !/^T\d+$/.test(id))) throw new Error('use: oxe-cc plan task supersede T<n>[,T<m>] --by-phase "…" --by <papel> --reason "…" [--cr CR-n] [--dry-run]');
    const byPhase = String(options.byPhase || '').trim();
    if (!byPhase) throw new Error('informe o que as substitui (--by-phase "AG-10/AG-11")');
    const { by, reason } = requireEditReason({ by: options.by, reason: options.reason });
    const cr = options.cr ? String(options.cr).toUpperCase() : null;
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan task supersede exige PLAN.json');
    const at = new Date().toISOString();
    const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/');
    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const tasks = (doc.tasks || []).filter(Boolean);
      const set = new Set(ids);
      const problems = [];
      for (const id of ids) {
        const t = tasks.find((x) => String(x.id).toUpperCase() === id);
        if (!t) { problems.push(`${id} não existe no plano`); continue; }
        if (t.done === true || t.status === 'done') problems.push(`${id} já está done`);
        if (t.done_commit) problems.push(`${id} tem checkpoint (${String(t.done_commit).slice(0, 8)})`);
        const dependents = tasks.filter((x) => !set.has(String(x.id).toUpperCase()) && x.done !== true && (x.depends_on || x.dependsOn || []).map((d) => String(d).toUpperCase()).includes(id));
        if (dependents.length) problems.push(`${dependents.map((x) => x.id).join(', ')} depende(m) de ${id} (oxe-cc plan task edit … --depends-on)`);
      }
      if (problems.length) throw new Error(`plan task supersede recusado: ${problems.join('; ')}`);
      const sup = tasks.filter((t) => set.has(String(t.id).toUpperCase()));
      const criteria = [...new Set(sup.flatMap((t) => [...(t.acceptance || []), ...(t.aceite || [])]))];
      // a criterion another pending task still holds stays (only its entries owned by a superseded task go)
      const heldElsewhere = new Set(tasks.filter((t) => !set.has(String(t.id).toUpperCase()) && t.done !== true).flatMap((t) => [...(t.acceptance || []), ...(t.aceite || [])]));
      const goes = (a) => a && ((a.task && set.has(String(a.task).toUpperCase())) || (!a.task && criteria.includes(a.criterion) && !heldElsewhere.has(a.criterion)));
      const moved = (doc.acceptance_tests || []).filter(goes);
      const files = [...new Set(moved.flatMap((a) => (a.files || []).map(norm)).filter(Boolean))];
      const verifyChanges = [];
      for (const t of tasks) {
        if (set.has(String(t.id).toUpperCase()) || t.done === true) continue;
        const c = pruneTaskVerify(t, files, [], { apply: !options.dryRun });
        if (!c) continue;
        verifyChanges.push({ task: t.id, before: c.before, after: c.after });
        if (!options.dryRun) t.edits = [...(Array.isArray(t.edits) ? t.edits : []), { by, reason, at, verify_pruned: files, superseded: ids }];
      }
      if (!options.dryRun) {
        for (const t of sup) Object.assign(t, { done: true, status: 'done', superseded: { by_phase: byPhase, cr, by, reason, at, acceptance: [...new Set([...(t.acceptance || []), ...(t.aceite || [])])] }, acceptance: [], ...(t.aceite ? { aceite: [] } : {}) });
        doc.acceptance_tests = (doc.acceptance_tests || []).filter((a) => !goes(a));
        doc.superseded_tests = [...(Array.isArray(doc.superseded_tests) ? doc.superseded_tests : []), ...moved.map((a) => ({ ...a, superseded: { by_phase: byPhase, tasks: ids, at } }))];
        const tmp = `${jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, jsonPath);
      }
      return { tasks: ids, criteria, tests_kept: moved.map((a) => a.criterion), files, verify_changes: verifyChanges };
    });
    // their open deferred entries close as superseded — never an open deferral at the close (R34, like the fold)
    const closedDeferred = [];
    try {
      const dlib = require('../oxe-deferred.cjs');
      for (const e of dlib.open(programDir)) {
        if (!ids.includes(String(e.task).toUpperCase())) continue;
        if (!options.dryRun) dlib.close(programDir, e.id, `superseded_by:${byPhase}`);
        closedDeferred.push(e.id);
      }
    } catch { /* no ledger */ }
    if (!options.dryRun) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'task_supersede', tasks: ids, by_phase: byPhase, cr, criteria: out.criteria, tests_kept: out.tests_kept, verify_pruned: out.verify_changes.map((c) => c.task), closed_deferred: closedDeferred, by, reason, at });
      appendEvent(projectRoot, activeSession, { type: 'PlanTasksSuperseded', payload: { tasks: ids, by_phase: byPhase, cr, by, reason, closed_deferred: closedDeferred } });
    }
    return { dry_run: Boolean(options.dryRun), by_phase: byPhase, ...out, closed_deferred: closedDeferred };
  }

  /**
   * OxeSpace 15/11 (OxeChat F4 install): `oxe-cc plan verify prune --later-owned --by <papel> --reason "…" [--dry-run]`.
   * The G38 findings applied: from each pending task's verify, the test arguments that select a frozen test only a LATER
   * task turns green are removed (the exact path, or the argument that matched it as a vitest substring). A command left
   * with no test argument and nothing else is dropped. Recorded per task (edits[], changes.ndjson, PlanVerifyPruned).
   */
  function runtimePlanVerifyPrune(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const si = require('../oxe-suite-impact.cjs');
    if (!options.laterOwned) throw new Error('use: oxe-cc plan verify prune --later-owned --by <papel> --reason "…" [--dry-run]');
    const { by, reason } = requireEditReason({ by: options.by, reason: options.reason });
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan verify prune exige PLAN.json');
    const at = new Date().toISOString();
    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const findings = si.laterOwnedTests(doc);
      // cross-review 15/11 (R31 P0): an argument that selects a later test only as a vitest SUBSTRING (T44's
      // `pu03-app-version.test.ts` pulling T59's `.test.tsx`) is the task's own test — it is ANCHORED (`arg$`), never
      // removed; only an argument that names a later-owned test itself is removed
      const byTask = new Map();
      for (const f of findings) {
        if (!byTask.has(f.task)) byTask.set(f.task, { drop: new Set(), anchor: new Set() });
        const e = byTask.get(f.task);
        if (!f.via) e.drop.add(f.test);
        else e.anchor.add(f.via);
      }
      for (const e of byTask.values()) for (const a of e.anchor) if (e.drop.has(a)) e.anchor.delete(a);
      const changes = [];
      for (const t of (doc.tasks || []).filter(Boolean)) {
        const e = byTask.get(t.id);
        if (!e) continue;
        const c = pruneTaskVerify(t, e.drop, e.anchor, { apply: !options.dryRun });
        if (!c) continue;
        changes.push({ task: t.id, removed: [...e.drop], anchored: [...e.anchor], before: c.before, after: c.after });
        if (!options.dryRun) t.edits = [...(Array.isArray(t.edits) ? t.edits : []), { by, reason, at, verify_pruned: [...e.drop], ...(e.anchor.size ? { verify_anchored: [...e.anchor] } : {}) }];
      }
      if (!options.dryRun && changes.length) {
        const tmp = `${jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, jsonPath);
      }
      return { changes, remaining: options.dryRun ? findings.length : si.laterOwnedTests(doc).length };
    });
    if (!options.dryRun && out.changes.length) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'verify_prune', by, reason, at, changes: out.changes.map((c) => ({ task: c.task, removed: c.removed, anchored: c.anchored })) });
      appendEvent(projectRoot, activeSession, { type: 'PlanVerifyPruned', payload: { by, reason, tasks: out.changes.map((c) => c.task) } });
    }
    return { dry_run: Boolean(options.dryRun), ...out };
  }

  function extractAndRemoveVerifySegment(task, rawTarget, { apply = true } = {}) {
    const target = String(rawTarget || '').trim();
    if (!target) return null;
    const normTarget = target.replace(/\\/g, '/').replace(/^\.\//, '');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = esc(normTarget).replace(/\//g, '[\\\\/]');
    const argRe = new RegExp(`(^|\\s)(["'\`]?)(${pat}(?:\\.(?:test|spec)\\.[cm]?[jt]sx?)?)\\$?\\2(?=\\s|$)`, 'g');
    const TEST_ARG = /[^\s"'`]+\.(?:test|spec)\.[cm]?[jt]sx?/g;

    const extracted = [];
    const rewriteCommand = (cmdStr) => {
      const parts = String(cmdStr).split(/(\s*(?:&&|\|\||;)\s*)/);
      const keep = [];
      for (let i = 0; i < parts.length; i += 2) {
        const sub = parts[i].trim();
        if (!sub) continue;
        // 1. Exact full subcommand match (or multi-word command substring match)
        if (sub === target || (/\s/.test(target) && sub.includes(target))) {
          extracted.push(sub);
          continue;
        }
        // 2. Test-argument / path match inside the subcommand
        const matchedArgs = [];
        const stripped = sub.replace(argRe, (_m, p1, q, argVal) => {
          matchedArgs.push(`${q}${argVal}${q}`);
          return p1;
        });
        if (!matchedArgs.length) {
          keep.push({ sep: i ? parts[i - 1] : null, text: parts[i] });
          continue;
        }
        const cleaned = stripped.replace(/\s{2,}/g, ' ').trim();
        const hadTests = (sub.match(TEST_ARG) || []).length;
        const hasTests = (cleaned.match(TEST_ARG) || []).length;
        if (hadTests && !hasTests) {
          // Every test argument in this subcommand was moved/dropped: whole subcommand leaves
          extracted.push(sub);
          continue;
        }
        // Reconstruct runnable subcommand for `--to T<m>` with the same runner prefix + only the moved arg(s)
        const runnerOnly = sub.replace(TEST_ARG, '').replace(/\s{2,}/g, ' ').trim();
        extracted.push(runnerOnly ? `${runnerOnly} ${matchedArgs.join(' ')}`.replace(/\s{2,}/g, ' ').trim() : matchedArgs.join(' '));
        if (cleaned) keep.push({ sep: i ? parts[i - 1] : null, text: cleaned });
      }
      return keep.map((k, j) => (j ? (k.sep || ' && ') : '') + k.text).join('');
    };

    const before = {
      commands: task.verify && Array.isArray(task.verify.commands) ? [...task.verify.commands] : null,
      command: task.verify && task.verify.command ? task.verify.command : null,
      verifyCommand: task.verifyCommand || null,
    };
    const after = {
      commands: before.commands ? before.commands.map(rewriteCommand).filter(Boolean) : null,
      command: before.command ? rewriteCommand(before.command) || null : null,
      verifyCommand: before.verifyCommand ? rewriteCommand(before.verifyCommand) || null : null,
    };
    const flat = (x) => [...(x.commands || []), ...(x.command ? [x.command] : []), ...(x.verifyCommand ? [x.verifyCommand] : [])];
    if (JSON.stringify(flat(after)) === JSON.stringify(flat(before))) return null;
    if (apply) {
      if (before.commands) task.verify.commands = after.commands;
      if (before.command) { if (after.command) task.verify.command = after.command; else delete task.verify.command; }
      if (before.verifyCommand) { if (after.verifyCommand) task.verifyCommand = after.verifyCommand; else delete task.verifyCommand; }
    }
    return { before: flat(before), after: flat(after), extracted: [...new Set(extracted)] };
  }

  /**
   * OXB-C1 (#8): `oxe-cc plan verify move T<n> "<segmento|arquivo>" --to <T<m>|KEY> --cr CR-n --by <papel> [--reason "…"] [--dry-run]`
   * and `oxe-cc plan verify drop T<n> "<segmento|arquivo>" --by <papel> --reason "…" [--cr CR-n] [--dry-run]`.
   */
  function runtimePlanVerifyEdit(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const criteriaIds = require('../oxe-criteria-ids.cjs');
    const action = options.action === 'move' ? 'move' : 'drop';
    const taskId = String(options.task || '').trim().toUpperCase();
    const segment = String(options.segment || '').trim();
    if (!/^T\d+$/.test(taskId) || !segment) {
      throw new Error(
        action === 'move'
          ? 'use: oxe-cc plan verify move T<n> "<segmento|arquivo>" --to <T<m>|KEY> --cr CR-n --by <papel> [--reason "…"] [--dry-run]'
          : 'use: oxe-cc plan verify drop T<n> "<segmento|arquivo>" --by <papel> --reason "…" [--cr CR-n] [--dry-run]'
      );
    }
    const cr = options.cr ? String(options.cr).trim().toUpperCase() : null;
    if (action === 'move') {
      if (!cr || !criteriaIds.CR_ID_RE.test(cr)) {
        throw new Error('plan verify move exige um CR válido (--cr CR-<n>)');
      }
    } else if (cr && !criteriaIds.CR_ID_RE.test(cr)) {
      throw new Error(`CR inválido: ${cr}`);
    }
    const toRaw = action === 'move' ? String(options.to || '').trim().toUpperCase() : null;
    const toIsTask = Boolean(toRaw && /^T\d+$/.test(toRaw));
    const toIsCard = Boolean(toRaw && !toIsTask && (/^[A-Z][A-Z0-9]*-\d+$/.test(toRaw) || /^\d+$/.test(toRaw)));
    if (action === 'move' && !toIsTask && !toIsCard) {
      throw new Error('informe o destino (--to T<m> ou --to <CARD-KEY>, ex.: OXE-292)');
    }
    if (toIsTask && toRaw === taskId) {
      throw new Error(`--to: ${taskId} já é a tarefa de origem`);
    }
    const fallbackReason = action === 'move' && !options.reason ? `movido de ${taskId} para ${toRaw} (${cr})` : options.reason;
    const { by, reason } = requireEditReason({ by: options.by, reason: fallbackReason });

    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error(`plan verify ${action} exige PLAN.json`);
    const at = new Date().toISOString();

    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const tasks = (doc.tasks || []).filter(Boolean);
      const srcTask = tasks.find((t) => String(t.id).toUpperCase() === taskId);
      if (!srcTask) throw new Error(`Tarefa ${taskId} não encontrada em PLAN.json`);
      if (srcTask.done === true) throw new Error(`${taskId} está done: reabra antes (oxe-cc plan reopen ${taskId})`);

      let dstTask = null;
      if (toIsTask) {
        dstTask = tasks.find((t) => String(t.id).toUpperCase() === toRaw);
        if (!dstTask) throw new Error(`Tarefa destino ${toRaw} não encontrada em PLAN.json`);
        if (dstTask.done === true) throw new Error(`Tarefa destino ${toRaw} já está done`);
      }

      const removed = extractAndRemoveVerifySegment(srcTask, segment, { apply: !options.dryRun });
      if (!removed) {
        throw new Error(`segmento/arquivo "${segment}" não encontrado no verify de ${taskId}`);
      }

      let dstBefore = null;
      let dstAfter = null;
      if (dstTask) {
        const curCmds = dstTask.verify && Array.isArray(dstTask.verify.commands)
          ? [...dstTask.verify.commands]
          : (dstTask.verify && dstTask.verify.command ? [dstTask.verify.command] : (dstTask.verifyCommand ? [dstTask.verifyCommand] : []));
        dstBefore = [...curCmds];
        const nextCmds = [...new Set([...curCmds, ...removed.extracted])];
        dstAfter = nextCmds;
        if (!options.dryRun) {
          dstTask.verify = { ...(dstTask.verify && typeof dstTask.verify === 'object' && !Array.isArray(dstTask.verify) ? dstTask.verify : {}), commands: nextCmds };
          if (dstTask.verify.command) delete dstTask.verify.command;
          if (dstTask.verifyCommand) delete dstTask.verifyCommand;
          dstTask.edits = [...(Array.isArray(dstTask.edits) ? dstTask.edits : []), { by, reason, cr, at, verify_received_from: taskId, added: removed.extracted }];
        }
      }

      if (!options.dryRun) {
        srcTask.edits = [
          ...(Array.isArray(srcTask.edits) ? srcTask.edits : []),
          action === 'move'
            ? { by, reason, cr, at, verify_moved: segment, to: toRaw, extracted: removed.extracted }
            : { by, reason, cr, at, verify_dropped: segment, extracted: removed.extracted },
        ];
        const tmp = `${jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, jsonPath);
      }

      return {
        action,
        task: taskId,
        segment,
        extracted: removed.extracted,
        before: removed.before,
        after: removed.after,
        ...(action === 'move' ? { to: toRaw, to_kind: toIsTask ? 'task' : 'card', ...(dstTask ? { target_before: dstBefore, target_after: dstAfter } : {}) } : {}),
        cr,
        by,
        reason,
      };
    });

    if (!options.dryRun) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), {
        kind: action === 'move' ? 'verify_move' : 'verify_drop',
        ...out,
        at,
      });
      appendEvent(projectRoot, activeSession, {
        type: action === 'move' ? 'PlanVerifyMoved' : 'PlanVerifyDropped',
        work_item_id: taskId,
        payload: { ...out },
      });
    }

    return { dry_run: Boolean(options.dryRun), ...out };
  }

  function buildSuiteVerifyCommand(projectRoot, suites) {
    const rels = suites.map((p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean);
    if (rels.some((p) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..'))) {
      throw new Error('--suite: caminho deve ser relativo ao repositório, sem ".." nem absoluto');
    }
    const cfg = readProjectConfig(projectRoot) || {};
    const customTpl = typeof cfg.task_suite_command === 'string' && cfg.task_suite_command.includes('{files}')
      ? cfg.task_suite_command
      : cfg.checkpoint_related_tests && typeof cfg.checkpoint_related_tests === 'object'
        && typeof cfg.checkpoint_related_tests.run_command === 'string' && cfg.checkpoint_related_tests.run_command.includes('{files}')
        ? cfg.checkpoint_related_tests.run_command
        : null;
    if (customTpl) return customTpl.replace('{files}', rels.join(' '));
    const combinedText = rels.map((r) => readTextIfExists(path.join(projectRoot, r)) || '').join('\n');
    if (rels.some((r) => /(^|\/)(e2e|playwright)\//i.test(r) || /\.e2e\./i.test(r)) || /@playwright\/test/.test(combinedText)) {
      return `npx playwright test ${rels.join(' ')}`;
    }
    if (/node:test/.test(combinedText) || rels.every((r) => /\.test\.c?js$/i.test(r))) {
      return `node --test ${rels.join(' ')}`;
    }
    return `npx vitest run ${rels.join(' ')}`;
  }

  /**
   * OXB-C7 #2: `oxe-cc plan verify add T<n> (--command "…" | --suite <arquivo…>) [--by <papel> --reason "…"] [--dry-run]`
   * Appends command(s) or test suite runner invocations to a task's `verify.commands` and keeps `IMPLEMENTATION-PACK.json`
   * `expected_checks` synchronized.
   */
  function runtimePlanVerifyAdd(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const criteriaIds = require('../oxe-criteria-ids.cjs');
    const taskId = String(options.task || '').trim().toUpperCase();
    if (!/^T\d+$/.test(taskId)) {
      throw new Error('use: oxe-cc plan verify add T<n> (--command "…" | --suite <arquivo…>) [--cr CR-n] [--by <papel> --reason "…"] [--dry-run]');
    }
    const rawCommands = (Array.isArray(options.commands) ? options.commands : options.command ? [options.command] : [])
      .map((c) => String(c || '').trim())
      .filter(Boolean);
    const rawSuites = (Array.isArray(options.suites) ? options.suites : options.suite ? [options.suite] : [])
      .flatMap((s) => String(s || '').split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!rawCommands.length && !rawSuites.length) {
      throw new Error('informe --command "…" ou --suite <arquivo…> para adicionar ao verify');
    }
    const candidates = [...rawCommands];
    if (rawSuites.length) candidates.push(buildSuiteVerifyCommand(projectRoot, rawSuites));

    const cr = options.cr ? String(options.cr).trim().toUpperCase() : null;
    if (cr && !criteriaIds.CR_ID_RE.test(cr)) throw new Error(`CR inválido: ${cr}`);
    const by = String(options.by || '').trim() || 'planner';
    if (options.reason != null && String(options.reason).trim().length < 8) {
      throw new Error('informe o motivo em uma frase (--reason "…", mínimo 8 caracteres)');
    }
    const reason = options.reason ? String(options.reason).trim() : 'adicionado check/suíte ao verify da tarefa';

    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan verify add exige PLAN.json');
    const at = new Date().toISOString();

    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const task = (doc.tasks || []).find((t) => t && String(t.id).toUpperCase() === taskId);
      if (!task) throw new Error(`Tarefa ${taskId} não encontrada em PLAN.json`);
      if (task.done === true) throw new Error(`${taskId} está done: reabra antes (oxe-cc plan reopen ${taskId})`);
      const before = readTaskVerifyCommands(task);
      const beforeSet = new Set(before);
      const added = [...new Set(candidates)].filter((c) => !beforeSet.has(c));
      const after = [...before, ...added];
      let packUpdated = false;
      if (!options.dryRun && added.length) {
        task.verify = { ...(task.verify && typeof task.verify === 'object' && !Array.isArray(task.verify) ? task.verify : {}), commands: after };
        if (task.verify.command) delete task.verify.command;
        if (task.verifyCommand) delete task.verifyCommand;
        task.edits = [...(Array.isArray(task.edits) ? task.edits : []), { by, reason, ...(cr ? { cr } : {}), at, verify_added: added }];
        const tmp = `${jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, jsonPath);
        packUpdated = syncImplementationPackExpectedChecks(paths, jsonPath, taskId, after);
      }
      return { task: taskId, added, before, after, pack_updated: packUpdated, ...(cr ? { cr } : {}), by, reason };
    });

    if (!options.dryRun && out.added.length) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'verify_add', ...out, at });
      appendEvent(projectRoot, activeSession, { type: 'PlanVerifyAdded', work_item_id: taskId, payload: { ...out } });
    }

    return { dry_run: Boolean(options.dryRun), ...out };
  }

  /**
   * OXB-C7 #1: `oxe-cc plan pack sync|rebuild T<n> [--by <papel> --reason "…"] [--dry-run]`
   * Regenerates an existing task's `IMPLEMENTATION-PACK.json` entry from `PLAN.json` using the canonical C5b builder
   * (`buildPackEntryFromAppendTask`). Refuses if the task has already started execution or is done.
   */
  function runtimePlanPackSync(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const taskId = String(options.task || '').trim().toUpperCase();
    if (!/^T\d+$/.test(taskId)) {
      throw new Error('use: oxe-cc plan pack sync T<n> [--by <papel> --reason "…"] [--dry-run]');
    }
    const by = String(options.by || '').trim() || 'planner';
    if (options.reason != null && String(options.reason).trim().length < 8) {
      throw new Error('informe o motivo em uma frase (--reason "…", mínimo 8 caracteres)');
    }
    const reason = options.reason ? String(options.reason).trim() : 'entrada reconstruída a partir do PLAN.json';

    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan pack sync exige PLAN.json');
    const packPath = paths.implementationPack || path.join(path.dirname(jsonPath), 'IMPLEMENTATION-PACK.json');
    if (!fs.existsSync(packPath)) {
      throw new Error(`IMPLEMENTATION-PACK.json ausente (${path.relative(projectRoot, packPath)}) — rode \`oxe-cc plan build\``);
    }
    const at = new Date().toISOString();

    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const task = (doc.tasks || []).find((t) => t && String(t.id).toUpperCase() === taskId);
      if (!task) throw new Error(`Tarefa ${taskId} não encontrada em PLAN.json`);
      if (hasTaskExecutionStarted(projectRoot, activeSession, task)) {
        throw new Error(`${taskId} já iniciou execução — ` + '`plan pack sync` recusa regenerar tarefa já iniciada ou concluída');
      }
      let packDoc;
      try { packDoc = JSON.parse(fs.readFileSync(packPath, 'utf8')); } catch { throw new Error(`IMPLEMENTATION-PACK.json inválido (${path.relative(projectRoot, packPath)})`); }
      packDoc.tasks = Array.isArray(packDoc.tasks) ? packDoc.tasks : [];
      const idx = packDoc.tasks.findIndex((p) => p && String(p.id || p.task_id || '').toUpperCase() === taskId);
      const before = idx >= 0 ? JSON.parse(JSON.stringify(packDoc.tasks[idx])) : null;
      const after = buildPackEntryFromAppendTask(projectRoot, doc, task, null, task);
      const action = idx >= 0 ? 'rebuilt' : 'added';
      if (!options.dryRun) {
        if (idx >= 0) packDoc.tasks[idx] = after;
        else packDoc.tasks.push(after);
        writeTextAtomic(packPath, `${JSON.stringify(packDoc, null, 2)}\n`);
      }
      return { task: taskId, action, pack: path.relative(projectRoot, packPath).replace(/\\/g, '/'), before, after, by, reason };
    });

    if (!options.dryRun) {
      changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'pack_sync', task: taskId, action: out.action, by, reason, at });
      appendEvent(projectRoot, activeSession, { type: 'PlanPackSynced', work_item_id: taskId, payload: { task: taskId, action: out.action, by, reason } });
    }

    return { dry_run: Boolean(options.dryRun), ...out };
  }

  /**
   * OxeSpace 15/11 (OxeCode F6, CR-F6-14): `oxe-cc plan task fold T<a> --into T<b> --cr CR-n --by <papel> --reason "…"`.
   * Folds a task into another: its files, criteria, verify commands and pack contract go to the target; the tasks that
   * depended on it depend on the target; its frozen entries name the target; it becomes `merged_into` (done, never
   * scheduled) and its open deferred entries close as merged — so the close does not count it as an open deferral.
   */
  function runtimePlanTaskFold(projectRoot, activeSession, options = {}) {
    const planJsonLib = require('../oxe-plan-json.cjs');
    const changeLib = require('../oxe-change.cjs');
    const from = String(options.task || '').toUpperCase();
    const into = String(options.into || '').toUpperCase();
    if (!/^T\d+$/.test(from) || !/^T\d+$/.test(into)) throw new Error('use: oxe-cc plan task fold T<n> --into T<m> --cr CR-<n> --by <papel> --reason "…"');
    if (from === into) throw new Error('--into: uma tarefa não se funde em si mesma');
    const cr = options.cr ? String(options.cr).toUpperCase() : null;
    if (!cr) throw new Error('informe o CR que decide a fusão (--cr CR-<n>)');
    const { by, reason } = requireEditReason({ by: options.by, reason: options.reason });
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const programDir = paths.programDir || path.join(projectRoot, '.oxe', 'program');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('plan task fold exige PLAN.json');
    const at = new Date().toISOString();
    const norm = (p) => String(p).replace(/\\/g, '/');
    const out = planJsonLib.withPlanLock(jsonPath, () => {
      const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const tasks = (doc.tasks || []).filter(Boolean);
      const S = tasks.find((t) => String(t.id).toUpperCase() === from);
      const T = tasks.find((t) => String(t.id).toUpperCase() === into);
      if (!S) throw new Error(`${from} não existe no plano`);
      if (!T) throw new Error(`${into} não existe no plano`);
      if (S.done === true) throw new Error(`${from} já está done: nada a fundir`);
      if (T.done === true) throw new Error(`${into} está done: reabra antes (oxe-cc plan reopen ${into})`);
      const uniq = (arr) => [...new Set(arr)];
      const moved = { files: [], acceptance: [], verify: [] };
      const tFiles = (T.files || []).map(norm);
      for (const f of (S.files || []).map(norm)) if (!tFiles.includes(f)) { tFiles.push(f); moved.files.push(f); }
      T.files = tFiles;
      const tAcc = [...(T.acceptance || [])];
      for (const c of S.acceptance || []) if (!tAcc.includes(c)) { tAcc.push(c); moved.acceptance.push(c); }
      T.acceptance = tAcc;
      const sCmds = [...((S.verify && S.verify.commands) || []), ...(S.verify && S.verify.command ? [S.verify.command] : [])];
      if (sCmds.length) {
        T.verify = T.verify && typeof T.verify === 'object' ? T.verify : {};
        const tCmds = [...(T.verify.commands || []), ...(T.verify.command ? [T.verify.command] : [])];
        for (const c of sCmds) if (!tCmds.includes(c)) { tCmds.push(c); moved.verify.push(c); }
        T.verify.commands = tCmds;
        delete T.verify.command;
      }
      if (S.verifyCommand && !moved.verify.includes(S.verifyCommand)) {
        T.verify = T.verify && typeof T.verify === 'object' ? T.verify : {};
        T.verify.commands = uniq([...(T.verify.commands || []), S.verifyCommand]);
        moved.verify.push(S.verifyCommand);
      }
      if (Array.isArray(S.pack_symbols)) T.pack_symbols = uniq([...(Array.isArray(T.pack_symbols) ? T.pack_symbols : []), ...S.pack_symbols].map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))).map((x) => { try { return JSON.parse(x); } catch { return x; } });
      // the role paths (edited/added/removed) go with the files (cross-review 15/11)
      for (const k of ['edited_paths', 'added_paths', 'removed_paths']) if (Array.isArray(S[k]) && S[k].length) T[k] = uniq([...(Array.isArray(T[k]) ? T[k] : []), ...S[k]]);
      const depsOf = (t) => [...(t.depends_on || t.dependsOn || [])].map((d) => String(d).toUpperCase());
      // the target inherits the source's dependencies (never itself, never the source)
      T.depends_on = uniq([...depsOf(T), ...depsOf(S)]).filter((d) => d !== into && d !== from);
      // the dependents of the source depend on the target
      const rewired = [];
      for (const t of tasks) {
        if (t === S || t === T || !depsOf(t).includes(from)) continue;
        t.depends_on = uniq(depsOf(t).map((d) => (d === from ? into : d)));
        delete t.dependsOn;
        rewired.push(t.id);
      }
      // cross-review 15/11: a path S → X → T becomes the cycle X ↔ T — refused (nothing written), naming it
      const byIdF = new Map(tasks.map((t) => [String(t.id).toUpperCase(), t]));
      const live = (id) => id !== from;
      const cycleFrom = (start) => {
        const stack = [[start, [start]]];
        const seen = new Set();
        while (stack.length) {
          const [id, trail] = stack.pop();
          for (const d of depsOf(byIdF.get(id) || {}).filter(live)) {
            if (d === start) return [...trail, d];
            if (!seen.has(d)) { seen.add(d); stack.push([d, [...trail, d]]); }
          }
        }
        return null;
      };
      const cyc = cycleFrom(into);
      if (cyc) throw new Error(`fold recusado, nada foi gravado: ${from} → ${into} forma o ciclo ${cyc.join(' → ')} (uma tarefa entre as duas depende de ${from} e é dependência de ${into}); desfaça essa dependência antes`);
      // waves stay monotonic: a pending task never runs before a dependency (bumped wave = dependency wave + 1)
      const bumped = [];
      for (let pass = 0; pass < tasks.length; pass += 1) {
        let changed = false;
        for (const t of tasks) {
          if (t === S || t.done === true || !Number.isFinite(Number(t.wave))) continue;
          for (const d of depsOf(t)) {
            const dep = byIdF.get(d);
            if (dep && dep !== S && Number.isFinite(Number(dep.wave)) && Number(dep.wave) >= Number(t.wave)) { t.wave = Number(dep.wave) + 1; changed = true; if (!bumped.includes(t.id)) bumped.push(t.id); }
          }
        }
        if (!changed) break;
      }
      const entries = [];
      for (const a of doc.acceptance_tests || []) if (a && String(a.task || '').toUpperCase() === from) { a.task = into; entries.push(a.id || a.criterion); }
      T.notes = `${T.notes ? `${T.notes}\n` : ''}${from} fundida aqui por ${cr}: ${reason}`;
      T.edits = [...(Array.isArray(T.edits) ? T.edits : []), { by, reason, cr, at, folded_from: from }];
      // its criteria now belong to the target only (kept in `folded` for the record). status stays in the schema's enum
      // (done): merged_into is what says it was folded (cross-review 15/11: "merged" failed validatePlanJson)
      Object.assign(S, { done: true, status: 'done', merged_into: into, folded: { into, cr, by, reason, at, acceptance: [...(S.acceptance || [])] }, acceptance: [] });
      delete S.checkpoint_failed;
      const tmp = `${jsonPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, jsonPath);
      return { moved, rewired, entries, waves_bumped: bumped };
    });
    // the pack contract (exact_paths, symbols) goes with the files
    try {
      const pack = readJsonQuiet(paths.implementationPack);
      const ptasks = pack && Array.isArray(pack.tasks) ? pack.tasks : null;
      const idOf = (t) => String((t && (t.id || t.task_id)) || '').toUpperCase();
      const ps = ptasks ? ptasks.find((t) => idOf(t) === from) : null;
      if (ps) {
        let pt = ptasks.find((t) => idOf(t) === into);
        // a new entry inherits the source's contract shape (mode, write_set…) so it passes validatePackTask
        if (!pt) { pt = { ...JSON.parse(JSON.stringify(ps)), id: into, exact_paths: [], symbols: [] }; delete pt.task_id; delete pt.merged_into; ptasks.push(pt); }
        pt.exact_paths = [...new Set([...(pt.exact_paths || []), ...(ps.exact_paths || [])])];
        const symKey = (s) => `${s && (s.path || s.file)}#${s && s.name}`;
        const have = new Set((pt.symbols || []).map(symKey));
        pt.symbols = [...(pt.symbols || []), ...(ps.symbols || []).filter((s) => !have.has(symKey(s)))];
        // the removals and checks go too (cross-review 15/11): a removed file's contract is not lost in the merge
        const jkey = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
        for (const k of ['removed_paths', 'swept_paths', 'symbols_removed', 'contracts', 'expected_checks', 'edited_paths', 'added_paths']) {
          if (!Array.isArray(ps[k]) || !ps[k].length) continue;
          const seenK = new Set((Array.isArray(pt[k]) ? pt[k] : []).map(jkey));
          pt[k] = [...(Array.isArray(pt[k]) ? pt[k] : []), ...ps[k].filter((x) => !seenK.has(jkey(x)))];
        }
        ps.merged_into = into;
        fs.writeFileSync(paths.implementationPack, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
        out.pack = true;
      }
    } catch { /* auxiliar: the plan carries the fold */ }
    // its open deferred entries close as merged (not an open deferral at the close)
    const closedDeferred = [];
    try {
      const dlib = require('../oxe-deferred.cjs');
      for (const e of dlib.open(programDir)) if (String(e.task).toUpperCase() === from) { dlib.close(programDir, e.id, `merged_into:${into}`); closedDeferred.push(e.id); }
    } catch { /* no ledger */ }
    changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'task_fold', task: from, into, cr, by, reason, at, ...out, closed_deferred: closedDeferred });
    appendEvent(projectRoot, activeSession, { type: 'PlanTaskFolded', work_item_id: from, payload: { task: from, into, cr, by, reason, moved: out.moved, rewired: out.rewired, closed_deferred: closedDeferred } });
    return { task: from, into, cr, by, ...out, closed_deferred: closedDeferred };
  }

  /**
   * `oxe-cc plan pack fix T<n> --symbol <path>#<name> (--internal | --member-of <Class> | --remove) --by <papel>
   * --reason "…" [--cr CR-n]`: corrects a planner's pack symbol during a phase without reopening the task (OxeSpace
   * 14/11, Celular F2: a module-private class and a class method named as exports failed check-pack). The symbol stays
   * recorded (exported:false, member_of) or is removed; every change is kept in the entry's `fixes` and as an event.
   */
  function runtimePlanPackFix(projectRoot, activeSession, options = {}) {
    const taskId = String(options.task || '').toUpperCase();
    if (!/^T\d+$/.test(taskId)) throw new Error('use: oxe-cc plan pack fix T<n> --symbol <arquivo>#<nome> (--add | --internal | --member-of <Classe> | --signature "…" | --remove) --by <papel> --reason "…"');
    const m = /^(.+)#([A-Za-z_$][\w$]*)$/.exec(String(options.symbol || '').trim());
    if (!m) throw new Error('informe o símbolo: --symbol <arquivo>#<nome>');
    const [, file, name] = m;
    // OXB-C24-2: --signature "<assinatura>" gives a symbol the signature plan skeleton needs (no hand edit of the pack)
    // OXB-C28-5: --add puts a symbol the frozen tests do not import (a hook, a type the task must export) in the pack
    const mode = options.add ? 'add' : options.remove ? 'remove' : options.signature ? 'signature' : options.memberOf ? 'member' : options.internal ? 'internal' : null;
    if (!mode) throw new Error('diga a correção: --add (símbolo novo; com --signature/--internal/--member-of opcionais), --internal (não é export), --member-of <Classe> (é membro), --signature "…" ou --remove');
    if (options.add && options.remove) throw new Error('--add e --remove juntos: escolha um');
    if (mode === 'signature' && String(options.signature).trim().length < 3) throw new Error('--signature: a assinatura do símbolo, ex.: "(id: string) => Promise<void>"');
    if (mode === 'member' && !/^[A-Za-z_$][\w$]*$/.test(String(options.memberOf))) throw new Error('--member-of: o nome da classe');
    const by = String(options.by || '').trim();
    const reason = String(options.reason || '').trim();
    if (!by) throw new Error('informe quem decide (--by <papel>)');
    if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "…")');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const packFile = paths.implementationPack || path.join(projectRoot, '.oxe', 'IMPLEMENTATION-PACK.json');
    let pack;
    try { pack = JSON.parse(fs.readFileSync(packFile, 'utf8')); } catch { throw new Error(`IMPLEMENTATION-PACK.json ausente ou inválido (${path.relative(projectRoot, packFile)})`); }
    const entry = (pack.tasks || []).find((t) => t && String(t.id || t.task_id || '').toUpperCase() === taskId);
    if (!entry) throw new Error(`${taskId} não está no IMPLEMENTATION-PACK.json`);
    const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const syms = Array.isArray(entry.symbols) ? entry.symbols : [];
    let idx = syms.findIndex((s) => s && typeof s === 'object' && String(s.name) === name && norm(s.path || s.file) === norm(file));
    if (mode === 'add') {
      if (idx >= 0) throw new Error(`${file}#${name} já está nos symbols de ${taskId} — use --signature/--internal/--member-of para corrigi-lo`);
      const scope = [...(entry.exact_paths || []), ...(entry.write_set || []), ...(entry.files || [])].map((p) => norm(typeof p === 'string' ? p : p && (p.path || p.file)));
      if (scope.length && !scope.includes(norm(file))) throw new Error(`${file} não está no escopo de ${taskId} no pack (${scope.slice(0, 6).join(', ')}${scope.length > 6 ? ', …' : ''}) — o símbolo tem de ser de um arquivo que a tarefa escreve (oxe-cc plan scope add ${taskId} ${file}, depois plan pack sync ${taskId})`);
      const sym = {
        name,
        path: norm(file),
        ...(options.internal || options.memberOf ? { exported: false } : {}),
        ...(options.memberOf ? { member_of: String(options.memberOf) } : {}),
        ...(options.signature ? { signature: String(options.signature).trim() } : {}),
        added_by_fix: true,
      };
      syms.push(sym);
      idx = syms.length - 1;
      if (sym.exported !== false) {
        entry.contracts = Array.isArray(entry.contracts) ? entry.contracts : [];
        const c = `${name} exportado de ${sym.path}`;
        if (!entry.contracts.includes(c)) entry.contracts.push(c);
      }
    }
    if (idx < 0) throw new Error(`${file}#${name} não está nos symbols de ${taskId} (para acrescentar: --add)`);
    const before = mode === 'add' ? null : { ...syms[idx] };
    if (mode === 'add') { /* built above */ } else if (mode === 'remove') syms.splice(idx, 1);
    else if (mode === 'signature') syms[idx].signature = String(options.signature).trim();
    else Object.assign(syms[idx], { exported: false, ...(mode === 'member' ? { member_of: String(options.memberOf) } : {}) });
    entry.symbols = syms;
    entry.fixes = [...(Array.isArray(entry.fixes) ? entry.fixes : []), { symbol: `${file}#${name}`, change: mode === 'member' ? `membro de ${options.memberOf}` : mode, ...(mode === 'signature' ? { signature: syms[idx].signature } : {}), before, by, reason, ...(options.cr ? { cr: String(options.cr).toUpperCase() } : {}), at: new Date().toISOString() }];
    const tmp = `${packFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, packFile);
    appendEvent(projectRoot, activeSession, { type: 'PackSymbolFixed', work_item_id: taskId, payload: { task: taskId, symbol: `${file}#${name}`, change: mode, member_of: options.memberOf || null, by, reason, cr: options.cr || null } });
    return { task: taskId, symbol: `${file}#${name}`, change: mode, member_of: options.memberOf || null, signature: mode === 'signature' ? String(options.signature).trim() : null, by };
  }

  /**
   * OXB-C25: `oxe-cc plan pack ready --by <papel> [--reason "…"] [--dry-run]` marks IMPLEMENTATION-PACK.json
   * `ready: true` only when the pack has no other critical gap (the same check the preflight runs). A pack written
   * before plan build set the flag no longer needs a hand edit.
   */
  function runtimePlanPackReady(projectRoot, activeSession, options = {}) {
    const by = String(options.by || '').trim();
    if (!by) throw new Error('informe quem marca o pack (--by <papel>)');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const packFile = paths.implementationPack || path.join(projectRoot, '.oxe', 'IMPLEMENTATION-PACK.json');
    let pack;
    try { pack = JSON.parse(fs.readFileSync(packFile, 'utf8')); } catch { throw new Error(`IMPLEMENTATION-PACK.json ausente ou inválido (${path.relative(projectRoot, packFile)})`); }
    let planTasks = [];
    try { planTasks = ((readPlanJsonDoc(projectRoot, activeSession).doc || {}).tasks || []).filter((t) => t && t.id).map((t) => ({ id: String(t.id) })); } catch { planTasks = []; }
    const rationality = require('../oxe-rationality.cjs');
    const summary = rationality.summarizeImplementationPack(packFile, planTasks);
    const gaps = (summary.criticalGaps || []).filter((g) => !/ready missing|ready=false|IMPLEMENTATION-PACK\.json: /.test(g));
    const ownGaps = Array.isArray(pack.critical_gaps) ? pack.critical_gaps.map(String) : [];
    if (gaps.length || ownGaps.length) {
      const all = [...gaps, ...ownGaps.map((g) => `critical_gaps: ${g}`)];
      throw new Error(`o pack ainda tem ${all.length} lacuna(s) crítica(s); corrija antes de marcar ready:\n  - ${all.join('\n  - ')}`);
    }
    const already = pack.ready === true;
    if (!options.dryRun && !already) {
      pack.ready = true;
      pack.critical_gaps = [];
      pack.ready_marked = { by, reason: options.reason ? String(options.reason) : null, at: new Date().toISOString() };
      const tmp = `${packFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, packFile);
      appendEvent(projectRoot, activeSession, { type: 'PackMarkedReady', payload: { by, reason: options.reason || null, tasks: (pack.tasks || []).length } });
    }
    return { pack: path.relative(projectRoot, packFile).replace(/\\/g, '/'), ready: true, changed: !already && !options.dryRun, dry_run: Boolean(options.dryRun), tasks: (pack.tasks || []).length, by };
  }

  function runtimePlanReopen(projectRoot, activeSession, options = {}) {
    const taskId = String(options.task || '').trim().toUpperCase();
    if (!/^T\d+$/.test(taskId)) throw new Error('Informe a tarefa: oxe-cc plan reopen T<n>');
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const planJsonLib = require('../oxe-plan-json.cjs');
    const jsonPath = planJsonLib.planJsonPathFor(paths.plan);
    if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error(`plan reopen exige PLAN.json em ${projectRoot}`);
    const planChanged = planJsonLib.markPlanTaskOpen(paths.plan, taskId, { by: options.by || 'plan reopen' });
    const clearedRunState = clearTaskResidualRunState(projectRoot, activeSession, [taskId], { clearFailedAndBlocked: true });
    let closedDeferred = [];
    try {
      const phase = (taskPhaseContext(projectRoot, activeSession) || {}).phase || null;
      closedDeferred = require('../oxe-deferred.cjs').closeTask(paths.programDir || path.join(projectRoot, '.oxe', 'program'), taskId, phase, 'reopened');
    } catch { closedDeferred = []; }
    const changed = Boolean(planChanged || clearedRunState || closedDeferred.length);
    if (changed) {
      appendEvent(projectRoot, activeSession, {
        type: 'PlanTaskReopened',
        work_item_id: taskId,
        payload: {
          task: taskId,
          by: options.by || null,
          manual: true,
          plan_changed: planChanged,
          cleared_run_state: clearedRunState,
          ...(closedDeferred.length ? { closed_deferred: closedDeferred } : {}),
        },
      });
    }
    return {
      task: taskId,
      changed,
      plan_changed: planChanged,
      cleared_run_state: clearedRunState,
      closed_deferred: closedDeferred,
    };
  }

  return {
    runtimePlanScopeAdd,
    runtimePlanTaskEdit,
    pruneVerifyCommand,
    pruneTaskVerify,
    runtimePlanTaskSupersede,
    runtimePlanVerifyPrune,
    extractAndRemoveVerifySegment,
    runtimePlanVerifyEdit,
    buildSuiteVerifyCommand,
    runtimePlanVerifyAdd,
    runtimePlanPackSync,
    runtimePlanTaskFold,
    runtimePlanPackFix,
    runtimePlanPackReady,
    runtimePlanReopen,
  };
}

module.exports = { createPlanLintRuntime };
