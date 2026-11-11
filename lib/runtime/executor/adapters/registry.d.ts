import type { AntigravityCliAdapterOptions } from './antigravity-cli';
import type { ClaudeCliAdapterOptions } from './claude-cli';
import type { AdapterDetection, ExecutorAdapter, ExecutorAdapterId } from './types';
export declare const EXECUTOR_ADAPTER_IDS: readonly ExecutorAdapterId[];
export interface AdapterFactoryOptions {
    claude?: ClaudeCliAdapterOptions;
    antigravity?: AntigravityCliAdapterOptions;
}
export declare function normalizeExecutorAdapterId(value: string): ExecutorAdapterId | null;
export declare function isExecutorAdapterId(value: string): value is ExecutorAdapterId;
export declare function createExecutorAdapter(id: ExecutorAdapterId | 'agy', options?: AdapterFactoryOptions): ExecutorAdapter;
/** Detection result for every known adapter (`oxe-cc runtime providers`). */
export declare function detectExecutorAdapters(options?: AdapterFactoryOptions): Array<{
    id: ExecutorAdapterId;
    requires_api_key: boolean;
} & AdapterDetection>;
