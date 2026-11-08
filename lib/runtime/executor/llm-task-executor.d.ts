import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { TaskExecutor, TaskResult } from '../scheduler/scheduler';
import type { PluginRegistry } from '../plugins/plugin-registry';
import { streamCompletion } from './stream-completion';
import type { ToolCall } from './stream-completion';
import type { NodeContextProvider } from './node-context';
export interface LlmProviderConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    maxTurns?: number;
    timeoutMs?: number;
    systemPrompt?: string;
}
export type LlmExecutorEventType = 'turn_start' | 'turn_complete' | 'tool_call' | 'tool_result' | 'tool_denied' | 'executor_complete'
/** Once per attempt: turns, tool calls and backend-reported cost. */
 | 'executor_usage' | 'turn_timeout';
/** Injectable completion function (defaults to the HTTP OpenAI-compatible client). */
export type CompletionFn = typeof streamCompletion;
export interface LlmExecutorEvent {
    type: LlmExecutorEventType;
    nodeId: string;
    attempt: number;
    detail?: Record<string, unknown>;
}
export interface LlmExecuteOptions {
    previousError?: string | null;
    /** Cap from the run budget (OXB-023): the attempt never uses more turns than the run has left. */
    maxTurns?: number | null;
}
export interface LlmTaskExecutorOptions {
    /** Task body, pack contract, workspace snapshot… rendered into the node prompt. */
    contextProvider?: NodeContextProvider | null;
    /**
     * Workspace-relative files the executor may not write (plan-owned acceptance tests, 1.19).
     * `write_file`/`patch_file` on them are denied; anything else that changes them is caught by
     * the verify hash check (`acceptance_tampered`).
     */
    protectedPaths?: string[] | null;
}
export interface ExecutorUsage {
    turns: number;
    tool_calls: number;
    /** Calls per tool name (e.g. how many `run_command`). */
    tools: Record<string, number>;
    cost_usd: number | null;
    /**
     * OXB-118: what the attempt did, for the project's action rules checked after the fact (a command run, a path
     * read or written). Capped; long commands are cut.
     */
    commands?: string[];
    reads?: string[];
    writes?: string[];
}
/** OXB-148: a single tool result kept in the conversation (the rest is cut with a note). */
export declare const TOOL_RESULT_MAX_CHARS = 40000;
export declare function capToolResult(text: string, max?: number): string;
/** Sent before the last turn (OXB-026): finishing and reporting beats spending it on a verification the runtime repeats. */
export declare const LAST_TURN_NOTICE: string;
export declare class LlmTaskExecutor implements TaskExecutor {
    private readonly provider;
    private readonly registry?;
    private readonly onProgress?;
    private readonly complete;
    private readonly options;
    constructor(provider: LlmProviderConfig, registry?: (PluginRegistry | null) | undefined, onProgress?: ((event: LlmExecutorEvent) => void) | null | undefined, complete?: CompletionFn, options?: LlmTaskExecutorOptions);
    execute(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number, options?: LlmExecuteOptions): Promise<TaskResult>;
    private invokeToolCall;
    private isProtected;
    private emit;
}
/** Only tools known to be idempotent run concurrently; anything unknown is treated as a mutation. */
export declare function partitionToolCalls(toolCalls: ToolCall[], registry?: PluginRegistry): [ToolCall[], ToolCall[]];
