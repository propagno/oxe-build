import https from 'https';
import http from 'http';
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

export interface CompletionResponse {
  content: string;
  tool_calls: ToolCall[];
  finish_reason: string | null;
}

export interface StreamCompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
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

export async function streamCompletion(opts: StreamCompletionOptions): Promise<CompletionResponse> {
  const url = new URL('/chat/completions', opts.baseUrl.replace(/\/$/, '') + '/');
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
  });

  const rawText = await fetchWithTimeout(url, opts.apiKey, body, opts.timeoutMs ?? 120_000);
  return parseSseResponse(rawText);
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
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(payload); } catch { continue; }

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

  return { content, tool_calls, finish_reason };
}
