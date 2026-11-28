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

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const step = engine.getNextDeliveryStep(rootAbs, sessionOpt);
    const currentStatus = step.state;

    if (currentStatus === 'DELIVERED') {
      const latest = engine.readDeliveryState(rootAbs, sessionOpt);
      return {
        ok: true,
        deliver_id: step.deliver_id,
        steps_executed: stepsExecuted,
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
      continue;
    }

    // Execute one atomic slice via injected executorFn or CLI executor
    stepsExecuted += 1;
    let execResult = {};
    if (typeof opts.executorFn === 'function') {
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
  runAutonomousDelivery,
};
