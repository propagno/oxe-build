import { appendEvent } from '../events/bus';
import type { OxeEvent } from '../events/envelope';
import type { EventInput } from '../events/bus';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace/workspace-manager';
import type { WorkspaceLease } from '../models/workspace';
import type { GateManager } from '../gate/gate-manager';
import type { PolicyEngine, PersistedPolicyDecision, PolicyContext } from '../policy/policy-engine';
import { savePolicyDecision } from '../policy/policy-engine';
import type { PluginRegistry } from '../plugins/plugin-registry';
import type { AuditTrail } from '../audit/audit-trail';
import type { RunQuota, QuotaViolation } from '../audit/audit-trail';
import { checkQuota, consumeQuota } from '../audit/audit-trail';
import {
  saveJournal,
  loadJournal,
  deleteJournal,
  createJournal,
} from './run-journal';
import type { RunJournal } from './run-journal';

export interface TaskResult {
  success: boolean;
  failure_class: 'env' | 'policy' | 'test' | 'timeout' | null;
  evidence: string[];
  output: string;
}

export interface TaskExecutor {
  execute(
    node: GraphNode,
    lease: WorkspaceLease,
    runId: string,
    attemptNumber: number
  ): Promise<TaskResult>;
}

export interface SchedulerContext {
  projectRoot: string;
  sessionId: string | null;
  runId: string;
  executor: TaskExecutor;
  workspaceManager: WorkspaceManager;
  gateManager?: GateManager;
  policyEngine?: PolicyEngine;
  pluginRegistry?: PluginRegistry;
  auditTrail?: AuditTrail;
  quota?: RunQuota;
  policyActor?: string;
  onEvent?: (event: OxeEvent) => void;
}

export interface RunResult {
  run_id: string;
  status: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'paused';
  completed: string[];
  failed: string[];
  blocked: string[];
  pending_gates?: string[];
}

type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'blocked';

export class Scheduler {
  private cancelled = false;
  private paused = false;
  private journal: RunJournal | null = null;
  private ctx: SchedulerContext | null = null;

