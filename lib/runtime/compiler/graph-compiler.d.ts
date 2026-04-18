import type { WorkspaceStrategy } from '../models/workspace';
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
export declare function compile(plan: ParsedPlan, spec: ParsedSpec, options?: CompilerOptions): ExecutionGraph;
export declare function validateGraph(graph: ExecutionGraph): string[];
export declare function toSerializable(graph: ExecutionGraph): Record<string, unknown>;
export declare function fromSerializable(raw: Record<string, unknown>): ExecutionGraph;
