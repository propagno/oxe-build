#!/usr/bin/env node
'use strict';

/**
 * e2e "taskboard": programa por fases com oráculo independente (1.19).
 *
 * Um ROADMAP de 3 fases vira programa (`runtime program init`). Cada fase roda o ciclo completo:
 *   PLAN.json + IMPLEMENTATION-PACK da fase → execute → verify (+ regressão das fases fechadas) → close
 * e cada fase consome a interface da anterior (store → api → relatórios).
 *
 * O oráculo não depende do OXE: testes de referência por fase, guardados fora do projeto, rodados
 * numa cópia do `src/`. KPIs:
 *   - fases fechadas, falso verde (OXE fecha a fase e o oráculo da fase/anteriores falha);
 *   - mutação de regressão: a fase 3 quebra o store da fase 1 — o gate tem que reprovar;
 *   - interfaces: o contexto do nó da fase N traz os exports das fases fechadas.
 *
 * Modos:
 *   --mock (padrão, determinístico — roda no `npm test`)
 *   --real [--adapter claude|http] [--model <m>]  modelo real; mede custo e turnos por fase
 *          (critério: turnos/tarefa da fase 3 não crescem em relação à fase 1)
 *   --keep  mantém os diretórios temporários
 *
 * Saída: .oxe/release/e2e-program-report.json (mock) ou e2e-program-real-report.json (real).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const REPORT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT) : REPO_ROOT;
const KEEP = process.argv.includes('--keep');
const REAL = process.argv.includes('--real');
const REPORT_PATH = path.join(REPORT_ROOT, '.oxe', 'release', REAL ? 'e2e-program-real-report.json' : 'e2e-program-report.json');

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

const T = "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\n";

// ─── Fixture: taskboard em 3 fases ───────────────────────────────────────────

const PHASES = [
  {
    id: 'F1',
    title: 'Domínio e armazenamento',
    scope: 'entidade Task e store em memória',
    tasks: [
      {
        id: 'T1', wave: 1, title: 'Entidade Task', aceite: 'A1',
        criterion: 'createTask valida título e cria tarefa aberta',
        goal: 'Criar src/task.js exportando createTask(title): { id, title, done: false } com id string único; lança Error para título vazio. E test/task.test.js (node:test) [A1].',
        files: ['src/task.js', 'test/task.test.js'], test: 'test/task.test.js',
        symbols: [['src/task.js', 'createTask']],
        source: {
          'src/task.js': "'use strict';\nlet seq = 0;\nfunction createTask(title) {\n  const t = String(title || '').trim();\n  if (!t) throw new Error('title required');\n  seq += 1;\n  return { id: `t${seq}`, title: t, done: false };\n}\nmodule.exports = { createTask };\n",
          'test/task.test.js': `${T}const { createTask } = require('../src/task.js');\ntest('[A1] cria aberta', () => assert.equal(createTask('a').done, false));\ntest('[A1] rejeita vazio', () => assert.throws(() => createTask(' ')));\n`,
        },
      },
      {
        id: 'T2', wave: 2, title: 'Store em memória', aceite: 'A2', dependsOn: ['T1'],
        criterion: 'store adiciona, lista e conclui tarefas',
        goal: 'Criar src/store.js exportando createStore(): { add(title), list(), complete(id) } usando createTask de src/task.js; complete devolve a tarefa ou null. E test/store.test.js [A2].',
        files: ['src/store.js', 'test/store.test.js'], test: 'test/store.test.js',
        symbols: [['src/store.js', 'createStore']],
        source: {
          'src/store.js': "'use strict';\nconst { createTask } = require('./task.js');\nfunction createStore() {\n  const items = [];\n  return {\n    add(title) { const t = createTask(title); items.push(t); return t; },\n    list() { return items.map((t) => ({ ...t })); },\n    complete(id) { const t = items.find((x) => x.id === id); if (!t) return null; t.done = true; return { ...t }; },\n  };\n}\nmodule.exports = { createStore };\n",
          'test/store.test.js': `${T}const { createStore } = require('../src/store.js');\ntest('[A2] add/list/complete', () => { const s = createStore(); const t = s.add('x'); assert.equal(s.list().length, 1); assert.equal(s.complete(t.id).done, true); assert.equal(s.complete('nope'), null); });\n`,
        },
      },
    ],
    oracle: `${T}const { createStore } = require('./src/store.js');\nconst { createTask } = require('./src/task.js');\ntest('F1 store', () => { const s = createStore(); const a = s.add('a'); s.add('b'); s.complete(a.id); const l = s.list(); assert.equal(l.length, 2); assert.equal(l.filter((t) => t.done).length, 1); });\ntest('F1 task', () => { assert.throws(() => createTask('')); assert.equal(typeof createTask('z').id, 'string'); });\n`,
  },
  {
    id: 'F2',
    title: 'API com token',
    scope: 'handler HTTP-like sobre o store, com autenticação por token',
    tasks: [
      {
        id: 'T1', wave: 1, title: 'Autenticação', aceite: 'A3',
        criterion: 'checkToken aceita só `Bearer <token>` correto',
        goal: 'Criar src/auth.js exportando checkToken(header, token): boolean (true só para "Bearer <token>"). E test/auth.test.js [A3].',
        files: ['src/auth.js', 'test/auth.test.js'], test: 'test/auth.test.js',
        symbols: [['src/auth.js', 'checkToken']],
        source: {
          'src/auth.js': "'use strict';\nfunction checkToken(header, token) {\n  return typeof header === 'string' && Boolean(token) && header === `Bearer ${token}`;\n}\nmodule.exports = { checkToken };\n",
          'test/auth.test.js': `${T}const { checkToken } = require('../src/auth.js');\ntest('[A3] token', () => { assert.equal(checkToken('Bearer k', 'k'), true); assert.equal(checkToken('Bearer x', 'k'), false); assert.equal(checkToken(undefined, 'k'), false); });\n`,
        },
      },
      {
        id: 'T2', wave: 2, title: 'Handler da API', aceite: 'A4', dependsOn: ['T1'],
        criterion: 'handle cria/lista/conclui tarefas e exige token',
        goal: 'Criar src/api.js exportando createApi(store, token) que devolve handle({ method, path, headers, body }): { status, body }. Rotas: POST /tasks {title} → 201 tarefa; GET /tasks → 200 lista; POST /tasks/:id/done → 200 ou 404. Sem token válido (headers.authorization, via checkToken) → 401. Título inválido → 400. Usa createStore da fase 1 pelo parâmetro store. E test/api.test.js [A4].',
        files: ['src/api.js', 'test/api.test.js'], test: 'test/api.test.js',
        symbols: [['src/api.js', 'createApi']],
        source: {
          'src/api.js': "'use strict';\nconst { checkToken } = require('./auth.js');\nfunction createApi(store, token) {\n  return function handle(req) {\n    const headers = (req && req.headers) || {};\n    if (!checkToken(headers.authorization, token)) return { status: 401, body: { error: 'unauthorized' } };\n    if (req.method === 'POST' && req.path === '/tasks') {\n      try { return { status: 201, body: store.add(req.body && req.body.title) }; } catch { return { status: 400, body: { error: 'invalid title' } }; }\n    }\n    if (req.method === 'GET' && req.path === '/tasks') return { status: 200, body: store.list() };\n    const m = /^\\/tasks\\/([^/]+)\\/done$/.exec(req.path || '');\n    if (req.method === 'POST' && m) { const t = store.complete(m[1]); return t ? { status: 200, body: t } : { status: 404, body: { error: 'not found' } }; }\n    return { status: 404, body: { error: 'no route' } };\n  };\n}\nmodule.exports = { createApi };\n",
          'test/api.test.js': `${T}const { createApi } = require('../src/api.js');\nconst { createStore } = require('../src/store.js');\nconst auth = { authorization: 'Bearer k' };\ntest('[A4] fluxo', () => { const h = createApi(createStore(), 'k'); assert.equal(h({ method: 'GET', path: '/tasks', headers: {} }).status, 401); const c = h({ method: 'POST', path: '/tasks', headers: auth, body: { title: 'a' } }); assert.equal(c.status, 201); assert.equal(h({ method: 'POST', path: '/tasks/' + c.body.id + '/done', headers: auth }).status, 200); assert.equal(h({ method: 'GET', path: '/tasks', headers: auth }).body[0].done, true); });\n`,
        },
      },
    ],
    oracle: `${T}const { createApi } = require('./src/api.js');\nconst { createStore } = require('./src/store.js');\nconst H = { authorization: 'Bearer s3cret' };\ntest('F2 auth', () => { const h = createApi(createStore(), 's3cret'); assert.equal(h({ method: 'GET', path: '/tasks', headers: { authorization: 'Bearer no' } }).status, 401); });\ntest('F2 crud', () => { const h = createApi(createStore(), 's3cret'); assert.equal(h({ method: 'POST', path: '/tasks', headers: H, body: { title: '' } }).status, 400); const c = h({ method: 'POST', path: '/tasks', headers: H, body: { title: 'x' } }); assert.equal(c.status, 201); assert.equal(h({ method: 'POST', path: '/tasks/zzz/done', headers: H }).status, 404); assert.equal(h({ method: 'POST', path: '/tasks/' + c.body.id + '/done', headers: H }).body.done, true); });\n`,
  },
  {
    id: 'F3',
    title: 'Relatórios e exportação',
    scope: 'resumo e CSV a partir do store',
    tasks: [
      {
        id: 'T1', wave: 1, title: 'Resumo', aceite: 'A5',
        criterion: 'summary conta total, concluídas e abertas',
        goal: 'Criar src/report.js exportando summary(store): { total, done, open } a partir de store.list(). E test/report.test.js [A5].',
        files: ['src/report.js', 'test/report.test.js'], test: 'test/report.test.js',
        symbols: [['src/report.js', 'summary']],
        source: {
          'src/report.js': "'use strict';\nfunction summary(store) {\n  const items = store.list();\n  const done = items.filter((t) => t.done).length;\n  return { total: items.length, done, open: items.length - done };\n}\nmodule.exports = { summary };\n",
          'test/report.test.js': `${T}const { summary } = require('../src/report.js');\nconst { createStore } = require('../src/store.js');\ntest('[A5] resumo', () => { const s = createStore(); const a = s.add('a'); s.add('b'); s.complete(a.id); assert.deepEqual(summary(s), { total: 2, done: 1, open: 1 }); });\n`,
        },
      },
      {
        id: 'T2', wave: 1, title: 'Exportação CSV', aceite: 'A6',
        criterion: 'toCsv gera cabeçalho id,title,done e escapa aspas',
        goal: 'Criar src/export.js exportando toCsv(store): string com cabeçalho "id,title,done" e uma linha por tarefa; títulos com vírgula ou aspas vão entre aspas com aspas duplicadas. E test/export.test.js [A6].',
        files: ['src/export.js', 'test/export.test.js'], test: 'test/export.test.js',
        symbols: [['src/export.js', 'toCsv']],
        source: {
          'src/export.js': "'use strict';\nfunction cell(v) { const s = String(v); return /[\",\\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s; }\nfunction toCsv(store) {\n  return ['id,title,done', ...store.list().map((t) => [t.id, t.title, t.done].map(cell).join(','))].join('\\n');\n}\nmodule.exports = { toCsv };\n",
          'test/export.test.js': `${T}const { toCsv } = require('../src/export.js');\nconst { createStore } = require('../src/store.js');\ntest('[A6] csv', () => { const s = createStore(); s.add('a, "b"'); const lines = toCsv(s).split('\\n'); assert.equal(lines[0], 'id,title,done'); assert.match(lines[1], /,"a, ""b""",false$/); });\n`,
        },
      },
    ],
    oracle: `${T}const { summary } = require('./src/report.js');\nconst { toCsv } = require('./src/export.js');\nconst { createStore } = require('./src/store.js');\ntest('F3 relatorios', () => { const s = createStore(); s.add('x'); const b = s.add('y,z'); s.complete(b.id); assert.deepEqual(summary(s), { total: 2, done: 1, open: 1 }); const csv = toCsv(s).split('\\n'); assert.equal(csv.length, 3); assert.match(csv[2], /,"y,z",true$/); });\n`,
  },
];

const ALL_A = PHASES.flatMap((p) => p.tasks.map((t) => t.aceite));

const AT = "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst src = (m) => require('../../src/' + m);\n";
/** Testes de aceite do plano (escritos no /oxe-plan, antes da execução): a interface exigida em código. */
const ACCEPTANCE = {
  A1: `${AT}test('A1', () => { const t = src('task.js').createTask('x'); assert.equal(t.done, false); assert.equal(typeof t.id, 'string'); assert.throws(() => src('task.js').createTask('')); });\n`,
  A2: `${AT}test('A2', () => { const s = src('store.js').createStore(); const t = s.add('a'); assert.equal(s.complete(t.id).done, true); assert.equal(s.complete('none'), null); });\n`,
  A3: `${AT}test('A3', () => { const { checkToken } = src('auth.js'); assert.equal(checkToken('Bearer k', 'k'), true); assert.equal(checkToken('k', 'k'), false); });\n`,
  A4: `${AT}test('A4: createApi devolve a função handle', () => { const handle = src('api.js').createApi(src('store.js').createStore(), 'k'); assert.equal(typeof handle, 'function'); assert.equal(handle({ method: 'GET', path: '/tasks', headers: {} }).status, 401); assert.equal(handle({ method: 'POST', path: '/tasks', headers: { authorization: 'Bearer k' }, body: { title: 'a' } }).status, 201); });\n`,
  A5: `${AT}test('A5', () => { const s = src('store.js').createStore(); s.add('a'); assert.deepEqual(src('report.js').summary(s), { total: 1, done: 0, open: 1 }); });\n`,
  A6: `${AT}test('A6', () => { const s = src('store.js').createStore(); s.add('q"x'); assert.equal(src('export.js').toCsv(s).split('\\n')[0], 'id,title,done'); });\n`,
};
const acceptancePath = (a) => `test/acceptance/${a.toLowerCase()}.test.js`;

