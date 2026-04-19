"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const bus_1 = require("../events/bus");
const run_journal_1 = require("./run-journal");
class Scheduler {
    constructor() {
        this.cancelled = false;
        this.paused = false;
        this.journal = null;
        this.ctx = null;
    }
    async run(graph, ctx) {
        this.cancelled = false;
        this.paused = false;
        this.ctx = ctx;
        const status = new Map();
        for (const id of graph.nodes.keys())
            status.set(id, 'pending');
        const completed = [];
        const failed = [];
        const blocked = [];
        this.journal = (0, run_journal_1.createJournal)(ctx.runId);
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId } });
        for (const wave of graph.waves) {
            if (this.cancelled)
                break;
            // Respect pause: persist journal and return paused result
            if (this.paused) {
                this.journal.scheduler_state = 'paused';
                this.journal.paused_at = new Date().toISOString();
                this.journal.completed_work_items = completed.slice();
                this.journal.failed_work_items = failed.slice();
                this.journal.blocked_work_items = blocked.slice();
                this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
                (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
                return { run_id: ctx.runId, status: 'paused', completed, failed, blocked };
            }
            const waveFailed = await this.runWave(wave.node_ids, graph, ctx, status, completed, failed, blocked);
            // Sync journal after each wave
            this.journal.completed_work_items = completed.slice();
            this.journal.failed_work_items = failed.slice();
            this.journal.blocked_work_items = blocked.slice();
            (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
            if (waveFailed)
                break;
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
                : 'completed';
        this.emit(ctx, {
            type: 'RunCompleted',
            payload: { run_id: ctx.runId, status: finalStatus },
        });
        this.journal.scheduler_state = this.cancelled ? 'cancelled' : 'completed';
        this.journal.completed_work_items = completed.slice();
        this.journal.failed_work_items = failed.slice();
        this.journal.blocked_work_items = blocked.slice();
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        return { run_id: ctx.runId, status: finalStatus, completed, failed, blocked };
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
                return { run_id: ctx.runId, status: 'paused', completed, failed, blocked };
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
                : 'completed';
        this.emit(ctx, {
            type: 'RunCompleted',
            payload: { run_id: ctx.runId, status: finalStatus, recovered: true },
        });
        this.journal.scheduler_state = this.cancelled ? 'cancelled' : 'completed';
        this.journal.completed_work_items = completed.slice();
        this.journal.failed_work_items = failed.slice();
        this.journal.blocked_work_items = blocked.slice();
        (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        (0, run_journal_1.deleteJournal)(ctx.projectRoot, ctx.runId);
        return { run_id: ctx.runId, status: finalStatus, completed, failed, blocked };
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
        const readOnly = eligible.filter((id) => {
            const node = graph.nodes.get(id);
            return node.mutation_scope.length === 0;
        });
        const mutations = eligible.filter((id) => !readOnly.includes(id));
        if (readOnly.length > 0) {
            await Promise.all(readOnly.map((id) => this.runNode(id, graph, ctx, status, completed, failed)));
        }
        for (const id of mutations) {
            if (this.cancelled)
                break;
            await this.runNode(id, graph, ctx, status, completed, failed);
        }
        return failed.length > 0;
    }
    async runNode(nodeId, graph, ctx, status, completed, failed) {
        const node = graph.nodes.get(nodeId);
        status.set(nodeId, 'running');
        this.emit(ctx, {
            type: 'WorkItemReady',
            work_item_id: nodeId,
            payload: { title: node.title, wave: node.wave },
        });
        let lease = null;
        let lastResult = null;
        const maxAttempts = node.policy.max_retries + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const attemptId = `${nodeId}-a${attempt}`;
            this.emit(ctx, {
                type: 'AttemptStarted',
                work_item_id: nodeId,
                attempt_id: attemptId,
                payload: { attempt_number: attempt },
            });
            try {
                const wsReq = {
                    work_item_id: nodeId,
                    attempt_number: attempt,
                    strategy: node.workspace_strategy,
                    mutation_scope: node.mutation_scope,
                };
                lease = await ctx.workspaceManager.allocate(wsReq);
                this.emit(ctx, {
                    type: 'WorkspaceAllocated',
                    work_item_id: nodeId,
                    attempt_id: attemptId,
                    payload: { workspace_id: lease.workspace_id, strategy: lease.strategy },
                });
                lastResult = await ctx.executor.execute(node, lease, ctx.runId, attempt);
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
                if (lastResult.failure_class === 'policy')
                    break;
                if (attempt < maxAttempts) {
                    this.emit(ctx, {
                        type: 'RetryScheduled',
                        work_item_id: nodeId,
                        payload: { next_attempt: attempt + 1, reason: lastResult.failure_class },
                    });
                }
            }
            catch (err) {
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
            }
            finally {
                if (lease) {
                    await ctx.workspaceManager.dispose(lease.workspace_id).catch(() => { });
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
    emit(ctx, input) {
        const event = (0, bus_1.appendEvent)(ctx.projectRoot, ctx.sessionId, {
            run_id: ctx.runId,
            ...input,
        });
        ctx.onEvent?.(event);
    }
}
exports.Scheduler = Scheduler;
