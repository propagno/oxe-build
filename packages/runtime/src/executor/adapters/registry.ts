import { ClaudeCliAdapter } from './claude-cli';
import type { ClaudeCliAdapterOptions } from './claude-cli';
import { HttpOpenAiAdapter } from './http-openai';
import type { AdapterDetection, ExecutorAdapter, ExecutorAdapterId } from './types';

export const EXECUTOR_ADAPTER_IDS: readonly ExecutorAdapterId[] = ['claude', 'http'];

export interface AdapterFactoryOptions {
  claude?: ClaudeCliAdapterOptions;
}

export function isExecutorAdapterId(value: string): value is ExecutorAdapterId {
  return (EXECUTOR_ADAPTER_IDS as readonly string[]).includes(value);
}

export function createExecutorAdapter(id: ExecutorAdapterId, options: AdapterFactoryOptions = {}): ExecutorAdapter {
  switch (id) {
    case 'claude':
      return new ClaudeCliAdapter(options.claude);
    case 'http':
      return new HttpOpenAiAdapter();
    default:
      throw new Error(`Adapter de executor desconhecido: ${String(id)}`);
  }
}

/** Detection result for every known adapter (`oxe-cc runtime providers`). */
export function detectExecutorAdapters(options: AdapterFactoryOptions = {}): Array<{ id: ExecutorAdapterId; requires_api_key: boolean } & AdapterDetection> {
  return EXECUTOR_ADAPTER_IDS.map((id) => {
    const adapter = createExecutorAdapter(id, options);
    return { id, requires_api_key: adapter.requiresApiKey, ...adapter.detect() };
  });
}
