import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { NodeExecutionContext } from './node-context';
export interface NodePromptOptions {
    previousError?: string | null;
    context?: NodeExecutionContext | null;
}
export declare function buildNodePrompt(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number, options?: NodePromptOptions): string;