// Leitura errada do e2e real 1.19: createApi devolve { handle } e o teste do executor concorda.
const MISREAD_API = {
  'src/api.js': "'use strict';\nconst { checkToken } = require('./auth.js');\nfunction createApi(store, token) {\n  function handle(req) {\n    if (!checkToken(((req && req.headers) || {}).authorization, token)) return { status: 401, body: {} };\n    if (req.method === 'POST' && req.path === '/tasks') { try { return { status: 201, body: store.add(req.body && req.body.title) }; } catch { return { status: 400, body: {} }; } }\n    if (req.method === 'GET' && req.path === '/tasks') return { status: 200, body: store.list() };\n    return { status: 404, body: {} };\n  }\n  return { handle };\n}\nmodule.exports = { createApi };\n",
  'test/api.test.js': "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst { createApi } = require('../src/api.js');\nconst { createStore } = require('../src/store.js');\ntest('[A4] api', () => { const api = createApi(createStore(), 'k'); assert.equal(api.handle({ method: 'GET', path: '/tasks', headers: {} }).status, 401); });\n",
};

function roadmapMd() {
  const blocks = PHASES.map((p, i) => `## Fase ${i + 1} — ${p.title}\n\n**Requisitos:** R${i + 1}\n**Critérios de aceite:** ${p.tasks.map((t) => t.aceite).join(', ')}\n**Escopo:** ${p.scope}\n`);
  return `---\noxe_doc: roadmap\nstatus: approved\n---\n\n# Roteiro de Entrega\n\n${blocks.join('\n')}`;
}

