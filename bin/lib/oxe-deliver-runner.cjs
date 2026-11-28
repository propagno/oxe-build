'use strict';

/**
 * 1.23.0 (OXB-230-14): Headless Autonomous Delivery Runner (`oxe-cc deliver run`).
 * Drives the exact same `DELIVER.json` state machine used by Chat-Driven mode (`deliver next`/`advance`),
 * plugging in either a real local CLI executor (`claude`, `codex`) or an injectable `executorFn`,
 * enforcing approval_mode (`single-ok` vs `auto`), model tier escalation, budget cap, and FINAL_SMOKE.
 * Pure Node.js stdlib — zero external production dependencies.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const intake = require('./oxe-deliver-intake.cjs');
const engine = require('./oxe-deliver-engine.cjs');
const agentCoord = require('./oxe-agent-coord.cjs');

function normTaskFile(f) {
  return String(f || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function filesOverlap(setA, listB) {
  if (setA.size === 0 || listB.length === 0) return true;
  for (const b of listB) {
    for (const a of setA) {
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return true;
    }
  }
  return false;
}

/**
 * 1.23.0 (OXB-230-17): Partitions phase tasks into parallel execution batches whose file write-sets
 * are mutually disjoint, avoiding merge conflicts and write races.
 */
function partitionDisjointTasks(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const batches = [];
  const batchFileSets = [];

  for (const task of list) {
    const files = [...new Set((Array.isArray(task && task.files) ? task.files : []).map(normTaskFile).filter(Boolean))];
    let placed = false;
    for (let i = 0; i < batches.length; i += 1) {
      if (!filesOverlap(batchFileSets[i], files)) {
        batches[i].push(task);
        for (const f of files) batchFileSets[i].add(f);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push([task]);
      batchFileSets.push(new Set(files));
    }
  }
  return batches;
}

function slugifyBranchSegment(text) {
  const slug = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'auto';
}

function isGitRepo(projectRoot) {
  const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: path.resolve(projectRoot),
    encoding: 'utf8',
    windowsHide: true,
  });
  return res.status === 0 && String(res.stdout || '').trim() === 'true';
}

/**
 * Ensures local branch `deliver/<slug>` exists and is checked out. Never pushes to any remote.
 */
