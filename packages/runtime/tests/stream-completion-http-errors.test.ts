import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { streamCompletion, httpFailureKind, parseSseResponse } from '../src/executor/stream-completion';

// External review 15/11 (P0-1): a 401/404/500 resolved as text, parsed as zero tool calls and ended the attempt as
// "no tool call" in silence. Every status >= 400 is an error now, classified; the SSE usage chunk is read.

async function withServer(handler: http.RequestListener, fn: (base: string) => Promise<void>) {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  try { await fn(`http://127.0.0.1:${port}/v1`); } finally { await new Promise<void>((r) => srv.close(() => r())); }
}

const call = (baseUrl: string) => streamCompletion({ baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], timeoutMs: 5000 });

describe('http adapter: errors are errors', () => {
  test('401, 404 and 500 reject with a kind and a hint; a 400 about the context is context', async () => {
    for (const [status, body, kind, hint] of [
      [401, '{"error":"invalid x-api-key"}', 'env', /credencial recusada/],
      [404, 'not found', 'env', /chat\/completions não existe/],
      [500, 'boom', 'env', /transitório/],
      [400, '{"error":"prompt is too long: 250000 tokens"}', 'context', /prompt is too long/],
    ] as const) {
      await withServer((req, res) => { res.statusCode = status; res.end(body); }, async (base) => {
        await assert.rejects(call(base), (err: Error & { kind?: string; statusCode?: number }) => {
          assert.equal(err.statusCode, status);
          assert.equal(err.kind, kind);
          assert.match(err.message, hint);
          return true;
        });
      });
    }
  });

  test('a backend that refuses stream_options gets one more call without it', async () => {
    let calls = 0;
    await withServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        calls += 1;
        if (body.includes('stream_options')) { res.statusCode = 400; res.end('{"error":"Unrecognized request argument: stream_options"}'); return; }
        res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
      });
    }, async (base) => {
      const r = await call(base);
      assert.equal(r.content, 'ok');
      assert.equal(calls, 2);
    });
  });

  test('the usage chunk is read', () => {
    const r = parseSseResponse('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}\n\ndata: [DONE]\n');
    assert.deepEqual(r.usage, { input_tokens: 120, output_tokens: 30 });
    assert.equal(httpFailureKind(429, ''), 'quota');
  });
});
