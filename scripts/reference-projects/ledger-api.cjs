'use strict';

/**
 * Reference project 1 (1.21 maturity scorecard): `ledger-api`, a small expense ledger with a JSON HTTP API in plain
 * Node (node:http, no dependencies). Two program phases, ten tasks. The acceptance tests are the planner's (frozen
 * before execution); the oracle is an independent suite the executor never sees.
 */

const H = "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst src = (m) => require('../../src/' + m);\n";

const F1 = {
  id: 'F1',
  title: 'Domínio do livro-caixa',
  scope: 'valores em centavos, lançamentos validados, livro com saldo, resumo por categoria e exportação CSV',
  tasks: [
    {
      id: 'T1', wave: 1, title: 'Valores monetários em centavos', files: ['src/money.js'], aceite: 'A1',
      criterion: 'Valores em texto viram centavos inteiros e centavos voltam a texto com duas casas',
      goal: 'parseAmount(text) aceita "12.34", "12", "-5.5" e "0.07" (ponto como separador, até 2 casas) e devolve centavos inteiros; qualquer outra coisa (vazio, "1,50", "12.345", "abc", número não-string) lança TypeError. formatCents(cents) devolve "12.34", "-5.50", "0.07".',
      symbols: [['src/money.js', 'parseAmount'], ['src/money.js', 'formatCents']],
      commit: 'feat(money): parse and format amounts as integer cents',
    },
    {
      id: 'T2', wave: 2, dependsOn: ['T1'], title: 'Lançamento validado', files: ['src/entry.js'], aceite: 'A2',
      criterion: 'Um lançamento é criado só com descrição, valor e data válidos; categoria normalizada',
      goal: 'createEntry({ description, amount, category, date }) devolve { id, description, amount_cents, category, date }: id string única por chamada, description sem espaços nas pontas (vazia → TypeError), amount via parseAmount (string), category em minúsculas e sem espaços nas pontas (padrão "other"), date "YYYY-MM-DD" válida (inválida → TypeError; ausente → data de hoje em UTC).',
      symbols: [['src/entry.js', 'createEntry']],
      commit: 'feat(entry): validated ledger entries',
    },
    {
      id: 'T3', wave: 2, dependsOn: ['T1'], title: 'Exportação CSV', files: ['src/csv.js'], aceite: 'A3',
      criterion: 'Lançamentos exportam para CSV com cabeçalho e campos escapados',
      goal: 'toCsv(entries) devolve texto com a linha de cabeçalho "id,date,description,category,amount" e uma linha por lançamento (amount com formatCents), separadas por "\\n", sem quebra no fim. Campos com vírgula, aspas ou quebra de linha vão entre aspas, com aspas internas dobradas.',
      symbols: [['src/csv.js', 'toCsv']],
      commit: 'feat(csv): export entries as escaped CSV',
    },
    {
      id: 'T4', wave: 3, dependsOn: ['T2'], title: 'Livro com saldo e filtros', files: ['src/ledger.js'], aceite: 'A4',
      criterion: 'O livro guarda lançamentos, filtra por categoria e período e calcula o saldo',
      goal: 'createLedger() devolve { add(input) (usa createEntry e devolve o lançamento), get(id) (ou null), remove(id) (true/false), list({ category, from, to } = {}) ordenado por date e depois por ordem de inserção, com from/to inclusivos, balance() em centavos }. list devolve cópias: alterar o retorno não altera o livro.',
      symbols: [['src/ledger.js', 'createLedger']],
      commit: 'feat(ledger): in-memory ledger with filters and balance',
    },
    {
      id: 'T5', wave: 3, dependsOn: ['T2'], title: 'Resumo por categoria', files: ['src/summary.js'], aceite: 'A5',
      criterion: 'O resumo agrupa por categoria com total e contagem, do maior total para o menor',
      goal: 'summarizeByCategory(entries) devolve [{ category, total_cents, count }] ordenado por total_cents decrescente e, no empate, por category crescente. Lista vazia → [].',
      symbols: [['src/summary.js', 'summarizeByCategory']],
      commit: 'feat(summary): totals per category',
    },
  ],
  acceptance: {
    A1: `${H}const { parseAmount, formatCents } = src('money.js');
test('A1 parseAmount', () => {
  assert.equal(parseAmount('12.34'), 1234);
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('-5.5'), -550);
  assert.equal(parseAmount('0.07'), 7);
  for (const bad of ['', '1,50', '12.345', 'abc', 12]) assert.throws(() => parseAmount(bad), TypeError);
});
test('A1 formatCents', () => {
  assert.equal(formatCents(1234), '12.34');
  assert.equal(formatCents(-550), '-5.50');
  assert.equal(formatCents(7), '0.07');
});
`,
    A2: `${H}const { createEntry } = src('entry.js');
test('A2 createEntry', () => {
  const e = createEntry({ description: '  Café ', amount: '4.50', category: ' Food ', date: '2026-11-01' });
  assert.equal(e.description, 'Café');
  assert.equal(e.amount_cents, 450);
  assert.equal(e.category, 'food');
  assert.equal(e.date, '2026-11-01');
  assert.equal(typeof e.id, 'string');
  assert.notEqual(createEntry({ description: 'a', amount: '1', date: '2026-11-01' }).id, createEntry({ description: 'a', amount: '1', date: '2026-11-01' }).id);
  assert.equal(createEntry({ description: 'x', amount: '1', date: '2026-11-01' }).category, 'other');
  assert.match(createEntry({ description: 'x', amount: '1' }).date, /^\\d{4}-\\d{2}-\\d{2}$/);
  assert.throws(() => createEntry({ description: '  ', amount: '1', date: '2026-11-01' }), TypeError);
  assert.throws(() => createEntry({ description: 'x', amount: '1', date: '2026-13-40' }), TypeError);
});
`,
    A3: `${H}const { toCsv } = src('csv.js');
test('A3 toCsv', () => {
  const csv = toCsv([
    { id: 'a1', date: '2026-11-01', description: 'Café, pão', category: 'food', amount_cents: 450 },
    { id: 'a2', date: '2026-11-02', description: 'O "melhor"', category: 'other', amount_cents: -1000 },
  ]);
  const lines = csv.split('\\n');
  assert.equal(lines[0], 'id,date,description,category,amount');
  assert.equal(lines[1], 'a1,2026-11-01,"Café, pão",food,4.50');
  assert.equal(lines[2], 'a2,2026-11-02,"O ""melhor""",other,-10.00');
  assert.equal(lines.length, 3);
  assert.equal(toCsv([]), 'id,date,description,category,amount');
});
`,
    A4: `${H}const { createLedger } = src('ledger.js');
test('A4 ledger', () => {
  const l = createLedger();
  const a = l.add({ description: 'salário', amount: '1000', category: 'income', date: '2026-11-05' });
  const b = l.add({ description: 'café', amount: '-4.50', category: 'food', date: '2026-11-01' });
  l.add({ description: 'almoço', amount: '-20', category: 'food', date: '2026-11-05' });
  assert.equal(l.balance(), 100000 - 450 - 2000);
  assert.deepEqual(l.list().map((e) => e.description), ['café', 'salário', 'almoço']);
  assert.deepEqual(l.list({ category: 'food' }).map((e) => e.description), ['café', 'almoço']);
  assert.deepEqual(l.list({ from: '2026-11-02', to: '2026-11-05' }).map((e) => e.description), ['salário', 'almoço']);
  assert.equal(l.get(a.id).description, 'salário');
  assert.equal(l.get('nope'), null);
  l.list()[0].description = 'mutado';
  assert.equal(l.get(b.id).description, 'café');
  assert.equal(l.remove(b.id), true);
  assert.equal(l.remove(b.id), false);
  assert.equal(l.balance(), 100000 - 2000);
});
`,
    A5: `${H}const { summarizeByCategory } = src('summary.js');
test('A5 summarizeByCategory', () => {
  const out = summarizeByCategory([
    { category: 'food', amount_cents: 300 },
    { category: 'rent', amount_cents: 1000 },
    { category: 'food', amount_cents: 700 },
    { category: 'bike', amount_cents: 1000 },
  ]);
  assert.deepEqual(out, [
    { category: 'bike', total_cents: 1000, count: 1 },
    { category: 'food', total_cents: 1000, count: 2 },
    { category: 'rent', total_cents: 1000, count: 1 },
  ]);
  assert.deepEqual(summarizeByCategory([]), []);
});
`,
  },
  oracle: `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('oracle F1', () => {
  const { parseAmount, formatCents } = require('./src/money.js');
  assert.equal(parseAmount('100.1'), 10010);
  assert.equal(formatCents(-7), '-0.07');
  const { createLedger } = require('./src/ledger.js');
  const l = createLedger();
  l.add({ description: 'a', amount: '1.10', category: 'X', date: '2026-01-02' });
  l.add({ description: 'b', amount: '2.20', category: 'x', date: '2026-01-01' });
  assert.equal(l.balance(), 330);
  assert.deepEqual(l.list({ category: 'x' }).map((e) => e.description), ['b', 'a']);
  const { summarizeByCategory } = require('./src/summary.js');
  assert.deepEqual(summarizeByCategory(l.list()), [{ category: 'x', total_cents: 330, count: 2 }]);
  const { toCsv } = require('./src/csv.js');
  assert.equal(toCsv([{ id: 'i', date: '2026-01-01', description: 'linha\\nnova', category: 'x', amount_cents: 5 }]).split('\\n').slice(1).join('\\n'), 'i,2026-01-01,"linha\\nnova",x,0.05');
});
`,
};