function ensureDeliveryBranch(projectRoot, slug) {
  const rootAbs = path.resolve(projectRoot);
  if (!isGitRepo(rootAbs)) return { ok: false, skipped: true, branch: null };
  const cur = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: rootAbs,
    encoding: 'utf8',
    windowsHide: true,
  });
  const currentBranch = cur.status === 0 ? String(cur.stdout || '').trim() : '';
  if (currentBranch.startsWith('deliver/')) {
    return { ok: true, branch: currentBranch, created: false };
  }
  const branch = `deliver/${slugifyBranchSegment(slug)}`;
  const co = spawnSync('git', ['checkout', '-B', branch], {
    cwd: rootAbs,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (co.status !== 0) {
    return { ok: false, branch, error: String(co.stderr || co.stdout || '').trim() };
  }
  return { ok: true, branch, created: true };
}

/**
 * Commits local phase outputs with `OXE-Deliver: <deliver_id>/<phaseId>` trailer. Never pushes.
 */
function commitPhaseResult(projectRoot, deliverId, phaseId, title) {
  const rootAbs = path.resolve(projectRoot);
  if (!isGitRepo(rootAbs)) return { ok: false, skipped: true, committed: false };
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: rootAbs,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (status.status !== 0 || !String(status.stdout || '').trim()) {
    return { ok: true, committed: false };
  }
  const add = spawnSync('git', ['add', '-A'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
  if (add.status !== 0) {
    return { ok: false, committed: false, error: String(add.stderr || '').trim() };
  }
  const summary = `feat(${phaseId}): ${String(title || 'phase verified').slice(0, 72)}`;
  const msg = `${summary}\n\nOXE-Deliver: ${deliverId}/${phaseId}`;
  const commit = spawnSync('git', ['commit', '-m', msg], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
  if (commit.status !== 0) {
    return { ok: false, committed: false, error: String(commit.stderr || commit.stdout || '').trim() };
  }
  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
  return { ok: true, committed: true, sha: rev.status === 0 ? String(rev.stdout || '').trim() : null };
}

function buildExecutorPrompt(step) {
  const lines = [
    `OXE Autonomous Delivery — Estado: ${step.state}`,
    step.phase ? `Fase: ${step.phase.id} (${step.phase.index}/${step.phase.total}) — ${step.phase.title}` : '',
    `Instrução: ${step.instruction}`,
    step.allowed_files && step.allowed_files.length ? `Arquivos alvo: ${step.allowed_files.join(', ')}` : '',
    step.frozen_tests && step.frozen_tests.length ? `Testes congelados (NÃO alterar): ${step.frozen_tests.join(', ')}` : '',
    step.heal_state && step.heal_state.last_failure ? `Último erro para corrigir:\n${step.heal_state.last_failure}` : '',
    'Restrições:',
    ...(step.constraints || []).map((c) => `- ${c}`),
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

function invokeCliExecutor(projectRoot, step, opts = {}) {
  const execName = String(opts.executor || 'claude').trim().toLowerCase();
  const prompt = buildExecutorPrompt(step);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  let cmd = execName;
  let args = [];
  if (execName === 'claude') {
    args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (opts.model) args.push('--model', String(opts.model));
  } else if (execName === 'codex') {
    args = ['exec', prompt];
  } else {
    args = [prompt];
  }

  const res = spawnSync(cmd, args, {
    cwd: path.resolve(projectRoot),
    env: childEnv,
    encoding: 'utf8',
    timeout: opts.executorTimeoutMs || 300000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    throw new Error(`Falha ao invocar executor "${execName}": ${res.error.message}`);
  }
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    costUsd: Number(opts.defaultStepCostUsd || 0),
  };
}

/**
 * Runs the autonomous delivery state machine end-to-end.
 * Stops cleanly on CLARIFY, DESIGN_REVIEW (when single-ok / pending_choice), PAUSED_BLOCKED, or DELIVERED.
 */
async function runAutonomousDelivery(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const sessionOpt = opts.session ? { session: opts.session } : {};

  let found = engine.readDeliveryState(rootAbs, sessionOpt);
  if (!found || opts.from || opts.briefingText) {
    const initRes = intake.initDelivery(rootAbs, {
      from: opts.from,
      briefingText: opts.briefingText,
      approval: opts.approval,
      session: opts.session,
      maxBudgetUsd: opts.maxBudgetUsd,
      maxAttempts: opts.maxAttempts,
      skipGitInit: opts.skipGitInit,
    });
    found = { file: initRes.paths.deliverJson, state: initRes.state };
    if (initRes.state.status === 'CLARIFY') {
      return {
        ok: true,
        deliver_id: initRes.deliver_id,
        paused_for_clarification: true,
        approval_prompt: initRes.approval_prompt,
        blocking_questions: initRes.state.blocking_questions,
        state: initRes.state,
      };
    }
    if (initRes.state.status === 'DESIGN_REVIEW') {
      return {
        ok: true,
        deliver_id: initRes.deliver_id,
        paused_for_approval: true,
        approval_prompt: initRes.approval_prompt,
        state: initRes.state,
      };
    }
  }

  const maxIterations = Number.isInteger(opts.maxIterations) && opts.maxIterations > 0 ? opts.maxIterations : 50;
  let stepsExecuted = 0;
  let gitBranchInfo = null;
  const gitCommits = [];

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const step = engine.getNextDeliveryStep(rootAbs, sessionOpt);
    const currentStatus = step.state;

    if (opts.autoGit && !gitBranchInfo && !['CLARIFY', 'DESIGN_REVIEW', 'PAUSED_BLOCKED', 'CANCELLED'].includes(currentStatus)) {
      gitBranchInfo = ensureDeliveryBranch(rootAbs, step.deliver_id || step.title);
    }

    if (currentStatus === 'DELIVERED') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      return {
        ok: true,
        deliver_id: step.deliver_id,
        steps_executed: stepsExecuted,
        git_branch: gitBranchInfo ? gitBranchInfo.branch : null,
        git_commits: gitCommits,
        state: latest.state,
        handoff: latest.state.handoff || null,
      };
    }

    if (currentStatus === 'CLARIFY') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      return {
        ok: true,
        deliver_id: step.deliver_id,
        paused_for_clarification: true,
        blocking_questions: step.blocking_questions,
        state: latest.state,
      };
    }

    if (currentStatus === 'DESIGN_REVIEW') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      return {
        ok: true,
        deliver_id: step.deliver_id,
        paused_for_approval: true,
        approval_prompt: step.approval_prompt,
        state: latest.state,
      };
    }

    if (currentStatus === 'PAUSED_BLOCKED' || currentStatus === 'CANCELLED') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      return {
        ok: false,
        deliver_id: step.deliver_id,
        blocked: true,
        steps_executed: stepsExecuted,
        error: latest.state.blocked_reason || `Entrega interrompida (${currentStatus})`,
        state: latest.state,
      };
    }

    // Budget guard before launching another executor turn
    if (step.budget && step.budget.spent_usd >= step.budget.limit_usd && currentStatus !== 'FINAL_SMOKE') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      latest.state.status = 'PAUSED_BLOCKED';
      latest.state.blocked_reason = `Orçamento máximo atingido ($${step.budget.spent_usd}/$${step.budget.limit_usd})`;
      engine.writeDeliveryState(rootAbs, latest.file, latest.state);
      return {
        ok: false,
        deliver_id: step.deliver_id,
        blocked: true,
        steps_executed: stepsExecuted,
        error: latest.state.blocked_reason,
        state: latest.state,
      };
    }

    if (currentStatus === 'FINAL_SMOKE') {
      stepsExecuted += 1;
      const adv = engine.advanceDelivery(rootAbs, {
        ...sessionOpt,
        smokeCommand: opts.smokeCommand,
        runCommand: opts.runCommand,
      });
      if (!adv.ok && adv.state && adv.state.status === 'PAUSED_BLOCKED') {
        return { ok: false, deliver_id: step.deliver_id, blocked: true, steps_executed: stepsExecuted, error: adv.error, state: adv.state };
      }
      if (adv.ok && opts.autoGit) {
        const c = commitPhaseResult(rootAbs, step.deliver_id, 'FINAL_SMOKE', 'delivery handoff');
        if (c.committed) gitCommits.push({ phase: 'FINAL_SMOKE', sha: c.sha });
      }
      continue;
    }

    // Execute one atomic slice (or parallel disjoint task batches during PHASE_IMPLEMENT)
    stepsExecuted += 1;
    let execResult = {};
    const canParallelize = currentStatus === 'PHASE_IMPLEMENT'
      && opts.parallel !== false
      && Array.isArray(step.tasks)
      && step.tasks.length > 1;

    if (canParallelize) {
      const batches = partitionDisjointTasks(step.tasks);
      let totalCost = 0;
      for (const batch of batches) {
        const batchResults = await Promise.all(batch.map(async (task) => {
          const leaseId = `deliver-${step.deliver_id}-${(step.phase && step.phase.id) || 'F'}-${task.id}`;
          agentCoord.tryAutoLease(rootAbs, 'register', {
            agent_id: leaseId,
            provider: opts.executor || 'deliver-runner',
            role: 'executor',
            task: `${(step.phase && step.phase.id) || 'F'}/${task.id}`,
            write_set: task.files || [],
          });
          const taskStep = {
            ...step,
            task,
            allowed_files: task.files && task.files.length ? task.files : step.allowed_files,
          };
          try {
            if (typeof opts.executorFn === 'function') {
              return (await opts.executorFn(taskStep, { projectRoot: rootAbs, iteration: iter, task })) || {};
            }
            return invokeCliExecutor(rootAbs, taskStep, opts);
          } finally {
            agentCoord.tryAutoLease(rootAbs, 'release', { agent_id: leaseId });
          }
        }));
        for (const r of batchResults) {
          if (r && Number.isFinite(Number(r.costUsd))) totalCost += Number(r.costUsd);
        }
      }
      execResult = { costUsd: totalCost };
    } else if (typeof opts.executorFn === 'function') {
      execResult = (await opts.executorFn(step, { projectRoot: rootAbs, iteration: iter })) || {};
    } else {
      execResult = invokeCliExecutor(rootAbs, step, opts);
    }

    const adv = engine.advanceDelivery(rootAbs, {
      ...sessionOpt,
      frozenTests: execResult.frozenTests,
      planTasks: execResult.planTasks,
      verifyCommand: execResult.verifyCommand || opts.verifyCommand,
      smokeCommand: execResult.smokeCommand || opts.smokeCommand,
      costUsd: execResult.costUsd || 0,
      runCommand: opts.runCommand,
    });

    if (adv.ok && adv.closed_phase && opts.autoGit) {
      const closedObj = (adv.state && adv.state.phases || []).find((p) => p.id === adv.closed_phase);
      const c = commitPhaseResult(rootAbs, step.deliver_id, adv.closed_phase, closedObj && closedObj.title);
      if (c.committed) gitCommits.push({ phase: adv.closed_phase, sha: c.sha });
    }

    if (!adv.ok && adv.state && adv.state.status === 'PAUSED_BLOCKED') {
      return {
        ok: false,
        deliver_id: step.deliver_id,
        blocked: true,
        steps_executed: stepsExecuted,
        error: adv.error || adv.state.blocked_reason,
        state: adv.state,
      };
    }
    if (!adv.ok && !adv.healing) {
      return {
        ok: false,
        deliver_id: step.deliver_id,
        steps_executed: stepsExecuted,
        error: adv.error,
        state: adv.state,
      };
    }
  }

  const finalState = engine.readDeliveryState(rootAbs, sessionOpt);
  return {
    ok: false,
    deliver_id: finalState ? finalState.state.deliver_id : null,
    steps_executed: stepsExecuted,
    error: `Limite de iterações (${maxIterations}) atingido antes de concluir.`,
    state: finalState ? finalState.state : null,
  };
}

module.exports = {
  buildExecutorPrompt,
  invokeCliExecutor,
  partitionDisjointTasks,
  ensureDeliveryBranch,
  commitPhaseResult,
  runAutonomousDelivery,
};