function specMd(phase) {
  const rows = phase.tasks.map((t) => `| ${t.aceite} | ${t.criterion} | \`node --test ${t.test}\` |`).join('\n');
  return `# OXE — SPEC\n\n## Objetivo\n\nTaskboard — ${phase.id}: ${phase.title}.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n${rows}\n`;
}

function planMd(phase) {
  const blocks = phase.tasks.map((t) => `### ${t.id} — ${t.title}

- **Arquivos alvo:** ${t.files.map((f) => `\`${f}\``).join(', ')}
- **Depende de:** ${t.dependsOn ? t.dependsOn.join(', ') : '—'}
- **Onda:** ${t.wave}
- **Implementar:** ${t.goal}
- **Verificar:**
  - Comando: \`node --test ${t.test}\`
- **Aceite vinculado:** ${t.aceite}
`).join('\n');
  return `# OXE — PLAN\n\n## Tarefas (${phase.id})\n\n${blocks}\n## Autoavaliação do Plano\n\n**Melhor plano atual:** sim\n**Confiança:** 95%\n`;
}

function planJson(phase) {
  return {
    schema_version: 1,
    phase: phase.id,
    tasks: phase.tasks.map((t) => ({
      id: t.id, title: t.title, wave: t.wave, depends_on: t.dependsOn || [], files: t.files,
      verify: { commands: [`node --test ${t.test}`] }, acceptance: [t.aceite], complexity: 'S',
    })),
    acceptance_tests: phase.tasks.map((t) => ({
      criterion: t.aceite,
      files: [acceptancePath(t.aceite)],
      command: `node --test ${acceptancePath(t.aceite)}`,
    })),
  };
}

