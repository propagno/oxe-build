"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChatCompletionsUrl = buildChatCompletionsUrl;
exports.streamCompletion = streamCompletion;
exports.httpFailureKind = httpFailureKind;
exports.parseSseResponse = parseSseResponse;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
const scheduler_1 = require("../scheduler/scheduler");
/**
 * `<baseUrl>/chat/completions`, keeping any path prefix such as `/v1`.
 * (`new URL('/chat/completions', base)` discarded the prefix and hit `<host>/chat/completions`.)
 */
function buildChatCompletionsUrl(baseUrl) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    return new url_1.URL(`${base}/chat/completions`);
}
async function streamCompletion(opts) {
    const url = buildChatCompletionsUrl(opts.baseUrl);
    const bodyOf = (withUsage) => JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
        // External review 15/11 (P0-1): the usage of the turn (tokens) comes in the last chunk only when asked for
        ...(withUsage ? { stream_options: { include_usage: true } } : {}),
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    });
    let rawText;
    try {
        rawText = await fetchWithTimeout(url, opts.apiKey, bodyOf(true), opts.timeoutMs ?? 120000);
    }
    catch (err) {
        // a backend that does not know stream_options answers 400 naming it: once more without it
        if (err.statusCode === 400 && /stream_options|include_usage/i.test(String(err.message))) {
            rawText = await fetchWithTimeout(url, opts.apiKey, bodyOf(false), opts.timeoutMs ?? 120000);
        }
        else
            throw err;
    }
    return parseSseResponse(rawText);
}
/**
 * External review 15/11 (P0-1): every HTTP status >= 400 is an error, classified — before, anything but a quota
 * answer resolved as text, parsed as zero tool calls, and a 401/404/500 ended the attempt as "no tool call" in
 * silence (a read-only node could even succeed).
 */
function httpFailureKind(status, text) {
    if (status === 429 || /RESOURCE_EXHAUSTED|rate[ _-]?limit|too many requests|quota exceeded|insufficient_quota/i.test(text))
        return 'quota';
    if ((status === 400 || status === 413 || status === 422) && /context|too long|too many tokens|maximum.*tokens|prompt is too long/i.test(text))
        return 'context';
    return 'env';
}
function httpFailureHint(status, host) {
    if (status === 401 || status === 403)
        return ' — credencial recusada: confira a chave (--api-key / ANTHROPIC_API_KEY / OPENAI_API_KEY) e o --base-url';
    if (status === 404)
        return ` — o endpoint <base-url>/chat/completions não existe em ${host}: o adapter http fala o formato OpenAI; para a Anthropic use --adapter claude, ou um proxy OpenAI-compatível em --base-url`;
    if (status >= 500)
        return ' — erro do provedor (transitório): a próxima tentativa repete';
    return '';
}
function fetchWithTimeout(url, apiKey, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https_1.default : http_1.default;
        const chunks = [];
        const req = transport.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                const status = res.statusCode ?? 200;
                if (status >= 400) {
                    const kind = httpFailureKind(status, text);
                    const retryAfterHeader = Array.isArray(res.headers['retry-after']) ? res.headers['retry-after'][0] : res.headers['retry-after'];
                    const retryAfterMs = kind === 'quota' ? (0, scheduler_1.parseRateLimitResetMs)(text, Date.now(), retryAfterHeader ?? null) : null;
                    const err = Object.assign(new Error(`HTTP ${status}: ${text.slice(0, 500)}${httpFailureHint(status, url.hostname)}`), { kind, statusCode: status, retryAfterMs });
                    reject(err);
                    return;
                }
                resolve(text);
            });
            res.on('error', reject);
        });
        const timer = setTimeout(() => {
            req.destroy(new Error(`LLM request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        req.on('close', () => clearTimeout(timer));
        req.on('error', (err) => { clearTimeout(timer); reject(err); });
        req.write(body);
        req.end();
    });
}
function parseSseResponse(raw) {
    let content = '';
    const toolCallsMap = new Map();
    let finish_reason = null;
    let usage;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:'))
            continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]')
            break;
        let chunk;
        try {
            chunk = JSON.parse(payload);
        }
        catch {
            continue;
        }
        // the usage chunk (stream_options.include_usage): OpenAI-compatible prompt/completion tokens, cost if reported
        const u = chunk.usage;
        if (u && typeof u === 'object') {
            usage = {
                ...(typeof u.prompt_tokens === 'number' ? { input_tokens: u.prompt_tokens } : {}),
                ...(typeof u.completion_tokens === 'number' ? { output_tokens: u.completion_tokens } : {}),
                ...(typeof u.cost === 'number' ? { cost_usd: u.cost } : {}),
            };
        }
        const choices = chunk.choices;
        if (!choices?.length)
            continue;
        const delta = choices[0].delta;
        if (!delta)
            continue;
        if (typeof delta.content === 'string')
            content += delta.content;
        if (choices[0].finish_reason)
            finish_reason = choices[0].finish_reason;
        const deltaToolCalls = delta.tool_calls;
        if (deltaToolCalls) {
            for (const dtc of deltaToolCalls) {
                const idx = dtc.index;
                if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, { id: '', name: '', args: '' });
                }
                const entry = toolCallsMap.get(idx);
                if (dtc.id)
                    entry.id += dtc.id;
                const fn = dtc.function;
                if (fn?.name)
                    entry.name += fn.name;
                if (fn?.arguments)
                    entry.args += fn.arguments;
            }
        }
    }
    const tool_calls = [...toolCallsMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
    }));
    return { content, tool_calls, finish_reason, ...(usage ? { usage } : {}) };
}
