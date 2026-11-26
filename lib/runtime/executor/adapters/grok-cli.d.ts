import type { CompletionResponse, StreamCompletionOptions } from '../stream-completion';
import type { CliFailure } from './claude-cli';
import type { AdapterDetection, ExecutorAdapter } from './types';
/**
 * `grok -p` (headless Grok) as the completion backend, in bridge mode. Grok does not read the prompt
 * from stdin, so each turn is a fresh process with `--prompt-file`. Its own tools stay off: the runtime
 * executes the JSON tool calls under the node's allowlist. One short-lived process per turn.
 */
export interface GrokCliAdapterOptions {
    /** Executable name or path (default: `$OXE_GROK_BIN` or `grok`). */
    command?: string;
    /** Arguments placed before the grok flags — e.g. a node script that stands in for the CLI. */
    prefixArgs?: string[];
    /** `--model` for the CLI; null/empty keeps the CLI default. */
    model?: string | null;
    /** Working directory of the project. The prompt file is written under `<cwd>/.oxe/tmp`. */
    cwd?: string;
    /** Per-turn timeout (default 20 min). */
    timeoutMs?: number;
    /** Extra attempts when the reply is not the expected JSON (default 2). */
    parseRetries?: number;
    extraArgs?: string[];
    /** Wait until the machine has this much free memory (MB) before spawning. Default `$OXE_EXECUTOR_MIN_FREE_MB` or 0. */
    minFreeMemoryMb?: number;
    memoryWaitMs?: number;
    freeMemory?: () => number;
    memoryPollMs?: number;
    /** Hard limit of a bridge prompt in chars (default 1.2M). */
    maxPromptChars?: number;
}
export interface GrokJsonResult {
    text?: unknown;
    stopReason?: unknown;
    total_cost_usd?: unknown;
    structuredOutput?: unknown;
    structured_output?: unknown;
    type?: unknown;
    message?: unknown;
    error?: unknown;
}
/** Args after the executable. The prompt itself is never an argv (Windows limit); it is `--prompt-file`. */
export declare function buildGrokArgs(promptFile: string, options?: {
    model?: string | null;
    cwd?: string;
    extraArgs?: string[];
}): string[];
/** The JSON object `grok --output-format json` prints. Null when stdout is not that object. */
export declare function parseGrokStdout(stdout: string): GrokJsonResult | null;
/** The bridge JSON: `structuredOutput` when `--json-schema` filled it, otherwise `text`. */
export declare function grokBridgeText(envelope: GrokJsonResult | null): string;
export declare function grokFailure(input: {
    code: number | null;
    stdout: string;
    stderr: string;
    envelope?: GrokJsonResult | null;
    promptChars?: number;
}): CliFailure;
/**
 * Accept the turn when Grok printed the bridge JSON. A `max_turn_requests` envelope (exit 1) still
 * carries that JSON when the model answered in text and the CLI then reported the turn cap.
 * Refusal, context, hooks and a bare error object stay failures.
 */
export declare function grokTurnOutcome(input: {
    code: number | null;
    stdout: string;
    stderr: string;
    promptChars?: number;
}): {
    ok: true;
    text: string;
    costUsd: number;
} | {
    ok: false;
    error: CliFailure;
};
export declare class GrokCliAdapter implements ExecutorAdapter {
    private readonly options;
    readonly id: "grok";
    readonly requiresApiKey = false;
    constructor(options?: GrokCliAdapterOptions);
    private get command();
    private executable;
    detect(): AdapterDetection;
    createCompletion(): (opts: StreamCompletionOptions) => Promise<CompletionResponse>;
    private complete;
    private waitForMemory;
    private runOnce;
    private writePromptFile;
}
