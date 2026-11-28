'use strict';

/**
 * 1.23.0 (OXB-230-10 / ADR D-6 Fatia 3): Status and Doctor CLI command handlers extracted from bin/oxe-cc.js.
 * Zero circular requires back to bin/oxe-cc.js — all shared helpers are injected via `deps`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function createStatusDoctorHandlers(deps) {
  const {
    PKG_ROOT,
    oxeHealth,
    oxeWorkflows,
    oxeOperational,
    oxeRuntimeSemantics,
    oxeRelease,
    cyan,
    green,
    yellow,
    dim,
    red,
    reset,
    useAnsiColors,
    printSection,
    displayPathForUser,
    printSummaryAndNextSteps,
    readPkgVersion,
    readMinNode,
    writeOxeLegend,
    collectOxeRoutineHints,
  } = deps;

  /**
   * Doctor / status: config estendida, fase STATE, scan antigo, SUMMARY, SPEC/PLAN.
   * @param {string} target
   * @param {boolean} c
   * @param {{ skipScanCompactAgeWarnings?: boolean }} [diagOpts]
   */
  function printOxeHealthDiagnostics(target, c, diagOpts = {}) {
    const skipAge = Boolean(diagOpts.skipScanCompactAgeWarnings);
    const r = oxeHealth.buildHealthReport(target);
    const { config } = oxeHealth.loadOxeConfigMerged(target);

    console.log(`\n  ${c ? cyan : ''}▸ Coerência .oxe/ e config${reset}`);
    console.log(`  ${c ? dim : ''}Saúde lógica:${c ? reset : ''} ${r.healthStatus}`);

    if (r.configParseError) {
      console.log(`  ${red}FALHA${reset} config.json: ${r.configParseError}`);
      return;
    }

    for (const err of r.typeErrors) {
      console.log(`  ${yellow}AVISO${reset} ${err}`);
    }
    if (r.unknownConfigKeys.length) {
      console.log(
        `  ${yellow}AVISO${reset} Chaves desconhecidas em .oxe/config.json (não usadas pelo oxe-cc): ${r.unknownConfigKeys.join(', ')}`
      );
    }

    if (r.phase) {
      console.log(`  ${c ? dim : ''}Fase (STATE.md):${c ? reset : ''} ${r.phase}`);
    }
    if (r.activeSession) {
      console.log(`  ${c ? dim : ''}Sessão ativa:${c ? reset : ''} ${r.activeSession}`);
    }
    if (r.planReviewStatus) {
      console.log(`  ${c ? dim : ''}Revisão do plano:${c ? reset : ''} ${r.planReviewStatus}`);
    }
    if (r.activeRun && r.activeRun.run_id) {
      console.log(`  ${c ? dim : ''}Run ativo:${c ? reset : ''} ${r.activeRun.run_id} (${r.activeRun.status || 'planned'})`);
    }
    if (r.eventsSummary) {
      console.log(`  ${c ? dim : ''}Tracing:${c ? reset : ''} ${r.eventsSummary.total} evento(s)`);
    }
    if (r.planSelfEvaluation && r.planSelfEvaluation.hasSection) {
      const best = r.planSelfEvaluation.bestPlan || '—';
      const conf =
        typeof r.planSelfEvaluation.confidence === 'number' ? `${r.planSelfEvaluation.confidence}%` : '—';
      console.log(`  ${c ? dim : ''}Plano (autoavaliação):${c ? reset : ''} melhor=${best} | confiança=${conf}`);
    }
    if (r.executionRationality && r.executionRationality.applicable === false) {
      console.log(`  ${c ? dim : ''}Prontidão racional:${c ? reset : ''} não aplicável ainda (PLAN.md ausente)`);
    } else if (typeof r.executionRationalityReady === 'boolean') {
      console.log(
        `  ${c ? dim : ''}Prontidão racional:${c ? reset : ''} implementation=${r.implementationPackReady ? 'ok' : 'pendente'} | anchors=${r.referenceAnchorsReady ? 'ok' : 'pendente'} | fixtures=${r.fixturePackReady ? 'ok' : 'pendente'}`
      );
      if (r.visualInputReadiness && r.visualInputReadiness !== 'not_applicable') {
        console.log(`  ${c ? dim : ''}Entradas visuais:${c ? reset : ''} ${r.visualInputReadiness}`);
      }
    }
    if (r.contextQuality) {
      console.log(
        `  ${c ? dim : ''}Contexto:${c ? reset : ''} score=${r.contextQuality.primaryScore != null ? r.contextQuality.primaryScore : '—'} | workflow=${r.contextQuality.primaryWorkflow || '—'} | status=${r.contextQuality.primaryStatus || '—'}`
      );
    }
    if (r.semanticsDrift) {
      console.log(`  ${c ? dim : ''}Semântica multi-runtime:${c ? reset : ''} ${r.semanticsDrift.ok ? 'alinhada' : 'com drift'}`);
    }
    if (r.copilot && (r.copilot.detected || r.copilot.warnings.length)) {
      const promptSource =
        r.copilot.promptSource === 'workspace'
          ? '.github/prompts/'
          : r.copilot.promptSource === 'legacy_global'
            ? '~/.copilot/prompts/ (legado)'
            : 'ausente';
      console.log(`  ${c ? dim : ''}Copilot VS Code:${c ? reset : ''} target=workspace | source=${promptSource}`);
      console.log(`  ${c ? dim : ''}Copilot workspace:${c ? reset : ''} ${displayPathForUser(r.copilot.workspace.promptsDir)}`);
      if (r.copilot.legacy.detected) {
        console.log(`  ${c ? dim : ''}Legado global:${c ? reset : ''} ${displayPathForUser(r.copilot.legacy.root)}`);
      }
    }
    if (r.azureActive && r.azure) {
      console.log(`  ${c ? dim : ''}Azure:${c ? reset : ''} ${r.azure.authStatus && r.azure.authStatus.login_active ? 'login ativo' : 'sem login'} | subscription=${r.azure.profile && (r.azure.profile.subscription_name || r.azure.profile.subscription_id) || '—'}`);
      console.log(`  ${c ? dim : ''}Azure inventory:${c ? reset : ''} total=${r.azure.inventorySummary ? r.azure.inventorySummary.total : 0} | pendências=${r.azure.pendingOperations || 0}`);
      if (r.azure.inventoryStale && r.azure.inventoryStale.stale) {
        console.log(`  ${yellow}AVISO${reset} Inventário Azure stale — rode ${cyan}npx oxe-cc azure sync${reset}`);
      }
      for (const warning of r.azure.warnings || []) {
        console.log(`  ${yellow}AVISO${reset} ${warning}`);
      }
    }

    if (!skipAge) {
      if (config.scan_max_age_days > 0 && r.scanDate && r.stale.stale) {
        console.log(
          `  ${yellow}AVISO${reset} Último scan há ~${r.stale.days} dia(s) (limite: ${config.scan_max_age_days}) — considere ${cyan}/oxe-scan${reset}`
        );
      } else if (config.scan_max_age_days > 0 && !r.scanDate && fs.existsSync(path.join(target, '.oxe', 'STATE.md'))) {
        console.log(
          `  ${dim}Obs.:${reset} Preencha **Data:** em STATE.md (secção Último scan) para o aviso de scan antigo, ou use scan_max_age_days: 0`
        );
      }

      if (config.compact_max_age_days > 0 && r.compactDate && r.staleCompact.stale) {
        console.log(
          `  ${yellow}AVISO${reset} Último compact há ~${r.staleCompact.days} dia(s) (limite: ${config.compact_max_age_days}) — considere ${cyan}/oxe-compact${reset} se .oxe/codebase/ estiver desatualizado`
        );
      } else if (
        config.compact_max_age_days > 0 &&
        !r.compactDate &&
        fs.existsSync(path.join(target, '.oxe', 'STATE.md'))
      ) {
        console.log(
          `  ${dim}Obs.:${reset} Preencha **Data:** em STATE.md (secção Último compact) para o aviso de compact antigo, ou use compact_max_age_days: 0`
        );
      }
    }

    if (Array.isArray(config.scan_focus_globs) && config.scan_focus_globs.length) {
      console.log(`  ${c ? dim : ''}Scan (foco em .oxe/config):${c ? reset : ''} ${config.scan_focus_globs.join(', ')}`);
    }
    if (Array.isArray(config.scan_ignore_globs) && config.scan_ignore_globs.length) {
      console.log(`  ${c ? dim : ''}Scan (ignorar):${c ? reset : ''} ${config.scan_ignore_globs.join(', ')}`);
    }

    for (const w of r.phaseWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.runtimeWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.reviewWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.capabilityWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.investigationWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.sessionWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.installWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.copilotWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.contextWarn || []) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.semanticsWarn || []) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    if (r.summaryGapWarn) {
      console.log(`  ${yellow}AVISO${reset} ${r.summaryGapWarn}`);
    }
    for (const w of r.specWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
    for (const w of r.planWarn) {
      console.log(`  ${yellow}AVISO${reset} ${w}`);
    }
  }

  /**
   * Imprime uma célula de coverage com cor ANSI.
   * @param {boolean} exists
   * @param {string} label
   */
  function coverageCell(exists, label) {
    const c = useAnsiColors();
    return exists ? `${c ? green : ''}✓ ${label}${c ? reset : ''}` : `${c ? dim : ''}✗ ${label}${c ? reset : ''}`;
  }

  /**
   * Visão CLI-first: health + coverage matrix + readiness gate no terminal.
   * @param {string} target
   */
  function runStatusFull(target) {
    const c = useAnsiColors();
    const report = oxeHealth.buildHealthReport(target);
    const p = oxeHealth.oxePaths(target);
    const activeSession = report.activeSession || null;
    let sp = p;
    if (activeSession) {
      sp = oxeHealth.scopedOxePaths(target, activeSession);
    }

    printSection('OXE ▸ status --full');
    console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
    console.log(`  ${c ? green : ''}Sessão:${c ? reset : ''} ${c ? cyan : ''}${activeSession || '— (sem sessão ativa)'}${c ? reset : ''}`);
    console.log(`  ${c ? green : ''}Workspace mode:${c ? reset : ''} ${report.workspaceMode || 'oxe_project'}`);
    console.log(`  ${c ? green : ''}Fase:${c ? reset : ''} ${report.phase || '—'}`);

    const healthColor = report.healthStatus === 'healthy' ? green : report.healthStatus === 'warning' ? yellow : red;
    console.log(`  ${c ? green : ''}Saúde:${c ? reset : ''} ${c ? healthColor : ''}${report.healthStatus}${c ? reset : ''}`);

    if (report.copilot && (report.copilot.detected || report.copilot.warnings.length)) {
      console.log(`\n  ${c ? yellow : ''}Copilot VS Code${c ? reset : ''}`);
      console.log(`  ${c ? dim : ''}Target:${c ? reset : ''} workspace (.github/)`);
      console.log(`  ${c ? dim : ''}Source:${c ? reset : ''} ${report.copilot.promptSource}`);
      console.log(`  ${c ? dim : ''}Workspace prompts:${c ? reset : ''} ${displayPathForUser(report.copilot.workspace.promptsDir)}`);
      console.log(`  ${c ? dim : ''}Legado global:${c ? reset : ''} ${report.copilot.legacy.detected ? 'detectado' : 'não'}`);
      for (const warning of report.copilotWarn.slice(0, 3)) {
        console.log(`  ${c ? yellow : ''}  • ${warning}${c ? reset : ''}`);
      }
    }
    if (report.codex && (report.codex.detected || report.codex.warnings.length)) {
      console.log(`\n  ${c ? yellow : ''}Codex${c ? reset : ''}`);
      console.log(`  ${c ? dim : ''}Prompts:${c ? reset : ''} ${report.codex.commandsReady ? 'ok' : 'pendente'} · ${displayPathForUser(report.codex.promptsDir)}`);
      console.log(`  ${c ? dim : ''}Skills:${c ? reset : ''} ${report.codex.skillsReady ? 'ok' : 'pendente'} · ${displayPathForUser(report.codex.skillsRoot)}`);
      for (const warning of report.codexWarn.slice(0, 3)) {
        console.log(`  ${c ? yellow : ''}  • ${warning}${c ? reset : ''}`);
      }
    }

    // Coverage matrix
    const specPath = activeSession && sp.spec ? sp.spec : p.spec;
    const planPath = activeSession && sp.plan ? sp.plan : p.plan;
    const verifyPath = activeSession && sp.verify ? sp.verify : p.verify;
    const specExists = fs.existsSync(specPath);
    const planExists = fs.existsSync(planPath);
    const verifyExists = fs.existsSync(verifyPath);
    const lessonsExists = fs.existsSync(p.globalLessons || p.lessons);
    const codebaseExists = fs.existsSync(p.codebase);

    console.log(`\n  ${c ? yellow : ''}Coverage matrix${c ? reset : ''}`);
    console.log(`  ${coverageCell(codebaseExists, 'codebase scan')}   ${coverageCell(specExists, 'SPEC.md')}   ${coverageCell(planExists, 'PLAN.md')}   ${coverageCell(verifyExists, 'VERIFY.md')}   ${coverageCell(lessonsExists, 'LESSONS.md')}`);

    // Readiness gate
    const packageMode = report.workspaceMode === 'product_package';
    const ready = packageMode
      ? Boolean(report.releaseReadiness && report.releaseReadiness.ok)
      : specExists
        && planExists
        && report.executionRationalityReady
        && !report.planWarn.length
        && !report.runtimeWarn.length;
    const gateColor = ready ? green : yellow;
    console.log(`\n  ${c ? yellow : ''}Readiness gate${c ? reset : ''}`);
    console.log(`  ${c ? gateColor : ''}${ready ? (packageMode ? '✓ Pronto para publicar' : '✓ Pronto para executar') : (packageMode ? '✗ Não pronto para publicar' : '✗ Não pronto para executar')}${c ? reset : ''}`);
    if (packageMode) {
      const releaseReadiness = report.releaseReadiness || { blockers: [], warnings: [] };
      if (Array.isArray(releaseReadiness.blockers) && releaseReadiness.blockers.length) {
        for (const blocker of releaseReadiness.blockers) {
          console.log(`  ${c ? red : ''}  • ${blocker}${c ? reset : ''}`);
        }
      }
      if (Array.isArray(releaseReadiness.warnings) && releaseReadiness.warnings.length) {
        for (const warning of releaseReadiness.warnings) {
          console.log(`  ${c ? yellow : ''}  • ${warning}${c ? reset : ''}`);
        }
      }
    } else {
      if (!specExists) console.log(`  ${c ? dim : ''}  • SPEC.md ausente — rode /oxe-spec${c ? reset : ''}`);
      if (!planExists) console.log(`  ${c ? dim : ''}  • PLAN.md ausente — rode /oxe-plan${c ? reset : ''}`);
      if (report.planWarn.length) {
        for (const w of report.planWarn) {
          console.log(`  ${c ? yellow : ''}  • ${w}${c ? reset : ''}`);
        }
      }
      if (planExists) {
        console.log(`  ${c ? dim : ''}  • Artefatos racionais:${c ? reset : ''} implementation=${report.implementationPackReady ? 'ok' : 'pendente'} · anchors=${report.referenceAnchorsReady ? 'ok' : 'pendente'} · fixtures=${report.fixturePackReady ? 'ok' : 'pendente'}`);
        if (report.visualInputReadiness && report.visualInputReadiness !== 'not_applicable') {
          console.log(`  ${c ? dim : ''}  • Entradas visuais:${c ? reset : ''} ${report.visualInputReadiness}`);
        }
      }
    }

    // Active run summary
    if (report.activeRun) {
      const ar = report.activeRun;
      console.log(`\n  ${c ? yellow : ''}Active run${c ? reset : ''}`);
      console.log(`  ${c ? dim : ''}Run:${c ? reset : ''} ${ar.run_id || '—'}   ${c ? dim : ''}Estado:${c ? reset : ''} ${ar.status || '—'}   ${c ? dim : ''}Onda:${c ? reset : ''} ${ar.current_wave != null ? ar.current_wave : '—'}`);
    }

    if (
      report.runtimeMode ||
      report.providerCatalog ||
      (report.activeRun && (report.verificationSummary || report.pendingGates || report.quotaSummary || report.auditSummary || report.promotionSummary || report.policyDecisionSummary)) ||
      (report.pendingGates && report.pendingGates.total > 0)
    ) {
      console.log(`\n  ${c ? yellow : ''}Runtime enterprise${c ? reset : ''}`);
      if (report.runtimeMode) {
        console.log(`  ${c ? dim : ''}Runtime mode:${c ? reset : ''} ${report.runtimeMode.runtime_mode || 'legacy'}${report.runtimeMode.enterprise_available === false ? ' (engine indisponível)' : ''}`);
      }
      if (report.fallbackMode) {
        console.log(`  ${c ? dim : ''}Fallback:${c ? reset : ''} ${report.fallbackMode}${report.runtimeMode && report.runtimeMode.reason ? ` · ${report.runtimeMode.reason}` : ''}`);
      }
      if (report.verificationSummary) {
        console.log(`  ${c ? dim : ''}Verification:${c ? reset : ''} total ${report.verificationSummary.total} · pass ${report.verificationSummary.pass} · fail ${report.verificationSummary.fail} · error ${report.verificationSummary.error}`);
      }
      if (report.residualRiskSummary) {
        console.log(`  ${c ? dim : ''}Residual risks:${c ? reset : ''} total ${report.residualRiskSummary.total} · high/critical ${report.residualRiskSummary.highOrCritical}`);
      }
      if (report.evidenceCoverage) {
        console.log(`  ${c ? dim : ''}Evidence coverage:${c ? reset : ''} ${report.evidenceCoverage.coverage_percent}% (${report.evidenceCoverage.checks_with_evidence}/${report.evidenceCoverage.total_checks})`);
      }
      if (report.pendingGates) {
        console.log(`  ${c ? dim : ''}Pending gates:${c ? reset : ''} ${report.pendingGates.pending.length} (stale ${report.pendingGates.stalePending.length}) · SLA ${report.pendingGates.gateSlaHours || 24}h`);
      }
      if (report.policyDecisionSummary) {
        console.log(`  ${c ? dim : ''}Policy decisions:${c ? reset : ''} total ${report.policyDecisionSummary.total} · denied ${report.policyDecisionSummary.denied} · gated ${report.policyDecisionSummary.gated} · override sem razão ${report.policyDecisionSummary.overridesWithoutRationale}`);
      }
      if (report.policyCoverage) {
        console.log(`  ${c ? dim : ''}Policy coverage:${c ? reset : ''} ${report.policyCoverage.coveragePercent}% · mutations ${report.policyCoverage.coveredMutations}/${report.policyCoverage.mutationNodes}`);
      }
      if (report.quotaSummary) {
        const consumed = report.quotaSummary.consumed || {};
        const limits = report.quotaSummary.limits || {};
        console.log(`  ${c ? dim : ''}Quotas:${c ? reset : ''} work items ${consumed.workItems ?? 0}/${limits.maxWorkItemsPerRun ?? '∞'} · mutations ${consumed.mutations ?? 0}/${limits.maxMutationsPerRun ?? '∞'} · retries ${consumed.retries ?? 0}/${limits.maxRetriesPerRun ?? '∞'}`);
      }
      if (report.auditSummary) {
        console.log(`  ${c ? dim : ''}Audit trail:${c ? reset : ''} run ${report.auditSummary.runEntries} · warn ${report.auditSummary.warn} · critical ${report.auditSummary.critical}`);
      }
      if (report.promotionSummary) {
        console.log(`  ${c ? dim : ''}Promotion:${c ? reset : ''} ${report.promotionSummary.status || '—'} · target ${report.promotionSummary.targetKind || '—'} · remote ${report.promotionSummary.remote || '—'}`);
      }
      if (report.promotionReadiness) {
        console.log(`  ${c ? dim : ''}Promotion readiness:${c ? reset : ''} ${report.promotionReadiness.status || 'unknown'}${Array.isArray(report.promotionReadiness.blockers) && report.promotionReadiness.blockers.length ? ` · blockers ${report.promotionReadiness.blockers.join(', ')}` : ''}`);
      }
      if (report.recoveryState) {
        console.log(`  ${c ? dim : ''}Recovery:${c ? reset : ''} ${report.recoveryState.status || 'unknown'} · recoveries ${report.recoveryState.recoverCount ?? 0} · issues ${Array.isArray(report.recoveryState.issues) ? report.recoveryState.issues.length : 0}`);
      }
      if (report.multiAgent) {
        const agents = Array.isArray(report.multiAgent.agents) ? report.multiAgent.agents.length : 0;
        const handoffs = Array.isArray(report.multiAgent.handoffs) ? report.multiAgent.handoffs.length : 0;
        const ownership = Array.isArray(report.multiAgent.ownership) ? report.multiAgent.ownership.length : 0;
        const blockers = Array.isArray(report.multiAgent.mergeBlockers) ? report.multiAgent.mergeBlockers.length : 0;
        console.log(`  ${c ? dim : ''}Multi-agent:${c ? reset : ''} ${report.multiAgent.enabled ? (report.multiAgent.mode || 'active') : 'disabled'} · agentes ${agents} · ownership ${ownership} · handoffs ${handoffs} · merge ${report.multiAgent.mergeReadiness || 'n/a'} · blockers ${blockers}`);
        if (report.multiAgent.nextAction) console.log(`  ${c ? dim : ''}Multi-agent next:${c ? reset : ''} ${report.multiAgent.nextAction}`);
      }
      if (report.providerCatalog) {
        const summary = report.providerCatalog.summary || {};
        const pluginsCount = summary.pluginsCount ?? summary.total_plugins ?? (Array.isArray(summary.plugins) ? summary.plugins.length : 0);
        const toolProviders = summary.toolProviders ?? summary.tool_providers ?? 0;
        const verifierProviders = summary.verifierProviders ?? summary.verifier_providers ?? 0;
        const loadErrors = summary.loadErrors ?? summary.load_errors ?? (Array.isArray(report.providerCatalog.load_errors) ? report.providerCatalog.load_errors.length : 0);
        console.log(`  ${c ? dim : ''}Provider catalog:${c ? reset : ''} plugins ${pluginsCount} · tools ${toolProviders} · verifiers ${verifierProviders} · load errors ${loadErrors}`);
      }
    }

    if (report.contextQuality || report.semanticsDrift) {
      const primaryWorkflow = report.contextQuality && report.contextQuality.primaryWorkflow ? report.contextQuality.primaryWorkflow : 'dashboard';
      const primaryScore = report.contextQuality && report.contextQuality.primaryScore != null ? report.contextQuality.primaryScore : null;
      const primaryStatus = report.contextQuality && report.contextQuality.primaryStatus ? report.contextQuality.primaryStatus : '—';
      const freshness = report.packFreshness && report.packFreshness[primaryWorkflow] ? report.packFreshness[primaryWorkflow] : null;
      console.log(`\n  ${c ? yellow : ''}Contexto e semântica${c ? reset : ''}`);
      console.log(`  ${c ? dim : ''}Pack primário:${c ? reset : ''} ${primaryWorkflow}`);
      console.log(`  ${c ? dim : ''}Qualidade:${c ? reset : ''} ${primaryScore != null ? `${primaryScore} (${primaryStatus})` : '—'}`);
      console.log(`  ${c ? dim : ''}Freshness:${c ? reset : ''} ${freshness ? `${freshness.reason}${freshness.pack_age_hours != null ? ` · ${freshness.pack_age_hours}h` : ''}` : '—'}`);
      console.log(`  ${c ? dim : ''}Drift semântico:${c ? reset : ''} ${report.semanticsDrift && report.semanticsDrift.ok ? 'não detectado' : 'detectado'}`);
    }

    // Plan self-evaluation
    if (!packageMode && report.planSelfEvaluation) {
      const pse = report.planSelfEvaluation;
      const threshold = report.planConfidenceThreshold || 90;
      console.log(`\n  ${c ? yellow : ''}Autoavaliação do plano${c ? reset : ''}`);
      if (pse.best_plan_current != null) {
        const bestColor = pse.best_plan_current ? green : red;
        console.log(`  ${c ? dim : ''}Melhor plano atual:${c ? reset : ''} ${c ? bestColor : ''}${pse.best_plan_current ? 'sim' : 'não'}${c ? reset : ''}`);
      }
      if (pse.confidence != null) {
        const confColor = report.planConfidenceExecutable
          ? green
          : Number(pse.confidence) >= Math.max(80, threshold - 10)
            ? yellow
            : red;
        console.log(`  ${c ? dim : ''}Confiança:${c ? reset : ''} ${c ? confColor : ''}${pse.confidence}%${c ? reset : ''}`);
        console.log(`  ${c ? dim : ''}Gate executável:${c ? reset : ''} > ${threshold}%${pse.executable ? ' (atingido)' : ' (ainda não atingido)'}`);
      }
    }

    console.log(`\n  ${c ? dim : ''}Próximo passo:${c ? reset : ''} ${c ? cyan : ''}${report.next && report.next.cursorCmd ? report.next.cursorCmd : '—'}${c ? reset : ''}`);
    console.log(`  ${c ? dim : ''}Motivo:${c ? reset : ''} ${report.next && report.next.reason ? report.next.reason : '—'}`);
    console.log(`\n  ${c ? dim : ''}Para visão operacional completa (web): ${cyan}oxe-cc dashboard${c ? reset : ''}`);
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} status --full concluído.\n`);
  }

  /**
   * @param {string} target
   * @param {{ json?: boolean, hints?: boolean, full?: boolean }} [opts]
   */
  function slimActiveRun(run) {
    if (!run || typeof run !== 'object') return run;
    const row = (r) => (r && typeof r === 'object'
      ? { check_id: r.check_id, status: r.status, ...(r.acceptance_ref ? { acceptance_ref: r.acceptance_ref } : {}), ...(r.skip_reason ? { skip_reason: r.skip_reason } : {}), ...(r.work_item_id ? { work_item_id: r.work_item_id } : {}) }
      : r);
    const out = { ...run };
    if (Array.isArray(run.verification_check_results)) out.verification_check_results = run.verification_check_results.map(row);
    if (Array.isArray(run.verification_results)) out.verification_results = run.verification_results.map(row);
    if (run.verification_manifest && typeof run.verification_manifest === 'object') out.verification_manifest = { summary: run.verification_manifest.summary || null };
    if (run.verification_suite && typeof run.verification_suite === 'object') out.verification_suite = { checks: Array.isArray(run.verification_suite.checks) ? run.verification_suite.checks.length : 0 };
    out.slim = true;
    return out;
  }

  function runStatus(target, opts = {}) {
    const { config } = oxeHealth.loadOxeConfigMerged(target);
    const dirInfo = require('../oxe-dir-info.cjs');
    const staleDays = Number.isInteger(config && config.oxe_stale_days) ? config.oxe_stale_days : 14;
    // OXB-043: `oxe-cc status --all-worktrees` — every worktree's .oxe/ and its state, to tell the active one.
    if (opts.allWorktrees) {
      const rows = dirInfo.worktreesOxe(target, { staleDays });
      if (opts.json) {
        console.log(JSON.stringify({ oxeWorktreesSchema: 1, worktrees: rows.map((r) => ({ path: r.path, branch: r.branch, here: r.here, oxe: r.oxe.exists ? { version: r.oxe.version, last_activity: r.oxe.last_activity, idle_days: r.oxe.idle_days, program: r.oxe.program, stale: r.oxe.stale, reasons: r.oxe.reasons } : null, active_agents: Array.isArray(r.active_agents) ? r.active_agents : [] })) }));
        return;
      }
      const cc = useAnsiColors();
      printSection('OXE ▸ worktrees');
      if (!rows.length) console.log('  (não é um repositório git)');
      for (const r of rows) {
        const tag = !r.oxe.exists ? `${cc ? dim : ''}sem .oxe/${cc ? reset : ''}` : r.oxe.stale ? `${cc ? yellow : ''}stale${cc ? reset : ''}` : `${cc ? green : ''}ativo${cc ? reset : ''}`;
        console.log(`  ${r.here ? '▸' : ' '} ${r.path} [${r.branch || '?'}] ${tag}`);
        if (r.oxe.exists) console.log(`      ${dirInfo.oxeDirLine(r.oxe)}${r.oxe.reasons.length ? ` — ${r.oxe.reasons.join('; ')}` : ''}`);
        if (Array.isArray(r.active_agents) && r.active_agents.length) {
          console.log(`      agentes ativos: ${r.active_agents.map((a) => `${a.agent_id}[${a.provider}]${a.task ? `(${a.task})` : ''}`).join(', ')}`);
        }
      }
      return;
    }
    const oxeDirInfo = dirInfo.describeOxeDir(target, { staleDays });
    const report = oxeHealth.buildHealthReport(target);
    const routineHints = collectOxeRoutineHints(target, report, config);
    const next = report.next;

    // 1.21.2: the SDLC journey map (stages 0–9) with the single next step.
    if (opts.journey) {
      const j = require('../oxe-journey.cjs').journey(target, next, report.activeSession || null);
      if (opts.json) { console.log(JSON.stringify({ oxeJourneySchema: 1, ...j })); return; }
      const cc = useAnsiColors();
      printSection('OXE ▸ jornada');
      if (j.phase) console.log(`  Fase ${j.phase.index}/${j.phase.total} — ${j.phase.id} (${j.phase.status})`);
      const mark = { done: `${cc ? green : ''}✓${cc ? reset : ''}`, current: `${cc ? cyan : ''}→${cc ? reset : ''}`, pending: '·', optional: `${cc ? dim : ''}○${cc ? reset : ''}` };
      for (const s of j.stages) console.log(`  ${mark[s.state]} ${s.n} ${s.title.padEnd(32)} ${cc ? dim : ''}${s.cmd}${cc ? reset : ''}`);
      if (next) console.log(`\n  Próximo passo: ${next.cursorCmd}\n  Por quê: ${next.reason}`);
      return;
    }

    // Lightweight, versioned summary for host integrations (IDEs, OXESpace) —
    // a small stable payload instead of the full ~100KB status. Includes a
    // compact per-agent skills view so a host can decide whether to offer
    // "install OXE skills" before launching an agent.
    if (opts.json && opts.summary) {
      const summary = oxeHealth.buildStatusSummary(report);
      summary.projectRoot = path.resolve(target);
      summary.agentSkills = oxeHealth.agentSkillsReport(target).map((a) => ({ agent: a.agent, skillsInstalled: a.skillsInstalled }));
      console.log(JSON.stringify(summary));
      return;
    }

    if (opts.json) {
      /** @type {Record<string, unknown>} */
      const payload = {
        oxeStatusSchema: 5,
        projectRoot: path.resolve(target),
        oxeDir: oxeDirInfo.exists ? { version: oxeDirInfo.version, running: oxeDirInfo.running, last_activity: oxeDirInfo.last_activity, idle_days: oxeDirInfo.idle_days, program: oxeDirInfo.program, stale: oxeDirInfo.stale, reasons: oxeDirInfo.reasons } : null,
        workspaceMode: report.workspaceMode || 'oxe_project',
        releaseReadiness: report.releaseReadiness || null,
        // canonical names: nextStep / cursorCmd / reason; `next` is an alias of nextStep (older footers read it)
        nextStep: report.next.step,
        next: report.next.step,
        cursorCmd: report.next.cursorCmd,
        reason: report.next.reason,
        artifacts: report.next.artifacts,
        phase: report.phase,
        healthStatus: report.healthStatus,
        activeSession: report.activeSession,
        scanDate: report.scanDate,
        staleScan: report.stale,
        compactDate: report.compactDate,
        staleCompact: report.staleCompact,
        planSelfEvaluation: report.planSelfEvaluation,
        planConfidenceThreshold: report.planConfidenceThreshold,
        planConfidenceExecutable: report.planConfidenceExecutable,
        implementationPackReady: report.implementationPackReady,
        referenceAnchorsReady: report.referenceAnchorsReady,
        fixturePackReady: report.fixturePackReady,
        visualInputReadiness: report.visualInputReadiness,
        visualInputsReady: report.visualInputsReady,
        executionRationalityReady: report.executionRationalityReady,
        criticalExecutionGaps: report.criticalExecutionGaps,
        executionRationality: report.executionRationality,
        planReviewStatus: report.planReviewStatus,
        // Bench B17: the whole run (each check's stdout, twice) made `status --json` 627 KB — 575 KB of activeRun — and
        // every agent that runs it pays for it. The check rows keep id/status/criterion; `--full` keeps everything.
        activeRun: (opts.full || opts.statusFull) ? report.activeRun : slimActiveRun(report.activeRun),
        eventsSummary: report.eventsSummary,
        runtimeMode: report.runtimeMode,
        fallbackMode: report.fallbackMode,
        gateSla: report.pendingGates ? report.pendingGates.gateSlaHours || 24 : 24,
        staleGateCount: report.pendingGates ? report.pendingGates.staleGateCount || 0 : 0,
        verificationSummary: report.verificationSummary,
        residualRiskSummary: report.residualRiskSummary,
        evidenceCoverage: report.evidenceCoverage,
        pendingGates: report.pendingGates,
        gateQueue: report.gateQueue,
        policyDecisionSummary: report.policyDecisionSummary,
        policyCoverage: report.policyCoverage,
        quotaSummary: report.quotaSummary,
        auditSummary: report.auditSummary,
        promotionSummary: report.promotionSummary,
        promotionReadiness: report.promotionReadiness,
        recoveryState: report.recoveryState,
        multiAgent: report.multiAgent || null,
        providerCatalog: report.providerCatalog,
        memoryLayers: report.memoryLayers,
        azureActive: report.azureActive,
        azure: report.azure,
        copilot: report.copilot,
        codex: report.codex,
        agentSkills: oxeHealth.agentSkillsReport(target),
        contextPacks: report.contextPacks,
        contextQuality: report.contextQuality,
        semanticsDrift: report.semanticsDrift,
        packFreshness: report.packFreshness,
        activeSummaryRefs: report.activeSummaryRefs,
          diagnostics: {
          configParseError: report.configParseError,
          typeErrors: report.typeErrors,
          unknownConfigKeys: report.unknownConfigKeys,
          phaseWarnings: report.phaseWarn,
          runtimeWarnings: report.runtimeWarn,
          reviewWarnings: report.reviewWarn,
          enterpriseWarnings: report.enterpriseWarn,
          capabilityWarnings: report.capabilityWarn,
          investigationWarnings: report.investigationWarn,
          sessionWarnings: report.sessionWarn,
          installWarnings: report.installWarn,
          copilotWarnings: report.copilotWarn,
          codexWarnings: report.codexWarn,
          contextWarnings: report.contextWarn,
          semanticsWarnings: report.semanticsWarn,
          summaryGapWarning: report.summaryGapWarn,
          specWarnings: report.specWarn,
          planWarnings: report.planWarn,
        },
      };
      if (opts.hints) {
        payload.hints = routineHints;
      }
      // OXB-145: pending attention first-class in the JSON too.
      try { payload.attention = require('../oxe-attention.cjs').open(path.resolve(target)).map((x) => ({ id: x.id, what: x.what, command: x.command, owner: x.owner, at: x.at })); } catch { payload.attention = []; }
      // OXB-C20 #8 & OXB-C21 #7: keep default `status --json` compact (no inline IMPLEMENTATION-PACK or closed-phase bloat);
      // full payload remains available via `--full`.
      if (!opts.full) {
        if (payload.executionRationality && typeof payload.executionRationality === 'object') {
          const er = /** @type {Record<string, unknown>} */ (payload.executionRationality);
          const { tasks: _t, implementationPack: _ip, pack: _p, details: _d, ...rest } = er;
          payload.executionRationality = {
            ...rest,
            ...(Array.isArray(er.tasks) ? { taskCount: er.tasks.length } : {}),
            compacted: true,
          };
        }
        if (payload.contextPacks && typeof payload.contextPacks === 'object') {
          const cp = /** @type {Record<string, unknown>} */ (payload.contextPacks);
          const { packs: _p, entries: _e, items: _i, ...rest } = cp;
          payload.contextPacks = {
            ...rest,
            ...(Array.isArray(cp.packs) ? { packCount: cp.packs.length } : {}),
            ...(Array.isArray(cp.entries) ? { entryCount: cp.entries.length } : {}),
          };
        }
        if (payload.activeRun && typeof payload.activeRun === 'object') {
          const ar = /** @type {Record<string, unknown>} */ (payload.activeRun);
          const { history: _h, events: _ev, closedPhases: _cp, nodes: _n, tasks: _tk, ...rest } = ar;
          payload.activeRun = {
            ...rest,
            ...(Array.isArray(ar.tasks) ? { taskCount: ar.tasks.length } : {}),
          };
        }
        if (payload.providerCatalog && typeof payload.providerCatalog === 'object') {
          const pc = /** @type {Record<string, unknown>} */ (payload.providerCatalog);
          if (Array.isArray(pc.providers) && pc.providers.length > 0) {
            payload.providerCatalog = { count: pc.providers.length, ids: pc.providers.map((p) => (p && p.id) || String(p)) };
          }
        }
        if (payload.releaseReadiness && typeof payload.releaseReadiness === 'object') {
          const rr = /** @type {Record<string, unknown>} */ (payload.releaseReadiness);
          const { manifest: rawManifest, ...rest } = rr;
          payload.releaseReadiness = {
            ...rest,
            ...(rawManifest && typeof rawManifest === 'object'
              ? {
                  manifestPresent: true,
                  manifestOk: Boolean(/** @type {Record<string, unknown>} */ (rawManifest).ok),
                  manifestVersion: /** @type {Record<string, unknown>} */ (rawManifest).version || null,
                }
              : {}),
          };
        }
        payload.compact = true;
      }
      console.log(JSON.stringify(payload));
      return;
    }

    printSection('OXE ▸ status');
    // OXB-145: what needs someone comes first.
    try {
      const att = require('../oxe-attention.cjs').open(path.resolve(target));
      if (att.length) {
        const cc = useAnsiColors();
        console.log(`  ${cc ? yellow : ''}ATENÇÃO (${att.length}) — .oxe/ATTENTION.md${cc ? reset : ''}`);
        for (const x of att.slice(0, 5)) console.log(`    ${x.id}: ${x.what} → ${x.command} (${x.owner})`);
        console.log('');
      }
    } catch { /* auxiliar */ }
    const c = useAnsiColors();
    console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
    console.log(`  ${c ? dim : ''}Workspace mode:${c ? reset : ''} ${report.workspaceMode || 'oxe_project'}`);
    if (oxeDirInfo.exists) {
      console.log(`  ${c ? dim : ''}.oxe/:${c ? reset : ''} ${dirInfo.oxeDirLine(oxeDirInfo)}`);
      if (oxeDirInfo.stale) console.log(`  ${c ? yellow : ''}AVISO${c ? reset : ''} .oxe/ stale: ${oxeDirInfo.reasons.join('; ')} — o próximo passo abaixo pode ser de um plano morto. Com várias worktrees: ${c ? cyan : ''}oxe-cc status --all-worktrees${c ? reset : ''}`);
    }

    const wfTgt = oxeWorkflows.resolveWorkflowsDir(target);
    if (!wfTgt) {
      console.log(`  ${yellow}AVISO${reset} Workflows OXE não encontrados — ${cyan}npx oxe-cc@latest${reset}`);
    }

    printOxeHealthDiagnostics(target, c, { skipScanCompactAgeWarnings: Boolean(opts.hints) });

    // IDE readiness summary
    const ideStatusLines = [];
    const _copilotPromptsDir = path.join(target, '.github', 'prompts');
    const _copilotInstructions = path.join(target, '.github', 'copilot-instructions.md');
    ideStatusLines.push(`Copilot ${fs.existsSync(_copilotPromptsDir) || fs.existsSync(_copilotInstructions) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
    ideStatusLines.push(`Cursor ${fs.existsSync(path.join(target, '.cursor', 'commands')) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
    const _claudeLocal = path.join(target, 'commands', 'oxe');
    const _claudeGlobal = path.join(require('os').homedir(), '.claude', 'commands');
    ideStatusLines.push(`Claude Code ${fs.existsSync(_claudeLocal) || fs.existsSync(_claudeGlobal) ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
    const _codex = report.codex || oxeHealth.codexIntegrationReport(target);
    ideStatusLines.push(`Codex ${_codex.commandsReady ? (c ? green + '✓' + reset : '✓') : (c ? dim + '✗' + reset : '✗')}`);
    console.log(`\n  ${c ? dim : ''}IDEs:${c ? reset : ''} ${ideStatusLines.join('  ')}`);

    // Gates pending in default view
    const pendingGateCount = report.pendingGates ? (report.pendingGates.pendingCount || 0) : 0;
    const staleGateCount = report.pendingGates ? (report.pendingGates.staleGateCount || 0) : 0;
    if (pendingGateCount > 0 || staleGateCount > 0) {
      const gateMsg = [];
      if (pendingGateCount > 0) gateMsg.push(`${pendingGateCount} pendente(s)`);
      if (staleGateCount > 0) gateMsg.push(`${staleGateCount} stale`);
      console.log(`  ${c ? yellow : ''}⚠ Gates:${c ? reset : ''} ${gateMsg.join(', ')} — ${c ? cyan : ''}npx oxe-cc runtime gates list --dir .${c ? reset : ''}`);
    }

    // Explicit blockage diagnosis
    const packageMode = report.workspaceMode === 'product_package';
    const specMissing = !fs.existsSync(oxeHealth.oxePaths(target).spec);
    const planMissing = !fs.existsSync(path.join(target, '.oxe', 'PLAN.md'));
    const verifyMissing = !fs.existsSync(path.join(target, '.oxe', 'VERIFY.md'));
    if (packageMode) {
      const releaseReadiness = report.releaseReadiness || { ok: false, blockers: [], warnings: [] };
      if (!releaseReadiness.ok && Array.isArray(releaseReadiness.blockers) && releaseReadiness.blockers.length) {
        console.log(`  ${c ? yellow : ''}⚠ Release blockers:${c ? reset : ''} ${releaseReadiness.blockers[0]}`);
      } else if (Array.isArray(releaseReadiness.warnings) && releaseReadiness.warnings.length) {
        console.log(`  ${c ? dim : ''}Obs.:${c ? reset : ''} release warnings ativas — ${releaseReadiness.warnings[0]}`);
      }
    } else if (specMissing) {
      console.log(`  ${c ? yellow : ''}⚠ Bloqueio:${c ? reset : ''} SPEC.md ausente — rode ${c ? cyan : ''}/oxe-spec${c ? reset : ''} antes de planejar`);
    } else if (planMissing) {
      console.log(`  ${c ? yellow : ''}⚠ Bloqueio:${c ? reset : ''} PLAN.md ausente — rode ${c ? cyan : ''}/oxe-plan${c ? reset : ''}`);
    } else if (verifyMissing && !planMissing) {
      console.log(`  ${c ? dim : ''}Obs.:${c ? reset : ''} VERIFY.md ainda não gerado — rode ${c ? cyan : ''}/oxe-verify${c ? reset : ''} após executar`);
    }

    if (opts.hints) {
      console.log(`\n  ${c ? cyan : ''}Lembretes (rotina OXE)${reset}`);
      if (routineHints.length) {
        for (const h of routineHints) {
          console.log(`  ${c ? dim : ''}•${c ? reset : ''} ${h}`);
        }
      } else {
        console.log(`  ${c ? dim : ''}•${c ? reset : ''} Nenhum (ajuste scan_max_age_days / compact_max_age_days em .oxe/config.json se quiser lembretes por idade)${reset}`);
      }
    }

    console.log(`\n  ${c ? yellow : ''}Próximo passo sugerido (único)${reset}`);
    console.log(`  ${c ? dim : ''}Passo:${c ? reset : ''} ${c ? green : ''}${next.step}${reset}`);
    console.log(`  ${c ? dim : ''}No Cursor (referência):${c ? reset : ''} ${c ? cyan : ''}${next.cursorCmd}${reset}`);
    console.log(`  ${c ? dim : ''}Motivo:${c ? reset : ''} ${next.reason}`);

    printSummaryAndNextSteps(c, {
      bullets: [
        `Saúde lógica: ${report.healthStatus}`,
        `Artefatos em jogo: ${next.artifacts.join(', ')}`,
      ],
      nextSteps: [
        { desc: 'Diagnóstico completo (inclui pacote de workflows):', cmd: 'npx oxe-cc doctor' },
        { desc: 'Ação sugerida no agente:', cmd: next.cursorCmd },
      ],
      dryRun: false,
    });
    console.log(`  ${c ? green : ''}✓${c ? reset : ''} status concluído.\n`);
  }

  /** @param {string} target */
  /** OXB-C27-8: uncommitted changes to the running package's own code (bin/, lib/, oxe/), when it is a git checkout. */
  function oxeCcDirtyFiles(pkgRoot) {
    if (!fs.existsSync(path.join(pkgRoot, '.git'))) return [];
    const r = spawnSync('git', ['status', '--porcelain', '--', 'bin', 'lib', 'oxe'], { cwd: pkgRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    if (r.status !== 0) return [];
    // an EOL-only difference is not a change: ask git for the real content diff of the tracked ones
    const tracked = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'bin', 'lib', 'oxe'], { cwd: pkgRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    const changed = new Set(String(tracked.stdout || '').split(/\r?\n/).filter(Boolean));
    const untracked = String(r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
    return [...changed, ...untracked].filter((f) => /\.(c?js|mjs|json|md)$/.test(f) || f.endsWith('/'));
  }

  function runDoctor(target, options = {}) {
      // OXB-230-23: .oxe/<asset> → .oxe/core/<asset>; dry-run unless --apply, idempotent, never touches the project state.
      if (options.migrateLayout) {
        const out = require('../oxe-layout.cjs').migrateLayout(target, { apply: options.applyMigration === true });
        process.exitCode = out.ok ? 0 : 1;
        if (options.json) { console.log(JSON.stringify(out, null, 2)); return; }
        printSection('OXE ▸ doctor --migrate-layout');
        for (const mv of out.moves) console.log(`  ${out.apply ? 'movido' : 'pendente'}: ${mv.from} → ${mv.to}`);
        for (const e of out.errors) console.log(`  ${red}✗${reset} ${e}`);
        if (out.config_update) console.log(`  ${out.apply ? 'gravado' : 'pendente'}: install.repo_layout = "core" em .oxe/config.json`);
        if (out.ok && !out.moves.length && !out.config_update) console.log('  nada a migrar — o projeto já está no layout .oxe/core/');
        if (out.ok && !out.apply && (out.moves.length || out.config_update)) console.log('  aplicar: oxe-cc doctor --migrate-layout --apply');
        return;
      }
      // OXB-100: the config migrations of this version (notes + mechanical key moves), applied only with --apply.
      if (options.migrateConfig) {
        const ch = require('../oxe-channels.cjs');
        const cfgPath = path.join(target, '.oxe', 'config.json');
        const pkgVersion = readPkgVersion();
        if (!fs.existsSync(cfgPath)) { console.error(`${red}✗${reset} sem .oxe/config.json em ${target}`); process.exitCode = 1; return; }
        const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const list = ch.pending(config, config.oxe_config_version || null, pkgVersion);
        const out = options.applyMigration ? ch.apply(cfgPath, pkgVersion) : { from: config.oxe_config_version || null, to: pkgVersion, pending: list };
        if (options.json) { console.log(JSON.stringify({ oxeMigrateConfigSchema: 1, ...out }, null, 2)); return; }
        printSection('OXE ▸ doctor --migrate-config');
        const notes = options.applyMigration ? out.notes : list.flatMap((m) => m.notes.map((n) => `${m.version}: ${n}`));
        const moves = options.applyMigration ? out.applied : list.flatMap((m) => m.moves.map((mv) => `${mv.from} → ${mv.to}`));
        console.log(`  config de ${out.from || '(sem versão)'} para ${out.to}`);
        for (const n of notes) console.log(`  - ${n}`);
        for (const mv of moves) console.log(`  ${options.applyMigration ? 'aplicado' : 'pendente'}: ${mv}`);
        if (!notes.length && !moves.length) console.log('  nada a migrar');
        if (!options.applyMigration && (notes.length || moves.length)) console.log('  aplicar (com backup): oxe-cc doctor --migrate-config --apply');
        if (options.applyMigration) console.log(`  backup: ${path.relative(target, out.backup)}`);
        return;
      }
      if (options.project) {
        // 1.21 (OXB-006): the machine against the project's engines/.nvmrc/packageManager, the same check the execute
        // preflight blocks on.
        const env = require('../oxe-project-env.cjs').checkProjectEnvironment(target);
        if (options.json) {
          console.log(JSON.stringify({ oxeProjectEnvSchema: 1, ...env }, null, 2));
        } else {
          printSection('OXE ▸ doctor --project');
          const c = useAnsiColors();
          const t = env.toolchain;
          console.log(`  ${c ? green : ''}Máquina:${c ? reset : ''} node ${t.node} · npm ${t.npm || '—'} · ${t.platform}/${t.arch} · ${t.free_mb} MB livres`);
          const w = env.wanted;
          console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} engines ${JSON.stringify(w.engines)}${w.nvmrc ? ` · .nvmrc ${w.nvmrc}` : ''}${w.packageManager ? ` · ${w.packageManager}` : ''}`);
          for (const p of env.problems) console.log(`  ${red}✗${reset} ${p}`);
          for (const x of env.warnings) console.log(`  ${yellow}!${reset} ${x}`);
          if (env.scrubbed_env && env.scrubbed_env.length) console.log(`  ${c ? dim : ''}Removidas dos processos filhos (executor, verify, gates):${c ? reset : ''} ${env.scrubbed_env.join(', ')}`);
          console.log(env.ok ? `  ${green}✓ ambiente compatível${reset}` : `  ${red}✗ ambiente incompatível — o runtime execute fica bloqueado (project_env)${reset}`);
        }
        process.exitCode = env.ok ? 0 : 1;
        return;
      }
      if (options.ciParity) {
        const parity = require('../oxe-ci-parity.cjs').runCiParityCheck(target);
        if (options.json) {
          console.log(JSON.stringify(parity, null, 2));
        } else {
          printSection('OXE ▸ doctor --ci-parity');
          const c = useAnsiColors();
          const ck = parity.checks;
          const badge = (ok) => (ok ? `${c ? green : ''}✓${c ? reset : ''}` : `${c ? red : ''}✗${c ? reset : ''}`);
          console.log(`  ${badge(ck.clean_checkout_doctor.ok)} clean-checkout doctor (${ck.clean_checkout_doctor.healthStatus || 'n/a'})`);
          console.log(`  ${badge(ck.engines_parity.ok)} engines.node parity (${ck.engines_parity.root_engines_node || 'n/a'})`);
          console.log(`  ${badge(ck.posix_symlink_gitignore.ok)} POSIX symlink / .gitignore hygiene`);
          for (const p of parity.problems) console.log(`  ${red}✗${reset} ${p}`);
          for (const w of parity.warnings) console.log(`  ${yellow}!${reset} ${w}`);
          console.log(parity.ok ? `  ${green}✓ paridade CI local OK${reset}` : `  ${red}✗ divergências encontradas — corrija antes do push${reset}`);
        }
        process.exitCode = parity.ok ? 0 : 1;
        return;
      }
      if (options.release) {
        if (!options.json) printSection('OXE ▸ doctor --release');
        const c = useAnsiColors();
        const result = oxeRelease.checkReleaseConsistency(target, {
          packageRoot: PKG_ROOT,
          writeManifest: Boolean(options.writeManifest),
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: result.ok ? 'ok' : 'blocked',
              blockers: result.blockers,
              warnings: result.warnings,
              manifestPath: result.manifestPath,
              manifest: result.manifest,
            },
            null,
            2
          )
        );
      } else {
        console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
        console.log(`  ${c ? green : ''}Versão alvo:${c ? reset : ''} ${result.manifest.versions.rootPackage.version || '—'}`);
        console.log(`  ${c ? green : ''}Manifest:${c ? reset : ''} ${result.manifestPath}`);
        if (result.ok) {
          console.log(`  ${c ? green : ''}✓${c ? reset : ''} release readiness OK`);
        } else {
          console.log(`  ${c ? red : ''}✗${c ? reset : ''} release readiness bloqueada`);
          for (const blocker of result.blockers) {
            console.log(`    - ${blocker}`);
          }
        }
        for (const warning of result.warnings) {
          console.log(`  ${c ? yellow : ''}!${c ? reset : ''} ${warning}`);
        }
      }
      process.exit(result.ok ? 0 : 1);
    }
    printSection('OXE ▸ doctor');
    const v = process.versions.node;
    const major = parseInt(v.split('.')[0], 10);
    const minNode = readMinNode();
    const c = useAnsiColors();
    console.log(`  ${c ? green : ''}Projeto:${c ? reset : ''} ${c ? cyan : ''}${target}${c ? reset : ''}`);
    console.log(`  Node.js ${v} (mínimo exigido pelo pacote: ${minNode})`);
    if (major < minNode) {
      console.log(`${red}FALHA${reset} Versão do Node abaixo do exigido em engines do pacote`);
      process.exit(1);
    }
    console.log(`${green}OK${reset} Node.js`);

    // OXB-C27-8 (15:33Z): the oxe-cc in use running from a checkout with uncommitted changes in its code — one bad
    // edit there breaks every hook and worktree that calls it. A warning, with the files.
    try {
      const dirty = oxeCcDirtyFiles(PKG_ROOT);
      if (dirty.length) console.log(`${yellow}AVISO${reset} o oxe-cc em uso roda de uma árvore com ${dirty.length} mudança(s) não commitada(s) no código (${PKG_ROOT}): ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''} — uma edição quebrada ali derruba hooks e worktrees que chamam este oxe-cc`);
    } catch { /* auxiliar */ }

    // Keep the generated `.oxe/README.md` legend fresh against the current catalog.
    if (fs.existsSync(path.join(target, '.oxe'))) {
      writeOxeLegend(target, { quiet: true });
    }

    const wfPkg = path.join(PKG_ROOT, 'oxe', 'workflows');
    const wfTgt = oxeWorkflows.resolveWorkflowsDir(target);
    if (!fs.existsSync(wfPkg)) {
      console.log(`${red}FALHA${reset} Workflows do pacote npm ausentes: ${wfPkg}`);
      process.exit(1);
    }
    const expected = fs
      .readdirSync(wfPkg)
      .filter((f) => f.endsWith('.md'))
      .sort();

    if (!wfTgt) {
      // If the project has .oxe/runs/ it's a runtime-only project — workflows are optional
      const hasRuntimeRuns = fs.existsSync(path.join(target, '.oxe', 'runs'));
      if (hasRuntimeRuns) {
        // a checkout or worktree with the runtime and no workflows: the /oxe-* commands fall back to the package's
        // workflows (oxe-cc workflow path <slug>); the copy pins the version
        console.log(`${yellow}AVISO${reset} workflows ausentes (.oxe/runs/ presente, sem .oxe/workflows/): os comandos /oxe-* usam os do pacote instalado (${cyan}oxe-cc workflow path <slug>${reset}).`);
        console.log(`${c ? dim : ''}  Para fixar a versão neste repositório: ${cyan}oxe-cc install --oxe-only .${reset}`);
      } else {
        console.log(
          `${yellow}AVISO${reset} Não há oxe/workflows/ nem .oxe/workflows/ neste projeto — rode ${cyan}npx oxe-cc@latest${reset} para instalar.`
        );
        process.exit(1);
      }
      return;
    }

    const actual = fs
      .readdirSync(wfTgt)
      .filter((f) => f.endsWith('.md'))
      .sort();
    const missing = expected.filter((f) => !actual.includes(f));
    const extra = actual.filter((f) => !expected.includes(f));

    if (missing.length) {
      console.log(`${red}FALHA${reset} Faltam workflows em relação ao pacote: ${missing.join(', ')}`);
      process.exit(1);
    }
    if (extra.length) {
      console.log(
        `${dim}Obs.:${reset} Há workflows extras no projeto (ok em forks): ${extra.join(', ')}`
      );
    }
    const wfLabel = wfTgt.includes(`${path.sep}.oxe${path.sep}core${path.sep}`) ? '.oxe/core/workflows' : wfTgt.includes(`${path.sep}.oxe${path.sep}`) ? '.oxe/workflows' : 'oxe/workflows';
    console.log(`${green}OK${reset} ${wfLabel} contém os ${expected.length} arquivos esperados do pacote`);

    const shape = oxeWorkflows.validateWorkflowShapes(wfTgt);
    if (shape.warnings.length) {
      for (const w of shape.warnings) {
        console.log(`${yellow}Obs. (workflow):${reset} ${w.message}`);
      }
    }

    // Verificar workflows sem contrato no registry de semântica
    const allContractSlugs = new Set(oxeRuntimeSemantics.getAllWorkflowContracts().map((ct) => ct.workflow_slug));
    const workflowMdFiles = fs.readdirSync(wfTgt).filter((f) => f.endsWith('.md'));
    const orphanedWorkflows = workflowMdFiles
      .map((f) => f.replace(/\.md$/, ''))
      .filter((slug) => !allContractSlugs.has(slug));
    if (orphanedWorkflows.length) {
      for (const slug of orphanedWorkflows) {
        console.log(`${yellow}AVISO${reset} Workflow sem contrato semântico no registry: ${slug}.md — adicione em workflow-runtime-contracts.json ou rode \`npx oxe-cc update\`.`);
      }
    } else {
      console.log(`${green}OK${reset} Todos os workflows têm contrato semântico registado`);
    }

    const oxeState = path.join(target, '.oxe', 'STATE.md');
    if (fs.existsSync(oxeState)) console.log(`${green}OK${reset} .oxe/STATE.md encontrado`);
    else {
      console.log(
        `${dim}Obs.:${reset} .oxe/STATE.md ausente — rode ${cyan}oxe-cc init-oxe${reset} ou instale sem ${cyan}--no-init-oxe${reset}`
      );
    }

    const cfgPath = path.join(target, '.oxe', 'config.json');
    if (fs.existsSync(cfgPath)) {
      try {
        JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        console.log(`${green}OK${reset} .oxe/config.json (JSON válido)`);
      } catch (e) {
        console.log(`${red}FALHA${reset} .oxe/config.json com JSON inválido: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.log(`${dim}Obs.:${reset} .oxe/config.json ausente (opcional — ver oxe/templates/CONFIG.md)`);
    }
    // OXB-031/043: the oxe-cc that wrote this .oxe/ versus the one running now, and whether the .oxe/ is stale.
    try {
      const dirInfo = require('../oxe-dir-info.cjs');
      const info = dirInfo.describeOxeDir(target);
      if (info.exists) {
        console.log(`${info.stale ? yellow + 'AVISO' : green + 'OK'}${reset} .oxe/: ${dirInfo.oxeDirLine(info)}`);
        for (const r of info.reasons) if (info.stale || /sem registro/.test(r)) console.log(`  ${dim}${r}${reset}`);
        if (info.version && info.running && info.version !== info.running) console.log(`  ${dim}Versão do projeto ≠ versão em execução: use npx oxe-cc@${info.version} (ou atualize o projeto com oxe-cc update) para não rodar um fluxo de outra versão.${reset}`);
      }
    } catch { /* opcional */ }
    // OXB-118: which project rules are enforced and which are only text.
    try {
      const cfgRules = (JSON.parse(fs.readFileSync(path.join(target, '.oxe', 'config.json'), 'utf8')) || {}).policy_rules;
      const pol = require('../oxe-policy-rules.cjs').summary(cfgRules);
      if (pol.total) {
        console.log(`${pol.advisory.length ? yellow + 'AVISO' : green + 'OK'}${reset} Regras do projeto: ${pol.enforced.length} aplicada(s), ${pol.advisory.length} só texto${pol.advisory.length ? ' — nada checa estas; converta (oxe-cc policy list)' : ''}`);
        for (const r of pol.advisory.slice(0, 12)) console.log(`  ${dim}· ${r.text.slice(0, 110)}${reset}`);
      }
    } catch { /* opcional */ }
    // OXB-032: spec_ref/roadmap_ref that are missing, or a .oxe/ copy that diverges from them.
    try {
      for (const w of require('../oxe-artifact-refs.cjs').refWarnings(target)) console.log(`${yellow}AVISO${reset} ${w}`);
    } catch { /* opcional */ }
    // OXB-058: a gitignored .oxe/ with no versioned export leaves SPEC/ROADMAP/PROGRAM edits without history.
    try {
      const historyWarning = oxeOperational.oxeHistoryWarning(target);
      if (historyWarning) console.log(`${yellow}AVISO${reset} ${historyWarning}`);
    } catch { /* opcional */ }

    const cbDir = path.join(target, '.oxe', 'codebase');
    const expectedMaps = [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ];
    if (fs.existsSync(cbDir)) {
      const missingMaps = expectedMaps.filter((f) => !fs.existsSync(path.join(cbDir, f)));
      if (missingMaps.length) {
        console.log(
          `${yellow}Obs.:${reset} Mapa do codebase incompleto — faltam em .oxe/codebase/: ${missingMaps.join(', ')} (rode ${cyan}/oxe-scan${reset})`
        );
      } else {
        console.log(`${green}OK${reset} .oxe/codebase/ com os ${expectedMaps.length} mapas esperados`);
      }
    }

    const report = oxeHealth.buildHealthReport(target);

    // IDE health gates
    console.log('');
    const ideChecks = [];
    const copilotPromptsDir = path.join(target, '.github', 'prompts');
    const copilotInstructions = path.join(target, '.github', 'copilot-instructions.md');
    const copilotReady = fs.existsSync(copilotPromptsDir) || fs.existsSync(copilotInstructions);
    ideChecks.push({ label: 'Copilot', ready: copilotReady, hint: '.github/prompts/ ou copilot-instructions.md' });

    const cursorDir = path.join(target, '.cursor', 'commands');
    const cursorReady = fs.existsSync(cursorDir);
    ideChecks.push({ label: 'Cursor', ready: cursorReady, hint: '.cursor/commands/' });

    const claudeLocalDir = path.join(target, 'commands', 'oxe');
    // `install --claude --ide-local` writes the commands to <project>/.claude/commands
    const claudeProjectDir = path.join(target, '.claude', 'commands');
    const claudeGlobalDir = path.join(require('os').homedir(), '.claude', 'commands');
    const claudeProjectReady = fs.existsSync(path.join(claudeProjectDir, 'oxe.md'));
    const claudeLocalReady = fs.existsSync(claudeLocalDir) || claudeProjectReady;
    const claudeGlobalReady = fs.existsSync(claudeGlobalDir);
    ideChecks.push({
      label: 'Claude Code',
      ready: claudeLocalReady || claudeGlobalReady,
      hint: claudeProjectReady
        ? '.claude/commands/'
        : claudeLocalReady
          ? 'commands/oxe/'
          : claudeGlobalReady
            ? '~/.claude/commands/ (global do utilizador)'
            : '.claude/commands/, commands/oxe/ ou ~/.claude/commands/',
      status: claudeLocalReady ? 'local' : claudeGlobalReady ? 'global_only' : 'missing',
    });

    const codexReport = oxeHealth.codexIntegrationReport(target);
    ideChecks.push({
      label: 'Codex',
      ready: codexReport.commandsReady,
      hint: codexReport.promptSource === 'workspace'
        ? '.codex/prompts/oxe.md'
        : codexReport.promptSource === 'global'
          ? '~/.codex/prompts/oxe.md (global do utilizador)'
          : '.codex/prompts/oxe.md ou ~/.codex/prompts/oxe.md',
      status: codexReport.promptSource,
    });

    for (const ide of ideChecks) {
      if (ide.ready) {
        const suffix = ide.status === 'global_only' || ide.status === 'global'
          ? ' — apenas global'
          : '';
        console.log(`${c ? green : ''}OK${c ? reset : ''} ${ide.label} pronto (${ide.hint})${suffix}`);
      } else {
        console.log(`${c ? dim : ''}Obs.:${c ? reset : ''} ${ide.label} não detectado — esperado ${ide.hint}`);
      }
    }

    // Runtime compilation check
    if (report.runtimeMode && report.runtimeMode.enterprise_available) {
      console.log(`${c ? green : ''}OK${c ? reset : ''} Runtime compilado detectado — modo enterprise disponível`);
    } else {
      console.log(`${c ? dim : ''}Obs.:${c ? reset : ''} Runtime não compilado — operando em modo legado (sem perda de UX)`);
    }

    // Readiness gate summary
    const stateFilePath = path.join(target, '.oxe', 'STATE.md');
    let readinessCmd = '/oxe';
    let readinessDesc = 'Nenhum STATE.md encontrado';
    if (fs.existsSync(stateFilePath)) {
      try {
        const stateContent = fs.readFileSync(stateFilePath, 'utf8');
        const phaseMatch = stateContent.match(/fase[:\s]+([a-z_]+)/i) || stateContent.match(/phase[:\s]+([a-z_]+)/i) || stateContent.match(/status[:\s]+([a-z_]+)/i);
        const phase = phaseMatch ? phaseMatch[1].toLowerCase() : 'init';
        const phaseMap = {
          init: { cmd: '/oxe', desc: 'Pronto para /oxe' },
          scan_complete: { cmd: '/oxe-spec', desc: 'Pronto para /oxe-spec' },
          spec_complete: { cmd: '/oxe-plan', desc: 'Pronto para /oxe-plan' },
          plan_complete: { cmd: '/oxe-execute', desc: 'Pronto para /oxe-execute' },
          execute_complete: { cmd: '/oxe-verify', desc: 'Pronto para /oxe-verify' },
          verify_complete: { cmd: 'runtime promote --target pr_draft', desc: 'Pronto para promoção' },
        };
        const next = phaseMap[phase] || { cmd: '/oxe', desc: `Fase detectada: ${phase}` };
        readinessCmd = next.cmd;
        readinessDesc = next.desc;
      } catch (_) { /* ignore */ }
    }
    const specPath = path.join(target, '.oxe', 'SPEC.md');
    const specExists = fs.existsSync(specPath);
    console.log('');
    if (specExists) {
      console.log(`  ${c ? green : ''}✓ ${readinessDesc}${c ? reset : ''} — próximo: ${c ? cyan : ''}${readinessCmd}${c ? reset : ''}`);
    } else {
      console.log(`  ${c ? yellow : ''}⚠ Falta SPEC — rode ${c ? cyan : ''}${readinessCmd}${c ? reset : ''}`);
    }

    printOxeHealthDiagnostics(target, c);
    const statusColor = report.healthStatus === 'healthy' ? green : report.healthStatus === 'warning' ? yellow : red;
    console.log(`\n  ${statusColor}Diagnóstico ${report.healthStatus}${reset}`);
    if (report.healthStatus === 'broken') {
      process.exitCode = 1;
    }
    const ideReadySummary = ideChecks.filter((i) => i.ready).map((i) => i.label).join(', ') || 'nenhuma IDE detectada';
    printSummaryAndNextSteps(c, {
      bullets: [
        `Projeto em ${target}`,
        `Workflows conferidos em ${wfLabel}`,
        `IDEs prontas: ${ideReadySummary}`,
        `Saúde lógica: ${report.healthStatus}`,
      ],
      nextSteps: [
        { desc: 'Entrar no fluxo OXE e deixar o router apontar o primeiro passo:', cmd: '/oxe' },
        { desc: 'Ver ajuda e ordem dos passos OXE:', cmd: '/oxe-help' },
        { desc: 'Reinstalar ou atualizar arquivos do OXE:', cmd: 'npx oxe-cc@latest --force' },
      ],
      dryRun: false,
    });
  }

  return {
    printOxeHealthDiagnostics,
    coverageCell,
    runStatusFull,
    slimActiveRun,
    runStatus,
    oxeCcDirtyFiles,
    runDoctor,
  };
}

module.exports = { createStatusDoctorHandlers };
