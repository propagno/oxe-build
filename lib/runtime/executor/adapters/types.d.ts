import type { CompletionFn } from '../llm-task-executor';
export type ExecutorAdapterId = 'claude' | 'antigravity' | 'http';
export interface AdapterDetection {
    available: boolean;
    version: string | null;
    /** Executable the adapter would spawn, when it spawns one. */
    binary: string | null;
    error: string | null;
}
/**
 * An executor backend. Adapters only supply the completion step ("given the transcript and the
 * tool schemas, return `{content, tool_calls}`"); the tool loop — allowlist, path containment,
 * `no_tool_call` rule — stays in LlmTaskExecutor, so every backend runs under the same guards.
 */
export interface ExecutorAdapter {
    id: ExecutorAdapterId;
    /** Whether `runtime execute` must be given an API key to use this adapter. */
    requiresApiKey: boolean;
    detect(): AdapterDetection;
    createCompletion(): CompletionFn;
}
