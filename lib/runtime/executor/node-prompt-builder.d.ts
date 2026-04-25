import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
export declare function buildNodePrompt(node: GraphNode, lease: WorkspaceLease, runId: string, attempt: number): string;
