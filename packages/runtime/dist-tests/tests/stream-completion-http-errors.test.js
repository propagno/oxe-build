"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const http_1 = __importDefault(require("http"));
const stream_completion_1 = require("../src/executor/stream-completion");
// External review 15/11 (P0-1): a 401/404/500 resolved as text, parsed as zero tool calls and ended the attempt as
// "no tool call" in silence. Every status >= 400 is an error now, classified; the SSE usage chunk is read.
async function withServer(handler, fn) {
    const srv = http_1.default.createServer(handler);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    try {
        await fn(`http://127.0.0.1:${port}/v1`);
    }
    finally {
        await new Promise((r) => srv.close(() => r()));
    }
}
const call = (baseUrl) => (0, stream_completion_1.streamCompletion)({ baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], timeoutMs: 5000 });
(0, node_test_1.describe)('http adapter: errors are errors', () => {
    (0, node_test_1.test)('401, 404 and 500 reject with a kind and a hint; a 400 about the context is context', async () => {
        for (const [status, body, kind, hint] of [
            [401, '{"error":"invalid x-api-key"}', 'environment', /credencial recusada/],
            [404, 'not found', 'environment', /chat\/completions não existe/],
            [500, 'boom', 'env', /transitório/],
            [400, '{"error":"prompt is too long: 250000 tokens"}', 'context', /prompt is too long/],
        ]) {
            await withServer((req, res) => { res.statusCode = status; res.end(body); }, async (base) => {
                await strict_1.default.rejects(call(base), (err) => {
                    strict_1.default.equal(err.statusCode, status);
                    strict_1.default.equal(err.kind, kind);
                    strict_1.default.match(err.message, hint);
                    return true;
                });
            });
        }
    });
    (0, node_test_1.test)('a backend that refuses stream_options gets one more call without it', async () => {
        let calls = 0;
        await withServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                calls += 1;
                if (body.includes('stream_options')) {
                    res.statusCode = 400;
                    res.end('{"error":"Unrecognized request argument: stream_options"}');
                    return;
                }
                res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
            });
        }, async (base) => {
            const r = await call(base);
            strict_1.default.equal(r.content, 'ok');
            strict_1.default.equal(calls, 2);
        });
    });
    (0, node_test_1.test)('the usage chunk is read', () => {
        const r = (0, stream_completion_1.parseSseResponse)('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}\n\ndata: [DONE]\n');
        strict_1.default.deepEqual(r.usage, { input_tokens: 120, output_tokens: 30 });
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(429, ''), 'quota');
        const t = (0, stream_completion_1.parseSseResponse)('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":9,"completion_tokens_details":{"reasoning_tokens":7}}}\n\ndata: [DONE]\n');
        strict_1.default.equal(t.usage?.thinking_tokens, 7);
    });
    (0, node_test_1.test)('cross-review 15/11: a policy refusal is policy, a refused credential / missing endpoint is environment', () => {
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(400, '{"error":{"code":"content_filter","message":"flagged"}}'), 'policy');
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(403, 'Request blocked by our usage policies'), 'policy');
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(403, 'forbidden'), 'environment');
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(401, ''), 'environment');
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(404, ''), 'environment');
        strict_1.default.equal((0, stream_completion_1.httpFailureKind)(502, ''), 'env');
    });
});
