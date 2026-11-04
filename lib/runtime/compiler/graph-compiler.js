"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compile = compile;
exports.validateGraph = validateGraph;
exports.toSerializable = toSerializable;
exports.fromSerializable = fromSerializable;
const crypto_1 = __importDefault(require("crypto"));
/** External dependencies of a task (PLAN.json `blocked_by`). */
function taskExternalDependencies(task) {
    const meta = (task.meta ?? {});
    return Array.isArray(meta.blocked_by) ? meta.blocked_by.map(String).filter(Boolean) : [];
}
/** A task delivered by another path: only its verify runs (`kind: verify_only` | `external_delivery`). */
function taskIsVerifyOnly(task) {
    const kind = (task.meta ?? {}).kind;
    return kind === 'verify_only' || kind === 'external_delivery';
}
/** Human gate declared on the task (PLAN.json `gate`); null when none. External dependencies are not human gates. */
function taskHumanGate(task) {
    const gate = (task.meta ?? {}).gate;
    return gate && (gate.reason || gate.kind) ? `${gate.kind ?? 'human'}: ${gate.reason ?? 'aprovação humana'}` : null;
}
/** Gate declared on the task (PLAN.json `gate` / `blocked_by`), as a human-readable reason; null when none. */
function taskGate(task) {
    const meta = (task.meta ?? {});
    const gate = meta.gate;
    const blockedBy = Array.isArray(meta.blocked_by) ? meta.blocked_by.map(String).filter(Boolean) : [];
    const parts = [];
    if (gate && (gate.reason || gate.kind))
        parts.push(`${gate.kind ?? 'human'}: ${gate.reason ?? 'aprovação humana'}`);
    if (blockedBy.length)
        parts.push(`depende de ${blockedBy.join(', ')}`);
    return parts.length ? parts.join(' · ') : null;
}
function compile(plan, spec, options = {}) {
    const { default_workspace_strategy = 'git_worktree', default_max_retries = 2, require_approval_for_all = false, skip_done_tasks = false, } = options;
    const nodes = new Map();
    const edges = [];
    const waveMap = new Map();
    // A done task is not re-run; a dependency on it is already satisfied (replan keeps finished work).
    const skipped = new Set(skip_done_tasks ? plan.tasks.filter((t) => t.done).map((t) => t.id) : []);
    for (const task of plan.tasks) {
        if (skipped.has(task.id))
            continue;
        const waveNumber = task.wave ?? 1;
        const gateReason = taskGate(task);
        const node = {
            id: task.id,
            title: task.title,
            wave: waveNumber,
            depends_on: task.dependsOn.filter((dep) => !skipped.has(dep)),
            workspace_strategy: default_workspace_strategy,
            mutation_scope: task.files,
            actions: buildActions(task),
            verify: {
                must_pass: task.verifyCommand ? (task.aceite.length > 0 ? task.aceite : ['tests']) : [],
                acceptance_refs: task.aceite,
                command: task.verifyCommand,
            },
            policy: {
                // 1.20c (OXB-005): a task-level gate stops the scheduler before it. 1.21.1 (OXB-047): an external dependency
                // (`blocked_by`) blocks only this node and never becomes a human gate.
                requires_human_approval: require_approval_for_all || taskHumanGate(task) !== null,
                max_retries: default_max_retries,
                ...(gateReason ? { gate_reason: gateReason } : {}),
                ...(taskExternalDependencies(task).length ? { external_dependency: taskExternalDependencies(task) } : {}),
                ...(taskIsVerifyOnly(task) ? { verify_only: true } : {}),
            },
        };
        nodes.set(task.id, node);
        for (const dep of task.dependsOn) {
            if (skipped.has(dep))
                continue;
            edges.push({ from: dep, to: task.id, type: 'dependency' });
        }
        if (!waveMap.has(waveNumber))
            waveMap.set(waveNumber, []);
        waveMap.get(waveNumber).push(task.id);
    }
    const waves = Array.from(waveMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([wave_number, node_ids]) => ({ wave_number, node_ids }));
    return {
        nodes,
        edges,
        waves,
        metadata: {
            compiled_at: new Date().toISOString(),
            plan_hash: hashObject(plan),
            spec_hash: hashObject(spec),
            node_count: nodes.size,
            wave_count: waves.length,
        },
    };
}
function validateGraph(graph) {
    const errors = [];
    const nodeIds = new Set(graph.nodes.keys());
    for (const [id, node] of graph.nodes) {
        for (const dep of node.depends_on) {
            if (!nodeIds.has(dep)) {
                errors.push(`Node ${id} depends on unknown node ${dep}`);
            }
        }
    }
    // Detect cycles using DFS
    const visited = new Set();
    const inStack = new Set();
    function hasCycle(nodeId) {
        if (inStack.has(nodeId))
            return true;
        if (visited.has(nodeId))
            return false;
        visited.add(nodeId);
        inStack.add(nodeId);
        const node = graph.nodes.get(nodeId);
        if (node) {
            for (const dep of node.depends_on) {
                if (hasCycle(dep))
                    return true;
            }
        }
        inStack.delete(nodeId);
        return false;
    }
    for (const id of nodeIds) {
        if (hasCycle(id)) {
            errors.push(`Cycle detected involving node ${id}`);
            break;
        }
    }
    // Validate mutation_scope conflicts between parallel nodes in the same wave
    const waveMap = new Map();
    for (const [id, node] of graph.nodes) {
        const list = waveMap.get(node.wave) ?? [];
        waveMap.set(node.wave, [...list, id]);
    }
    for (const [wave, waveNodeIds] of waveMap) {
        for (let i = 0; i < waveNodeIds.length; i++) {
            for (let j = i + 1; j < waveNodeIds.length; j++) {
                const idA = waveNodeIds[i];
                const idB = waveNodeIds[j];
                const a = graph.nodes.get(idA);
                const b = graph.nodes.get(idB);
                const notDependent = !a.depends_on.includes(idB) && !b.depends_on.includes(idA);
                if (notDependent && a.mutation_scope.length > 0 && b.mutation_scope.length > 0) {
                    const overlap = a.mutation_scope.filter(p => b.mutation_scope.includes(p));
                    if (overlap.length > 0) {
                        errors.push(`Wave ${wave}: nodes "${idA}" and "${idB}" mutate the same paths in parallel: ${overlap.join(', ')}`);
                    }
                }
            }
        }
    }
    // Validate wave ordering: a node must only depend on nodes from earlier waves
    for (const [id, node] of graph.nodes) {
        for (const dep of node.depends_on) {
            const depNode = graph.nodes.get(dep);
            if (depNode && depNode.wave >= node.wave) {
                errors.push(`Node "${id}" (wave ${node.wave}) depends on "${dep}" (wave ${depNode.wave}) — dependency must come from an earlier wave`);
            }
        }
    }
    return errors;
}
function toSerializable(graph) {
    return {
        nodes: Object.fromEntries(graph.nodes),
        edges: graph.edges,
        waves: graph.waves,
        metadata: graph.metadata,
    };
}
function fromSerializable(raw) {
    const nodes = new Map(Object.entries(raw.nodes));
    return {
        nodes,
        edges: raw.edges,
        waves: raw.waves,
        metadata: raw.metadata,
    };
}
function buildActions(task) {
    const actions = [];
    if (task.files.length > 0) {
        actions.push({ type: 'read_code', targets: task.files });
    }
    actions.push({ type: 'generate_patch' });
    if (task.verifyCommand) {
        actions.push({ type: 'run_tests', command: task.verifyCommand });
    }
    actions.push({ type: 'collect_evidence' });
    return actions;
}
function hashObject(obj) {
    return crypto_1.default
        .createHash('sha256')
        .update(JSON.stringify(obj))
        .digest('hex')
        .slice(0, 12);
}