function pack(phase) {
  return {
    tasks: phase.tasks.map((t) => ({
      id: t.id, mode: 'mutating', exact_paths: t.files, write_set: 'closed',
      symbols: t.symbols.map(([file, name]) => ({ kind: 'function', name, path: file })),
      // The same pack rules the execute preflight applies (OXB-022): a contract and the checks it must pass.
      contracts: [{ name: `${t.id}-contract`, input_shape: 'acceptance tests', output_shape: 'exports declared in symbols', invariants: ['frozen acceptance unchanged'], not_allowed: ['editing acceptance tests'] }],
      expected_checks: ['acceptance tests'],
    })),
  };
}

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
}

function makeProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-e2e-program-${name}-`));
  writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'taskboard', private: true, scripts: { test: 'node --test' } }, null, 2));
  writeFile(path.join(dir, '.gitignore'), '.oxe/\nnode_modules/\n');
  writeFile(path.join(dir, '.oxe', 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`spec_ready`\n');
  writeFile(path.join(dir, '.oxe', 'ROADMAP.md'), roadmapMd());
  // Greenfield fixture: no external reference and no fixture data — declared, as the preflight requires (OXB-028).
  writeFile(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md'), '# REFERENCE-ANCHORS\n\n<reference_anchors version="1" ready="true" status="not_applicable">\n</reference_anchors>\n');
  writeFile(path.join(dir, '.oxe', 'FIXTURE-PACK.json'), JSON.stringify({ schema_version: '1', ready: true, fixtures: [], status: 'not_applicable', reason: 'testes de aceite trazem os próprios dados' }, null, 2));
  if (git(dir, ['init', '-q']).status === 0) {
    git(dir, ['config', 'user.email', 'oxe-e2e@local']);
    git(dir, ['config', 'user.name', 'OXE e2e']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'init']);
  }
  return dir;
}

function writePhaseArtifacts(dir, phase) {
  writeFile(path.join(dir, '.oxe', 'SPEC.md'), specMd(phase));
  writeFile(path.join(dir, '.oxe', 'PLAN.md'), planMd(phase));
  writeFile(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(planJson(phase), null, 2));
  writeFile(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify(pack(phase), null, 2));
  // O planner escreve o aceite antes da execução (o runtime congela o hash no compile).
  for (const t of phase.tasks) writeFile(path.join(dir, acceptancePath(t.aceite)), ACCEPTANCE[t.aceite]);
}

/** Oráculo independente: testes de referência das fases dadas, numa cópia do `src/`. */
function oracle(dir, phases) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-program-oracle-'));
  try {
    fs.cpSync(path.join(dir, 'src'), path.join(sandbox, 'src'), { recursive: true });
    const per = {};
    for (const phase of phases) {
      const file = path.join(sandbox, `oracle-${phase.id}.test.js`);
      writeFile(file, phase.oracle);
      const res = spawnSync(process.execPath, ['--test', file], { cwd: sandbox, encoding: 'utf8', timeout: 60_000 });
      per[phase.id] = res.status === 0;
    }
    return { ok: Object.values(per).every(Boolean), phases: per };
  } catch (err) {
    return { ok: false, phases: {}, error: String(err && err.message ? err.message : err) };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

/** `breakFiles`: arquivos que o executor também sobrescreve (mutação de regressão). */
function scriptedExecutor(phase, breakFiles = {}) {
  return {
    async execute(node, lease) {
      const task = phase.tasks.find((t) => t.id === node.id);
      if (!task) return { success: false, failure_class: 'env', evidence: [], output: `tarefa desconhecida ${node.id}` };
      const files = { ...task.source, ...(task.id === phase.tasks[phase.tasks.length - 1].id ? breakFiles : {}) };
      for (const [rel, content] of Object.entries(files)) writeFile(path.join(lease.root_path, rel), content);
      return { success: true, failure_class: null, evidence: Object.keys(files), output: 'ok', completed_by: 'finish_task' };
    },
  };
}

function interfaceNames(dir, phase) {
  const provider = operational.buildNodeContextProvider(dir, null);
  const first = phase.tasks[0];
  const ctx = provider({ id: first.id, mutation_scope: first.files, depends_on: [] }, { root_path: dir });
  return (ctx.interfaces || []).flatMap((m) => m.exports.map((e) => `${m.file}#${e.name}`)).sort();
}


