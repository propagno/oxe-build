import type { ToolSchema } from './stream-completion';
export interface BuiltInToolHandler {
    schema: ToolSchema;
    idempotent: boolean;
    execute(args: Record<string, unknown>, cwd: string): Promise<string>;
}
export declare const BUILT_IN_TOOLS: Record<string, BuiltInToolHandler>;
export declare const ALL_BUILT_IN_SCHEMAS: ToolSchema[];
