import { streamCompletion } from '../stream-completion';
import type { ExecutorAdapter, AdapterDetection } from './types';
/** OpenAI-compatible `/chat/completions` over HTTP — the pre-1.18 behavior. */
export declare class HttpOpenAiAdapter implements ExecutorAdapter {
    readonly id: "http";
    readonly requiresApiKey = true;
    detect(): AdapterDetection;
    createCompletion(): typeof streamCompletion;
}
