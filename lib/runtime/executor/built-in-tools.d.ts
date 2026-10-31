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
export declare const BUILT_IN_TOOLS: Record<string, BuiltInToolHandler>;
export declare const ALL_BUILT_IN_SCHEMAS: ToolSchema[];
