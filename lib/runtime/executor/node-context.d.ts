import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { ExportedSymbol } from '../verification/contract-exports';
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
    /**
     * Public surface of modules the task consumes (closed program phases + completed dependencies):
     * exports and signatures instead of raw files, so the prompt does not grow with the codebase.
     */
    interfaces?: ModuleInterface[];
    /**
     * Plan-owned acceptance tests for the criteria this task serves (1.19). They are the spec in
     * executable form: implement against them; they are frozen and cannot be edited.
     */
    acceptanceTests?: AcceptanceTestSnapshot[];
    /**
     * Rules the repository enforces on its own (1.21, OXB-020): policy rules, directives from AGENTS.md/CLAUDE.md and
     * the titles of its governance tests (design-lint, allowlists, catalogs). Written right the first time, they never
     * come back as a red CI.
     */
    repoRules?: RepoRule[];
    /** What each closed program phase told the next ones (its dossier handoff), oldest first (1.21). */
    handoffs?: PhaseHandoff[];
    lessons?: string[];
}
export interface PhaseHandoff {
    phase: string;
    text: string;
}
export interface RepoRule {
    /** Where the rule comes from (`tests/design-lint.test.ts`, `AGENTS.md`, `.oxe/config.json`). */
    source: string;
    text: string;
}
export interface AcceptanceTestSnapshot {
    criterion: string;
    path: string;
    command?: string | null;
    content?: string | null;
}
export interface ModuleInterface {
    file: string;
    exports: ExportedSymbol[];
    /** Program phase that delivered it; null for a dependency of the current run. */
    phase?: string | null;
}
export type NodeContextProvider = (node: GraphNode, lease: WorkspaceLease) => NodeExecutionContext | null;
export interface NodeContextBudget {
    taskBody: number;
    contract: number;
    fixture: number;
    filesTotal: number;
    gitStatus: number;
    lessons: number;
    interfaces?: number;
    acceptance?: number;
    repoRules?: number;
    handoffs?: number;
}
export declare const DEFAULT_NODE_CONTEXT_BUDGET: NodeContextBudget;
export declare function truncate(text: string, limit: number): string;
/** Markdown sections appended to the node prompt; empty when there is no context. */
export declare function renderNodeContext(ctx: NodeExecutionContext | null | undefined, budget?: NodeContextBudget): string[];
