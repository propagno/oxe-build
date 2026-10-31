import type { ClaudeCliAdapterOptions } from './claude-cli';
import type { AdapterDetection, ExecutorAdapter, ExecutorAdapterId } from './types';
export declare const EXECUTOR_ADAPTER_IDS: readonly ExecutorAdapterId[];
export interface AdapterFactoryOptions {
    claude?: ClaudeCliAdapterOptions;
}
export declare function isExecutorAdapterId(value: string): value is ExecutorAdapterId;
export declare function createExecutorAdapter(id: ExecutorAdapterId, options?: AdapterFactoryOptions): ExecutorAdapter;
/** Detection result for every known adapter (`oxe-cc runtime providers`). */
export declare function detectExecutorAdapters(options?: AdapterFactoryOptions): Array<{
    id: ExecutorAdapterId;
    requires_api_key: boolean;
} & AdapterDetection>;
