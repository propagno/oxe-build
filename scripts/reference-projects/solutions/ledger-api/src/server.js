'use strict';
const http = require('http');
const { createRouter } = require('./http/router.js');
const { readJson } = require('./http/body.js');
const { checkBearer } = require('./http/auth.js');
const { createHandlers } = require('./http/handlers.js');
function createServer({ ledger, token }) {
  const h = createHandlers(ledger);
  const r = createRouter();
  r.add('POST', '/entries', async (req) => h.createEntry(await readJson(req)));
  r.add('GET', '/entries', async (req, p, q) => h.listEntries(q));
  r.add('DELETE', '/entries/:id', async (req, p) => h.deleteEntry(p));
  r.add('GET', '/balance', async () => h.getBalance());
  const send = (res, status, body, headers = {}) => {
    if (status === 204) { res.writeHead(204, headers); return res.end(); }
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    if (!checkBearer(req.headers.authorization, token)) return send(res, 401, { error: 'unauthorized' });
    const m = r.match(req.method, req.url);
    if (m.status === 404) return send(res, 404, { error: 'not_found' });
    if (m.status === 405) return send(res, 405, { error: 'method_not_allowed' }, { allow: m.allow.join(', ') });
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    try { const out = await m.handler(req, m.params, q); send(res, out.status, out.body); } catch (e) { send(res, e.status || 500, { error: e.message }); }
  });
}
module.exports = { createServer };
