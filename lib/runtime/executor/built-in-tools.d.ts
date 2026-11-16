import type { ToolSchema } from './stream-completion';
export interface BuiltInToolHandler {
    schema: ToolSchema;
    idempotent: boolean;
    execute(args: Record<string, unknown>, cwd: string): Promise<string>;
}
export declare class PathContainmentError extends Error {
    constructor(candidate: unknown);
}
/**
 * Resolve a tool-supplied path and refuse anything outside the workspace root.
 * The LLM only ever sees relative paths; `..` or an absolute path elsewhere is a violation.
 */
export declare function resolveWithin(cwd: string, candidate: unknown): string;
/**
 * The real path of `p`, following links. For a path that does not exist yet (a new file), the real path of its
 * nearest existing ancestor joined with the rest — a write through a linked directory is resolved too.
 */
export declare function realPathOf(p: string, depth?: number): string;
/** Case-insensitive file systems (Windows, macOS): paths compare in lower case. */
export declare function samePathKey(p: string): string;
/**
 * OxeSpace 14/11 (P0): a command that printed more than ~512 MB (a recursive grep that followed the node_modules
 * junction) made `Buffer.concat(out).toString()` throw ERR_STRING_TOO_LONG and killed the whole run. The output is now
 * bounded: the first and the last `keep` bytes, with the count of what was cut; past `hardLimit` the command is killed.
 */
export declare class BoundedOutput {
    private readonly keep;
    readonly hardLimit: number;
    private head;
    private headBytes;
    private tail;
    private tailBytes;
    total: number;
    constructor(keep?: number, hardLimit?: number);
    push(chunk: Buffer): void;
    get overLimit(): boolean;
    text(): string;
}
/**
 * OxeSpace 14/11 (OxeChat F2 T5): the agent ran `… 2>$null` (PowerShell) through cmd.exe, which created a file named
 * `$null` in the worktree (a ScopeViolation). On Windows, a redirect to `$null` or `/dev/null` goes to `nul`.
 */
export declare function windowsNullRedirects(command: string): string;
export interface FinishTaskGuardResult {
    ok: boolean;
    error?: string | null;
}
/**
 * OXB-C1 Adendo 2: optional synchronous guard checked inside `finish_task` (e.g. file-size cap check)
 * so oversized files fail inside the SAME executor attempt for free instead of ending the attempt and
 * paying for a second attempt after checkpoint failure.
 */
export declare function setFinishTaskGuard(fn: ((cwd: string, args: Record<string, unknown>) => FinishTaskGuardResult | null | undefined) | null): void;
export interface ExecutorQuestion {
    question: string;
    options: string[];
    default?: string | null;
    blocking: boolean;
    task?: string | null;
}
export interface ExecutorAnswer {
    answer?: string | null;
    source?: string | null;
    provisional?: boolean;
    wait?: boolean;
    id?: string | null;
}
/** The orchestrator side (oxe-cc) answers from the artifacts, records decisions, queues what needs a person. */
export declare function setQuestionResolver(fn: ((q: ExecutorQuestion) => ExecutorAnswer) | null): void;
export declare const BUILT_IN_TOOLS: Record<string, BuiltInToolHandler>;
export declare const ALL_BUILT_IN_SCHEMAS: ToolSchema[];
