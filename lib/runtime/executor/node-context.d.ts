import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
/**
 * What the executor knows about a node beyond its title and actions. Without it every attempt spent
 * turns rediscovering the workspace and drifted from the IMPLEMENTATION-PACK (1.17 benchmark, T3).
 */
export interface WorkspaceFileSnapshot {
    path: string;
    exists: boolean;
    bytes?: number;
    /** First lines of the file, already truncated. */
    head?: string;
}
export interface NodeExecutionContext {
    /** The task's own section of PLAN.md. */
    taskBody?: string | null;
    /** The task's IMPLEMENTATION-PACK entry (paths, symbols, contracts). */
    implementationContract?: unknown;
    /** The task's FIXTURE-PACK entry. */
    fixture?: unknown;
    /** Files in the task's scope and contract, as they are now. */
    workspaceFiles?: WorkspaceFileSnapshot[];
    /** `git status --porcelain` of the workspace. */
    gitStatus?: string | null;
    lessons?: string[];
}
export type NodeContextProvider = (node: GraphNode, lease: WorkspaceLease) => NodeExecutionContext | null;
export interface NodeContextBudget {
    taskBody: number;
    contract: number;
    fixture: number;
    filesTotal: number;
    gitStatus: number;
    lessons: number;
}
export declare const DEFAULT_NODE_CONTEXT_BUDGET: NodeContextBudget;
export declare function truncate(text: string, limit: number): string;
/** Markdown sections appended to the node prompt; empty when there is no context. */
export declare function renderNodeContext(ctx: NodeExecutionContext | null | undefined, budget?: NodeContextBudget): string[];
