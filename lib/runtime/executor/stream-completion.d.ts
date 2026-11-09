import { URL } from 'url';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface CompletionUsage {
    /** Cost reported by the backend for this turn (USD), when it reports one. */
    cost_usd?: number | null;
}
export interface CompletionResponse {
    content: string;
    tool_calls: ToolCall[];
    finish_reason: string | null;
    usage?: CompletionUsage;
}
export interface StreamCompletionOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** OXB-131: the model chosen for this attempt (tier/override); null = the backend default. */
    attemptModel?: string | null;
    messages: ChatMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
    timeoutMs?: number;
}
export interface ToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
/**
 * `<baseUrl>/chat/completions`, keeping any path prefix such as `/v1`.
 * (`new URL('/chat/completions', base)` discarded the prefix and hit `<host>/chat/completions`.)
 */
export declare function buildChatCompletionsUrl(baseUrl: string): URL;
export declare function streamCompletion(opts: StreamCompletionOptions): Promise<CompletionResponse>;
