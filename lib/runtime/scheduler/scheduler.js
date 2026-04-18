"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const bus_1 = require("../events/bus");
class Scheduler {
    constructor() {
        this.cancelled = false;
        this.paused = false;
    }
    async run(graph, ctx) {
        this.cancelled = false;
        this.paused = false;
        const status = new Map();
        for (const id of graph.nodes.keys())
            status.set(id, 'pending');
        const completed = [];
        const failed = [];
        const blocked = [];
        this.emit(ctx, { type: 'RunStarted', payload: { run_id: ctx.runId } });
        for (const wave of graph.waves) {
            if (this.cancelled)
                break;
            const waveFailed = await this.runWave(wave.node_ids, graph, ctx, status, completed, failed, blocked);
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
        return { run_id: ctx.runId, status: finalStatus, completed, failed, blocked };
    }
    async runWave(nodeIds, graph, ctx, status, completed, failed, blocked) {
        // Partition: eligible vs blocked-by-dep
        const eligible = [];
        const depsNotMet = [];
        for (const id of nodeIds) {
            const node = graph.nodes.get(id);
            const depsMet = node.depends_on.every((dep) => status.get(dep) === 'completed');
            if (depsMet) {
                eligible.push(id);
            }
            else {
                depsNotMet.push(id);
            }
        }
        // Nodes whose deps weren't met in this wave → blocked
        for (const id of depsNotMet) {
            status.set(id, 'blocked');
            blocked.push(id);
            this.emit(ctx, {
                type: 'WorkItemBlocked',
                work_item_id: id,
                payload: { reason: 'dependency_not_met' },
            });
        }
        // Separate read-only (no mutation_scope) from mutation nodes
        const readOnly = eligible.filter((id) => {
            const node = graph.nodes.get(id);
            return node.mutation_scope.length === 0;
        });
        const mutations = eligible.filter((id) => !readOnly.includes(id));
        // Run read-only nodes in parallel
        if (readOnly.length > 0) {
            await Promise.all(readOnly.map((id) => this.runNode(id, graph, ctx, status, completed, failed)));
        }
        // Run mutation nodes sequentially to avoid scope conflicts
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
                // Policy failures never retry
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
        // All attempts exhausted
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
    }
    resume() {
        this.paused = false;
    }
    cancel() {
        this.cancelled = true;
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
