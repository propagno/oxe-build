"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bus_1 = require("../events/bus");
const policy_engine_1 = require("../policy/policy-engine");
const audit_trail_1 = require("../audit/audit-trail");
const run_journal_1 = require("./run-journal");
const decision_memo_1 = require("../decision/decision-memo");
const capability_adapter_1 = require("../plugins/capability-adapter");
const verification_compiler_1 = require("../verification/verification-compiler");
class Scheduler {
    constructor() {
        this.cancelled = false;
        this.paused = false;
        this.journal = null;
        this.ctx = null;
        this.runStartMs = 0;
        this.lastProgressMs = 0;
    }
    recordProgress() {
        this.lastProgressMs = Date.now();
    }
    async executeRollback(plan, ctx) {
        try {
            switch (plan.strategy) {
                case 'revert_commit':
                    await (0, capability_adapter_1.runCapabilityAsync)('git', ['revert', 'HEAD', '--no-edit'], {}, ctx.projectRoot, 30000);
                    break;
                case 'restore_workspace':
                    await (0, capability_adapter_1.runCapabilityAsync)('git', ['checkout', '.'], {}, ctx.projectRoot, 30000);
                    break;
                case 'undo_patch':
                    for (const p of plan.steps) {
                        await (0, capability_adapter_1.runCapabilityAsync)('git', ['checkout', 'HEAD', '--', p], {}, ctx.projectRoot, 10000);
                    }
                    break;
                case 'no_rollback':
                default:
                    break;
            }
            this.emit(ctx, { type: 'RollbackExecuted', payload: { strategy: plan.strategy } });
        }
        catch (err) {
            this.emit(ctx, { type: 'RollbackFailed', payload: { strategy: plan.strategy, error: String(err) } });
        }
    }
    async run(graph, ctx) {
        this.cancelled = false;
        this.paused = false;
        this.ctx = ctx;
        this.runStartMs = Date.now();
        this.lastProgressMs = Date.now();
        const status = new Map();
        for (const id of graph.nodes.keys())
            status.set(id, 'pending');
        const completed = [];
        const failed = [];
        const blocked = [];
        // Plan hash drift detection: abort if the graph was recompiled since ACTIVE-RUN was saved
        const activeRunPath = ctx.sessionId
            ? path_1.default.join(ctx.projectRoot, '.oxe', ctx.sessionId, 'execution', 'ACTIVE-RUN.json')
            : path_1.default.join(ctx.projectRoot, '.oxe', 'ACTIVE-RUN.json');
        if (fs_1.default.existsSync(activeRunPath)) {
            try {
                const activeRun = JSON.parse(fs_1.default.readFileSync(activeRunPath, 'utf8'));
                const savedHash = activeRun.plan_hash;
                const currentHash = graph.metadata.plan_hash;
                if (savedHash && savedHash !== currentHash) {
                    return {
                        run_id: ctx.runId,
                        status: 'aborted',
                        completed: [],
                        failed: [],
                        blocked: [],
                        reason: `plan_drift: graph recompiled (${savedHash} → ${currentHash}). Run /oxe-plan --replan to realign.`,
                    };
                }
            }
            catch {
                // ACTIVE-RUN not parseable — continue without drift check
            }
        }
        this.journal = (0, run_journal_1.createJournal)(ctx.runId);
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId } });
        ctx.auditTrail?.record('run_started', ctx.policyActor ?? 'runtime', {
            runId: ctx.runId,
            detail: { session_id: ctx.sessionId ?? null },
        });
        const maxRunMs = ctx.options?.maxRunDurationMs ?? 30 * 60000;
        const staleMs = ctx.options?.staleProgressMs ?? 5 * 60000;
        for (const wave of graph.waves) {
            if (this.cancelled)
                break;
            // Global run timeout
            if (Date.now() - this.runStartMs > maxRunMs) {
                this.emit(ctx, { type: 'RunAborted', payload: { reason: 'global_timeout' } });
                return { run_id: ctx.runId, status: 'aborted', completed: [], failed: [], blocked: [], reason: 'global_timeout' };
            }
            // Stale progress timeout (no task completed in staleMs)
            if (Date.now() - this.lastProgressMs > staleMs) {
                this.emit(ctx, { type: 'RunAborted', payload: { reason: 'no_progress_timeout' } });
                return { run_id: ctx.runId, status: 'aborted', completed: [], failed: [], blocked: [], reason: 'no_progress_timeout' };
            }
            // Respect pause: persist journal and return paused result
            if (this.paused) {
                this.journal.scheduler_state = 'paused';
                this.journal.paused_at = new Date().toISOString();
                this.journal.completed_work_items = completed.slice();
                this.journal.failed_work_items = failed.slice();
                this.journal.blocked_work_items = blocked.slice();
                this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
                (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
                ctx.auditTrail?.record('run_paused', ctx.policyActor ?? 'runtime', {
                    runId: ctx.runId,
                    detail: { completed, failed, blocked },
                });
                return { run_id: ctx.runId, status: 'paused', completed, failed, blocked, pending_gates: this.journal.pending_gates.slice() };
            }
            const waveFailed = await this.runWave(wave.node_ids, graph, ctx, status, completed, failed, blocked);
            // Sync journal after each wave
            this.journal.completed_work_items = completed.slice();
            this.journal.failed_work_items = failed.slice();
            this.journal.blocked_work_items = blocked.slice();
            (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
            if (waveFailed) {
                // Execute rollback plan if one was created for this run
                const memos = (0, decision_memo_1.listMemos)(ctx.projectRoot, ctx.runId);
                for (const memo of memos) {
                    if (memo.rollback_plan.strategy !== 'no_rollback') {
                        await this.executeRollback(memo.rollback_plan, ctx);
                        break; // apply at most one rollback plan per wave failure
                    }
                }
                break;
            }
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
        const finalStatus = this.cancelled
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
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
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
    async recover(runId, ctx, graph) {
        const journal = (0, run_journal_1.loadJournal)(ctx.projectRoot, runId);
        if (!journal || journal.scheduler_state !== 'paused')
            return null;
        // Restore state from journal
        this.cancelled = false;
        this.paused = false;
        this.ctx = ctx;
        this.journal = { ...journal, scheduler_state: 'running', paused_at: null };
        const restoredCompleted = new Set(journal.completed_work_items);
        const restoredFailed = new Set(journal.failed_work_items);
        const restoredBlocked = new Set(journal.blocked_work_items);
        const status = new Map();
        for (const id of graph.nodes.keys()) {
            if (restoredCompleted.has(id))
                status.set(id, 'completed');
            else if (restoredFailed.has(id))
                status.set(id, 'failed');
            else if (restoredBlocked.has(id))
                status.set(id, 'blocked');
            else
                status.set(id, 'pending');
        }
        const completed = [...restoredCompleted];
        const failed = [...restoredFailed];
        const blocked = [...restoredBlocked];
        (0, run_journal_1.saveJournal)(ctx.projectRoot, runId, this.journal);
        this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId, recovered: true } });
        for (const wave of graph.waves) {
            if (this.cancelled)
                break;
            if (this.paused) {
                this.journal.scheduler_state = 'paused';
                this.journal.paused_at = new Date().toISOString();
                this.journal.completed_work_items = completed.slice();
                this.journal.failed_work_items = failed.slice();
                this.journal.blocked_work_items = blocked.slice();
                this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
                (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
                ctx.auditTrail?.record('run_paused', ctx.policyActor ?? 'runtime', {
                    runId: ctx.runId,
                    detail: { recovered: true, completed, failed, blocked },
                });
                return { run_id: ctx.runId, status: 'paused', completed, failed, blocked, pending_gates: this.journal.pending_gates.slice() };
            }
            // Skip waves fully completed
            const allDone = wave.node_ids.every((id) => restoredCompleted.has(id) || restoredFailed.has(id) || restoredBlocked.has(id));
            if (allDone)
                continue;
            const waveFailed = await this.runWave(wave.node_ids, graph, ctx, status, completed, failed, blocked);
            this.journal.completed_work_items = completed.slice();
            this.journal.failed_work_items = failed.slice();
            this.journal.blocked_work_items = blocked.slice();
            (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
            if (waveFailed)
                break;
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
        const finalStatus = this.cancelled
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
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        (0, run_journal_1.deleteJournal)(ctx.projectRoot, ctx.runId);
        return {
            run_id: ctx.runId,
            status: finalStatus,
            completed,
            failed,
            blocked,
            pending_gates: this.journal.pending_gates.slice(),
        };
    }
    isConcurrentSafe(nodeId, graph, ctx) {
        const node = graph.nodes.get(nodeId);
        if (node.mutation_scope.length > 0)
            return false;
        const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
        if (!primaryAction)
            return true;
        const provider = ctx.pluginRegistry?.toolProviderFor(primaryAction.type);
        return provider?.idempotent ?? true;
    }
    async runWave(nodeIds, graph, ctx, status, completed, failed, blocked) {
        const eligible = [];
        const depsNotMet = [];
        for (const id of nodeIds) {
            if (status.get(id) === 'completed')
                continue; // already done in recovery
            const node = graph.nodes.get(id);
            const depsMet = node.depends_on.every((dep) => status.get(dep) === 'completed');
            if (depsMet) {
                eligible.push(id);
            }
            else {
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
        const readOnly = eligible.filter((id) => this.isConcurrentSafe(id, graph, ctx));
        const mutations = eligible.filter((id) => !readOnly.includes(id));
        if (readOnly.length > 0) {
            await Promise.all(readOnly.map((id) => this.runNode(id, graph, ctx, status, completed, failed, blocked)));
        }
        for (const id of mutations) {
            if (this.cancelled)
                break;
            await this.runNode(id, graph, ctx, status, completed, failed, blocked);
        }
        return failed.length > 0;
    }
    async runNode(nodeId, graph, ctx, status, completed, failed, blocked) {
        const node = graph.nodes.get(nodeId);
        status.set(nodeId, 'running');
        this.emit(ctx, {
            type: 'WorkItemReady',
            work_item_id: nodeId,
            payload: { title: node.title, wave: node.wave },
        });
        let lease = null;
        let lastResult = null;
        let lastError = null;
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
                const wsReq = {
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
                lastResult = await this.executeNode(node, lease, ctx, attempt, attemptId, { previousError: lastError });
                if (lastResult.success) {
                    const verifyResult = await this.verifyNode(node, lease, ctx, attemptId, attempt);
                    if (verifyResult && verifyResult.status === 'failed') {
                        lastResult = {
                            success: false,
                            failure_class: 'verify',
                            evidence: lastResult.evidence,
                            output: `Verification failed: ${(verifyResult.gaps || []).join('; ') || 'checks did not pass'}`,
                        };
                    }
                    else {
                        this.emit(ctx, {
                            type: 'WorkItemCompleted',
                            work_item_id: nodeId,
                            attempt_id: attemptId,
                            payload: { attempt_number: attempt, evidence: lastResult.evidence },
                        });
                        status.set(nodeId, 'completed');
                        completed.push(nodeId);
                        this.recordProgress();
                        return;
                    }
                }
                lastError = lastResult.output || (lastResult.failure_class ?? 'unknown error');
                if (lastResult.failure_class === 'policy')
                    break;
                if (attempt < maxAttempts) {
                    const retryBlocked = this.consumeRetryQuota(ctx);
                    if (retryBlocked) {
                        this.blockNode(nodeId, ctx, status, blocked, 'quota_exceeded', retryBlocked);
                        return;
                    }
                    // Exponential backoff with jitter: 1s * 2^(attempt-1) + [0, 500ms], capped at 30s
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 30000);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    this.emit(ctx, {
                        type: 'RetryScheduled',
                        work_item_id: nodeId,
                        payload: { next_attempt: attempt + 1, reason: lastResult.failure_class, backoff_ms: backoffMs },
                    });
                }
            }
            catch (err) {
                // Error boundary: isolate task failure, emit structured event, do not crash scheduler
                const message = err instanceof Error ? err.message : String(err);
                const stack = err instanceof Error ? err.stack : undefined;
                this.emit(ctx, {
                    type: 'TaskErrorBoundaryTripped',
                    work_item_id: nodeId,
                    payload: { message, stack, attempt },
                });
                lastResult = {
                    success: false,
                    failure_class: 'env',
                    evidence: [],
                    output: `[error_boundary] ${message}`,
                };
                lastError = lastResult.output;
                if (attempt < maxAttempts) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 30000);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    this.emit(ctx, {
                        type: 'RetryScheduled',
                        work_item_id: nodeId,
                        payload: { next_attempt: attempt + 1, reason: 'env', backoff_ms: backoffMs },
                    });
                }
            }
            finally {
                if (lease) {
                    await ctx.workspaceManager.dispose(lease.workspace_id).catch((e) => this.emit(ctx, { type: 'WorkspaceDisposeFailed', payload: { workspace_id: lease?.workspace_id, error: String(e) } }));
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
    pause() {
        this.paused = true;
        if (this.journal && this.ctx) {
            this.journal.scheduler_state = 'paused';
            this.journal.paused_at = new Date().toISOString();
            (0, run_journal_1.saveJournal)(this.ctx.projectRoot, this.ctx.runId, this.journal);
        }
    }
    resume() {
        this.paused = false;
        if (this.journal && this.ctx) {
            this.journal.scheduler_state = 'running';
            this.journal.paused_at = null;
            (0, run_journal_1.saveJournal)(this.ctx.projectRoot, this.ctx.runId, this.journal);
        }
    }
    cancel() {
        this.cancelled = true;
        if (this.journal && this.ctx) {
            this.journal.cancelled = true;
            this.journal.scheduler_state = 'cancelled';
            (0, run_journal_1.saveJournal)(this.ctx.projectRoot, this.ctx.runId, this.journal);
        }
    }
    getJournal() {
        return this.journal;
    }
    static loadJournal(projectRoot, runId) {
        return (0, run_journal_1.loadJournal)(projectRoot, runId);
    }
    async executeNode(node, lease, ctx, attempt, attemptId, options = {}) {
        const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
        const provider = primaryAction ? ctx.pluginRegistry?.toolProviderFor(primaryAction.type) : null;
        if (!provider || !primaryAction) {
            return ctx.executor.execute(node, lease, ctx.runId, attempt, options);
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
        const invocationInput = {
            action_type: primaryAction.type,
            work_item_id: node.id,
            run_id: ctx.runId,
            attempt_id: attemptId,
            params: {
                command: primaryAction.command ?? null,
                targets: primaryAction.targets ?? [],
            },
            workspace_root: lease.root_path,
        };
        if (provider.preInvoke) {
            const preCheck = await provider.preInvoke(invocationInput);
            if (!preCheck.allowed) {
                this.emit(ctx, {
                    type: 'ToolFailed',
                    work_item_id: node.id,
                    attempt_id: attemptId,
                    payload: { provider: provider.name, action_type: primaryAction.type, error: preCheck.reason ?? 'pre_invoke blocked', evidence_paths: [], side_effects_applied: [] },
                });
                return { success: false, failure_class: 'policy', evidence: [], output: preCheck.reason ?? 'pre_invoke blocked' };
            }
        }
        const result = await provider.invoke(invocationInput);
        if (provider.postInvoke) {
            await provider.postInvoke(invocationInput, result).catch(() => { });
        }
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
    async verifyNode(node, lease, ctx, attemptId, attempt) {
        if (!node.verify?.command)
            return null;
        this.emit(ctx, {
            type: 'VerificationStarted',
            work_item_id: node.id,
            payload: { command: node.verify.command, attempt_number: attempt },
        });
        const suite = {
            checks: [{
                    id: `inline-${node.id}`,
                    type: 'custom',
                    command: node.verify.command,
                    evidence_type_expected: 'stdout',
                    acceptance_ref: null,
                    description: `Verify ${node.id}`,
                }],
            compiled_at: new Date().toISOString(),
            spec_hash: '',
            plan_hash: '',
        };
        let result;
        try {
            result = await (0, verification_compiler_1.verifyRun)({
                suite,
                cwd: lease.root_path,
                timeoutMs: ctx.options?.verifyTimeoutMs ?? 60000,
                runId: ctx.runId,
                workItemId: node.id,
                attemptNumber: attempt,
                projectRoot: ctx.projectRoot,
                pluginRegistry: ctx.pluginRegistry,
            });
        }
        catch (err) {
            this.emit(ctx, {
                type: 'VerificationCompleted',
                work_item_id: node.id,
                attempt_id: attemptId,
                payload: { status: 'error', error: String(err) },
            });
            return null;
        }
        this.emit(ctx, {
            type: 'VerificationCompleted',
            work_item_id: node.id,
            attempt_id: attemptId,
            payload: { status: result.status },
        });
        return result;
    }
    evaluatePolicyForNode(node, ctx) {
        if (!ctx.policyEngine)
            return null;
        const primaryAction = pickPrimaryAction(node, ctx.pluginRegistry);
        const decisionContext = {
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
        const persisted = {
            ...evaluated,
            run_id: ctx.runId,
            work_item_id: node.id,
            action: primaryAction?.type ?? 'custom',
            actor: ctx.policyActor ?? 'runtime',
            override: false,
            rationale: null,
            context: decisionContext,
        };
        (0, policy_engine_1.savePolicyDecision)(ctx.projectRoot, persisted);
        return persisted;
    }
    async requestGateForNode(node, ctx, decision) {
        if (!ctx.gateManager) {
            console.warn('[scheduler] ctx.gateManager not configured — gates will not be persisted');
            return 'gate-missing-manager';
        }
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
    blockNode(nodeId, ctx, status, blocked, reason, detail = null) {
        this.emit(ctx, {
            type: 'WorkItemBlocked',
            work_item_id: nodeId,
            payload: { reason, detail },
        });
        status.set(nodeId, 'blocked');
        if (!blocked.includes(nodeId))
            blocked.push(nodeId);
    }
    consumeQuotaForNode(ctx, node) {
        if (!ctx.quota)
            return null;
        let quota = (0, audit_trail_1.consumeQuota)(ctx.quota, 'work_items', 1);
        if (node.mutation_scope.length > 0) {
            quota = (0, audit_trail_1.consumeQuota)(quota, 'mutations', 1);
        }
        const violation = (0, audit_trail_1.checkQuota)(quota);
        ctx.quota = quota;
        return violation ? `${violation.quota_type}:${violation.consumed}/${violation.limit}` : null;
    }
    consumeRetryQuota(ctx) {
        if (!ctx.quota)
            return null;
        ctx.quota = (0, audit_trail_1.consumeQuota)(ctx.quota, 'retries', 1);
        const violation = (0, audit_trail_1.checkQuota)(ctx.quota);
        return violation ? `${violation.quota_type}:${violation.consumed}/${violation.limit}` : null;
    }
    emit(ctx, input) {
        const event = (0, bus_1.appendEvent)(ctx.projectRoot, ctx.sessionId, {
            run_id: ctx.runId,
            ...input,
        });
        ctx.onEvent?.(event);
    }
}
exports.Scheduler = Scheduler;
function inferSideEffectClass(node) {
    if (node.mutation_scope.length > 0)
        return 'write_fs';
    if (node.actions.some((action) => action.type === 'run_tests' || action.type === 'run_lint'))
        return 'spawn_process';
    return 'read_fs';
}
function pickPrimaryAction(node, pluginRegistry) {
    const candidateActions = node.actions.filter((action) => action.type !== 'collect_evidence');
    const preferredMutation = candidateActions.find((action) => action.type === 'generate_patch')
        || candidateActions.find((action) => action.type === 'run_tests')
        || candidateActions[0];
    if (!pluginRegistry)
        return preferredMutation;
    return candidateActions.find((action) => pluginRegistry.toolProviderFor(action.type)) || preferredMutation;
}
function inferGateScope(node) {
    if (node.mutation_scope.length > 0)
        return 'critical_mutation';
    if (node.actions.some((action) => action.type === 'collect_evidence'))
        return 'security';
    return 'plan_approval';
}
