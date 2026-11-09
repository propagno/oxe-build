"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
exports.scopesOverlap = scopesOverlap;
exports.classifyFailureOutput = classifyFailureOutput;
exports.quotaResumeAt = quotaResumeAt;
exports.tailLines = tailLines;
exports.segmentTestFiles = segmentTestFiles;
exports.splitVerifySegments = splitVerifySegments;
exports.withAttemptChanges = withAttemptChanges;
exports.buildVerifyLog = buildVerifyLog;
exports.describeVerifyFailure = describeVerifyFailure;
exports.verifyFailureSignature = verifyFailureSignature;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bus_1 = require("../events/bus");
const policy_engine_1 = require("../policy/policy-engine");
const audit_trail_1 = require("../audit/audit-trail");
const run_journal_1 = require("./run-journal");
const decision_memo_1 = require("../decision/decision-memo");
const capability_adapter_1 = require("../plugins/capability-adapter");
const verification_compiler_1 = require("../verification/verification-compiler");
/** Two scopes may touch the same file: equal paths, one a directory prefix of the other, or a glob in either. */
function scopesOverlap(a, b) {
    if (!a.length || !b.length)
        return true;
    const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    const base = (p) => norm(p).split(/[*?[{]/)[0].replace(/\/[^/]*$/, (m) => (/[*?[{]/.test(norm(p)) ? '' : m));
    for (const x of a) {
        for (const y of b) {
            const nx = norm(x);
            const ny = norm(y);
            if (nx === ny)
                return true;
            const gx = /[*?[{]/.test(nx);
            const gy = /[*?[{]/.test(ny);
            const px = gx ? base(nx) : nx;
            const py = gy ? base(ny) : ny;
            if (!px || !py)
                return true;
            if (px === py || px.startsWith(`${py}/`) || py.startsWith(`${px}/`))
                return true;
        }
    }
    return false;
}
class Scheduler {
    constructor() {
        this.cancelled = false;
        this.paused = false;
        this.journal = null;
        this.ctx = null;
        this.runStartMs = 0;
        this.lastProgressMs = 0;
        /** OXB-050: integrations into the program checkout happen one at a time (copy, verify, checkpoint). */
        this.integrationChain = Promise.resolve();
    }
    recordProgress() {
        this.lastProgressMs = Date.now();
    }
    withIntegrationLock(fn) {
        const run = this.integrationChain.then(fn, fn);
        this.integrationChain = run.catch(() => undefined);
        return run;
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
        // OXB-129: stream dispatch — no wave barrier.
        if (ctx.options?.dispatch === 'stream') {
            await this.runStream(graph, ctx, status, completed, failed, blocked, maxRunMs);
        }
        for (const wave of ctx.options?.dispatch === 'stream' ? [] : graph.waves) {
            if (this.cancelled)
                break;
            // Global run timeout
            if (Date.now() - this.runStartMs > maxRunMs) {
                return this.abortRun(ctx, 'global_timeout', completed, failed, blocked);
            }
            // Stale progress timeout (no task completed in staleMs)
            if (Date.now() - this.lastProgressMs > staleMs) {
                return this.abortRun(ctx, 'no_progress_timeout', completed, failed, blocked);
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
            // OXB-138: a task depending (transitively) on a failed/deferred or blocked one does not run.
            const deferMode = ctx.options?.deferFailed === true;
            let waveIds = wave.node_ids;
            if (deferMode) {
                waveIds = [];
                for (const id of wave.node_ids) {
                    const n = graph.nodes.get(id);
                    const bad = (n?.depends_on ?? []).find((d) => status.get(d) === 'failed' || status.get(d) === 'blocked');
                    if (bad && status.get(id) === 'pending')
                        this.blockNode(id, ctx, status, blocked, 'blocked_by_deferred', bad);
                    else
                        waveIds.push(id);
                }
            }
            const failedBefore = failed.length;
            const waveFailed = await this.runWave(waveIds, graph, ctx, status, completed, failed, blocked);
            if (deferMode) {
                for (const id of failed.slice(failedBefore))
                    this.emit(ctx, { type: 'WorkItemDeferred', work_item_id: id, payload: { task: id } });
            }
            // Sync journal after each wave
            this.journal.completed_work_items = completed.slice();
            this.journal.failed_work_items = failed.slice();
            this.journal.blocked_work_items = blocked.slice();
            (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
            if (waveFailed && !deferMode) {
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
            : this.paused // OXB-120: paused inside the last wave (environment / quota)
                ? 'paused'
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
        this.journal.scheduler_state = this.cancelled
            ? 'cancelled'
            : finalStatus === 'blocked' || finalStatus === 'failed'
                ? finalStatus
                : 'completed';
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
        // Paused, blocked (gates since approved), aborted (timeout) and failed runs can all be resumed;
        // only completed/cancelled runs have nothing left to do.
        if (!journal || !RECOVERABLE_JOURNAL_STATES.has(journal.scheduler_state))
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
        this.journal.scheduler_state = this.cancelled
            ? 'cancelled'
            : finalStatus === 'blocked' || finalStatus === 'failed'
                ? finalStatus
                : 'completed';
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
        // A node that may write files but declares no scope is not provably safe to run in parallel
        // (an empty scope used to mean "run everything in parallel, in place").
        if (nodeMayMutate(node))
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
        for (const id of eligible) {
            const node = graph.nodes.get(id);
            // OXB-068: a verify_only / external-dependency node has an enforced empty scope (checked by the caller), not a
            // "may write files" warning.
            const externalNode = Boolean(node.policy.verify_only) || (node.policy.external_dependency?.length ?? 0) > 0;
            if (node.mutation_scope.length === 0 && nodeMayMutate(node) && !externalNode) {
                this.emit(ctx, {
                    type: 'PolicyWarning',
                    work_item_id: id,
                    payload: {
                        reason: 'empty_mutation_scope',
                        detail: 'node may write files but declares no mutation_scope; running serially and without scope checks',
                    },
                });
            }
        }
        const readOnly = eligible.filter((id) => this.isConcurrentSafe(id, graph, ctx));
        const mutations = eligible.filter((id) => !readOnly.includes(id));
        if (readOnly.length > 0) {
            await Promise.all(readOnly.map((id) => this.runNode(id, graph, ctx, status, completed, failed, blocked)));
        }
        if (ctx.parallel && mutations.length > 1) {
            await this.runMutationsInParallel(mutations, graph, ctx, status, completed, failed, blocked);
            return failed.length > 0;
        }
        for (const id of mutations) {
            if (this.cancelled || this.paused)
                break;
            await this.runNode(id, graph, ctx, status, completed, failed, blocked);
        }
        return failed.length > 0;
    }
    /**
     * OXB-129: dispatch by dependency, not by wave. A node is ready when every dependency is completed; one with a failed
     * or blocked dependency is blocked (only its dependents — the rest goes on). Ready nodes start in plan order, up to
     * `parallel.maxParallel` (1 without --parallel-mutating), never two with overlapping scopes (a hot file serializes),
     * and never past the free-memory floor. Every decision is a `DispatchState` event (ready / waiting with the reason).
     */
    async runStream(graph, ctx, status, completed, failed, blocked, maxRunMs) {
        const order = graph.waves.flatMap((w) => w.node_ids);
        const parallel = ctx.parallel;
        const max = parallel ? Math.max(1, Math.floor(parallel.maxParallel || 1)) : 1;
        const running = new Map();
        let lastSignature = '';
        while (!this.cancelled && !this.paused) {
            if (Date.now() - this.runStartMs > maxRunMs)
                break;
            const waiting = [];
            const ready = [];
            for (const id of order) {
                if (status.get(id) !== 'pending' || running.has(id))
                    continue;
                const node = graph.nodes.get(id);
                const bad = node.depends_on.find((d) => status.get(d) === 'failed' || status.get(d) === 'blocked');
                if (bad) {
                    this.blockNode(id, ctx, status, blocked, 'dependency_not_met', bad);
                    continue;
                }
                const open = node.depends_on.filter((d) => status.get(d) !== 'completed');
                if (open.length) {
                    waiting.push({ id, reason: `depende de ${open.join(', ')}` });
                    continue;
                }
                ready.push(id);
            }
            const started = [];
            for (const id of ready) {
                if (running.size >= max) {
                    waiting.push({ id, reason: `limite de paralelismo (${max})` });
                    continue;
                }
                const node = graph.nodes.get(id);
                const hot = [...running.entries()].find(([, r]) => scopesOverlap(r.scope, node.mutation_scope) || (node.mutation_scope.length === 0 && nodeMayMutate(node)));
                if (hot) {
                    waiting.push({ id, reason: `arquivo quente: escopo em comum com ${hot[0]}` });
                    continue;
                }
                if (running.size > 0 && parallel?.minFreeMb && parallel.freeMb && parallel.freeMb() < parallel.minFreeMb) {
                    waiting.push({ id, reason: `memória livre abaixo de ${parallel.minFreeMb} MB` });
                    continue;
                }
                const useParallel = Boolean(parallel) && max > 1;
                const done = this.runNode(id, graph, ctx, status, completed, failed, blocked, useParallel ? { parallel: true } : {})
                    .catch(() => undefined)
                    .finally(() => { running.delete(id); });
                running.set(id, { scope: node.mutation_scope, done });
                started.push(id);
            }
            const signature = JSON.stringify([started, waiting]);
            if (signature !== lastSignature && (started.length || waiting.length)) {
                lastSignature = signature;
                this.emit(ctx, { type: 'DispatchState', payload: { mode: 'stream', started, running: [...running.keys()], waiting } });
                if (this.journal)
                    this.journal.dispatch = { running: [...running.keys()], waiting };
            }
            if (running.size === 0)
                break;
            await Promise.race([...running.values()].map((r) => r.done));
            if (this.journal) {
                this.journal.completed_work_items = completed.slice();
                this.journal.failed_work_items = failed.slice();
                this.journal.blocked_work_items = blocked.slice();
                (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
            }
        }
        if (running.size)
            await Promise.all([...running.values()].map((r) => r.done));
    }
    /** OXB-050: a pool over the wave's mutating nodes — disjoint scopes only, `maxParallel`, memory per agent. */
    async runMutationsInParallel(mutations, graph, ctx, status, completed, failed, blocked) {
        const parallel = ctx.parallel;
        const max = Math.max(1, Math.floor(parallel.maxParallel || 1));
        const pending = [...mutations];
        const running = new Map();
        let memoryWarned = false;
        while ((pending.length > 0 || running.size > 0) && !this.cancelled) {
            for (const id of [...pending]) {
                if (running.size >= max)
                    break;
                const scope = graph.nodes.get(id).mutation_scope;
                if ([...running.values()].some((r) => scopesOverlap(r.scope, scope)))
                    continue;
                if (running.size > 0 && parallel.minFreeMb && parallel.freeMb && parallel.freeMb() < parallel.minFreeMb) {
                    if (!memoryWarned) {
                        memoryWarned = true;
                        this.emit(ctx, { type: 'PolicyWarning', work_item_id: id, payload: { reason: 'parallel_memory', detail: `memória livre abaixo de ${parallel.minFreeMb} MB: o próximo agente espera um terminar` } });
                    }
                    break;
                }
                pending.splice(pending.indexOf(id), 1);
                const done = this.runNode(id, graph, ctx, status, completed, failed, blocked, { parallel: true })
                    .catch(() => undefined)
                    .finally(() => { running.delete(id); });
                running.set(id, { scope, done });
            }
            if (running.size === 0) {
                // Nothing could start (should not happen: one always runs) — fall back to the next one, alone.
                const id = pending.shift();
                if (id)
                    await this.runNode(id, graph, ctx, status, completed, failed, blocked);
                continue;
            }
            await Promise.race([...running.values()].map((r) => r.done));
        }
    }
    async runNode(nodeId, graph, ctx, status, completed, failed, blocked, mode = {}) {
        const node = graph.nodes.get(nodeId);
        const parallelNode = Boolean(mode.parallel && ctx.parallel);
        status.set(nodeId, 'running');
        this.emit(ctx, {
            type: 'WorkItemReady',
            work_item_id: nodeId,
            payload: { title: node.title, wave: node.wave },
        });
        let lease = null;
        // Dispose through the manager that allocated the lease (plugin provider or default).
        let leaseManager = null;
        let lastResult = null;
        let lastError = null;
        // 1.20c: the same verify failure twice (normalized output) = suspect ruler or stuck executor: stop paying retries.
        let lastVerifySignature = null;
        let verifySuspect = false;
        const maxAttempts = node.policy.max_retries + 1;
        // 1.21.1 (OXB-047): work that arrives by another path never pays an agent and never becomes a human gate.
        // An explicit human gate (PLAN.json `gate`) still comes first: the attempt loop requests it as before.
        const humanGatePending = node.policy.requires_human_approval && !this.hasApprovedGate(node, ctx);
        if (!humanGatePending && (node.policy.verify_only || (node.policy.external_dependency?.length ?? 0) > 0)) {
            await this.runExternalNode(node, ctx, status, completed, failed, blocked);
            return;
        }
        const quotaBlocked = this.consumeQuotaForNode(ctx, node);
        if (quotaBlocked) {
            this.blockNode(nodeId, ctx, status, blocked, 'quota_exceeded', quotaBlocked);
            return;
        }
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const attemptId = `${nodeId}-a${attempt}`;
            const attemptModel = ctx.modelFor ? ctx.modelFor(nodeId, attempt, attempt > 1 ? (lastResult?.failure_class ?? null) : null) : null;
            this.emit(ctx, {
                type: 'AttemptStarted',
                work_item_id: nodeId,
                attempt_id: attemptId,
                payload: { attempt_number: attempt, ...(attemptModel ? { model: attemptModel.model, tier: attemptModel.tier, escalated: Boolean(attemptModel.escalated) } : {}) },
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
                if ((policyDecision?.gate_required || node.policy.requires_human_approval) && !this.hasApprovedGate(node, ctx)) {
                    const gateId = await this.requestGateForNode(node, ctx, policyDecision);
                    this.blockNode(nodeId, ctx, status, blocked, 'pending_gate', gateId);
                    return;
                }
                // OXB-023: the run's turn/cost ceiling is checked before every attempt, never in the middle of one.
                const budgetReason = ctx.budget?.exhausted() ?? null;
                if (budgetReason) {
                    this.emit(ctx, {
                        type: 'BudgetExhausted',
                        work_item_id: nodeId,
                        attempt_id: attemptId,
                        payload: { reason: budgetReason, attempt_number: attempt },
                    });
                    this.blockNode(nodeId, ctx, status, blocked, 'budget_exhausted', budgetReason);
                    return;
                }
                const turnsLeft = ctx.budget?.remainingTurns() ?? null;
                const wsReq = {
                    work_item_id: nodeId,
                    attempt_number: attempt,
                    strategy: node.workspace_strategy,
                    mutation_scope: node.mutation_scope,
                };
                const workspaceManager = parallelNode
                    ? ctx.parallel.manager
                    : ctx.pluginRegistry?.workspaceProviderFor(node.workspace_strategy) ?? ctx.workspaceManager;
                leaseManager = workspaceManager;
                lease = await workspaceManager.allocate(wsReq);
                this.emit(ctx, {
                    type: 'WorkspaceAllocated',
                    work_item_id: nodeId,
                    attempt_id: attemptId,
                    payload: { workspace_id: lease.workspace_id, strategy: lease.strategy },
                });
                lastResult = await this.executeNode(node, lease, ctx, attempt, attemptId, {
                    previousError: withAttemptChanges(lastError, attempt > 1 && ctx.attemptChanges ? ctx.attemptChanges(nodeId) : null),
                    ...(attemptModel && attemptModel.model ? { model: attemptModel.model } : {}),
                    ...(turnsLeft != null ? { maxTurns: turnsLeft } : {}),
                });
                // OXB-026: the verify judges the work, not the end of the LLM conversation. An attempt that ran out of turns
                // after writing in its scope is verified before it is classified: green completes the task, red goes to the
                // informed retry. Discarding it unverified paid a whole second attempt for finished work.
                const turnLimitWithWork = !lastResult.success
                    && lastResult.completed_by === 'turn_limit_exhausted'
                    && Boolean(node.verify?.command)
                    && (lastResult.evidence?.length ?? 0) > 0;
                // OXB-171: what the agent itself said (before a verify failure replaces the output).
                const agentOutput = String(lastResult.output || '');
                if (lastResult.success || turnLimitWithWork) {
                    const verifyResult = await this.verifyNode(node, lease, ctx, attemptId, attempt);
                    if (verifyResult && verifyResult.status === 'failed') {
                        // Informed retry: the next attempt sees the command, the reason and the output — not just "failed".
                        lastResult = {
                            success: false,
                            failure_class: 'verify',
                            evidence: lastResult.evidence,
                            output: describeVerifyFailure(node.verify.command, verifyResult.check, verifyResult.gaps, verifyResult.segment),
                            verify_log: buildVerifyLog(verifyResult.segments),
                        };
                        // OXB-120: a verify that failed for the environment (not the code) pauses the run — no attempt is spent.
                        const envClass = classifyFailureOutput(`${verifyResult.check?.error ?? ''}\n${verifyResult.check?.stderr ?? ''}\n${verifyResult.check?.stdout ?? ''}`, verifyResult.check?.exit_code ?? null, ctx.options?.failureClasses);
                        if (envClass && envClass.kind === 'environment') {
                            this.pauseForFailure(ctx, nodeId, 'environment', envClass.diagnosis, null);
                            this.blockNode(nodeId, ctx, status, blocked, 'paused_environment', envClass.diagnosis);
                            return;
                        }
                        // OXB-155: a verify that timed out did not fail — the clock did. It is never "identical_verify_failure".
                        const verifyTimedOut = Boolean(verifyResult.check?.timed_out);
                        const signature = verifyTimedOut ? null : verifyFailureSignature(verifyResult.check);
                        if (signature && signature === lastVerifySignature) {
                            verifySuspect = true;
                            this.emit(ctx, {
                                type: 'VerifyCommandSuspect',
                                work_item_id: nodeId,
                                attempt_id: attemptId,
                                payload: {
                                    attempt_number: attempt,
                                    command: node.verify.command,
                                    excerpt: tailLines(`${verifyResult.check?.error ?? ''}\n${verifyResult.check?.stderr ?? ''}\n${verifyResult.check?.stdout ?? ''}`, 12),
                                    reason: 'identical_verify_failure',
                                },
                            });
                            break;
                        }
                        lastVerifySignature = signature;
                        // OXB-171: the frozen test needs a file outside the task's scope (plan lint) and it is THAT test failing, or
                        // the agent said the change it needs is out of scope → stop now: a retry cannot pass.
                        const scopeReason = scopeInsufficientReason(nodeId, ctx, `${verifyResult.check?.stdout ?? ''}\n${verifyResult.check?.stderr ?? ''}`, agentOutput);
                        if (scopeReason) {
                            lastResult = { ...lastResult, failure_class: 'scope_insufficient' };
                            this.emit(ctx, {
                                type: 'ScopeInsufficient',
                                work_item_id: nodeId,
                                attempt_id: attemptId,
                                payload: { task: nodeId, attempt_number: attempt, ...scopeReason, output_tail: tailLines(`${verifyResult.check?.stdout ?? ''}\n${verifyResult.check?.stderr ?? ''}`, 40) },
                            });
                            lastError = lastResult.output || 'scope_insufficient';
                            break;
                        }
                    }
                    else if (parallelNode) {
                        // OXB-050: green in its worktree → integrate (in-scope files only) and verify again on the integrated tree,
                        // under the integration lock; only then the task completes (and its checkpoint is committed).
                        const attemptLease = lease;
                        const outcome = await this.withIntegrationLock(async () => {
                            const integration = await ctx.parallel.integrate(node, attemptLease);
                            if (integration.outside.length) {
                                this.emit(ctx, {
                                    type: 'ScopeViolation',
                                    work_item_id: nodeId,
                                    attempt_id: attemptId,
                                    payload: { task: nodeId, paths: integration.outside, outcome: 'not_integrated', workspace: 'worktree' },
                                });
                            }
                            if (!integration.ok)
                                return { ok: false, output: `integration_failed: ${integration.error ?? 'unknown'}` };
                            const integrated = await this.verifyNode(node, { ...attemptLease, root_path: ctx.projectRoot }, ctx, attemptId, attempt);
                            if (integrated && integrated.status === 'failed') {
                                await ctx.parallel.discard(integration.files);
                                return {
                                    ok: false,
                                    output: `Verify on the integrated tree failed (it passed in the task's worktree; another task's change may conflict).\n${describeVerifyFailure(node.verify.command, integrated.check, integrated.gaps, integrated.segment)}`,
                                };
                            }
                            this.emit(ctx, {
                                type: 'WorkItemCompleted',
                                work_item_id: nodeId,
                                attempt_id: attemptId,
                                payload: {
                                    attempt_number: attempt,
                                    evidence: lastResult.evidence,
                                    workspace: 'worktree',
                                    integrated_files: integration.files,
                                    ...(turnLimitWithWork ? { completed_by: 'verify_after_turn_limit' } : {}),
                                },
                            });
                            return { ok: true, output: '' };
                        });
                        if (outcome.ok) {
                            status.set(nodeId, 'completed');
                            completed.push(nodeId);
                            this.recordProgress();
                            return;
                        }
                        lastResult = { success: false, failure_class: 'verify', evidence: lastResult.evidence, output: outcome.output };
                    }
                    else {
                        this.emit(ctx, {
                            type: 'WorkItemCompleted',
                            work_item_id: nodeId,
                            attempt_id: attemptId,
                            payload: {
                                attempt_number: attempt,
                                evidence: lastResult.evidence,
                                ...(turnLimitWithWork ? { completed_by: 'verify_after_turn_limit' } : {}),
                            },
                        });
                        status.set(nodeId, 'completed');
                        completed.push(nodeId);
                        this.recordProgress();
                        return;
                    }
                }
                lastError = lastResult.output || (lastResult.failure_class ?? 'unknown error');
                // OXB-171: the agent stopped saying the needed change is outside its files — a retry has the same files.
                if (!lastResult.success && lastResult.failure_class !== 'scope_insufficient' && OUT_OF_SCOPE_RE.test(agentOutput)) {
                    lastResult = { ...lastResult, failure_class: 'scope_insufficient' };
                    this.emit(ctx, {
                        type: 'ScopeInsufficient',
                        work_item_id: nodeId,
                        attempt_id: attemptId,
                        payload: { task: nodeId, attempt_number: attempt, reason: 'agent_reported_out_of_scope', output_tail: tailLines(agentOutput, 40) },
                    });
                    break;
                }
                if (lastResult.failure_class === 'scope_insufficient')
                    break;
                // OXB-125: waiting for a person's answer — never a retry
                if (lastResult.failure_class === 'waiting_answer') {
                    this.blockNode(nodeId, ctx, status, blocked, 'waiting_answer', tailLines(lastResult.output || '', 3));
                    return;
                }
                if (lastResult.failure_class === 'policy')
                    break;
                // OXB-120: a provider usage limit pauses the whole run (every task would hit it), with the reset time when known.
                if (lastResult.failure_class === 'quota') {
                    const diag = tailLines(lastResult.output || '', 3);
                    this.pauseForFailure(ctx, nodeId, 'quota', diag, quotaResumeAt(lastResult.output || ''));
                    this.blockNode(nodeId, ctx, status, blocked, 'paused_quota', diag);
                    return;
                }
                // OXB-148: a prompt that does not fit fails the same way on a blind retry.
                if (lastResult.failure_class === 'context')
                    break;
                // OXB-130: decide the repair before paying another attempt.
                if (attempt < maxAttempts && ctx.repairFor) {
                    const repair = ctx.repairFor(nodeId, { attempt, maxAttempts, failureClass: lastResult.failure_class ?? null, output: String(lastResult.output || ''), verifySuspect });
                    if (repair) {
                        this.emit(ctx, { type: 'RepairDecided', work_item_id: nodeId, attempt_id: attemptId, payload: { strategy: repair.strategy, reason: repair.reason, adjustment: repair.adjustment, attempt_number: attempt } });
                        if (repair.strategy !== 'retry') {
                            this.blockNode(nodeId, ctx, status, blocked, `repair_${repair.strategy}`, repair.reason);
                            return;
                        }
                        if (repair.adjustment)
                            lastError = `${lastError ?? ''}\n\n## Ajuste declarado para esta tentativa\n${repair.adjustment}`;
                    }
                }
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
                        payload: { next_attempt: attempt + 1, reason: lastResult.failure_class, backoff_ms: backoffMs, output_tail: tailLines(lastResult.output || '', 60), ...(lastResult.verify_log ? { verify_log: lastResult.verify_log } : {}) },
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
                        payload: { next_attempt: attempt + 1, reason: 'env', backoff_ms: backoffMs, output_tail: tailLines(lastResult.output || '', 60) },
                    });
                }
            }
            finally {
                if (lease) {
                    await (leaseManager ?? ctx.workspaceManager).dispose(lease.workspace_id).catch((e) => this.emit(ctx, { type: 'WorkspaceDisposeFailed', payload: { workspace_id: lease?.workspace_id, error: String(e) } }));
                    lease = null;
                    leaseManager = null;
                }
            }
        }
        this.emit(ctx, {
            type: 'WorkItemBlocked',
            work_item_id: nodeId,
            payload: { failure_class: verifySuspect ? 'verify_suspect' : lastResult?.failure_class ?? 'env', max_attempts: maxAttempts, output_tail: tailLines(lastResult?.output || '', 60), ...(lastResult?.verify_log ? { verify_log: lastResult.verify_log } : {}) },
        });
        status.set(nodeId, 'failed');
        failed.push(nodeId);
    }
    /** Abort keeps the progress made so far: an aborted run is recoverable, not a blank slate. */
    abortRun(ctx, reason, completed, failed, blocked) {
        this.emit(ctx, { type: 'RunAborted', payload: { reason, completed: completed.slice(), failed: failed.slice(), blocked: blocked.slice() } });
        if (this.journal) {
            this.journal.scheduler_state = 'aborted';
            this.journal.completed_work_items = completed.slice();
            this.journal.failed_work_items = failed.slice();
            this.journal.blocked_work_items = blocked.slice();
            this.journal.partial_result = { run_id: ctx.runId, completed, failed, blocked };
            (0, run_journal_1.saveJournal)(ctx.projectRoot, ctx.runId, this.journal);
        }
        return { run_id: ctx.runId, status: 'aborted', completed, failed, blocked, reason };
    }
    /** OXB-120: pause the run for a failure that is not the task's (environment / quota). */
    pauseForFailure(ctx, nodeId, kind, diagnosis, resumeAt) {
        this.emit(ctx, { type: 'RunPaused', work_item_id: nodeId, payload: { reason: kind, diagnosis, resume_at: resumeAt, task: nodeId } });
        this.pause();
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
        // 1.21.2 (OXB-066): each top-level `&&` segment runs on its own, in order, stopping at the first failure. As one
        // command, `vitest … && tsc --noEmit` failed in tsc but the retry only carried the passing vitest output: the
        // executor never saw the type error (oxespace 1.5.0 T13: 4 attempts, US$ 4.54, 0 completed).
        const segments = splitVerifySegments(node.verify.command);
        const ran = [];
        const gaps = [];
        let status = 'passed';
        let failing = null;
        for (let index = 0; index < segments.length; index++) {
            const command = segments[index];
            const suite = {
                checks: [{
                        id: segments.length > 1 ? `inline-${node.id}-s${index + 1}` : `inline-${node.id}`,
                        type: 'custom',
                        command,
                        evidence_type_expected: 'stdout',
                        acceptance_ref: null,
                        description: `Verify ${node.id}${segments.length > 1 ? ` [${index + 1}/${segments.length}]` : ''}`,
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
                    timeoutMs: ctx.options?.verifyTimeoutMs ?? 600000,
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
                    payload: { status: 'error', error: String(err), failed_segment: { index: index + 1, total: segments.length, command, exit_code: null } },
                });
                return null;
            }
            let segmentRun = { index: index + 1, total: segments.length, command, status: result.status, check: result.check_results?.[0] };
            // OXB-162: the same command, or test files an earlier segment of THIS attempt already passed, failing now is a
            // flaky suspect: rerun once; green → continue (marked), red → the task fails as before.
            if (result.status === 'failed') {
                const files = segmentTestFiles(command);
                const earlier = ran.find((r) => r.status === 'passed' && (r.command === command || (files.length > 0 && files.every((f) => segmentTestFiles(r.command).includes(f)))));
                if (earlier) {
                    let rerun = null;
                    try {
                        rerun = await (0, verification_compiler_1.verifyRun)({
                            suite: { ...suite, checks: suite.checks.map((c) => ({ ...c, id: `${c.id}-rerun` })) },
                            cwd: lease.root_path,
                            timeoutMs: ctx.options?.verifyTimeoutMs ?? 600000,
                            runId: ctx.runId,
                            workItemId: node.id,
                            attemptNumber: attempt,
                            projectRoot: ctx.projectRoot,
                            pluginRegistry: ctx.pluginRegistry,
                        });
                    }
                    catch {
                        rerun = null;
                    }
                    const green = rerun?.status === 'passed';
                    this.emit(ctx, {
                        type: 'VerifyCommandSuspect',
                        work_item_id: node.id,
                        attempt_id: attemptId,
                        payload: { attempt_number: attempt, command, reason: 'flaky_suspect', passed_before_in: earlier.index, rerun: green ? 'passed' : 'failed', excerpt: tailLines(`${segmentRun.check?.stdout ?? ''}\n${segmentRun.check?.stderr ?? ''}`, 12) },
                    });
                    if (green && rerun) {
                        result = rerun;
                        segmentRun = { ...segmentRun, status: 'passed', check: rerun.check_results?.[0], flaky_suspect: true };
                    }
                    else {
                        segmentRun = { ...segmentRun, flaky_suspect: true };
                    }
                }
            }
            ran.push(segmentRun);
            gaps.push(...(result.gaps ?? []));
            if (result.status === 'failed') {
                status = 'failed';
                failing = segmentRun;
                break;
            }
            if (result.status !== 'passed' && status === 'passed')
                status = result.status;
        }
        // OXB-171: the failing segment's own output tail rides in the event (the cause was only found by rerunning by hand).
        const failedSegment = failing
            ? { index: failing.index, total: failing.total, command: failing.command, exit_code: failing.check?.exit_code ?? null, output_tail: tailLines(`${failing.check?.stdout ?? ''}\n${failing.check?.stderr ?? ''}\n${failing.check?.error ?? ''}`, 40) }
            : null;
        this.emit(ctx, {
            type: 'VerificationCompleted',
            work_item_id: node.id,
            attempt_id: attemptId,
            payload: { status, ...(failedSegment ? { failed_segment: failedSegment } : {}) },
        });
        const last = ran[ran.length - 1];
        return {
            status,
            gaps,
            check: failing ? failing.check : last?.check,
            segment: failedSegment,
            segments: ran,
        };
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
    /** An approval already granted for this node in this run must not be requested again on re-execution. */
    hasApprovedGate(node, ctx) {
        if (!ctx.gateManager)
            return false;
        return ctx.gateManager
            .listResolved()
            .some((gate) => gate.work_item_id === node.id && gate.decision === 'approved' && (gate.run_id == null || gate.run_id === ctx.runId));
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
            risks: [decision?.reason ?? node.policy.gate_reason ?? 'human approval required'],
            rationale: decision?.reason ?? node.policy.gate_reason ?? 'node policy requires approval',
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
    /**
     * A node delivered by another path (`verify_only`) or waiting on external work (`external_dependency`): no agent.
     * verify_only runs only the node's verify — green completes it; red (or no verify) leaves it waiting. A node with an
     * external dependency and no verify_only waits without a gate, so the rest of the run (and the next preflight) goes on.
     */
    async runExternalNode(node, ctx, status, completed, failed, blocked) {
        const deps = node.policy.external_dependency ?? [];
        if (node.policy.verify_only && node.verify?.command) {
            const attemptId = `${node.id}-verify-only`;
            const workspaceManager = ctx.pluginRegistry?.workspaceProviderFor(node.workspace_strategy) ?? ctx.workspaceManager;
            const lease = await workspaceManager.allocate({ work_item_id: node.id, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope });
            try {
                const verdict = await this.verifyNode(node, lease, ctx, attemptId, 1);
                if (verdict && verdict.status !== 'failed') {
                    this.emit(ctx, {
                        type: 'WorkItemCompleted',
                        work_item_id: node.id,
                        attempt_id: attemptId,
                        payload: { attempt_number: 1, evidence: [], completed_by: 'verify_only', external_dependency: deps },
                    });
                    status.set(node.id, 'completed');
                    completed.push(node.id);
                    this.recordProgress();
                    return;
                }
            }
            finally {
                await workspaceManager.dispose(lease.workspace_id).catch(() => undefined);
            }
        }
        this.blockNode(node.id, ctx, status, blocked, 'external_dependency', deps.length ? deps.join(', ') : 'verify_only: entrega externa ainda não verificada');
        void failed;
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
const RECOVERABLE_JOURNAL_STATES = new Set(['paused', 'interrupted', 'blocked', 'aborted', 'failed']);
/** Nodes whose actions may write to the workspace (anything beyond reading and collecting evidence). */
function nodeMayMutate(node) {
    return node.actions.some((action) => action.type !== 'read_code' && action.type !== 'collect_evidence');
}
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
/** Last `n` non-empty lines of a text. */
/**
 * OXB-120: a failure that is not the task's logic must not cost an attempt. Environment (exit 126/127, a missing
 * executable, a build artifact not built, a native module for another Node, the network) and quota (a provider usage
 * limit) pause the run with a diagnosis; only `logic` failures consume attempts.
 */
const ENVIRONMENT_RE = /command not found|is not recognized as an internal or external command|ENOENT[^\n]*\b(out|dist|build|\.next|lib)[\\/]|Cannot find module '(?!\.)[^']+'|was compiled against a different Node\.js version|NODE_MODULE_VERSION \d+|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNRESET|socket hang up|ENOSPC|EMFILE|JavaScript heap out of memory/i;
const QUOTA_RE = /usage limit|rate limit|quota exceeded|too many requests|\b429\b|limit reached|resets? at|try again (in|after)/i;
function classifyFailureOutput(output, exitCode, extra) {
    const text = String(output || '');
    const lineOf = (re) => (text.split(/\r?\n/).find((l) => re.test(l)) || '').trim().slice(0, 240);
    const extraRe = (list) => (list || []).map((p) => { try {
        return new RegExp(p, 'i');
    }
    catch {
        return null;
    } }).filter(Boolean);
    for (const re of extraRe(extra?.quota))
        if (re.test(text))
            return { kind: 'quota', diagnosis: lineOf(re) };
    for (const re of extraRe(extra?.environment))
        if (re.test(text))
            return { kind: 'environment', diagnosis: lineOf(re) };
    if (exitCode === 126 || exitCode === 127)
        return { kind: 'environment', diagnosis: lineOf(/./) || `exit ${exitCode}` };
    if (ENVIRONMENT_RE.test(text))
        return { kind: 'environment', diagnosis: lineOf(ENVIRONMENT_RE) };
    return null;
}
function quotaResumeAt(text) {
    const m = /resets? at ([^\n.;]{3,40})|try again (?:in|after) ([^\n.;]{2,30})/i.exec(String(text || ''));
    return m ? (m[1] || m[2]).trim() : null;
}
/** OXB-171: an agent that says the change it needs is outside its files (pt/en). */
const OUT_OF_SCOPE_RE = /\b(out of (my |the task'?s? )?scope|outside (of )?(my |the task'?s? )?(scope|files)|not in (my |the task'?s? )?(files|scope)|fora do (meu |)escopo|fora dos arquivos( da tarefa)?|não está (no|nos) (escopo|arquivos)( da tarefa)?|scope_insufficient)\b/i;
function scopeInsufficientReason(nodeId, ctx, verifyOutput, agentOutput) {
    const req = ctx.options?.outOfScopeRequirements?.[nodeId];
    if (req && req.files.length) {
        const out = String(verifyOutput || '').replace(/\\/g, '/');
        const named = req.tests.filter((t) => out.includes(t) || out.includes(t.split('/').pop() || t));
        if (named.length)
            return { reason: 'frozen_test_needs_out_of_scope_file', files: req.files, tests: named };
    }
    if (OUT_OF_SCOPE_RE.test(agentOutput))
        return { reason: 'agent_reported_out_of_scope' };
    return null;
}
/** OXB-162: git's line-ending notices — they filled F4-T1's whole output tail and hid the failing test. */
const GIT_EOL_NOTICE_RE = /^\s*warning: (in the working copy of .*(LF|CRLF) will be replaced|(LF|CRLF) will be replaced by (CRLF|LF))/i;
/** A failing-test block start (vitest/jest/node:test/mocha/JUnit). */
const FAIL_BLOCK_RE = /^\s*(FAIL\b|×|✗|✖|not ok\b|\d+\) |●\s)/;
const FAIL_ERROR_RE = /AssertionError|Error: expect/;
function tailLines(text, n) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !GIT_EOL_NOTICE_RE.test(l));
    const tail = lines.slice(-n);
    // OXB-162: the last failing-test block, when the tail (summary lines, noise) does not reach it.
    let lastFail = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1)
        if (FAIL_BLOCK_RE.test(lines[i])) {
            lastFail = i;
            break;
        }
    if (lastFail < 0)
        for (let i = lines.length - 1; i >= 0; i -= 1)
            if (FAIL_ERROR_RE.test(lines[i])) {
                lastFail = i;
                break;
            }
    if (lastFail >= 0 && lastFail < lines.length - n) {
        const block = lines.slice(lastFail, Math.min(lastFail + Math.max(10, Math.floor(n / 2)), lines.length - n));
        return [...block, '…', ...tail.slice(-Math.max(1, n - block.length - 1))].join('\n');
    }
    return tail.join('\n');
}
/** OXB-162: the test files a segment names (`x.test.ts`, `y.spec.js`, JVM `--tests` excluded). */
function segmentTestFiles(command) {
    return [...new Set((String(command).match(/[\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?\b/g) || []).map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')))].sort();
}
/**
 * Top-level `&&` segments of a verify command (quoted text is not split). Same rule as the dry-verify (OXB-018), so
 * what the planner checks before execution is what runs after.
 */
function splitVerifySegments(command) {
    const out = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < command.length; i += 1) {
        const ch = command[i];
        if (quote) {
            if (ch === quote)
                quote = null;
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
        }
        else if (ch === '&' && command[i + 1] === '&') {
            if (current.trim())
                out.push(current.trim());
            current = '';
            i += 1;
            continue;
        }
        current += ch;
    }
    if (current.trim())
        out.push(current.trim());
    return out.length ? out : [command];
}
/** OXB-184: the retry text plus what the previous attempt left in the tree. */
function withAttemptChanges(previousError, changes) {
    if (!changes || (!changes.kept.length && !changes.gone.length))
        return previousError;
    const list = (xs) => xs.slice(0, 30).join(', ') + (xs.length > 30 ? ` (+${xs.length - 30})` : '');
    const lines = ['', '## O que a tentativa anterior deixou na árvore'];
    if (changes.kept.length)
        lines.push(`Mantidos (o verify desta tentativa os vê; não refaça sem motivo): ${list(changes.kept)}`);
    if (changes.gone.length)
        lines.push(`Escritos e NÃO mantidos (refaça se ainda forem necessários): ${list(changes.gone)}`);
    return `${previousError ?? ''}${lines.join('\n')}`;
}
/** Every segment's output with a header per segment, for the attempt log (`attempts/<Tn>-<n>.log`). */
function buildVerifyLog(segments, maxLinesPerSegment = 120) {
    return (segments ?? []).map((s) => {
        const check = s.check;
        const exit = check?.exit_code != null ? `exit ${check.exit_code}` : check?.error ? check.error : s.status;
        const body = tailLines(`${check?.stdout ?? ''}\n${check?.stderr ?? ''}`, maxLinesPerSegment);
        return `=== [${s.index}/${s.total}] ${s.command} — ${s.status} (${exit})${s.flaky_suspect ? ' · flaky_suspect (repetido: passou antes nesta tentativa)' : ''} ===\n${body || '(sem saída)'}`;
    }).join('\n\n');
}
function describeVerifyFailure(command, check, gaps, segment) {
    const reason = check?.error || (check?.exit_code != null ? `exit code ${check.exit_code}` : (gaps || []).join('; ') || 'checks did not pass');
    // Only the failing segment's output: the tail of a passing earlier segment never reaches the executor (OXB-066).
    const output = tailLines(`${check?.stdout ?? ''}\n${check?.stderr ?? ''}`, 40);
    const failingLine = segment && segment.total > 1
        ? [`Failing segment [${segment.index}/${segment.total}]: ${segment.command}`, `(segments before it passed; the output below is only from this segment)`]
        : [];
    return [
        'Verification failed after your previous attempt.',
        `Command: ${command ?? '(none)'}`,
        ...failingLine,
        `Reason: ${reason}`,
        output ? `Output (last lines):\n${output.slice(-4000)}` : 'Output: (empty)',
        'Fix the code so this exact command passes. If you are certain the command itself is wrong (not the code), stop and call finish_task explaining why — do not work around it.',
    ].join('\n');
}
/** Normalized failure fingerprint: timings, timestamps, hashes and temp paths removed. */
function verifyFailureSignature(check) {
    if (!check)
        return null;
    const raw = `${check.error ?? ''}\n${check.stderr ?? ''}\n${check.stdout ?? ''}`;
    const normalized = raw
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
        .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, '<t>')
        .replace(/\b[0-9a-f]{7,64}\b/gi, '<hash>')
        .replace(/[A-Za-z]:\\[^\s'"]*|\/tmp\/[^\s'"]*/g, '<path>')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized ? normalized.slice(-1200) : null;
}
