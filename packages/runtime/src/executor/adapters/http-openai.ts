import { streamCompletion } from '../stream-completion';
import type { ExecutorAdapter, AdapterDetection } from './types';

/** OpenAI-compatible `/chat/completions` over HTTP — the pre-1.18 behavior. */
export class HttpOpenAiAdapter implements ExecutorAdapter {
  readonly id = 'http' as const;
  readonly requiresApiKey = true;

  detect(): AdapterDetection {
    return { available: true, version: null, binary: null, error: null };
  }

  createCompletion() {
    return streamCompletion;
  }
}
