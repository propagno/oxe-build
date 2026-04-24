import type { Action } from '../compiler/graph-compiler';
import type { ToolSchema } from './stream-completion';
export declare function selectToolsForActions(actions: Action[]): ToolSchema[];
