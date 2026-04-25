import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { TaskExecutor, TaskResult } from '../scheduler/scheduler';
import type { PluginRegistry } from '../plugins/plugin-registry';
export interface LlmProviderConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    maxTurns?: number;
    timeoutMs?: number;
    systemPrompt?: string;
}
export type LlmExecutorEventType = 'turn_start' | 'turn_complete' | 'tool_call' | 'tool_result' | 'executor_complete';
export interface LlmExecutorEvent {
    type: LlmExecutorEventType;
    nodeId: string;
    attempt: number;
    detail?: Record<string, unknown>;
}
export declare class LlmTaskExecutor implements TaskExecutor {
    private readonly provider;
    private readonly registry?;
    private readonly onProgress?;
    constructor(provider: LlmProviderConfig, registry?: PluginRegistry | undefined, onProgress?: ((event: LlmExecutorEvent) => void) | undefined);
    execute(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number): Promise<TaskResult>;
    private invokeToolCall;
    private emit;
}