/** Handoff humano exigido pelo close (1.20): o que a próxima fase deve saber. */
function writeHandoff(dir, phase) {
  const r = operational.runtimeDossier(dir, null, { phase: phase.id });
  const file = path.join(r.dir, 'plan.md');
  const body = fs.readFileSync(file, 'utf8').replace('(preencher antes do `program close`)', `${phase.id} entrega ${phase.tasks.map((t) => t.symbols.map((x) => x[1]).join(', ')).join('; ')} — a próxima fase importa por esses nomes.`);
  fs.writeFileSync(file, body, 'utf8');
}

async function runPhase(dir, phase, executorOptions) {
  operational.runtimeProgramStart(dir, null, phase.id);
  writePhaseArtifacts(dir, phase);
  const lint = operational.runtimePlanLint(dir, null);
  const interfaces = interfaceNames(dir, phase);
  const executed = await operational.runRuntimeExecute(dir, null, { skipPreflight: true, ...executorOptions });
  const verified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 120_000 });
  writeHandoff(dir, phase);
  const closed = operational.runtimeProgramClose(dir, null, {});
  return { lint, interfaces, executed, verified, closed };
}

function phaseRecord(phase, step, truthUpToHere) {
  const closedByOxe = step.closed.closed === true;
  return {
    phase: phase.id,
    lint_ok: step.lint.ok,
    lint_errors: step.lint.errors,
    interfaces_in_context: step.interfaces,
    execute_status: step.executed.result.status,
    verify_status: step.verified.report.status,
    regression: step.verified.regression,
    closed: closedByOxe,
    gate_reasons: step.closed.gate ? step.closed.gate.reasons : [],
    commit: step.closed.commit ? step.closed.commit.commit : null,
    oracle: truthUpToHere,
    false_green: closedByOxe && !truthUpToHere.ok,
  };
}

