import { AntigravityCliAdapter } from './antigravity-cli';
import type { AntigravityCliAdapterOptions } from './antigravity-cli';
import { ClaudeCliAdapter } from './claude-cli';
import type { ClaudeCliAdapterOptions } from './claude-cli';
import { HttpOpenAiAdapter } from './http-openai';
import type { AdapterDetection, ExecutorAdapter, ExecutorAdapterId } from './types';

export const EXECUTOR_ADAPTER_IDS: readonly ExecutorAdapterId[] = ['claude', 'antigravity', 'http'];

export interface AdapterFactoryOptions {
  claude?: ClaudeCliAdapterOptions;
  antigravity?: AntigravityCliAdapterOptions;
}

export function normalizeExecutorAdapterId(value: string): ExecutorAdapterId | null {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'agy' || clean === 'antigravity') return 'antigravity';
  if (clean === 'claude') return 'claude';
  if (clean === 'http') return 'http';
  return null;
}

export function isExecutorAdapterId(value: string): value is ExecutorAdapterId {
  return (EXECUTOR_ADAPTER_IDS as readonly string[]).includes(value);
}

export function createExecutorAdapter(id: ExecutorAdapterId | 'agy', options: AdapterFactoryOptions = {}): ExecutorAdapter {
  const normalized = normalizeExecutorAdapterId(id);
  switch (normalized) {
    case 'claude':
      return new ClaudeCliAdapter(options.claude);
    case 'antigravity':
      return new AntigravityCliAdapter(options.antigravity);
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
