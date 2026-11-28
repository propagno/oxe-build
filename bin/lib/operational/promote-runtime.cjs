'use strict';

/**
 * 1.22.2 (OXB-222-16, ADR D-6 Fatia 2): Extracted promote runtime (`collectPromoteRiskSuites`,
 * `finalizePromotedWorktree`, `finalizePromotePrBodyAndEvents`, `cleanupPromoteWorktree`,
 * `runtimePromote`) with explicit dependency injection and zero circular require.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function createPromoteRuntime(deps = {}) {
  const {
    activeProgramPhase,
    allocatePromoteWorktreePath,
    almAutoSync,
    appendEvent,
    commitTaskVerifyTimeout,
    dirtyProjectPaths,
    gitLines,
    gitRun,
    loadRuntimeModule,
    ownPushedPromoteBranch,
    ownUnpushedPromoteBranch,
    promoteAssumedTasks,
    promoteStack,
    promoteTestRoot,
    readPlanJsonDoc,
    readProjectConfig,
    readTextIfExists,
    resolveImportAt,
    resolvePromoteBase,
    resolveRuntimeArtifactPaths,
    runChildCommandFull,
    runProgressCommand,
    sweepStalePromoteWorkspaces,
    taskCommitShas,
    taskPhaseContext,
    timedOutMessage,
    writeTextAtomic,
  } = deps;

  function collectPromoteRiskSuites(repoDir, { projectRoot, activeSession, planTasks, touchedFiles, excludeSuites = [], config = null }) {
    const promoteHelpers = require('../oxe-promote-helpers.cjs');
    const pcfg = config || readProjectConfig(projectRoot) || {};
    const excludedList = (excludeSuites || []).map((s) => String(s || '').replace(/\\/g, '/'));
    const riskSuites = promoteHelpers.discoverMainCiRiskSuites(repoDir, touchedFiles || [], {
      excludeSuites: excludedList,
    });
    let planDoc = null;
    try { planDoc = readPlanJsonDoc(projectRoot, activeSession).doc; } catch { planDoc = null; }
    // OXB-C6 #1: Include non-frozen active unit/integration/e2e specs discovered by extended G45 on `repoDir`
    try {
      const lintCfg = (pcfg && pcfg.lint) || {};
      if (lintCfg.cross_card_conflicts !== 'off') {
        const pathsG45 = resolveRuntimeArtifactPaths(projectRoot, activeSession);
        const g45Hits = require('../oxe-cross-card-conflicts.cjs').crossCardFrozenConflicts(
          repoDir,
          {
            tasks: (planTasks || []).map((t) => ({ ...t, done: false })),
            acceptance_tests: (planDoc && planDoc.acceptance_tests) || [],
          },
          { specText: readTextIfExists(pathsG45.spec) || '' },
        );
        const excludedSet = new Set(excludedList);
        const existingSuites = new Set(riskSuites.map((s) => s.suite));
        for (const f of g45Hits) {
          if (!f || !f.test || excludedSet.has(f.test) || existingSuites.has(f.test)) continue;
          existingSuites.add(f.test);
          const isE2e = /(^|\/)(e2e|playwright)\//i.test(f.test) || /\.e2e\./i.test(f.test)
            || (/\.spec\.[cm]?[jt]sx?$/i.test(f.test) && /@playwright\/test|playwright/i.test(readTextIfExists(path.join(repoDir, f.test)) || ''));
          riskSuites.push({ suite: f.test, kind: isE2e ? 'e2e' : 'unit_g45', covers: [f.component || f.token || f.test] });
        }
      }
    } catch { /* auxiliar */ }
    return { riskSuites, planDoc };
  }

  function finalizePromotedWorktree({
    projectRoot,
    activeSession,
    work,
    result,
    taskId,
    planTasks,
    phaseCtx,
    base,
    baseSha,
    buildSha,
    branch,
    programTip,
    withFixtures,
    preserveMergedFixtures,
    ordered,
    verifyTests,
    resolvedCapFiles,
    pushArgs,
    options,
  }) {
    const promoteHelpers = require('../oxe-promote-helpers.cjs');
    const preserveMergedSet = new Set(Array.isArray(preserveMergedFixtures) ? preserveMergedFixtures : []);
    const originTrailers = [
      ...planTasks.map((t) => `OXE-Task: ${phaseCtx.phase ? `${phaseCtx.phase}/` : ''}${t.id}`),
      ...[...new Set(planTasks.map((t) => t.run_id).filter(Boolean))].map((r) => `OXE-Run: ${r}`),
    ].join('\n');
    const commitWorkFiles = (files, subject, body, errLabel) => {
      if (!files || !files.length) return true;
      gitRun(work, ['add', '--', ...files]);
      if (gitRun(work, ['diff', '--cached', '--quiet']).ok) return true;
      const cm = gitRun(work, ['commit', '-q', '-m', subject, '-m', body, '-m', originTrailers]);
      if (!cm.ok) {
        result.error = `${errLabel}: ${(cm.stderr || cm.stdout || '').trim().split(/\r?\n/).pop()}`;
        return false;
      }
      return true;
    };
    const eqLf = (a, b) => a != null && b != null && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    // OXB-156 (b): the task's frozen tests as files from the program tip; identical-on-base ones are skipped.
    // OXB-C8: fixtures modified on both `base` and the task's commits preserve cherry-pick's merge instead of overwriting with tip.
    if (!result.conflict && withFixtures.length) {
      const added = [];
      for (const file of withFixtures) {
        if (preserveMergedSet.has(file) && fs.existsSync(path.join(work, file))) continue;
        const tip = gitRun(projectRoot, ['show', `${programTip}:${file}`]);
        if (!tip.ok) continue;
        const onBase = gitRun(projectRoot, ['show', `${baseSha}:${file}`]);
        const current = fs.existsSync(path.join(work, file)) ? fs.readFileSync(path.join(work, file), 'utf8') : null;
        if ((onBase.ok && eqLf(onBase.stdout, tip.stdout)) || eqLf(current, tip.stdout)) continue;
        const r = spawnSync('git', ['show', `${programTip}:${file}`], { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
        fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
        fs.writeFileSync(path.join(work, file), r.stdout);
        added.push(file);
      }
      if (added.length) {
        commitWorkFiles(
          added,
          `test(acceptance): frozen tests of ${taskId}`,
          `From the program branch at ${String(programTip).slice(0, 10)}: ${added.join(', ')}`,
          'commit dos testes congelados falhou',
        );
      }
      result.frozen_tests = added;
    }
    if (!result.conflict && !result.error) {
      const pcfg = readProjectConfig(projectRoot) || {};
      const lockAdj = promoteHelpers.reconcilePromotedEnforcedLocks(
        projectRoot,
        work,
        buildSha,
        Array.isArray(ordered) ? ordered : null,
        { resolve: options && options.resolve },
      );
      if (lockAdj.adjusted.length) {
        const lockMsg = lockAdj.adjusted.map((a) => `${a.file}: removido(s) [${a.removed_ids.join(', ') || 'stale'}] de fora de ${base}`).join('\n');
        commitWorkFiles(
          lockAdj.files,
          `chore(lock): reconcile enforced lock of ${taskId} on ${base}`,
          lockMsg,
          'commit de ajuste de enforced.lock falhou',
        );
        result.enforced_locks_adjusted = lockAdj.adjusted;
        const pruned = [...new Set(lockAdj.adjusted.flatMap((a) => a.removed_ids || []))];
        if (pruned.length) {
          result.warnings.push(`enforced.lock reconciliado contra ${base} + ${taskId}: removido(s) ${pruned.join(', ')} (já ausente(s)/retirado(s) em ${base})`);
        }
      }
      const ratchetAdj = promoteHelpers.reconcilePromotedRatchets(work, buildSha, pcfg, { resolvedCapFiles: [...resolvedCapFiles] });
      if (ratchetAdj.adjusted.length) {
        commitWorkFiles(
          ratchetAdj.files,
          `chore(ratchet): reconcile ratchet caps of ${taskId} on ${base}`,
          ratchetAdj.adjusted.map((a) => `${a.file}:${a.line} ${a.program_cap} -> ${a.promoted_cap} (real count: ${a.real_count})`).join('\n'),
          'commit de ajuste de ratchet falhou',
        );
        result.ratchets_adjusted = ratchetAdj.adjusted;
        result.warnings.push(`ratchet(s) recalculado(s) contra ${base} + ${taskId}: ${ratchetAdj.adjusted.map((a) => `${a.file}:${a.line} ${a.program_cap} → ${a.promoted_cap}`).join(', ')}`);
      }
      const enforcedCheck = promoteHelpers.checkPromotedEnforcedTargets(work, buildSha, { base, config: pcfg });
      if (enforcedCheck.gaps.length) {
        result.enforced_scene_gaps = enforcedCheck.gaps;
        result.warnings.push(...enforcedCheck.warnings);
      }
      // OXB-222-03: reconcile sequential migrations & sync.version_pins against base inside the promoted worktree.
      const syncEnabled = !(pcfg.sync && pcfg.sync.on_promote === false) && !(options && options.sync === false);
      if (syncEnabled && !result.error) {
        try {
          const syncLib = require('../oxe-sync.cjs');
          const syncPlan = syncLib.syncSequentialResources(work, { base: buildSha, config: pcfg, apply: false });
          if ((syncPlan.migration_bumps && syncPlan.migration_bumps.length) || (syncPlan.version_pin_updates && syncPlan.version_pin_updates.length)) {
            const syncApplied = syncLib.syncSequentialResources(work, { base: buildSha, config: pcfg, apply: true });
            const existingToStage = [...new Set([
              ...(syncApplied.applied_migrations || []).map((m) => m.to),
              ...(syncApplied.applied_version_pins || []).map((p) => p.file),
            ])].filter((f) => f && fs.existsSync(path.join(work, f)));
            const deletedToStage = [...new Set((syncApplied.applied_migrations || []).map((m) => m.from))]
              .filter((f) => f && !fs.existsSync(path.join(work, f)));
            if (deletedToStage.length) gitRun(work, ['rm', '-q', '--ignore-unmatch', '--', ...deletedToStage]);
            if (existingToStage.length) gitRun(work, ['add', '--', ...existingToStage]);
            if ((existingToStage.length || deletedToStage.length) && !gitRun(work, ['diff', '--cached', '--quiet']).ok) {
              const summaryLines = [
                ...(syncApplied.applied_migrations || []).map((m) => `${m.from} -> ${m.to}`),
                ...(syncApplied.applied_version_pins || []).map((p) => `${p.file}${p.label ? ` (${p.label})` : ''}: ${p.from} -> ${p.to}`),
              ];
              const cm = gitRun(work, [
                'commit', '-q',
                '-m', `chore(sync): bump sequential resources of ${taskId} on ${base}`,
                '-m', summaryLines.join('\n'),
                '-m', originTrailers,
              ]);
              if (!cm.ok) {
                result.error = `commit de sync sequencial falhou: ${(cm.stderr || cm.stdout || '').trim().split(/\r?\n/).pop()}`;
              }
            }
            result.sync = syncApplied;
            result.warnings.push(`sync sequencial aplicado contra ${base}: ${(syncApplied.applied_migrations || []).length} migration(s), ${(syncApplied.applied_version_pins || []).length} version_pin(s)`);
          }
        } catch (err) {
          result.warnings.push(`sync sequencial no promote falhou: ${err && err.message ? err.message : String(err)}`);
        }
      }
    }
    if (!result.conflict && !result.error) {
      const icLib = require('../oxe-integration-checks.cjs');
      const parked = icLib.findTrackedParkedAcceptance(work, { baseRef: baseSha });
      if (parked.length) {
        result.parked_acceptance = parked;
        result.error = `gate de PR bloqueado em ${branch}: ${icLib.formatParkedAcceptanceError(parked)}`;
      }
    }
    if (!result.conflict && !result.error && options.integrationChecks !== false) {
      const ic = require('../oxe-integration-checks.cjs').runIntegrationChecks(work, { configRoot: projectRoot, baseRef: baseSha });
      if (ic.ran.length) result.integration_checks = ic.ran;
      if (!ic.ok) result.error = `check de integração vermelho em ${branch}: \`${ic.failed.command}\` (exit ${ic.failed.exit})${ic.failed.tail ? `\n${String(ic.failed.tail).split(/\r?\n/).slice(-5).map((l) => `    ${l}`).join('\n')}\n` : ''} — nada foi enviado; a branch local ${branch} fica (não enviada). Corrija no programa (ex.: um quick que reduz o arquivo acima do teto, ou npm run notices:generate) e rode o promote de novo: a branch é refeita com o conserto`;
    }
    if (!result.conflict && !result.error) {
      const pcfg = readProjectConfig(projectRoot) || {};
      const promotedDiffFiles = gitLines(work, ['diff', '--name-only', buildSha, 'HEAD']) || [];
      const { riskSuites, planDoc } = collectPromoteRiskSuites(work, {
        projectRoot,
        activeSession,
        planTasks,
        touchedFiles: promotedDiffFiles,
        excludeSuites: [...verifyTests, ...(result.frozen_tests || [])],
        config: pcfg,
      });
      if (riskSuites.length) result.ci_risk_suites = riskSuites;
      if (options.previewCi) {
        const previewCmds = promoteHelpers.buildPreviewCiCommands(work, riskSuites, pcfg, { projectRoot, planTasks, planDoc });
        const previewRuns = [];
        let previewOk = true;
        const baseVerifyTimeout = Number(pcfg.verify_timeout_ms) > 0 ? Number(pcfg.verify_timeout_ms) : 10 * 60_000;
        for (const cmd of previewCmds) {
          const ms = commitTaskVerifyTimeout(projectRoot, options, cmd, baseVerifyTimeout);
          const r = runChildCommandFull(work, cmd, ms);
          const failInfo = !r.ok ? promoteHelpers.extractPreviewCiFailure(r.output || r.tail) : null;
          previewRuns.push({
            command: cmd,
            ok: r.ok,
            status: r.status,
            timed_out: r.timedOut,
            tail: failInfo ? failInfo.summary : r.tail,
            ...(failInfo && failInfo.failing_specs.length ? { failing_specs: failInfo.failing_specs } : {}),
          });
          if (!r.ok) {
            previewOk = false;
            const specLine = failInfo && failInfo.failing_specs.length
              ? `\n    spec(s) falhando: ${failInfo.failing_specs.join(', ')}`
              : '';
            const detailText = failInfo ? failInfo.summary : String(r.tail || '');
            const detailLines = detailText
              ? `\n${detailText.split(/\r?\n/).filter(Boolean).slice(-8).map((l) => `    ${l}`).join('\n')}`
              : '';
            result.error = r.timedOut
              ? timedOutMessage(`preview-ci em ${branch}`, cmd, ms, { ...r, tail: detailText || r.tail })
              : `preview-ci vermelho em ${branch}: \`${cmd}\` (exit ${r.status})${specLine}${detailLines}`;
            break;
          }
        }
        result.preview_ci = { ok: previewOk, suites: riskSuites.map((s) => s.suite), runs: previewRuns };
      }
    }
    if (!result.conflict && options.openPr && !result.error) {
      const push = gitRun(work, pushArgs());
      if (!push.ok) result.error = `push falhou: ${push.stderr.trim().split(/\r?\n/).slice(-2).join(' · ')}`;
      else result.pushed = true;
    }
    if (!result.conflict && !result.error) {
      let pkg = null;
      try { pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')); } catch { pkg = null; }
      if (pkg && pkg.scripts && pkg.scripts['pr:ready'] && options.prReady !== false) {
        const ready = runProgressCommand(work, 'npm run pr:ready', 1_800_000, { quiet: options.quietProgress === true || process.env.OXE_PROGRESS === '0' });
        const tail = String(ready.tail || '');
        const STATUS_LINE = /not on GitHub yet|push it first|(post|create|set)\w*\s+(the\s+)?(commit\s+)?status/i;
        const otherLines = tail.split(/\r?\n/).filter((l) => !STATUS_LINE.test(l) && !/^\s*npm (ERR!|error|warn)\b/i.test(l)).join('\n');
        const statusOnly = !ready.ok && STATUS_LINE.test(tail) && !/\bFAIL\b|\bfailed\b|✗|×|error TS\d+|\d+ (failing|failed)/i.test(otherLines);
        result.pr_ready = { ok: ready.ok || statusOnly, tail: ready.tail, ...(statusOnly ? { status_post_failed: true } : {}) };
      }
    }
  }

  function finalizePromotePrBodyAndEvents({
    projectRoot,
    activeSession,
    result,
    task,
    taskId,
    criteria,
    ordered,
    branch,
    original,
    base,
    remote,
    stack,
    pushArgs,
    options,
  }) {
    const paths = resolveRuntimeArtifactPaths(projectRoot, activeSession);
    const crs = require('../oxe-change.cjs').listChanges(paths.programDir || path.join(projectRoot, '.oxe', 'program'))
      .filter((cr) => (cr.criteria || []).some((a) => criteria.has(a)));
    const body = [
      `## ${taskId} — ${task.title || ''}`.trim(),
      '',
      options.testsOnly
        ? `Promovida de \`${original}\` por \`oxe-cc runtime promote --tests-only\` (apenas ${((result.frozen_tests || []).length)} arquivo(s) de testes congelados e fixtures; commits de código já na base).`
        : `Promovida de \`${original}\` por \`oxe-cc runtime promote\` (cherry-pick -x de ${ordered.length} commit(s)).`,
      '',
      ...(stack ? [
        `> **Empilhada sobre ${stack.task}** (${stack.pr ? `PR ${stack.pr}, ` : ''}branch \`${stack.branch}\`), ainda não mergeada em \`${base}\`: este PR traz os commits dela até ela entrar. Mergeie ${stack.task} primeiro; depois disso o diff deste PR encolhe para os commits de ${taskId}.`,
        '',
      ] : []),
      '### Arquivos',
      ...(task.files || []).map((f) => `- \`${f}\``),
      '',
      `### Critérios: ${[...criteria].join(', ') || '—'}`,
      ...(crs.length ? ['', '### Change requests', ...crs.map((cr) => `- ${cr.id} (${cr.class}, ${cr.status}): ${cr.summary}`)] : []),
      '',
      '### Commits da tarefa',
      ...(ordered.length ? ordered.map((sha) => `- ${sha.slice(0, 10)} ${(gitLines(projectRoot, ['log', '-1', '--format=%s', sha]) || [''])[0]}`) : ['- —']),
      '',
      '### Testes congelados (arquivos do tip do programa)',
      ...((result.frozen_tests || []).length ? result.frozen_tests.map((f) => `- \`${f}\``) : ['- — (já na base, ou nenhum)']),
      ...((result.quick_commits || []).length ? ['', '### Quicks incluídos', ...result.quick_commits.map((q) => `- ${q.sha.slice(0, 10)} (${q.quick}${q.card ? `, ${q.card}` : ''})`)] : []),
      ...((result.ratchets_adjusted || []).length ? ['', '### Ratchets ajustados para a base', ...result.ratchets_adjusted.map((a) => `- \`${a.file}:${a.line}\`: ${a.program_cap} → ${a.promoted_cap} (contagem real na branch: ${a.real_count})`)] : []),
      ...(result.suggested_promote_order && result.suggested_promote_order.length ? ['', `### Ordem sugerida de promoção: ${result.suggested_promote_order.join(' → ')}`] : []),
      ...(((result.ci_risk_suites && result.ci_risk_suites.length) || (result.enforced_scene_gaps && result.enforced_scene_gaps.length)) ? [
        '',
        '### Riscos de CI na main (fora do verify da tarefa)',
        ...((result.ci_risk_suites || []).map((s) => `- \`${s.suite}\` (${s.kind} — cobre ${s.covers.map((c) => `\`${c}\``).join(', ')})`)),
        ...((result.enforced_scene_gaps || []).map((g) => `- \`${g.file}\` → \`${g.id}\`: seletor \`${g.selector}\` ausente na cena de conformidade (sugestão: manter \`${g.proposed_status}\` — ${g.proposed_reason})`)),
      ] : []),
      ...(result.preview_ci ? ['', `### preview-ci: ${result.preview_ci.ok ? 'verde' : 'VERMELHO'} (${result.preview_ci.suites.length} suíte(s))`] : []),
      ...(result.pr_ready ? ['', `### pr:ready: ${result.pr_ready.ok ? 'verde' : 'VERMELHO'}`] : []),
      '',
    ].join('\n');
    const bodyFile = path.join(projectRoot, '.oxe', 'promote', `${taskId}.md`);
    writeTextAtomic(bodyFile, body);
    result.body_file = path.relative(projectRoot, bodyFile).replace(/\\/g, '/');
    let almKey = null;
    const lookupIds = [taskId, ...(Array.isArray(options.taskIds) ? options.taskIds : [])].filter(Boolean);
    try {
      const almLib = require('../oxe-alm.cjs');
      const cfgAlm = almLib.almConfig(readProjectConfig(projectRoot) || {});
      const ph = activeProgramPhase(projectRoot, activeSession);
      const pd = resolveRuntimeArtifactPaths(projectRoot, activeSession).programDir || path.join(projectRoot, '.oxe', 'program');
      if (cfgAlm) {
        for (const lid of lookupIds) {
          almKey = almLib.keyFor(pd, cfgAlm, ph ? ph.id : null, lid);
          if (almKey) break;
        }
      }
    } catch { almKey = null; }
    if (almKey) result.alm_key = almKey;
    if (almKey) {
      try {
        const almLib = require('../oxe-alm.cjs');
        const cfgAlm = almLib.almConfig(readProjectConfig(projectRoot) || {});
        const ph = activeProgramPhase(projectRoot, activeSession);
        const pd = resolveRuntimeArtifactPaths(projectRoot, activeSession).programDir || path.join(projectRoot, '.oxe', 'program');
        const docM = readPlanJsonDoc(projectRoot, activeSession).doc;
        const promotedSet = new Set(lookupIds);
        const docForMarker = docM && promotedSet.size > 1 && Array.isArray(docM.tasks)
          ? { ...docM, tasks: docM.tasks.map((t) => (t && promotedSet.has(t.id) ? { ...t, done: true } : t)) }
          : docM;
        const mk = require('../oxe-alm-prs.cjs').prMarkerFor(almKey, taskId, docForMarker, (id) => almLib.keyFor(pd, cfgAlm, ph ? ph.id : null, id));
        if (mk) {
          result.alm_marker = mk.marker;
          writeTextAtomic(bodyFile, `${body}\n${mk.marker}${mk.open_tasks.length ? ` (ainda abertas no card: ${mk.open_tasks.join(', ')})` : ''}\n`);
        }
      } catch { /* auxiliar: o PR segue sem o marcador */ }
    }
    const title = `${taskId}: ${task.title || 'promote'}${almKey ? ` (${almKey})` : ''}`;
    const prBase = base.replace(new RegExp(`^${remote}/`), '');
    result.commands = [
      `git push -u ${remote} ${branch}`,
      `gh pr create --base ${prBase} --head ${branch} --title ${JSON.stringify(title)} --body-file ${result.body_file}`,
    ];
    if (options.openPr && !result.error) {
      if (result.pr_ready && !result.pr_ready.ok) {
        result.error = `pr:ready vermelho em ${branch} — PR não aberto (a branch já está em ${remote}; corrija e rode os comandos abaixo — o PR vai contra ${prBase}${stack ? `, não contra a branch de ${stack.task}` : ''})`;
      } else {
        const push = result.pushed ? { ok: true } : gitRun(projectRoot, pushArgs());
        if (!push.ok) result.error = `push falhou: ${push.stderr.trim().split(/\r?\n/).slice(-2).join(' · ')}`;
        else {
          const gh = (options.ghSpawn || spawnSync)('gh', ['pr', 'create', '--base', prBase, '--head', branch, '--title', title, '--body-file', bodyFile], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
          if (gh.status === 0) result.pr = String(gh.stdout || '').trim().split(/\r?\n/).pop();
          else result.error = `gh pr create falhou: ${String(gh.stderr || gh.stdout || '').trim().split(/\r?\n/).slice(-2).join(' · ')}`;
        }
      }
    }
    appendEvent(projectRoot, activeSession, { type: 'TaskPromoted', work_item_id: taskId, payload: { base, branch, commits: ordered, pr_ready: result.pr_ready ? result.pr_ready.ok : null, pr: result.pr, ...(stack ? { stacked_on: result.stacked_on } : {}) } });
    almAutoSync(projectRoot, activeSession);
    return result;
  }

  function cleanupPromoteWorktree(projectRoot, wt, linked) {
    const rel = path.relative(projectRoot, wt).replace(/\\/g, '/');
    try {
      const rt = loadRuntimeModule();
      if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(wt);
      else if (linked && fs.existsSync(path.join(wt, 'node_modules'))) fs.unlinkSync(path.join(wt, 'node_modules'));
    } catch { /* */ }
    let rm = gitRun(projectRoot, ['worktree', 'remove', wt]);
    if (!rm.ok) {
      let linkLeft = false;
      try { linkLeft = fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
      if (!linkLeft) rm = gitRun(projectRoot, ['worktree', 'remove', '--force', wt]);
    }
    if (rm.ok) { try { fs.rmSync(`${wt}.pid`, { force: true }); } catch { /* */ } }
    gitRun(projectRoot, ['worktree', 'prune']);
    return rm.ok ? null : `worktree ${rel} não removida (${rm.stderr.trim().split(/\r?\n/).pop()}) — remova à mão depois de conferir que não há links dentro`;
  }

  /**
   * `oxe-cc runtime promote <Tn> --base main [--branch name] [--open-pr] [--remote origin]`: a branch from the base with
   * the task's checkpoint commits (OXE-Task trailer / done_commit) and the commits of its frozen acceptance tests,
   * cherry-picked with -x in history order. Stops (and cleans up, unless `--keep-on-conflict`) on a conflict; resolves
   * `lint.ratchets` cap-only conflicts and append-only `enforced.lock.json` JSON unions automatically (or per `--resolve`).
   */
  function runtimePromote(projectRoot, activeSession, options = {}) {
    const promoteHelpers = require('../oxe-promote-helpers.cjs');
    promoteHelpers.parseResolveRules(options.resolve); // fail fast on malformed --resolve rules
    if (!gitLines(projectRoot, ['rev-parse', '--git-dir'])) throw new Error('runtime promote exige um repositório git');

    const pendingFile = path.join(projectRoot, '.oxe', 'promote', 'pending-conflict.json');
    const original = (gitLines(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || [])[0];
    const originalSha = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
    const remote = String(options.remote || 'origin');

    if (options.continue === true) {
      if (!fs.existsSync(pendingFile)) {
        throw new Error('nenhum promote pausado em conflito (.oxe/promote/pending-conflict.json não encontrado)');
      }
      const saved = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      if ((options.task || options.tasks) && saved.task) {
        const reqIds = [...new Set((options.tasks ? (Array.isArray(options.tasks) ? options.tasks : String(options.tasks).split(',')) : [options.task]).map((t) => String(t || '').trim().toUpperCase()).filter(Boolean))].join('-');
        if (reqIds && reqIds !== saved.task) {
          throw new Error(`promote pausado é para ${saved.task} (worktree ${path.relative(projectRoot, saved.worktree).replace(/\\/g, '/')}), não para ${reqIds}`);
        }
      }
      const work = saved.worktree;
      if (!fs.existsSync(work)) {
        throw new Error(`worktree do promote pausado não existe mais (${saved.worktree}) — rode o promote do início sem --continue`);
      }
      const taskId = saved.task;
      const taskIds = saved.taskIds || [];
      const branch = saved.branch;
      const base = saved.base;
      const baseSha = saved.baseSha;
      const buildSha = saved.buildSha || baseSha;
      const programTip = saved.programTip || originalSha;
      const ordered = saved.ordered || [];
      const remaining = Array.isArray(saved.remaining_commits) ? saved.remaining_commits : [];
      const withFixtures = saved.withFixtures || [];
      const verifyTests = saved.verifyTests || [];
      const sharedSkipped = saved.sharedSkipped || [];
      const criteria = new Set(saved.criteria || []);
      const phaseCtx = saved.phaseCtx || taskPhaseContext(projectRoot, activeSession);
      const { doc } = readPlanJsonDoc(projectRoot, activeSession);
      const planTasks = taskIds.map((id) => (doc && Array.isArray(doc.tasks) ? doc.tasks.find((x) => x && x.id === id) : null) || { id, acceptance: saved.criteria || [], files: [] });
      const task = saved.taskMeta || planTasks[0];
      const resolvedCapFiles = new Set(saved.resolved_cap_files || []);
      const resolvedConflicts = Array.isArray(saved.resolved_conflicts) ? [...saved.resolved_conflicts] : [];
      const result = {
        ...(saved.resultSnapshot || {}),
        task: taskId,
        branch,
        base,
        base_sha: baseSha,
        worktree: path.relative(projectRoot, work).replace(/\\/g, '/'),
        conflict: null,
        error: undefined,
        warnings: [...((saved.resultSnapshot && saved.resultSnapshot.warnings) || [])],
        resumed_from_conflict: true,
      };
      if (resolvedConflicts.length) result.resolved_conflicts = resolvedConflicts;
      const pcfg = readProjectConfig(projectRoot) || {};
      const linked = (() => { try { return fs.lstatSync(path.join(work, 'node_modules')).isSymbolicLink(); } catch { return false; } })();
      let keepWorktree = false;
      const cleanup = () => {
        if (saved.inPlace) {
          gitRun(projectRoot, ['checkout', '-q', original && original !== 'HEAD' ? original : originalSha]);
        } else {
          const w = cleanupPromoteWorktree(projectRoot, work, linked);
          if (w) result.cleanup_warning = w;
        }
      };
      const pushArgs = () => ['push', ...(saved.forceLease ? [`--force-with-lease=${branch}:${saved.forceLease}`] : []), '-u', saved.remote || remote, branch];
      const onSignal = (sig) => { try { if (!keepWorktree) cleanup(); } catch { /* */ } process.exit(sig === 'SIGINT' ? 130 : 143); };
      const signals = ['SIGINT', 'SIGTERM'];
      for (const sig of signals) process.once(sig, onSignal);
      try {
        const stillUnmerged = gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [];
        if (stillUnmerged.length && options.resolve && (Array.isArray(options.resolve) ? options.resolve.length : options.resolve)) {
          const res = promoteHelpers.tryResolvePromoteCherryPickConflict(projectRoot, work, saved.conflict_commit, pcfg, stillUnmerged, { resolve: options.resolve, skipRatchet: true, commit: false });
          if (res.resolved && res.resolved_files) {
            for (const rf of res.resolved_files) {
              resolvedConflicts.push({ commit: saved.conflict_commit, ...rf });
              result.warnings.push(`conflito resolvido em ${rf.file} (${rf.strategy})`);
            }
          }
        }
        const unmergedAfter = gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [];
        if (unmergedAfter.length) {
          keepWorktree = true;
          result.conflict = { commit: saved.conflict_commit, files: unmergedAfter };
          result.kept_worktree = result.worktree;
          result.error = `conflito ainda aberto em ${unmergedAfter.join(', ')} (worktree ${result.worktree}) — resolva, rode \`git add\` e depois \`oxe-cc runtime promote ${taskId} --continue\` (ou passe --resolve <arquivo>=ours|theirs|union-json-array)`;
        } else if (gitLines(work, ['rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD'])) {
          const cached = gitRun(work, ['diff', '--cached', '--quiet']);
          const contRes = cached.ok
            ? gitRun(work, ['cherry-pick', '--skip'])
            : spawnSync('git', ['-c', 'core.editor=true', 'cherry-pick', '--continue'], { cwd: work, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_EDITOR: 'true' } });
          if ((contRes.status != null ? contRes.status : (contRes.ok ? 0 : 1)) !== 0) {
            keepWorktree = true;
            result.conflict = { commit: saved.conflict_commit, files: gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [] };
            result.kept_worktree = result.worktree;
            result.error = `cherry-pick --continue falhou em ${result.worktree}: ${String(contRes.stderr || contRes.stdout || '').trim().split(/\r?\n/).slice(-3).join(' · ')}`;
          }
        }
        if (!result.conflict && !result.error) {
          for (let idx = 0; idx < remaining.length; idx += 1) {
            const sha = remaining[idx];
            const pick = gitRun(work, ['cherry-pick', '-x', sha]);
            if (!pick.ok) {
              const files = gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [];
              const auto = promoteHelpers.tryResolvePromoteCherryPickConflict(projectRoot, work, sha, pcfg, files, { resolve: options.resolve });
              if (auto.resolved) {
                for (const rf of auto.resolved_cap_files || []) resolvedCapFiles.add(rf);
                for (const rf of auto.resolved_files || []) {
                  resolvedConflicts.push({ commit: sha, ...rf });
                  result.warnings.push(`conflito auto-resolvido em ${rf.file} (${rf.strategy})`);
                }
                continue;
              }
              keepWorktree = true;
              const updatedPending = { ...saved, conflict_commit: sha, remaining_commits: remaining.slice(idx + 1), resolved_cap_files: [...resolvedCapFiles], resolved_conflicts: resolvedConflicts };
              writeTextAtomic(pendingFile, `${JSON.stringify(updatedPending, null, 2)}\n`);
              result.conflict = { commit: sha, files };
              result.kept_worktree = result.worktree;
              result.error = `conflito no cherry-pick de ${sha.slice(0, 8)} (${files.join(', ') || 'sem arquivos'}) — worktree mantida em ${result.worktree}; resolva, rode \`git add\` e \`oxe-cc runtime promote ${taskId} --continue\` (ou use --resolve <arquivo>=ours|theirs|union-json-array)`;
              break;
            }
          }
        }
        if (!result.conflict && !result.error) {
          if (resolvedConflicts.length) result.resolved_conflicts = resolvedConflicts;
          finalizePromotedWorktree({
            projectRoot,
            activeSession,
            work,
            result,
            task,
            taskId,
            taskIds,
            planTasks,
            phaseCtx,
            base,
            baseSha,
            buildSha,
            branch,
            remote: saved.remote || remote,
            programTip,
            withFixtures,
            preserveMergedFixtures: saved.preserveMergedFixtures || [],
            ordered,
            verifyTests,
            criteria,
            resolvedCapFiles,
            pushArgs,
            options,
          });
          try { fs.rmSync(pendingFile, { force: true }); } catch { /* */ }
        }
      } finally {
        for (const sig of signals) process.removeListener(sig, onSignal);
        if (!keepWorktree) cleanup();
      }
      if (result.conflict) {
        appendEvent(projectRoot, activeSession, { type: 'TaskPromoteFailed', work_item_id: taskId, payload: { base, reason: result.error || 'conflict', commit: result.conflict.commit, files: result.conflict.files, kept_worktree: result.kept_worktree || null } });
        return result;
      }
      return finalizePromotePrBodyAndEvents({ projectRoot, activeSession, result, task, taskId, criteria, ordered, branch, original: saved.original || original, base, remote: saved.remote || remote, stack: saved.stack || null, pushArgs, options: { ...options, taskIds } });
    }

    // OXB-169: `--tasks T4,T5,T6,T7` builds ONE branch from the tasks' commits in commit order (the execute may commit
    // them out of plan order — a checkpoint retry committed T4/T5 after T6/T7, and T4's diff assumed theirs).
    const taskIds = [...new Set((options.tasks ? (Array.isArray(options.tasks) ? options.tasks : String(options.tasks).split(',')) : [options.task])
      .map((t) => String(t || '').trim().toUpperCase()).filter(Boolean))];
    if (!taskIds.length || !taskIds.every((t) => /^T\d+$/.test(t))) throw new Error('informe a tarefa: oxe-cc runtime promote T<n> --base main  (ou --tasks T4,T5,…)');
    const taskId = taskIds.join('-');
    const testsOnly = options.testsOnly === true;
    // OXB-157: `--base main` used the LOCAL main (11 days old) — the PR conflicted on files identical on origin/main.
    const resolvedBase = resolvePromoteBase(projectRoot, options.base, remote, options);
    const base = resolvedBase.ref;
    // OXB-151: by default promote works in its OWN temporary worktree — the program tree (checkout, index, node_modules)
    // is never touched, so it is safe while `runtime execute` runs there. --in-place keeps the old behavior.
    const inPlace = options.inPlace === true;
    if (inPlace && !options.dryRun) {
      const dirty = dirtyProjectPaths(projectRoot);
      if (dirty.length) throw new Error(`working tree com mudanças fora de .oxe/ (${dirty.slice(0, 5).join(', ')}) — faça commit ou stash antes do promote`);
    }
    let baseSha = (gitLines(projectRoot, ['rev-parse', '--verify', `${base}^{commit}`]) || [])[0];
    if (!baseSha) throw new Error(`base desconhecida: ${base}`);
    const { doc } = readPlanJsonDoc(projectRoot, activeSession);
    const planTasks = taskIds.map((id) => {
      const t = doc && Array.isArray(doc.tasks) ? doc.tasks.find((x) => x && x.id === id) : null;
      if (!t) throw new Error(`${id} não está no PLAN.json`);
      if (t.done !== true) throw new Error(`${id} não está done — só uma tarefa concluída e verde é promovida`);
      return t;
    });
    const idSet = new Set(taskIds);
    // One task: itself. Several: their union — files, criteria, and the dependencies OUTSIDE the set (for stacking).
    const task = planTasks.length === 1 ? planTasks[0] : {
      id: taskId,
      title: planTasks.map((t) => `${t.id} ${t.title || ''}`.trim()).join(' · '),
      files: [...new Set(planTasks.flatMap((t) => t.files || []))],
      acceptance: [...new Set(planTasks.flatMap((t) => t.acceptance || []))],
      depends_on: [...new Set(planTasks.flatMap((t) => t.depends_on || []))].filter((d) => !idSet.has(d)),
      done: true,
    };
    // Commits of the task not yet in the base: its checkpoints and the frozen tests of its criteria.
    const range = `${baseSha}..HEAD`;
    // OXB-166: by phase + task; with a done_commit, the phase-less legacy trailers are not searched at all.
    const phaseCtx = taskPhaseContext(projectRoot, activeSession);
    const shas = new Set();
    if (!testsOnly) {
      const inRangeAll = gitLines(projectRoot, ['rev-list', range]) || [];
      for (const t of planTasks) {
        const own = t.done_commit && phaseCtx.phase
          ? (gitLines(projectRoot, ['log', '--format=%H', '-E', `--grep=^OXE-Task: ${phaseCtx.phase}/${t.id}$`, range]) || [])
          : taskCommitShas(projectRoot, t.id, range, phaseCtx);
        for (const sha of own) shas.add(sha);
        if (t.done_commit) {
          const full = (gitLines(projectRoot, ['rev-parse', '--verify', `${t.done_commit}^{commit}`]) || [])[0];
          if (full && inRangeAll.includes(full)) shas.add(full);
        }
      }
    }
    const quickSelection = (testsOnly || options.quicks === false)
      ? { quicks: [], skipped: [], warnings: [] }
      : promoteHelpers.selectPromoteQuickCommits(projectRoot, {
          range,
          orderedTaskShas: [...shas],
          planTasks,
          allTasks: doc && Array.isArray(doc.tasks) ? doc.tasks : [],
          phase: phaseCtx.phase,
          programDir: resolveRuntimeArtifactPaths(projectRoot, activeSession).programDir,
          config: readProjectConfig(projectRoot) || {},
        });
    if (!testsOnly) for (const q of quickSelection.quicks) shas.add(q.sha);
    // OXB-C27-3 (polish2 989902e60): the planner's single frozen-tests commit (only acceptance test files, of several
    // tasks) is never cherry-picked — every task PR carried the others' red tests. The task's own frozen tests are
    // carried as files below (OXB-156); the commit leaves the pick list, named in the warnings.
    {
      const frozenOwner = new Map();
      for (const a of (doc && Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [])) {
        for (const f of (a && a.files) || []) {
          const rel = String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
          if (!rel) continue;
          if (!frozenOwner.has(rel)) frozenOwner.set(rel, new Set());
          frozenOwner.get(rel).add(String(a.task || a.criterion || '?').toUpperCase());
        }
      }
      if (frozenOwner.size) {
        for (const sha of [...shas]) {
          const files = (gitLines(projectRoot, ['show', '--name-only', '--format=', '--no-renames', sha]) || []).map((f) => f.replace(/\\/g, '/')).filter((f) => f && !f.startsWith('.oxe/'));
          if (!files.length || !files.every((f) => frozenOwner.has(f))) continue;
          const owners = new Set(files.flatMap((f) => [...frozenOwner.get(f)]));
          const ownCriteria = new Set(planTasks.flatMap((t) => (t.acceptance || []).map((c) => String(c).toUpperCase())));
          const foreign = [...owners].filter((o) => !idSet.has(o) && !ownCriteria.has(o));
          if (!foreign.length) continue;
          shas.delete(sha);
          resolvedBase.warnings.push(`${sha.slice(0, 8)} é o commit de testes congelados do planejador (também de ${foreign.slice(0, 6).join(', ')}): não vai no PR; os congelados de ${taskIds.join(',')} vão como arquivos [OXB-C27-3]`);
        }
      }
    }
    const criteria = new Set(Array.isArray(task.acceptance) ? task.acceptance : []);
    // OXB-156: the PR carries (a) the task's OWN commits (OXE-Task trailer / done_commit) and (b) the frozen tests it
    // proves, taken as FILES from the program tip (+ the local fixtures they import) — never the program branch's import
    // commits, which also carry other tasks' and parked tests (F2-T1: a conflict on tests/acceptance/parked-f3/…).
    const programTip = (gitLines(projectRoot, ['rev-parse', 'HEAD']) || [])[0];
    const TEST_FILE_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
    const normRel = (f) => String(typeof f === 'string' ? f : (f && f.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const differsFromBase = (file) => {
      const tip = gitRun(projectRoot, ['show', `${programTip}:${file}`]);
      if (!tip.ok) return false;
      const onBase = gitRun(projectRoot, ['show', `${baseSha}:${file}`]);
      return !(onBase.ok && onBase.stdout === tip.stdout);
    };
    // OxeSpace 15/11 (OxeCode F6 T30): the task was built against u83 as RE-FROZEN by a CR's quick (cdfd414f9) — a test
    // in its FILES, not an acceptance entry of it — and the PR carried main's old u83, which its code turns red. The
    // test files of the task's own scope that differ from the base go in too, as files from the program tip.
    const scopeCandidates = [...new Set(planTasks.flatMap((t) => (t.files || []).map(normRel)))].filter((f) => f && !f.includes('*') && !f.endsWith('/') && TEST_FILE_RE.test(f) && differsFromBase(f));
    // cross-review 15/11: a SHARED suite (in the files of several waves) that ANOTHER task already changed on the program
    // branch is never copied from the tip — it would bring that task's unpromoted assertions into this PR. Only a file
    // whose changes in the range come from this task or from no task (a CR quick re-freeze) is carried.
    const otherTaskTouched = (file) => {
      const bodies = (gitRun(projectRoot, ['log', '--format=%B%x00', `${baseSha}..HEAD`, '--', file]).stdout || '').split('\0');
      // phase-aware (OXB-166): F5/T3 is not the T3 of F6 being promoted
      return bodies.some((b) => {
        if ([...b.matchAll(/^OXE-Task:\s*(?:(F\d+)\/)?(T\d+)\s*$/gm)].some((m) => (phaseCtx.phase && m[1] && m[1] !== phaseCtx.phase) || !idSet.has(m[2]))) return true;
        // OXB-C23-2 (152chat T5, tests/design-lint.test.ts 415→406): a QUICK that did another task (no OXE-Task trailer,
        // it names T10) changed the file too — the tip carries that task's assertions. A quick naming this task (a CR
        // re-freeze of its test) is still ours.
        if (!/^OXE-Quick:/m.test(b)) return false;
        const named = [...b.matchAll(/(?:(F\d+)\/)?\b(T\d+)\b/g)].filter((m) => !(phaseCtx.phase && m[1] && m[1] !== phaseCtx.phase)).map((m) => m[2]);
        return named.length > 0 && !named.some((t) => idSet.has(t));
      });
    };
    const scopeTests = scopeCandidates.filter((f) => !otherTaskTouched(f));
    const sharedSkipped = scopeCandidates.filter((f) => !scopeTests.includes(f));
    // OXB-C31-2 (152perf T2, #1050): the planner's commit (OXE-Plan) froze T2's test AND amended tests/agent-state.test.ts,
    // a NON-frozen test that T2's behavior change makes wrong. The planner commit is never cherry-picked, so the PR would
    // be born red. When a planner commit touches this task's own frozen tests, the non-frozen tests it amended go too (as
    // files from the tip) — unless another task's frozen tests share that commit or another task changed the file: then
    // the promote says the amendment stays out.
    const ownFrozenFiles = new Set((Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [])
      .filter((a) => a && ((a.task && idSet.has(a.task)) || (!a.task && criteria.has(a.criterion))))
      .flatMap((a) => (a.files || []).map(normRel)));
    const anyFrozen = new Map();
    for (const a of (Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [])) {
      for (const f of (a && a.files) || []) {
        const rel = normRel(f);
        if (!rel) continue;
        if (!anyFrozen.has(rel)) anyFrozen.set(rel, new Set());
        anyFrozen.get(rel).add(String(a.task || a.criterion || '?').toUpperCase());
      }
    }
    const plannerAmends = [];
    const plannerWarnings = [];
    if (!testsOnly && ownFrozenFiles.size) {
      for (const sha of gitLines(projectRoot, ['rev-list', '--reverse', range]) || []) {
        const body = (gitRun(projectRoot, ['log', '-1', '--format=%B', sha]).stdout) || '';
        if (!/^OXE-Plan:/m.test(body)) continue;
        const files = (gitLines(projectRoot, ['show', '--name-only', '--format=', '--no-renames', sha]) || []).map((f) => f.replace(/\\/g, '/')).filter((f) => f && !f.startsWith('.oxe/'));
        if (!files.some((f) => ownFrozenFiles.has(f))) continue;
        const otherFrozenOwners = [...new Set(files.filter((f) => anyFrozen.has(f) && !ownFrozenFiles.has(f)).flatMap((f) => [...anyFrozen.get(f)]))].filter((o) => !idSet.has(o) && !criteria.has(o));
        for (const f of files.filter((x) => !anyFrozen.has(x) && TEST_FILE_RE.test(x))) {
          if (plannerAmends.includes(f) || scopeTests.includes(f) || !differsFromBase(f)) continue;
          if (otherFrozenOwners.length) plannerWarnings.push(`emenda do planejador em ${f} (${sha.slice(0, 8)}) fica de fora: o mesmo commit congela testes de ${otherFrozenOwners.slice(0, 4).join(', ')} — se ${taskId} precisa dela, ponha ${f} nos files da tarefa [OXB-C31-2]`);
          else if (otherTaskTouched(f)) plannerWarnings.push(`emenda do planejador em ${f} (${sha.slice(0, 8)}) fica de fora: outra tarefa também mudou o arquivo no programa — promova junto se precisar das duas [OXB-C31-2]`);
          else plannerAmends.push(f);
        }
      }
    }
    const testFiles = [...new Set([...ownFrozenFiles, ...scopeTests, ...plannerAmends])];
    // a test the verify runs that differs from the base but is NOT the task's (not in its files nor its entries): the PR
    // runs the base version — named, with the commits that changed it, never carried silently
    const verifyTests = [...new Set(planTasks.flatMap((t) => [...((t.verify && t.verify.commands) || []), t.verify && t.verify.command, t.verifyCommand].filter(Boolean).join(' ').replace(/\\/g, '/').match(/[^\s"'`]+/g) || []))]
      .map(normRel).filter((s) => s.includes('/') && TEST_FILE_RE.test(s) && /\.[cm]?[jt]sx?$/i.test(s));
    // a shared suite that is ALSO the task's own frozen entry is carried (as before): never reported as not carried
    const notCarried = [...new Set([...verifyTests.filter((f) => !testFiles.includes(f) && differsFromBase(f)), ...sharedSkipped.filter((f) => !testFiles.includes(f))])];
    if (!shas.size && !testFiles.length) throw new Error(`${taskId}: nenhum commit da tarefa fora de ${base} (sem trailer OXE-Task/done_commit em ${base}..HEAD) — já está na base?`);
    const ordered = testsOnly ? [] : (gitLines(projectRoot, ['rev-list', '--reverse', '--topo-order', range]) || []).filter((sha) => shas.has(sha));
    // local fixtures the frozen tests import (relative specifiers), one level deep — OXB-160 + OXB-C8 (T59 / #917):
    // carry a local fixture from the program tree ONLY when it is new on `base` (not deleted on `base`) or when THIS
    // task itself modified it; otherwise keep `base`'s file and warn when `base` has a newer/divergent version.
    const directTestSet = new Set(testFiles);
    const mergeBaseWithBase = (gitLines(projectRoot, ['merge-base', baseSha, programTip]) || [])[0] || null;
    const skippedFixtures = [];
    const preserveMergedFixtures = [];
    const fixtureWarnings = [];
    const withFixtures = (() => {
      const out = new Set(testFiles);
      const seenFixtures = new Set();
      for (const file of testFiles) {
        const root = promoteTestRoot(file);
        const text = (gitRun(projectRoot, ['show', `${programTip}:${file}`]).stdout) || '';
        for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
          const cand = resolveImportAt(projectRoot, programTip, path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
          if (!cand || !(cand + '/').startsWith(root + '/') || /\/src\//.test(`/${cand}`)) continue;
          if (directTestSet.has(cand) || seenFixtures.has(cand)) continue;
          seenFixtures.add(cand);

          const existsOnBase = gitRun(projectRoot, ['show', `${baseSha}:${cand}`]).ok;
          const divergesFromBase = differsFromBase(cand);
          if (!divergesFromBase) {
            out.add(cand);
            continue;
          }
          const baseChangedAfterFork = mergeBaseWithBase
            ? (gitLines(projectRoot, ['diff', '--name-only', mergeBaseWithBase, baseSha, '--', cand]) || []).length > 0
            : false;
          const existsAtMergeBase = mergeBaseWithBase ? gitRun(projectRoot, ['show', `${mergeBaseWithBase}:${cand}`]).ok : false;
          const deletedOnBase = !existsOnBase && existsAtMergeBase && baseChangedAfterFork;
          const taskCommitsTouching = (gitLines(projectRoot, ['log', '--no-merges', '--format=%H', range, '--', cand]) || []).filter((h) => shas.has(h));
          const inTaskFiles = planTasks.some((t) => (t.files || []).some((f) => normRel(f) === cand));
          const taskChangedFixture = taskCommitsTouching.length > 0 || (inTaskFiles && !otherTaskTouched(cand));

          if ((existsOnBase || deletedOnBase) && !taskChangedFixture) {
            const reason = deletedOnBase ? 'removed_on_base' : (baseChangedAfterFork ? 'older_than_base' : 'not_changed_by_task');
            skippedFixtures.push({ file: cand, reason });
            fixtureWarnings.push(
              `fixture ${cand} importada pelo teste congelado difere de ${base}, mas não foi alterada por ${taskId}${deletedOnBase ? ` (removida em ${base})` : baseChangedAfterFork ? ` (cópia do programa é mais antiga que ${base})` : ''} — mantida a versão de ${base}`
            );
            continue;
          }

          if (baseChangedAfterFork) {
            if (!testsOnly && taskCommitsTouching.length > 0) {
              preserveMergedFixtures.push(cand);
              fixtureWarnings.push(
                `fixture ${cand} alterada por ${taskId} também mudou em ${base} após o fork — mantida a mescla do cherry-pick em vez da cópia antiga do programa`
              );
            } else {
              fixtureWarnings.push(
                `fixture ${cand} carregada do programa difere de ${base}, que a modificou após o fork (cópia pode estar mais antiga que ${base})`
              );
            }
          }
          out.add(cand);
        }
      }
      return [...out];
    })();
    if (testsOnly) {
      const differingTests = withFixtures.filter((f) => differsFromBase(f));
      if (!withFixtures.length || !differingTests.length) {
        throw new Error(`${taskId}: nenhum teste congelado ou fixture diferente de ${base} para promover com --tests-only`);
      }
    }
    // OXB-169: other tasks' unpromoted commits BEFORE this task's, on the same files — this diff assumes them; the
    // cherry-pick will likely conflict. Name them and the combined promote.
    const assumed = testsOnly ? [] : promoteAssumedTasks(projectRoot, range, ordered, idSet, phaseCtx);
    // ALM: with an item for the task, the branch starts with its key ("oxe-12-t3"; Azure DevOps "ab-123-t3").
    let branchKey = null;
    try {
      const almLib = require('../oxe-alm.cjs');
      const almCfg = almLib.almConfig(readProjectConfig(projectRoot) || {});
      const ph = activeProgramPhase(projectRoot, activeSession);
      const pd = resolveRuntimeArtifactPaths(projectRoot, activeSession).programDir || path.join(projectRoot, '.oxe', 'program');
      let k = null;
      if (almCfg) {
        for (const lid of [taskId, ...taskIds]) {
          k = almLib.keyFor(pd, almCfg, ph ? ph.id : null, lid);
          if (k) break;
        }
      }
      branchKey = k ? k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null;
    } catch { branchKey = null; }
    const branch = String(options.branch || (branchKey ? `${branchKey}-${taskId.toLowerCase()}` : `oxe/promote-${taskId.toLowerCase()}`)).trim();
    const stackInfo = promoteStack(projectRoot, activeSession, task, { base, baseSha, remote, options });
    baseSha = stackInfo.baseSha;
    const stack = stackInfo.stack;
    const buildSha = stack ? stack.sha : baseSha;
    const unpromoDeps = testsOnly
      ? { dependencies: [], suggested_order: [], warnings: [] }
      : promoteHelpers.analyzeUnpromotedDependencies(projectRoot, {
          range,
          baseSha: buildSha,
          orderedTaskShas: ordered,
          planTasks,
          phase: phaseCtx.phase,
          stackedTaskIds: stack ? [stack.task] : [],
        });
    if (options.strict && unpromoDeps.dependencies.length) {
      throw new Error(`promote --strict recusado para ${taskId}: ${unpromoDeps.warnings[0]}`);
    }
    resolvedBase.warnings = [...(resolvedBase.warnings || []), ...stackInfo.warnings, ...quickSelection.warnings, ...fixtureWarnings, ...plannerWarnings, ...plannerAmends.map((f) => `${f}: emenda do planejador (commit OXE-Plan que congelou os testes de ${taskId}) vai no PR como arquivo [OXB-C31-2]`)];
    if (assumed.length && !stack) {
      resolvedBase.warnings.push(`${taskId} vem depois de ${assumed.map((a) => `${a.task} (${a.sha.slice(0, 8)})`).join(', ')} no histórico e mexe nos mesmos arquivos (${[...new Set(assumed.flatMap((a) => a.files))].slice(0, 4).join(', ')}) — o cherry-pick pode conflitar; promova junto: oxe-cc runtime promote --tasks ${[...new Set([...assumed.map((a) => a.task), ...taskIds])].join(',')}`);
    }
    for (const w of unpromoDeps.warnings) {
      if (!resolvedBase.warnings.includes(w)) resolvedBase.warnings.push(w);
    }
    const notCarriedWarnings = [];
    for (const f of notCarried) {
      const by = (gitLines(projectRoot, ['log', '--format=%h %s', range, '--', f]) || []).slice(0, 3);
      notCarriedWarnings.push(sharedSkipped.includes(f)
        ? `${f} está nos files de ${taskId}, mas outra tarefa também o mudou no programa: o PR leva só o que o cherry-pick da tarefa trouxe (não a versão da ponta, com as asserções dela)${by.length ? ` — commits: ${by.join('; ')}` : ''}. Se precisar das duas, promova junto`
        : `${f} está no verify de ${taskId} e difere de ${base}, mas não é da tarefa (fora dos files e dos testes congelados dela): o PR roda a versão de ${base}${by.length ? ` — mudado por ${by.join('; ')}` : ''}. Se a tarefa foi construída contra a nova, ponha o arquivo nos files dela (ou promova junto com a dona)`);
    }
    resolvedBase.warnings.push(...notCarriedWarnings);
    // 1.23.0 (OXB-230-05): check upstream drift against base before promoting (warn by default; block if reevaluate.block_on_drift === true)
    let reevaluateReport = null;
    try {
      const reevCfg = (readProjectConfig(projectRoot) || {}).reevaluate || {};
      if (reevCfg.enabled !== false && options.reevaluate !== false) {
        const reev = require('../oxe-reevaluate.cjs').reevaluateAgainstBase(projectRoot, { against: base });
        if (reev && reev.ok) {
          reevaluateReport = reev;
          if (reev.summary && reev.summary.contract_drift > 0) {
            const driftIds = (reev.tasks || []).filter((t) => t.classification === 'contract_drift').map((t) => t.id).join(', ');
            const driftMsg = `reevaluate: ${reev.summary.contract_drift} tarefa(s) com contract_drift contra ${base} (${driftIds}) — rode oxe-cc reevaluate --against ${base}`;
            if (reevCfg.block_on_drift === true) {
              throw Object.assign(new Error(`promote bloqueado por ${driftMsg}`), { oxeReevaluateBlocked: true });
            }
            resolvedBase.warnings.push(driftMsg);
          } else if (reev.summary && reev.summary.mechanical_sync > 0) {
            resolvedBase.warnings.push(`reevaluate: ${reev.summary.mechanical_sync} tarefa(s) com mechanical_sync contra ${base} — rode oxe-cc sync --base ${base} --apply`);
          }
        }
      }
    } catch (err) {
      if (err && err.oxeReevaluateBlocked) throw err;
    }
    if (options.dryRun) {
      const quickShaSet = new Set(quickSelection.quicks.map((q) => q.sha));
      const pcfgDry = readProjectConfig(projectRoot) || {};
      const dryTouchedFiles = [...new Set([
        ...planTasks.flatMap((t) => (t.files || []).map(normRel)),
        ...ordered.flatMap((sha) => gitLines(projectRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]) || []),
      ])].filter((f) => f && !f.includes('*'));
      const { riskSuites: dryRiskSuites, planDoc: dryPlanDoc } = collectPromoteRiskSuites(projectRoot, {
        projectRoot,
        activeSession,
        planTasks,
        touchedFiles: dryTouchedFiles,
        excludeSuites: [...verifyTests, ...withFixtures],
        config: pcfgDry,
      });
      const dryPreviewCmds = options.previewCi && dryRiskSuites.length
        ? promoteHelpers.buildPreviewCiCommands(projectRoot, dryRiskSuites, pcfgDry, { projectRoot, planTasks, planDoc: dryPlanDoc })
        : [];
      return {
        dry_run: true,
        ...(testsOnly ? { tests_only: true } : {}),
        task: taskId,
        base,
        base_sha: baseSha,
        ...(stack ? { stacked_on: { task: stack.task, branch: stack.branch, pr: stack.pr || null, sha: stack.sha } } : {}),
        base_requested: resolvedBase.requested,
        warnings: resolvedBase.warnings,
        branch,
        commits: ordered,
        commit_details: ordered.map((sha) => ({
          sha,
          subject: (gitLines(projectRoot, ['log', '-1', '--format=%s', sha]) || [''])[0],
          is_quick: quickShaSet.has(sha),
        })),
        ...(quickSelection.quicks.length ? { quick_commits: quickSelection.quicks } : {}),
        ...(quickSelection.skipped.length ? { skipped_quicks: quickSelection.skipped } : {}),
        ...(unpromoDeps.dependencies.length ? { unpromoted_dependencies: unpromoDeps.dependencies, suggested_promote_order: unpromoDeps.suggested_order } : {}),
        ...(notCarried.length ? { not_carried_tests: notCarried } : {}),
        ...(skippedFixtures.length ? { skipped_fixtures: skippedFixtures } : {}),
        ...(dryRiskSuites.length ? { ci_risk_suites: dryRiskSuites } : {}),
        ...(dryPreviewCmds.length ? { preview_ci_commands: dryPreviewCmds } : {}),
        ...(reevaluateReport ? { reevaluate: reevaluateReport } : {}),
        frozen_tests: withFixtures,
        conflict: null,
        pr_ready: null,
        body_file: null,
        pr: null,
        commands: [],
        worktree: null,
      };
    }
    // Never a force-push: a branch already on the remote with commits we do not have is refused before anything changes.
    // OXB-160: a local branch an earlier (failed) promote left behind — created by the promote, never pushed — is
    // reused: dropped and rebuilt. Any other existing branch is refused, as before.
    let replacedBranch = null;
    // OXB-162: the promote's own branch already on the remote with NO PR (a run that died, or pr:ready red) is rebuilt
    // and force-pushed with a lease on the sha it has now. A branch with a PR, or with commits that are not the
    // promote's, is refused as before.
    const remoteHead0 = gitRun(projectRoot, ['ls-remote', '--heads', remote, branch]);
    const remoteSha = remoteHead0.ok ? remoteHead0.stdout.trim().split(/\s+/)[0] : '';
    let forceLease = null;
    if (remoteSha) {
      const own = ownPushedPromoteBranch(projectRoot, activeSession, branch, remote, remoteSha, baseSha, options);
      if (!own.ok) throw new Error(`a branch ${branch} já existe em ${remote} (${remoteSha.slice(0, 8)}) — ${own.why}; o promote não sobrescreve; use --branch <outra>`);
      forceLease = remoteSha;
    }
    // OxeSpace 14/11: the leftover worktree of an earlier failed promote holds the branch ("está em uso numa worktree");
    // sweep the stale promote worktrees (pid gone) BEFORE checking whether the branch is ours to rebuild.
    const sweptEarly = sweepStalePromoteWorkspaces(projectRoot);
    if (gitLines(projectRoot, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])) {
      const own = ownUnpushedPromoteBranch(projectRoot, branch, remote, baseSha, { allowRemote: Boolean(forceLease) });
      if (!own.ok) throw new Error(`a branch ${branch} já existe${own.why ? ` (${own.why})` : ''} — use --branch <outra> ou apague-a`);
      const del = gitRun(projectRoot, ['branch', '-D', branch]);
      if (!del.ok) throw new Error(`a branch ${branch} (de um promote anterior) não pôde ser recriada: ${del.stderr.trim()}`);
      replacedBranch = own.sha;
    }
    const pushArgs = () => ['push', ...(forceLease ? [`--force-with-lease=${branch}:${forceLease}`] : []), '-u', remote, branch];
    const result = {
      task: taskId,
      ...(testsOnly ? { tests_only: true } : {}),
      base,
      base_sha: baseSha,
      ...(stack ? { stacked_on: { task: stack.task, branch: stack.branch, pr: stack.pr || null, sha: stack.sha } } : {}),
      base_requested: resolvedBase.requested,
      warnings: resolvedBase.warnings,
      branch,
      commits: ordered,
      ...(quickSelection.quicks.length ? { quick_commits: quickSelection.quicks } : {}),
      ...(quickSelection.skipped.length ? { skipped_quicks: quickSelection.skipped } : {}),
      ...(skippedFixtures.length ? { skipped_fixtures: skippedFixtures } : {}),
      ...(unpromoDeps.dependencies.length ? { unpromoted_dependencies: unpromoDeps.dependencies, suggested_promote_order: unpromoDeps.suggested_order } : {}),
      ...(reevaluateReport ? { reevaluate: reevaluateReport } : {}),
      conflict: null,
      pr_ready: null,
      body_file: null,
      pr: null,
      commands: [],
      worktree: null,
      ...(replacedBranch ? { replaced_branch: replacedBranch } : {}),
      ...(forceLease ? { replaced_remote: forceLease } : {}),
    };
    if (notCarried.length) result.not_carried_tests = notCarried;
    // Where the branch is built: a temporary worktree (default) or, with --in-place, the program checkout.
    let work = projectRoot;
    let wtPidFile = null;
    let cleanup = () => {};
    if (inPlace) {
      const back = () => gitRun(projectRoot, ['checkout', '-q', original && original !== 'HEAD' ? original : originalSha]);
      const co = gitRun(projectRoot, ['checkout', '-q', '-b', branch, buildSha]);
      if (!co.ok) throw new Error(`não foi possível criar ${branch}: ${co.stderr.trim()}`);
      gitRun(projectRoot, ['config', `branch.${branch}.oxePromote`, 'true']);
      cleanup = back;
    } else {
      const alloc = allocatePromoteWorktreePath(projectRoot, taskIds, taskId, buildSha);
      const wt = alloc.wt;
      wtPidFile = alloc.pidFile;
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      fs.mkdirSync(path.dirname(wtPidFile), { recursive: true });
      // OXB-162: worktrees of killed promotes (their junction unlinked first), and this one's pid for the next sweep.
      result.swept = [...sweptEarly, ...sweepStalePromoteWorkspaces(projectRoot)];
      fs.writeFileSync(wtPidFile, JSON.stringify({ pid: process.pid, task: taskId, ...(alloc.external ? { dir: wt } : {}), at: new Date().toISOString() }));
      const addArgs = process.platform === 'win32'
        ? ['-c', 'core.longpaths=true', 'worktree', 'add', '-q', '-b', branch, wt, buildSha]
        : ['worktree', 'add', '-q', '-b', branch, wt, buildSha];
      const add = gitRun(projectRoot, addArgs);
      if (!add.ok) throw new Error(`não foi possível criar a worktree de ${branch}: ${add.stderr.trim()}`);
      gitRun(projectRoot, ['config', `branch.${branch}.oxePromote`, 'true']);
      work = (() => { try { return fs.realpathSync.native ? fs.realpathSync.native(wt) : fs.realpathSync(wt); } catch { return wt; } })();
      // OXB-163: machine-local files (worktree.copy_local) pr:ready needs (gradle's local.properties, .env.local).
      try { result.local_copied = require('../oxe-local-config.cjs').copyLocalFiles(projectRoot, work).copied; } catch { /* auxiliar */ }
      const relWt = path.relative(projectRoot, work).replace(/\\/g, '/');
      result.worktree = relWt.startsWith('..') ? work.replace(/\\/g, '/') : relWt;
      // pr:ready needs the dependencies: a junction to the program's node_modules (or deps_link_from), never an install.
      let linked = false;
      try {
        const pc = require('../oxe-parallel.cjs').parallelConfig(projectRoot);
        const from = pc.deps && pc.deps.from ? pc.deps.from : projectRoot;
        const src = path.join(from, 'node_modules');
        if (fs.existsSync(src) && !fs.existsSync(path.join(work, 'node_modules'))) {
          fs.symlinkSync(fs.realpathSync(src), path.join(work, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
          linked = true;
        }
      } catch { /* pr:ready reports the missing deps */ }
      cleanup = () => {
        // Links first (a junction must never be followed by a recursive delete), then the worktree — never --force.
        try {
          const rt = loadRuntimeModule();
          if (rt && typeof rt.unlinkExternalLinks === 'function') rt.unlinkExternalLinks(work);
          else if (linked) fs.unlinkSync(path.join(work, 'node_modules'));
        } catch { /* */ }
        let rm = gitRun(projectRoot, ['worktree', 'remove', work]);
        // OxeSpace 14/11: a failed step (the frozen-tests commit refused) leaves uncommitted files in this promote's OWN
        // worktree; plain remove refuses and the worktree keeps holding the branch, so the next promote cannot rebuild
        // it. It is ours (created above): with no link left inside, a forced removal is safe.
        if (!rm.ok) {
          let linkLeft = false;
          try { linkLeft = fs.lstatSync(path.join(work, 'node_modules')).isSymbolicLink(); } catch { linkLeft = false; }
          if (!linkLeft) rm = gitRun(projectRoot, ['worktree', 'remove', '--force', work]);
        }
        if (rm.ok) {
          try { fs.rmSync(wtPidFile, { force: true }); } catch { /* */ }
          if (alloc.external) { try { fs.rmSync(`${work}.pid`, { force: true }); } catch { /* */ } }
        }
        if (!rm.ok) result.cleanup_warning = `worktree ${result.worktree} não removida (${rm.stderr.trim().split(/\r?\n/).pop()}) — remova à mão depois de conferir que não há links dentro`;
        gitRun(projectRoot, ['worktree', 'prune']);
      };
    }
    // OXB-162: Ctrl+C / SIGTERM while the promote runs still unlinks and removes its worktree (a hard kill is swept by
    // the next promote).
    let keepWorktree = false;
    const onSignal = (sig) => { try { if (!keepWorktree) cleanup(); } catch { /* */ } process.exit(sig === 'SIGINT' ? 130 : 143); };
    const signals = ['SIGINT', 'SIGTERM'];
    for (const sig of signals) process.once(sig, onSignal);
    try {
      const resolvedCapFiles = new Set();
      const resolvedConflicts = [];
      const pcfgPick = readProjectConfig(projectRoot) || {};
      for (let idx = 0; idx < ordered.length; idx += 1) {
        const sha = ordered[idx];
        const pick = gitRun(work, ['cherry-pick', '-x', sha]);
        if (!pick.ok) {
          const files = gitLines(work, ['diff', '--name-only', '--diff-filter=U']) || [];
          const auto = promoteHelpers.tryResolvePromoteCherryPickConflict(projectRoot, work, sha, pcfgPick, files, { resolve: options.resolve });
          if (auto.resolved) {
            for (const rf of auto.resolved_cap_files || []) resolvedCapFiles.add(rf);
            for (const rf of auto.resolved_files || []) {
              resolvedConflicts.push({ commit: sha, ...rf });
              result.warnings.push(`conflito auto-resolvido em ${rf.file} (${rf.strategy})`);
            }
            continue;
          }
          if (options.keepOnConflict && !inPlace) {
            keepWorktree = true;
            try {
              const pidTarget = wtPidFile || `${work}.pid`;
              const pausedMeta = JSON.stringify({ pid: process.pid, task: taskId, paused: true, ...(pidTarget !== `${work}.pid` ? { dir: work } : {}), at: new Date().toISOString() });
              fs.writeFileSync(pidTarget, pausedMeta);
              if (pidTarget !== `${work}.pid`) fs.writeFileSync(`${work}.pid`, pausedMeta);
            } catch { /* */ }
            const pendingState = {
              task: taskId,
              taskIds,
              branch,
              base,
              baseSha,
              buildSha,
              original,
              originalSha,
              remote,
              inPlace,
              forceLease,
              worktree: work,
              programTip,
              ordered,
              conflict_commit: sha,
              remaining_commits: ordered.slice(idx + 1),
              resolved_cap_files: [...resolvedCapFiles],
              resolved_conflicts: resolvedConflicts,
              withFixtures,
              preserveMergedFixtures,
              verifyTests,
              sharedSkipped,
              criteria: [...criteria],
              phaseCtx,
              taskMeta: { id: task.id, title: task.title || '', files: task.files || [], acceptance: task.acceptance || [] },
              quickSelection,
              stack,
              resultSnapshot: { ...result },
            };
            writeTextAtomic(pendingFile, `${JSON.stringify(pendingState, null, 2)}\n`);
            result.conflict = { commit: sha, files };
            result.kept_worktree = result.worktree;
            result.error = `conflito no cherry-pick de ${sha.slice(0, 8)} (${files.join(', ') || 'sem arquivos'}) — worktree mantida em ${result.worktree} (branch ${branch}); resolva os arquivos, rode \`git -C ${work} add ${files.join(' ') || '.'}\` e finalize com \`oxe-cc runtime promote ${taskId} --continue\`${assumed.length ? ` (ou promova junto: --tasks ${[...new Set([...assumed.map((a) => a.task), ...taskIds])].join(',')})` : ''}`;
            break;
          }
          gitRun(work, ['cherry-pick', '--abort']);
          result.conflict = { commit: sha, files };
          result.error = `conflito no cherry-pick de ${sha.slice(0, 8)} (${files.join(', ') || 'sem arquivos'}) — branch ${branch} descartada; ${assumed.length ? `a tarefa depende de commits de ${assumed.map((a) => a.task).join(', ')} feitos antes dela: promova junto (--tasks ${[...new Set([...assumed.map((a) => a.task), ...taskIds])].join(',')}) — ` : ''}use --resolve <arquivo>=ours|theirs|union-json-array ou rode com --keep-on-conflict para resolver na worktree e finalizar com \`oxe-cc runtime promote ${taskId} --continue\``;
          break;
        }
      }
      if (resolvedConflicts.length) result.resolved_conflicts = resolvedConflicts;
      if (!result.conflict && !result.error) {
        finalizePromotedWorktree({
          projectRoot,
          activeSession,
          work,
          result,
          taskId,
          planTasks,
          phaseCtx,
          base,
          baseSha,
          buildSha,
          branch,
          programTip,
          withFixtures,
          preserveMergedFixtures,
          ordered,
          verifyTests,
          resolvedCapFiles,
          pushArgs,
          options,
        });
        if (fs.existsSync(pendingFile)) { try { fs.rmSync(pendingFile, { force: true }); } catch { /* */ } }
      }
    } finally {
      for (const sig of signals) process.removeListener(sig, onSignal);
      if (!keepWorktree) cleanup();
    }
    if (result.conflict) {
      if (!keepWorktree) gitRun(projectRoot, ['branch', '-D', branch]);
      appendEvent(projectRoot, activeSession, { type: 'TaskPromoteFailed', work_item_id: taskId, payload: { base, reason: result.error || 'conflict', commit: result.conflict.commit, files: result.conflict.files, ...(keepWorktree ? { kept_worktree: result.kept_worktree } : {}) } });
      return result;
    }
    return finalizePromotePrBodyAndEvents({ projectRoot, activeSession, result, task, taskId, criteria, ordered, branch, original, base, remote, stack, pushArgs, options: { ...options, taskIds } });
  }

  /**
   * OXB-076: what removing criteria from the CURRENT plan means — their acceptance tests go, they leave the tasks'
   * `acceptance`, and a pending task left with no criterion goes too. Refused when another pending task depends on a
   * task that would go, or when such a task has a checkpoint (its work exists). Returns the new doc (not written).
   */

  return {
    collectPromoteRiskSuites,
    finalizePromotedWorktree,
    finalizePromotePrBodyAndEvents,
    cleanupPromoteWorktree,
    runtimePromote,
  };
}

module.exports = { createPromoteRuntime };