async function runMockScenario(name, mutate, variant = null) {
  const dir = makeProject(name);
  try {
    operational.runtimeProgramInit(dir, null);
    const records = [];
    let mutationCaught = null;
    for (let i = 0; i < PHASES.length; i += 1) {
      const phase = PHASES[i];
      let breakFiles = mutate && phase.id === 'F3' ? { 'src/store.js': "'use strict';\nmodule.exports = {};\n" } : {};
      if (variant && phase.id === 'F2') {
        breakFiles = { ...MISREAD_API };
        if (variant === 'tamper') {
          breakFiles[acceptancePath('A4')] = ACCEPTANCE.A4.replace("assert.equal(typeof handle, 'function'); ", '').replace(/handle\(/g, 'handle.handle(');
        }
      }
      const step = await runPhase(dir, phase, { executor: scriptedExecutor(phase, breakFiles) });
      records.push(phaseRecord(phase, step, oracle(dir, PHASES.slice(0, i + 1))));
      if (variant && phase.id === 'F2') {
        const failed = (step.verified.report.check_results || []).filter((r) => r.status !== 'pass').map((r) => `${r.check_id}:${r.error || ''}`);
        const expected = variant === 'tamper' ? /check-accept-a4:acceptance_tampered/ : /check-accept-a4:/;
        mutationCaught = !step.closed.closed && failed.some((f) => expected.test(f));
        // Correção: interface certa + aceite original restaurado; re-executa e fecha.
        writeFile(path.join(dir, acceptancePath('A4')), ACCEPTANCE.A4);
        const reexecuted = await operational.runRuntimeExecute(dir, null, { skipPreflight: true, executor: scriptedExecutor(phase) });
        if (reexecuted.result.status !== 'completed') records.push({ phase: phase.id, reexecute_status: reexecuted.result.status });
        const reverified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 120_000 });
        const reclosed = operational.runtimeProgramClose(dir, null, {});
        records.push(phaseRecord(phase, { ...step, verified: reverified, closed: reclosed }, oracle(dir, PHASES.slice(0, i + 1))));
      }
      if (mutate && phase.id === 'F3') {
        const regFailed = step.verified.regression ? step.verified.regression.failed.map((f) => f.check_id) : [];
        mutationCaught = !step.closed.closed && regFailed.some((id) => id.startsWith('reg-f1-'));
        // Repara o store e re-executa a fase (o que o próximo /oxe-execute faria), depois fecha.
        writeFile(path.join(dir, 'src', 'store.js'), PHASES[0].tasks[1].source['src/store.js']);
        const reexecuted = await operational.runRuntimeExecute(dir, null, { skipPreflight: true, executor: scriptedExecutor(phase) });
        if (reexecuted.result.status !== 'completed') {
          records.push({ phase: phase.id, reexecute_status: reexecuted.result.status, failed: reexecuted.result.failed });
        }
        const reverified = await operational.runRuntimeVerify(dir, null, { timeoutMs: 120_000 });
        const reclosed = operational.runtimeProgramClose(dir, null, {});
        records.push(phaseRecord(phase, { ...step, verified: reverified, closed: reclosed }, oracle(dir, PHASES)));
      }
    }
    const status = operational.runtimeProgramStatus(dir, null);
    const finalOracle = oracle(dir, PHASES);
    const closedPhases = status.state.phases.filter((p) => p.status === 'closed').length;
    const commits = git(dir, ['log', '--format=%s']).stdout.split('\n').filter((s) => s.startsWith('feat(phase-'));
    const checks = {
      phases_closed: closedPhases,
      false_green: records.filter((r) => r.false_green).length,
      final_oracle_ok: finalOracle.ok,
      lint_ok: records.every((r) => r.lint_ok),
      // F2 enxerga a interface de F1; F3 enxerga F1 + F2.
      interfaces_flow: records.find((r) => r.phase === 'F2').interfaces_in_context.includes('src/store.js#createStore')
        && records.find((r) => r.phase === 'F3').interfaces_in_context.includes('src/api.js#createApi'),
      phase_commits: commits.length,
      mutation_caught: mutate || variant ? mutationCaught : null,
    };
    const ok = checks.phases_closed === PHASES.length && checks.false_green === 0 && checks.final_oracle_ok && checks.lint_ok
      && checks.interfaces_flow && (!(mutate || variant) || checks.mutation_caught === true);
    return { name, ok, checks, phases: records, dir: KEEP ? dir : null };
  } finally {
    if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runRealScenario() {
  const adapter = argValue('--adapter', 'claude');
  const model = argValue('--model', null);
  const dir = makeProject('real');
  const started = Date.now();
  const toolCalls = {};
  try {
    operational.runtimeProgramInit(dir, null);
    const records = [];
    for (let i = 0; i < PHASES.length; i += 1) {
      const phase = PHASES[i];
      const step = await runPhase(dir, phase, {
        adapter,
        adapterOptions: adapter === 'claude' ? { model } : {},
        providerConfig: {
          apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '',
          baseUrl: process.env.OXE_BASE_URL || 'https://api.anthropic.com/v1',
          model: model || process.env.OXE_MODEL || 'claude-sonnet-4-6',
          maxTurns: 15,
        },
        onProgress: (event) => {
          if (event && event.type === 'tool_call' && event.detail && event.detail.tool) {
            toolCalls[event.detail.tool] = (toolCalls[event.detail.tool] || 0) + 1;
          }
        },
      });
      const usage = operational.readExecutorUsageRows(dir, null, step.executed.result.run_id);
      const record = phaseRecord(phase, step, oracle(dir, PHASES.slice(0, i + 1)));
      record.usage = {
        attempts: usage.length,
        turns: usage.reduce((s, r) => s + (r.turns || 0), 0),
        cost_usd: Number(usage.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4)),
        turns_per_task: Number((usage.reduce((s, r) => s + (r.turns || 0), 0) / phase.tasks.length).toFixed(2)),
      };
      records.push(record);
      if (!step.closed.closed) break;
    }
    const finalOracle = oracle(dir, PHASES);
    const cost = records.reduce((s, r) => s + r.usage.cost_usd, 0);
    const tasks = PHASES.reduce((s, p) => s + p.tasks.length, 0);
    const f1 = records.find((r) => r.phase === 'F1');
    const f3 = records.find((r) => r.phase === 'F3');
    const checks = {
      phases_closed: records.filter((r) => r.closed).length,
      false_green: records.filter((r) => r.false_green).length,
      final_oracle_ok: finalOracle.ok,
      cost_usd: Number(cost.toFixed(4)),
      cost_per_task_usd: Number((cost / tasks).toFixed(4)),
      turns_per_task_f1: f1 ? f1.usage.turns_per_task : null,
      turns_per_task_f3: f3 ? f3.usage.turns_per_task : null,
      context_scales: Boolean(f1 && f3 && f3.usage.turns_per_task <= f1.usage.turns_per_task * 1.25),
      run_command_calls: toolCalls.run_command || 0,
    };
    const ok = checks.phases_closed === PHASES.length && checks.false_green === 0 && checks.final_oracle_ok;
    return { name: `real-${adapter}`, adapter, model, ok, checks, phases: records, tool_calls: toolCalls, duration_ms: Date.now() - started, dir: KEEP ? dir : null };
  } finally {
    if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  const results = REAL
    ? [await runRealScenario()]
    : [
      await runMockScenario('honest', false),
      await runMockScenario('regression-mutation', true),
      await runMockScenario('misread-interface', false, 'misread'),
      await runMockScenario('tampered-acceptance', false, 'tamper'),
    ];
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    suite: 'e2e-program',
    mode: REAL ? 'real' : 'mock',
    fixture: { name: 'taskboard', phases: PHASES.length, tasks: PHASES.reduce((s, p) => s + p.tasks.length, 0), acceptance: ALL_A },
    kpis: {
      false_green_count: results.reduce((s, r) => s + r.checks.false_green, 0),
      phases_closed: results.map((r) => r.checks.phases_closed),
      mutation_caught: results.map((r) => r.checks.mutation_caught).filter((v) => v !== null && v !== undefined),
      ...(REAL ? { cost_usd: results[0].checks.cost_usd, cost_per_task_usd: results[0].checks.cost_per_task_usd, context_scales: results[0].checks.context_scales } : {}),
    },
    summary: { total: results.length, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, all_passed: results.every((r) => r.ok) },
    results,
  };
  writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  if (!report.summary.all_passed) {
    console.error(`e2e-program: FAIL (${report.summary.fail}/${report.summary.total})`);
    for (const r of results.filter((x) => !x.ok)) console.error(`- ${r.name}: ${JSON.stringify(r.checks)}`);
    console.error(`report: ${REPORT_PATH}`);
    process.exit(1);
  }
  const tail = REAL
    ? ` · US$ ${report.kpis.cost_usd.toFixed(2)} · turnos/tarefa F1 ${results[0].checks.turns_per_task_f1} → F3 ${results[0].checks.turns_per_task_f3}`
    : ` · regressão, leitura errada de interface e aceite adulterado detectados`;
  console.log(`e2e-program: OK (${report.summary.pass}/${report.summary.total}) · ${PHASES.length}/${PHASES.length} fases · falso verde ${report.kpis.false_green_count}${tail}`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
