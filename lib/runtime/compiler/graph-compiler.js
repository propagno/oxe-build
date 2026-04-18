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
function compile(plan, spec, options = {}) {
    const { default_workspace_strategy = 'git_worktree', default_max_retries = 2, require_approval_for_all = false, skip_done_tasks = false, } = options;
    const nodes = new Map();
    const edges = [];
    const waveMap = new Map();
    for (const task of plan.tasks) {
        if (skip_done_tasks && task.done)
            continue;
        const waveNumber = task.wave ?? 1;
        const node = {
            id: task.id,
            title: task.title,
            wave: waveNumber,
            depends_on: task.dependsOn,
            workspace_strategy: default_workspace_strategy,
            mutation_scope: task.files,
            actions: buildActions(task),
            verify: {
                must_pass: task.verifyCommand ? ['tests'] : [],
                acceptance_refs: task.aceite,
                command: task.verifyCommand,
            },
            policy: {
                requires_human_approval: require_approval_for_all,
                max_retries: default_max_retries,
            },
        };
        nodes.set(task.id, node);
        for (const dep of task.dependsOn) {
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