  async run(graph: ExecutionGraph, ctx: SchedulerContext): Promise<RunResult> {
    this.cancelled = false;
    this.paused = false;
    this.ctx = ctx;

    const status = new Map<string, NodeStatus>();
    for (const id of graph.nodes.keys()) status.set(id, 'pending');

    const completed: string[] = [];
    const failed: string[] = [];
    const blocked: string[] = [];

    this.journal = createJournal(ctx.runId);
    saveJournal(ctx.projectRoot, ctx.runId, this.journal);

    this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId } });
    ctx.auditTrail?.record('run_started', ctx.policyActor ?? 'runtime', {
      runId: ctx.runId,
      detail: { session_id: ctx.sessionId ?? null },
    });

    for (const wave of graph.waves) {
      if (this.cancelled) break;

      // Respect pause: persist journal and return paused result
      if (this.paused) {
        this.journal.scheduler_state = 'paused';
        this.journal.paused_at = new Date().toISOString();
        this.journal.completed_work_items = completed.slice();
        this.journal.failed_work_items = failed.slice();
        this.journal.blocked_work_items = blocked.slice();
        this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
        saveJournal(ctx.projectRoot, ctx.runId, this.journal);
        ctx.auditTrail?.record('run_paused', ctx.policyActor ?? 'runtime', {
          runId: ctx.runId,
          detail: { completed, failed, blocked },
        });
        return { run_id: ctx.runId, status: 'paused', completed, failed, blocked, pending_gates: this.journal.pending_gates.slice() };
      }

      const waveFailed = await this.runWave(
        wave.node_ids,
        graph,
        ctx,
        status,
        completed,
        failed,
        blocked
      );

      // Sync journal after each wave
      this.journal.completed_work_items = completed.slice();
      this.journal.failed_work_items = failed.slice();
      this.journal.blocked_work_items = blocked.slice();
      saveJournal(ctx.projectRoot, ctx.runId, this.journal);

      if (waveFailed) break;
    }

    // Any remaining pending nodes become blocked
    for (const [id, s] of status) {
      if (s === 'pending') {
        status.set(id, 'blocked');
        blocked.push(id);
        this.emit(ctx, {
          type: 'WorkItemBlocked',
          work_item_id: id,
          payload: { reason: 'upstream_wave_failed' },
        });
      }
    }

    const finalStatus: RunResult['status'] = this.cancelled
      ? 'cancelled'
      : failed.length > 0
      ? 'failed'
      : blocked.length > 0
      ? 'blocked'
      : 'completed';

    this.emit(ctx, {
      type: 'RunCompleted',
      payload: { run_id: ctx.runId, status: finalStatus },
    });
    ctx.auditTrail?.record('run_completed', ctx.policyActor ?? 'runtime', {
      runId: ctx.runId,
      detail: {
        status: finalStatus,
        completed: completed.length,
        failed: failed.length,
        blocked: blocked.length,
        pending_gates: this.journal.pending_gates.slice(),
      },
    });

    this.journal.scheduler_state = this.cancelled ? 'cancelled' : finalStatus === 'blocked' ? 'blocked' : 'completed';
    this.journal.completed_work_items = completed.slice();
    this.journal.failed_work_items = failed.slice();
    this.journal.blocked_work_items = blocked.slice();
    saveJournal(ctx.projectRoot, ctx.runId, this.journal);

    return {
      run_id: ctx.runId,
      status: finalStatus,
      completed,
      failed,
      blocked,
      pending_gates: this.journal.pending_gates.slice(),
    };
  }

  /**
   * Recover a previously paused run by loading its journal and re-running
   * only the work items that haven't completed yet.
   */
  async recover(runId: string, ctx: SchedulerContext, graph: ExecutionGraph): Promise<RunResult | null> {
    const journal = loadJournal(ctx.projectRoot, runId);
    if (!journal || journal.scheduler_state !== 'paused') return null;

    // Restore state from journal
    this.cancelled = false;
    this.paused = false;
    this.ctx = ctx;
    this.journal = { ...journal, scheduler_state: 'running', paused_at: null };

    const restoredCompleted = new Set(journal.completed_work_items);
    const restoredFailed = new Set(journal.failed_work_items);
    const restoredBlocked = new Set(journal.blocked_work_items);

    const status = new Map<string, NodeStatus>();
    for (const id of graph.nodes.keys()) {
      if (restoredCompleted.has(id)) status.set(id, 'completed');
      else if (restoredFailed.has(id)) status.set(id, 'failed');
      else if (restoredBlocked.has(id)) status.set(id, 'blocked');
      else status.set(id, 'pending');
    }

    const completed = [...restoredCompleted];
    const failed = [...restoredFailed];
    const blocked = [...restoredBlocked];

    saveJournal(ctx.projectRoot, runId, this.journal);

    this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId, recovered: true } });

    for (const wave of graph.waves) {
      if (this.cancelled) break;
      if (this.paused) {
        this.journal.scheduler_state = 'paused';
        this.journal.paused_at = new Date().toISOString();
        this.journal.completed_work_items = completed.slice();
        this.journal.failed_work_items = failed.slice();
        this.journal.blocked_work_items = blocked.slice();
        this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
        saveJournal(ctx.projectRoot, ctx.runId, this.journal);
        ctx.auditTrail?.record('run_paused', ctx.policyActor ?? 'runtime', {
          runId: ctx.runId,
          detail: { recovered: true, completed, failed, blocked },
        });
        return { run_id: ctx.runId, status: 'paused', completed, failed, blocked, pending_gates: this.journal.pending_gates.slice() };
      }

      // Skip waves fully completed
      const allDone = wave.node_ids.every(
        (id) => restoredCompleted.has(id) || restoredFailed.has(id) || restoredBlocked.has(id)
      );
      if (allDone) continue;

      const waveFailed = await this.runWave(
        wave.node_ids,
        graph,
        ctx,
        status,
        completed,
        failed,
        blocked
      );

      this.journal.completed_work_items = completed.slice();
      this.journal.failed_work_items = failed.slice();
      this.journal.blocked_work_items = blocked.slice();
      saveJournal(ctx.projectRoot, ctx.runId, this.journal);

      if (waveFailed) break;
    }

    for (const [id, s] of status) {
      if (s === 'pending') {
        status.set(id, 'blocked');
        blocked.push(id);
        this.emit(ctx, {
          type: 'WorkItemBlocked',
          work_item_id: id,
          payload: { reason: 'upstream_wave_failed' },
        });
      }
    }

    const finalStatus: RunResult['status'] = this.cancelled
      ? 'cancelled'
      : failed.length > 0
      ? 'failed'
      : blocked.length > 0
      ? 'blocked'
      : 'completed';

    this.emit(ctx, {
      type: 'RunCompleted',
      payload: { run_id: ctx.runId, status: finalStatus, recovered: true },
    });
    ctx.auditTrail?.record('run_recovered', ctx.policyActor ?? 'runtime', {
      runId: ctx.runId,
      detail: {
        status: finalStatus,
        completed: completed.length,
        failed: failed.length,
        blocked: blocked.length,
        pending_gates: this.journal.pending_gates.slice(),
      },
    });

    this.journal.scheduler_state = this.cancelled ? 'cancelled' : finalStatus === 'blocked' ? 'blocked' : 'completed';
    this.journal.completed_work_items = completed.slice();
    this.journal.failed_work_items = failed.slice();
    this.journal.blocked_work_items = blocked.slice();
    saveJournal(ctx.projectRoot, ctx.runId, this.journal);
    deleteJournal(ctx.projectRoot, ctx.runId);

    return {
      run_id: ctx.runId,
      status: finalStatus,
      completed,
      failed,
      blocked,
      pending_gates: this.journal.pending_gates.slice(),
    };
  }

  private async runWave(
    nodeIds: string[],
    graph: ExecutionGraph,
    ctx: SchedulerContext,
    status: Map<string, NodeStatus>,
    completed: string[],
    failed: string[],
    blocked: string[]
  ): Promise<boolean> {
    const eligible: string[] = [];
    const depsNotMet: string[] = [];

    for (const id of nodeIds) {
      if (status.get(id) === 'completed') continue; // already done in recovery
      const node = graph.nodes.get(id)!;
      const depsMet = node.depends_on.every((dep) => status.get(dep) === 'completed');
      if (depsMet) {
        eligible.push(id);
      } else {
        depsNotMet.push(id);
      }
    }

    for (const id of depsNotMet) {
      status.set(id, 'blocked');
      blocked.push(id);
      this.emit(ctx, {
        type: 'WorkItemBlocked',
        work_item_id: id,
        payload: { reason: 'dependency_not_met' },
      });
    }

    const readOnly = eligible.filter((id) => {
      const node = graph.nodes.get(id)!;
      return node.mutation_scope.length === 0;
    });
    const mutations = eligible.filter((id) => !readOnly.includes(id));

    if (readOnly.length > 0) {
      await Promise.all(
        readOnly.map((id) => this.runNode(id, graph, ctx, status, completed, failed, blocked))
      );
    }

    for (const id of mutations) {
      if (this.cancelled) break;
      await this.runNode(id, graph, ctx, status, completed, failed, blocked);
    }

    return failed.length > 0;
  }

  private async runNode(
    nodeId: string,
    graph: ExecutionGraph,
    ctx: SchedulerContext,
    status: Map<string, NodeStatus>,
    completed: string[],
    failed: string[],
    blocked: string[]
  ): Promise<void> {
    const node = graph.nodes.get(nodeId)!;
    status.set(nodeId, 'running');
    this.emit(ctx, {
      type: 'WorkItemReady',
      work_item_id: nodeId,
      payload: { title: node.title, wave: node.wave },
    });

    let lease: WorkspaceLease | null = null;
    let lastResult: TaskResult | null = null;
    const maxAttempts = node.policy.max_retries + 1;
    const quotaBlocked = this.consumeQuotaForNode(ctx, node);
    if (quotaBlocked) {
      this.blockNode(nodeId, ctx, status, blocked, 'quota_exceeded', quotaBlocked);
      return;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptId = `${nodeId}-a${attempt}`;

      this.emit(ctx, {
        type: 'AttemptStarted',
        work_item_id: nodeId,
        attempt_id: attemptId,
        payload: { attempt_number: attempt },
      });

      try {
        const policyDecision = this.evaluatePolicyForNode(node, ctx);
        if (policyDecision && !policyDecision.allowed) {
          this.emit(ctx, {
            type: 'PolicyEvaluated',
            work_item_id: nodeId,
            attempt_id: attemptId,
            payload: { ...policyDecision },
          });
          ctx.auditTrail?.record('policy_denied', ctx.policyActor ?? 'runtime', {
            runId: ctx.runId,
            workItemId: nodeId,
            detail: { reason: policyDecision.reason, rule_id: policyDecision.rule_id },
          });
          this.blockNode(nodeId, ctx, status, blocked, 'policy_denied', policyDecision.reason);
          return;
        }

        if (policyDecision) {
          this.emit(ctx, {
            type: 'PolicyEvaluated',
            work_item_id: nodeId,
            attempt_id: attemptId,
            payload: { ...policyDecision },
          });
        }

        if (policyDecision?.gate_required || node.policy.requires_human_approval) {
          const gateId = await this.requestGateForNode(node, ctx, policyDecision);
          this.blockNode(nodeId, ctx, status, blocked, 'pending_gate', gateId);
          return;
        }

        const wsReq: WorkspaceRequest = {
          work_item_id: nodeId,
          attempt_number: attempt,
          strategy: node.workspace_strategy,
          mutation_scope: node.mutation_scope,
        };
        const workspaceManager = ctx.pluginRegistry?.workspaceProviderFor(node.workspace_strategy) ?? ctx.workspaceManager;
        lease = await workspaceManager.allocate(wsReq);
        this.emit(ctx, {
          type: 'WorkspaceAllocated',
          work_item_id: nodeId,
          attempt_id: attemptId,
          payload: { workspace_id: lease.workspace_id, strategy: lease.strategy },
        });

        lastResult = await this.executeNode(node, lease, ctx, attempt, attemptId);

        if (lastResult.success) {
          this.emit(ctx, {
            type: 'WorkItemCompleted',
            work_item_id: nodeId,
            attempt_id: attemptId,
            payload: { attempt_number: attempt, evidence: lastResult.evidence },
          });
          status.set(nodeId, 'completed');
          completed.push(nodeId);
          return;
        }

        if (lastResult.failure_class === 'policy') break;

        if (attempt < maxAttempts) {
          const retryBlocked = this.consumeRetryQuota(ctx);
          if (retryBlocked) {
            this.blockNode(nodeId, ctx, status, blocked, 'quota_exceeded', retryBlocked);
            return;
          }
          this.emit(ctx, {
            type: 'RetryScheduled',
            work_item_id: nodeId,
            payload: { next_attempt: attempt + 1, reason: lastResult.failure_class },
          });
        }
      } catch (err) {
        lastResult = {
          success: false,
          failure_class: 'env',
          evidence: [],
          output: String(err),
        };
        if (attempt < maxAttempts) {
          this.emit(ctx, {
            type: 'RetryScheduled',
            work_item_id: nodeId,
            payload: { next_attempt: attempt + 1, reason: 'env' },
          });
        }
      } finally {
        if (lease) {
          await ctx.workspaceManager.dispose(lease.workspace_id).catch(() => {});
          lease = null;
        }
      }
    }

    this.emit(ctx, {
      type: 'WorkItemBlocked',
      work_item_id: nodeId,
      payload: { failure_class: lastResult?.failure_class ?? 'env', max_attempts: maxAttempts },
    });
    status.set(nodeId, 'failed');
    failed.push(nodeId);
  }

  pause(): void {
    this.paused = true;
    if (this.journal && this.ctx) {
      this.journal.scheduler_state = 'paused';
      this.journal.paused_at = new Date().toISOString();
      saveJournal(this.ctx.projectRoot, this.ctx.runId, this.journal);
    }
  }

  resume(): void {
    this.paused = false;
    if (this.journal && this.ctx) {
      this.journal.scheduler_state = 'running';
      this.journal.paused_at = null;
      saveJournal(this.ctx.projectRoot, this.ctx.runId, this.journal);
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.journal && this.ctx) {
      this.journal.cancelled = true;
      this.journal.scheduler_state = 'cancelled';
      saveJournal(this.ctx.projectRoot, this.ctx.runId, this.journal);
    }
  }

  getJournal(): RunJournal | null {
    return this.journal;
  }

  static loadJournal(projectRoot: string, runId: string): RunJournal | null {
    return loadJournal(projectRoot, runId);
  }

  private async executeNode(
    node: GraphNode,
    lease: WorkspaceLease,
    ctx: SchedulerContext,
    attempt: number,
    attemptId: string
  ): Promise<TaskResult> {
    const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
    const provider = primaryAction ? ctx.pluginRegistry?.toolProviderFor(primaryAction.type) : null;
    if (!provider || !primaryAction) {
      return ctx.executor.execute(node, lease, ctx.runId, attempt);
    }

    ctx.auditTrail?.record('plugin_invoked', ctx.policyActor ?? 'runtime', {
      runId: ctx.runId,
      workItemId: node.id,
      resource: provider.name,
      detail: { action_type: primaryAction.type, attempt_id: attemptId },
    });
    this.emit(ctx, {
      type: 'ToolInvoked',
      work_item_id: node.id,
      attempt_id: attemptId,
      payload: { provider: provider.name, action_type: primaryAction.type },
    });

    const result = await provider.invoke({
      action_type: primaryAction.type,
      work_item_id: node.id,
      run_id: ctx.runId,
      attempt_id: attemptId,
      params: {
        command: primaryAction.command ?? null,
        targets: primaryAction.targets ?? [],
      },
      workspace_root: lease.root_path,
    });

    this.emit(ctx, {
      type: result.success ? 'ToolCompleted' : 'ToolFailed',
      work_item_id: node.id,
      attempt_id: attemptId,
      payload: {
        provider: provider.name,
        action_type: primaryAction.type,
        evidence_paths: result.evidence_paths,
        side_effects_applied: result.side_effects_applied,
        error: result.error ?? null,
      },
    });

    return {
      success: result.success,
      failure_class: result.success ? null : provider.kind === 'external_operation' ? 'policy' : 'env',
      evidence: result.evidence_paths,
      output: result.output,
    };
  }

  private evaluatePolicyForNode(node: GraphNode, ctx: SchedulerContext): PersistedPolicyDecision | null {
    if (!ctx.policyEngine) return null;
    const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
    const decisionContext: PolicyContext = {
      tool: primaryAction?.type ?? 'custom',
      kind: node.workspace_strategy,
      mutation_scope: node.mutation_scope,
      affected_paths: node.mutation_scope,
      side_effect_class: inferSideEffectClass(node),
      mutation_count: node.mutation_scope.length,
      node_policy: {
        max_retries: node.policy.max_retries,
      },
    };
    const evaluated = ctx.policyEngine.evaluate(decisionContext);
    const persisted: PersistedPolicyDecision = {
      ...evaluated,
      run_id: ctx.runId,
      work_item_id: node.id,
      action: primaryAction?.type ?? 'custom',
      actor: ctx.policyActor ?? 'runtime',
      override: false,
      rationale: null,
      context: decisionContext,
    };
    savePolicyDecision(ctx.projectRoot, persisted);
    return persisted;
  }

  private async requestGateForNode(
    node: GraphNode,
    ctx: SchedulerContext,
    decision: PersistedPolicyDecision | null
  ): Promise<string> {
    if (!ctx.gateManager) return 'gate-missing-manager';
    const scope = inferGateScope(node);
    const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
    const gate = await ctx.gateManager.request(scope, {
      run_id: ctx.runId,
      work_item_id: node.id,
      action: primaryAction?.type ?? 'custom',
      description: `Gate required before executing ${node.id}`,
      evidence_refs: [],
      risks: [decision?.reason ?? 'human approval required'],
      rationale: decision?.reason ?? 'node policy requires approval',
      policy_decision_id: decision?.decision_id ?? null,
    });
    if (this.journal && !this.journal.pending_gates.includes(gate.gate_id)) {
      this.journal.pending_gates.push(gate.gate_id);
    }
    ctx.auditTrail?.record('gate_requested', ctx.policyActor ?? 'runtime', {
      runId: ctx.runId,
      workItemId: node.id,
      detail: { gate_id: gate.gate_id, scope: gate.scope, action: gate.action },
    });
    return gate.gate_id;
  }

  private blockNode(
    nodeId: string,
    ctx: SchedulerContext,
    status: Map<string, NodeStatus>,
    blocked: string[],
    reason: string,
    detail: string | QuotaViolation | null = null
  ): void {
    this.emit(ctx, {
      type: 'WorkItemBlocked',
      work_item_id: nodeId,
      payload: { reason, detail },
    });
    status.set(nodeId, 'blocked');
    if (!blocked.includes(nodeId)) blocked.push(nodeId);
  }

  private consumeQuotaForNode(ctx: SchedulerContext, node: GraphNode): string | null {
    if (!ctx.quota) return null;
    let quota = consumeQuota(ctx.quota, 'work_items', 1);
    if (node.mutation_scope.length > 0) {
      quota = consumeQuota(quota, 'mutations', 1);
    }
    const violation = checkQuota(quota);
    ctx.quota = quota;
    return violation ? `${violation.quota_type}:${violation.consumed}/${violation.limit}` : null;
  }

  private consumeRetryQuota(ctx: SchedulerContext): string | null {
    if (!ctx.quota) return null;
    ctx.quota = consumeQuota(ctx.quota, 'retries', 1);
    const violation = checkQuota(ctx.quota);
    return violation ? `${violation.quota_type}:${violation.consumed}/${violation.limit}` : null;
  }

  private emit(
    ctx: SchedulerContext,
    input: EventInput
  ): void {
    const event = appendEvent(ctx.projectRoot, ctx.sessionId, {
      run_id: ctx.runId,
      ...input,
    });
    ctx.onEvent?.(event);
  }
}

function inferSideEffectClass(node: GraphNode): PolicyContext['side_effect_class'] {
  if (node.mutation_scope.length > 0) return 'write_fs';
  if (node.actions.some((action) => action.type === 'run_tests' || action.type === 'run_lint')) return 'spawn_process';
  return 'read_fs';
}

function pickPrimaryAction(node: GraphNode, pluginRegistry?: PluginRegistry): GraphNode['actions'][number] | undefined {
  const candidateActions = node.actions.filter((action) => action.type !== 'collect_evidence');
  const preferredMutation = candidateActions.find((action) => action.type === 'generate_patch')
    || candidateActions.find((action) => action.type === 'run_tests')
    || candidateActions[0];
  if (!pluginRegistry) return preferredMutation;
  return candidateActions.find((action) => pluginRegistry.toolProviderFor(action.type)) || preferredMutation;
}

function inferGateScope(node: GraphNode): 'critical_mutation' | 'security' | 'plan_approval' {
  if (node.mutation_scope.length > 0) return 'critical_mutation';
  if (node.actions.some((action) => action.type === 'collect_evidence')) return 'security';
  return 'plan_approval';
}
