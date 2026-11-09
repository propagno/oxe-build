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
