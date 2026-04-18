import crypto from 'crypto';
import type { WorkspaceStrategy } from '../models/workspace';

// Mirror of SDK ParsedTask / ParsedSpec / ParsedPlan interfaces
// (avoids a hard dependency on the CJS SDK from TypeScript source)
export interface ParsedTask {
  id: string;
  title: string;
  wave: number | null;
  dependsOn: string[];
  files: string[];
  verifyCommand: string | null;
  aceite: string[];
  done: boolean;
  meta?: Record<string, unknown> | null;
}

export interface ParsedSpecCriterion {
  id: string;
  criterion: string;
  howToVerify: string;
}

export interface ParsedSpec {
  objective: string | null;
  criteria: ParsedSpecCriterion[];
}

export interface ParsedPlan {
  tasks: ParsedTask[];
  waves: Record<number, string[]>;
  totalTasks: number;
}

export interface Action {
  type: 'read_code' | 'generate_patch' | 'run_tests' | 'run_lint' | 'collect_evidence' | 'custom';
  command?: string;
  targets?: string[];
}

export interface VerifyContract {
  must_pass: string[];
  acceptance_refs: string[];
  command: string | null;
}

export interface NodePolicy {
  requires_human_approval: boolean;
  max_retries: number;
}

export interface GraphNode {
  id: string;
  title: string;
  wave: number;
  depends_on: string[];
  workspace_strategy: WorkspaceStrategy;
  mutation_scope: string[];
  actions: Action[];
  verify: VerifyContract;
  policy: NodePolicy;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'dependency' | 'wave_sequence';
}

export interface Wave {
  wave_number: number;
  node_ids: string[];
}

export interface ExecutionGraphMetadata {
  compiled_at: string;
  plan_hash: string;
  spec_hash: string;
  node_count: number;
  wave_count: number;
}

export interface ExecutionGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  waves: Wave[];
  metadata: ExecutionGraphMetadata;
}

export interface CompilerOptions {
  default_workspace_strategy?: WorkspaceStrategy;
  default_max_retries?: number;
  require_approval_for_all?: boolean;
  skip_done_tasks?: boolean;
}

export function compile(
  plan: ParsedPlan,
  spec: ParsedSpec,
  options: CompilerOptions = {}
): ExecutionGraph {
  const {
    default_workspace_strategy = 'git_worktree',
    default_max_retries = 2,
    require_approval_for_all = false,
    skip_done_tasks = false,
  } = options;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const waveMap = new Map<number, string[]>();

  for (const task of plan.tasks) {
    if (skip_done_tasks && task.done) continue;

    const waveNumber = task.wave ?? 1;
    const node: GraphNode = {
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

    if (!waveMap.has(waveNumber)) waveMap.set(waveNumber, []);
    waveMap.get(waveNumber)!.push(task.id);
  }

  const waves: Wave[] = Array.from(waveMap.entries())
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

export function validateGraph(graph: ExecutionGraph): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.keys());

  for (const [id, node] of graph.nodes) {
    for (const dep of node.depends_on) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node ${id} depends on unknown node ${dep}`);
      }
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    const node = graph.nodes.get(nodeId);
    if (node) {
      for (const dep of node.depends_on) {
        if (hasCycle(dep)) return true;
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

export function toSerializable(graph: ExecutionGraph): Record<string, unknown> {
  return {
    nodes: Object.fromEntries(graph.nodes),
    edges: graph.edges,
    waves: graph.waves,
    metadata: graph.metadata,
  };
}

export function fromSerializable(raw: Record<string, unknown>): ExecutionGraph {
  const nodes = new Map<string, GraphNode>(
    Object.entries(raw.nodes as Record<string, GraphNode>)
  );
  return {
    nodes,
    edges: raw.edges as GraphEdge[],
    waves: raw.waves as Wave[],
    metadata: raw.metadata as ExecutionGraphMetadata,
  };
}

function buildActions(task: ParsedTask): Action[] {
  const actions: Action[] = [];
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

function hashObject(obj: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 12);
}
