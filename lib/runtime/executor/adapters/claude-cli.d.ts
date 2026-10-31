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
}
interface Spawnable {
    file: string;
    args: string[];
    windowsVerbatimArguments: boolean;
}
/** First matching executable on PATH (on Windows also tries .exe/.cmd/.bat), or null. */
export declare function resolveExecutable(command: string, platform?: NodeJS.Platform, envPath?: string): string | null;
/** `.cmd`/`.bat` shims need cmd.exe; everything else is spawned directly (no shell, no re-quoting). */
export declare function buildSpawnable(executable: string, args: string[], platform?: NodeJS.Platform): Spawnable;
export declare function renderTranscript(messages: ChatMessage[]): string;
export declare function buildBridgePrompt(messages: ChatMessage[], tools?: ToolSchema[], retryHint?: boolean): string;
/** Parse the model's reply into content + tool calls; null when it is not the expected JSON. */
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
    private runOnce;
}
export {};
