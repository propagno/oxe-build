import https from 'https';
import http from 'http';
import { URL } from 'url';
import { parseRateLimitResetMs } from '../scheduler/scheduler';

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
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
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
  /** Active workspace directory for CLI adapters (e.g. reading oversized prompt files inside the task workspace). */
  cwd?: string;
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
export function buildChatCompletionsUrl(baseUrl: string): URL {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  return new URL(`${base}/chat/completions`);
}

export async function streamCompletion(opts: StreamCompletionOptions): Promise<CompletionResponse> {
  const url = buildChatCompletionsUrl(opts.baseUrl);
  const bodyOf = (withUsage: boolean) => JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    // External review 15/11 (P0-1): the usage of the turn (tokens) comes in the last chunk only when asked for
    ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
  });
  let rawText: string;
  try {
    rawText = await fetchWithTimeout(url, opts.apiKey, bodyOf(true), opts.timeoutMs ?? 120_000);
  } catch (err) {
    // a backend that does not know stream_options answers 400 naming it: once more without it
    if ((err as { statusCode?: number }).statusCode === 400 && /stream_options|include_usage/i.test(String((err as Error).message))) {
      rawText = await fetchWithTimeout(url, opts.apiKey, bodyOf(false), opts.timeoutMs ?? 120_000);
    } else throw err;
  }
  return parseSseResponse(rawText);
}

/**
 * External review 15/11 (P0-1): every HTTP status >= 400 is an error, classified — before, anything but a quota
 * answer resolved as text, parsed as zero tool calls, and a 401/404/500 ended the attempt as "no tool call" in
 * silence (a read-only node could even succeed).
 */
export function httpFailureKind(status: number, text: string): 'quota' | 'context' | 'policy' | 'environment' | 'env' {
  if (status === 429 || /RESOURCE_EXHAUSTED|rate[ _-]?limit|too many requests|quota exceeded|insufficient_quota/i.test(text)) return 'quota';
  if ((status === 400 || status === 413 || status === 422) && /context|too long|too many tokens|maximum.*tokens|prompt is too long/i.test(text)) return 'context';
  // cross-review 15/11: a refusal by the provider's content/usage policy repeats on the same prompt — never retried
  if ((status === 400 || status === 403) && /content[ _-]?filter|content[ _-]?policy|usage[ _-]?polic|safety system|flagged/i.test(text)) return 'policy';
  // a refused credential or a missing endpoint is configuration: the next attempt fails the same way (pauses the run)
  if (status === 401 || status === 403 || status === 404) return 'environment';
  return 'env';
}

function httpFailureHint(status: number, host: string): string {
  if (status === 401 || status === 403) return ' — credencial recusada: confira a chave (--api-key / ANTHROPIC_API_KEY / OPENAI_API_KEY) e o --base-url';
  if (status === 404) return ` — o endpoint <base-url>/chat/completions não existe em ${host}: o adapter http fala o formato OpenAI; para a Anthropic use --adapter claude, ou um proxy OpenAI-compatível em --base-url`;
  if (status >= 500) return ' — erro do provedor (transitório): a próxima tentativa repete';
  return '';
}

function fetchWithTimeout(url: URL, apiKey: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const chunks: Buffer[] = [];

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 200;
          if (status >= 400) {
            const kind = httpFailureKind(status, text);
            const retryAfterHeader = Array.isArray(res.headers['retry-after']) ? res.headers['retry-after'][0] : res.headers['retry-after'];
            const retryAfterMs = kind === 'quota' ? parseRateLimitResetMs(text, Date.now(), retryAfterHeader ?? null) : null;
            const err = Object.assign(
              new Error(`HTTP ${status}: ${text.slice(0, 500)}${httpFailureHint(status, url.hostname)}`),
              { kind, statusCode: status, retryAfterMs },
            );
            reject(err);
            return;
          }
          resolve(text);
        });
        res.on('error', reject);
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`LLM request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(body);
    req.end();
  });
}

function parseSseResponse(raw: string): CompletionResponse {
  let content = '';
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
  let finish_reason: string | null = null;
  let usage: CompletionUsage | undefined;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(payload); } catch { continue; }

    // the usage chunk (stream_options.include_usage): OpenAI-compatible prompt/completion tokens, cost if reported
    const u = chunk.usage as Record<string, unknown> | undefined | null;
    if (u && typeof u === 'object') {
      usage = {
        ...(typeof u.prompt_tokens === 'number' ? { input_tokens: u.prompt_tokens } : {}),
        ...(typeof u.completion_tokens === 'number' ? { output_tokens: u.completion_tokens } : {}),
        ...(typeof u.cost === 'number' ? { cost_usd: u.cost } : {}),
      };
      const details = u.completion_tokens_details as Record<string, unknown> | undefined | null;
      if (details && typeof details.reasoning_tokens === 'number') usage.thinking_tokens = details.reasoning_tokens;
    }

    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    if (!choices?.length) continue;

    const delta = choices[0].delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    if (typeof delta.content === 'string') content += delta.content;
    if (choices[0].finish_reason) finish_reason = choices[0].finish_reason as string;

    const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (deltaToolCalls) {
      for (const dtc of deltaToolCalls) {
        const idx = dtc.index as number;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, { id: '', name: '', args: '' });
        }
        const entry = toolCallsMap.get(idx)!;
        if (dtc.id) entry.id += dtc.id as string;
        const fn = dtc.function as Record<string, unknown> | undefined;
        if (fn?.name) entry.name += fn.name as string;
        if (fn?.arguments) entry.args += fn.arguments as string;
      }
    }
  }

  const tool_calls: ToolCall[] = [...toolCallsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.args },
    }));

  return { content, tool_calls, finish_reason, ...(usage ? { usage } : {}) };
}

/** For tests: the SSE parser. */
export { parseSseResponse };
