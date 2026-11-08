import type { ChatMessage, CompletionResponse, StreamCompletionOptions, ToolCall, ToolSchema } from '../stream-completion';
import type { AdapterDetection, ExecutorAdapter } from './types';
/**
 * `claude -p` (headless Claude Code) as the completion backend, in "bridge" mode: the CLI runs with
 * its own tools disabled and only decides the next step; the runtime executes the tool calls under
 * the node's allowlist and workspace containment. One short-lived process per turn — no HTTP server,
 * no port, no API key (the 1.17 benchmark lost a run when the external bridge process was killed).
 */
export interface ClaudeCliAdapterOptions {
    /** Executable name or path (default: `$OXE_CLAUDE_BIN` or `claude`). */
    command?: string;
    /** Arguments placed before the claude flags — e.g. a node script that stands in for the CLI. */
    prefixArgs?: string[];
    /** `--model` for the CLI; null/empty keeps the CLI default. */
    model?: string | null;
    /** Per-turn timeout (default 5 min). */
    timeoutMs?: number;
    /** Extra attempts when the reply is not the expected JSON (default 2). */
    parseRetries?: number;
    extraArgs?: string[];
    /**
     * Memory gate before every turn: wait until the machine has this much free memory (MB) before spawning
     * `claude -p`. Default `$OXE_EXECUTOR_MIN_FREE_MB` or 0 (off). Shared machines reap processes when memory runs out.
     */
    minFreeMemoryMb?: number;
    /** How long a turn waits for memory before failing the attempt as `env` (default 10 min). */
    memoryWaitMs?: number;
    /** Free memory reader (bytes); tests inject it. */
    freeMemory?: () => number;
    /** Poll interval of the memory gate (default 5 s). */
    memoryPollMs?: number;
    /** OXB-148: hard limit of a bridge prompt in chars (default 1.2M); over it the turn fails fast as `context`. */
    maxPromptChars?: number;
}
interface Spawnable {
    file: string;
    args: string[];
    windowsVerbatimArguments: boolean;
}
/**
 * OXB-148: F2-T1's 2.29M-char prompt was ~1.37M tokens (≈1.7 chars/token for code + Portuguese). The window is 1M
 * tokens; 1.2M chars keeps a margin. Tool results older than the last few are elided from 600k chars on.
 */
export declare const DEFAULT_MAX_PROMPT_CHARS = 1200000;
/** Elides the oldest tool results (keeping the last few) until the conversation fits the soft budget. */
export declare function fitTranscript(messages: ChatMessage[], hardLimit?: number): ChatMessage[];
/** First matching executable on PATH (on Windows also tries .exe/.cmd/.bat), or null. */
export declare function resolveExecutable(command: string, platform?: NodeJS.Platform, envPath?: string): string | null;
/** `.cmd`/`.bat` shims need cmd.exe; everything else is spawned directly (no shell, no re-quoting). */
export declare function buildSpawnable(executable: string, args: string[], platform?: NodeJS.Platform): Spawnable;
export declare function renderTranscript(messages: ChatMessage[]): string;
export declare function buildBridgePrompt(messages: ChatMessage[], tools?: ToolSchema[], retryHint?: boolean): string;
/** Parse the model's reply into content + tool calls; null when it is not the expected JSON. */
/** An adapter failure with what the CLI said, classified (context / quota / llm / env) and the cost already spent. */
export interface CliFailure extends Error {
    kind: 'context' | 'quota' | 'llm' | 'env';
    costUsd: number;
    subtype: string | null;
    exitCode: number | null;
}
export declare function cliFailure(input: {
    code: number | null;
    stdout: string;
    stderr: string;
    envelope: {
        result?: unknown;
        total_cost_usd?: unknown;
        subtype?: unknown;
        is_error?: unknown;
    } | null;
    promptChars?: number;
}): CliFailure;
export declare function parseBridgeReply(text: string): {
    content: string;
    tool_calls: ToolCall[];
} | null;
export declare class ClaudeCliAdapter implements ExecutorAdapter {
    private readonly options;
    readonly id: "claude";
    readonly requiresApiKey = false;
    constructor(options?: ClaudeCliAdapterOptions);
    private get command();
    private executable;
    detect(): AdapterDetection;
    createCompletion(): (opts: StreamCompletionOptions) => Promise<CompletionResponse>;
    private complete;
    /** Pauses the executor while free memory is below the floor; gives up (env failure) after `memoryWaitMs`. */
    private waitForMemory;
    private runOnce;
    private runOnceRaw;
}
export {};
