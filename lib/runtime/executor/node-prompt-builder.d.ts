import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
export interface NodePromptOptions {
    previousError?: string | null;
}
export declare function buildNodePrompt(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number, options?: NodePromptOptions): string;
