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
 | 'executor_usage';
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
}
export interface LlmTaskExecutorOptions {
    /** Task body, pack contract, workspace snapshot… rendered into the node prompt. */
    contextProvider?: NodeContextProvider | null;
}
export interface ExecutorUsage {
    turns: number;
    tool_calls: number;
    cost_usd: number | null;
}
export declare class LlmTaskExecutor implements TaskExecutor {
    private readonly provider;
    private readonly registry?;
    private readonly onProgress?;
    private readonly complete;
    private readonly options;
    constructor(provider: LlmProviderConfig, registry?: (PluginRegistry | null) | undefined, onProgress?: ((event: LlmExecutorEvent) => void) | null | undefined, complete?: CompletionFn, options?: LlmTaskExecutorOptions);
    execute(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number, options?: LlmExecuteOptions): Promise<TaskResult>;
    private invokeToolCall;
    private emit;
}
/** Only tools known to be idempotent run concurrently; anything unknown is treated as a mutation. */
export declare function partitionToolCalls(toolCalls: ToolCall[], registry?: PluginRegistry): [ToolCall[], ToolCall[]];