const F2 = {
  id: 'F2',
  title: 'API HTTP do livro-caixa',
  scope: 'roteador, leitura de corpo JSON com limite, autenticação Bearer, handlers e servidor HTTP',
  tasks: [
    {
      id: 'T6', wave: 1, title: 'Roteador com parâmetros', files: ['src/http/router.js'], aceite: 'A6',
      criterion: 'O roteador casa método e caminho com parâmetros e distingue 404 de 405',
      goal: 'createRouter() devolve { add(method, pattern, handler), match(method, path) }. pattern aceita segmentos ":nome". match devolve { handler, params } quando casa; { status: 405, allow: [métodos ordenados] } quando o caminho existe com outro método; { status: 404 } quando nenhum caminho casa. A query string é ignorada no match.',
      symbols: [['src/http/router.js', 'createRouter']],
      commit: 'feat(http): router with path params and 404/405',
    },
    {
      id: 'T7', wave: 1, title: 'Corpo JSON com limite', files: ['src/http/body.js'], aceite: 'A7',
      criterion: 'O corpo JSON é lido com limite de tamanho e erros com status HTTP',
      goal: 'readJson(req, { limit = 100000 } = {}) devolve Promise do objeto lido de um stream legível. Corpo vazio → {}. JSON inválido → rejeita com Error de .status = 400. Mais bytes que limit → rejeita com Error de .status = 413.',
      symbols: [['src/http/body.js', 'readJson']],
      commit: 'feat(http): JSON body reader with size limit',
    },
    {
      id: 'T8', wave: 1, title: 'Autenticação Bearer', files: ['src/http/auth.js'], aceite: 'A8',
      criterion: 'Só um cabeçalho Bearer com o token certo autentica, comparado em tempo constante',
      goal: 'checkBearer(header, token) devolve true só para "Bearer <token>" exato; false para ausente, outro esquema, token errado ou de outro tamanho. Usa crypto.timingSafeEqual (sem lançar quando os tamanhos diferem).',
      symbols: [['src/http/auth.js', 'checkBearer']],
      commit: 'feat(http): constant-time bearer token check',
    },
    {
      id: 'T9', wave: 1, title: 'Handlers da API', files: ['src/http/handlers.js'], aceite: 'A9',
      criterion: 'Os handlers criam, listam, apagam lançamentos e informam o saldo com status corretos',
      goal: 'createHandlers(ledger) devolve { createEntry(body) → { status: 201, body: lançamento } ou { status: 400, body: { error } } quando a validação lança, listEntries(query) → { status: 200, body: ledger.list({ category, from, to }) }, getBalance() → { status: 200, body: { balance_cents, balance } } (balance com formatCents), deleteEntry(params) → { status: 204 } ou { status: 404, body: { error: "not_found" } } }.',
      symbols: [['src/http/handlers.js', 'createHandlers']],
      commit: 'feat(http): ledger API handlers',
    },
    {
      id: 'T10', wave: 2, dependsOn: ['T6', 'T7', 'T8', 'T9'], title: 'Servidor HTTP', files: ['src/server.js'], aceite: 'A10',
      criterion: 'O servidor expõe a API autenticada com respostas JSON e erros 400/401/404/405/413',
      goal: 'createServer({ ledger, token }) devolve um http.Server (sem listen). Rotas: POST /entries, GET /entries (query category/from/to), DELETE /entries/:id, GET /balance. Sem Bearer válido → 401 { error: "unauthorized" }. Respostas com content-type application/json (204 sem corpo). Erros do readJson usam o .status dele e a resposta precisa chegar ao cliente (ex.: corpo grande demais → 413 em JSON, sem derrubar a conexão antes de responder); 404 → { error: "not_found" }; 405 → cabeçalho allow.',
      symbols: [['src/server.js', 'createServer']],
      commit: 'feat(server): authenticated JSON HTTP server',
    },
  ],
  acceptance: {
    A6: `${H}const { createRouter } = src('http/router.js');
test('A6 router', () => {
  const r = createRouter();
  const h1 = () => 1;
  const h2 = () => 2;
  r.add('GET', '/entries/:id', h1);
  r.add('DELETE', '/entries/:id', h2);
  const m = r.match('GET', '/entries/abc?x=1');
  assert.equal(m.handler, h1);
  assert.deepEqual(m.params, { id: 'abc' });
  assert.deepEqual(r.match('POST', '/entries/abc'), { status: 405, allow: ['DELETE', 'GET'] });
  assert.deepEqual(r.match('GET', '/nope'), { status: 404 });
});
`,
    A7: `${H}const { Readable } = require('node:stream');
const { readJson } = src('http/body.js');
const req = (text) => Readable.from(text ? [Buffer.from(text)] : []);
test('A7 readJson', async () => {
  assert.deepEqual(await readJson(req('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJson(req('')), {});
  await assert.rejects(readJson(req('{oops')), (e) => e.status === 400);
  await assert.rejects(readJson(req('{"a":"' + 'x'.repeat(50) + '"}'), { limit: 20 }), (e) => e.status === 413);
});
`,
    A8: `${H}const { checkBearer } = src('http/auth.js');
test('A8 checkBearer', () => {
  assert.equal(checkBearer('Bearer s3cret', 's3cret'), true);
  for (const bad of [undefined, '', 's3cret', 'Basic s3cret', 'Bearer s3creT', 'Bearer s3cret-longer', 'Bearer ']) {
    assert.equal(checkBearer(bad, 's3cret'), false, String(bad));
  }
});
`,
    A9: `${H}const { createLedger } = src('ledger.js');
const { createHandlers } = src('http/handlers.js');
test('A9 handlers', () => {
  const h = createHandlers(createLedger());
  const created = h.createEntry({ description: 'café', amount: '-4.50', category: 'food', date: '2026-11-01' });
  assert.equal(created.status, 201);
  assert.equal(h.createEntry({ description: '', amount: '1' }).status, 400);
  assert.equal(typeof h.createEntry({ amount: 'x', description: 'a' }).body.error, 'string');
  assert.deepEqual(h.listEntries({ category: 'food' }).body.map((e) => e.id), [created.body.id]);
  assert.deepEqual(h.getBalance(), { status: 200, body: { balance_cents: -450, balance: '-4.50' } });
  assert.deepEqual(h.deleteEntry({ id: created.body.id }), { status: 204 });
  assert.equal(h.deleteEntry({ id: created.body.id }).status, 404);
});
`,
    A10: `${H}const { createLedger } = src('ledger.js');
const { createServer } = src('server.js');
test('A10 server', async () => {
  const server = createServer({ ledger: createLedger(), token: 'k' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = { authorization: 'Bearer k', 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/balance')).status, 401);
    const post = await fetch(base + '/entries', { method: 'POST', headers: auth, body: JSON.stringify({ description: 'x', amount: '2.00', date: '2026-11-01' }) });
    assert.equal(post.status, 201);
    assert.match(post.headers.get('content-type'), /application\\/json/);
    const entry = await post.json();
    assert.equal((await fetch(base + '/entries', { method: 'POST', headers: auth, body: '{bad' })).status, 400);
    assert.deepEqual(await (await fetch(base + '/balance', { headers: auth })).json(), { balance_cents: 200, balance: '2.00' });
    assert.equal((await fetch(base + '/entries?category=other', { headers: auth })).status, 200);
    const wrong = await fetch(base + '/balance', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(wrong.status, 405);
    assert.ok(wrong.headers.get('allow'));
    assert.equal((await fetch(base + '/nope', { headers: auth })).status, 404);
    assert.equal((await fetch(base + '/entries/' + entry.id, { method: 'DELETE', headers: auth })).status, 204);
    // An oversized body is answered with 413 in JSON, and the connection is not left half-open.
    const big = await fetch(base + '/entries', { method: 'POST', headers: auth, body: 'x'.repeat(200001) });
    assert.equal(big.status, 413);
    assert.match(big.headers.get('content-type'), /application\\/json/);
  } finally {
    // Graceful shutdown must finish: a request left half-open after an error keeps server.close() waiting forever.
    const closed = new Promise((resolve) => server.close(() => resolve('closed')));
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), 3000); });
    const outcome = await Promise.race([closed, late]);
    clearTimeout(timer);
    assert.equal(outcome, 'closed', 'server.close() did not finish after the requests');
  }
});
`,
  },
  oracle: `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('oracle F2', async () => {
  const { createLedger } = require('./src/ledger.js');
  const { createServer } = require('./src/server.js');
  const server = createServer({ ledger: createLedger(), token: 't0k' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const h = { authorization: 'Bearer t0k' };
  try {
    assert.equal((await fetch(base + '/entries', { headers: { authorization: 'Bearer t0K' } })).status, 401);
    await fetch(base + '/entries', { method: 'POST', headers: h, body: JSON.stringify({ description: 'a', amount: '1', category: 'Food', date: '2026-02-01' }) });
    await fetch(base + '/entries', { method: 'POST', headers: h, body: JSON.stringify({ description: 'b', amount: '3', category: 'rent', date: '2026-01-01' }) });
    const food = await (await fetch(base + '/entries?category=food', { headers: h })).json();
    assert.deepEqual(food.map((e) => e.description), ['a']);
    const all = await (await fetch(base + '/entries?from=2026-01-15', { headers: h })).json();
    assert.deepEqual(all.map((e) => e.description), ['a']);
    assert.equal((await fetch(base + '/entries/none', { method: 'DELETE', headers: h })).status, 404);
    assert.equal((await fetch(base + '/entries', { method: 'POST', headers: h, body: 'x'.repeat(200001) })).status, 413);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
`,
};

module.exports = {
  name: 'ledger-api',
  description: 'Livro-caixa com API HTTP JSON em Node puro (node:http), sem dependências.',
  objective: 'Registrar receitas e despesas em centavos, consultar saldo e lançamentos por categoria e período, exportar CSV e expor tudo numa API HTTP autenticada por token.',
  phases: [F1, F2],
};
