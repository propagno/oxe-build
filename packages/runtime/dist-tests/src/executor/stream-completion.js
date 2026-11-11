"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChatCompletionsUrl = buildChatCompletionsUrl;
exports.streamCompletion = streamCompletion;
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
    const body = JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    });
    const rawText = await fetchWithTimeout(url, opts.apiKey, body, opts.timeoutMs ?? 120000);
    return parseSseResponse(rawText);
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
                if (status === 429 || (status >= 400 && /RESOURCE_EXHAUSTED|rate[ _-]?limit|too many requests|quota exceeded|insufficient_quota/i.test(text))) {
                    const retryAfterHeader = Array.isArray(res.headers['retry-after']) ? res.headers['retry-after'][0] : res.headers['retry-after'];
                    const retryAfterMs = (0, scheduler_1.parseRateLimitResetMs)(text, Date.now(), retryAfterHeader ?? null);
                    const err = Object.assign(new Error(`HTTP ${status}: ${text.slice(0, 500)}`), { kind: 'quota', statusCode: status, retryAfterMs });
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
    return { content, tool_calls, finish_reason };
}
