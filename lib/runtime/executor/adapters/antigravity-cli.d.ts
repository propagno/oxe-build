import type { CompletionResponse, StreamCompletionOptions, ToolCall } from '../stream-completion';
import type { CliFailure } from './claude-cli';
import type { AdapterDetection, ExecutorAdapter } from './types';
/**
 * OXB-197: `agy -p` (Antigravity CLI) as an execution adapter in bridge mode, on parity with `claude` and `http`.
 * Spawns one headless `agy` turn (`--output-format stream-json --disable-slash-commands`), parses NDJSON events
 * (`init`, `step_update`, tool-call events, and terminal `{ status: "SUCCESS" | "ERROR", response, usage }`),
 * and lets `LlmTaskExecutor` enforce scope guards, tool execution, and `ExecutorTurn` heartbeats.
 */
export interface AntigravityCliAdapterOptions {
    /** Executable name or path (default: `$OXE_AGY_BIN` || `$OXE_ANTIGRAVITY_BIN` || `agy`). */
    command?: string;
    /** Arguments placed before the agy flags — e.g. a node script shim in tests. */
    prefixArgs?: string[];
    /** `--model` for the CLI; null/empty keeps Antigravity's default model. */
    model?: string | null;
    /** `--mode` for `agy` (default `'plan'` so host mutating tools stay disabled; null omits `--mode`). */
    mode?: string | null;
    /** `--output-format` for `agy` (default `'stream-json'`). */
    outputFormat?: 'stream-json' | 'json';
    /** Per-turn timeout (default 20 min). */
    timeoutMs?: number;
    /** Extra attempts when the reply is not the expected JSON (default 2). */
    parseRetries?: number;
    extraArgs?: string[];
    /** Maximum prompt length passed directly via `-p <prompt>` before falling back to stdin (default 16_000 chars). */
    maxArgvChars?: number;
    /** Additional environment variable names allowed through `childProcessEnv` scrub. */
    allowEnv?: string[];
    /** Memory gate floor in MB before spawning `agy` (default `$OXE_EXECUTOR_MIN_FREE_MB` or 0). */
    minFreeMemoryMb?: number;
    memoryWaitMs?: number;
    freeMemory?: () => number;
    memoryPollMs?: number;
    /** Hard limit of a bridge prompt in chars (default 1.2M). */
    maxPromptChars?: number;
}
export interface ParsedAntigravityStream {
    events: Array<Record<string, unknown>>;
    conversationId: string | null;
    steps: Array<{
        state: string;
        message: string;
    }>;
    responseText: string;
    structuredOutput: Record<string, unknown> | null;
    toolCalls: ToolCall[];
    isError: boolean;
    subtype: string | null;
    errorMessage: string | null;
    usage: {
        promptTokens: number;
        completionTokens: number;
        thinkingTokens: number;
        totalTokens: number;
        costUsd: number;
    };
}
/**
 * Parses NDJSON (`stream-json`) or single-JSON (`json`) stdout emitted by `agy -p`.
 * Supports:
 *  - `{ type: "init", conversation_id }`
 *  - `{ type: "step_update", state, message }`
 *  - `{ type: "tool_call" | "tool_use", name, arguments | input, id? }` or `{ tool_calls: [...] }`
 *  - `{ status: "SUCCESS" | "ERROR", response, structured_output?, error?, usage? }` (`agy` v1.5+)
 *  - `{ type: "result", is_error, subtype?, result, total_cost_usd?, usage? }`
 */
export declare function parseAntigravityEvents(stdout: string): ParsedAntigravityStream;
export declare function agyFailure(input: {
    code: number | null;
    stdout: string;
    stderr: string;
    parsed?: ParsedAntigravityStream | null;
    promptChars?: number;
}): CliFailure;
export declare function buildAntigravityArgs(prompt: string, options?: {
    prefixArgs?: string[];
    model?: string | null;
    mode?: string | null;
    outputFormat?: 'stream-json' | 'json';
    extraArgs?: string[];
    maxArgvChars?: number;
}): {
    args: string[];
    stdinPrompt: string | null;
};
export declare class AntigravityCliAdapter implements ExecutorAdapter {
    private readonly options;
    readonly id: "antigravity";
    readonly requiresApiKey = false;
    constructor(options?: AntigravityCliAdapterOptions);
    private get command();
    private get allowedEnv();
    private executable;
    detect(): AdapterDetection;
    createCompletion(): (opts: StreamCompletionOptions) => Promise<CompletionResponse>;
    private complete;
    private waitForMemory;
    private runOnce;
}
