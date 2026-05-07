'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../lib/sdk/index.cjs');

const { parsePlan, parseSpec, validateDecisionFidelity } = sdk;

// ---------------------------------------------------------------------------
// parsePlan
// ---------------------------------------------------------------------------

describe('parsePlan', () => {
  it('string vazia retorna estrutura vazia', () => {
    const r = parsePlan('');
    assert.deepEqual(r, { tasks: [], waves: {}, totalTasks: 0 });
  });

  it('PLAN.md bem-formado extrai tarefas, ondas e dependencias', () => {
    const md = `
## Tarefas

### T1 — Criar endpoint de login
- **Arquivos prováveis:** \`src/auth.ts\`, \`src/routes.ts\`
- **Depende de:** —
- **Onda:** 1
- **Complexidade:** M
- **Verificar:**
  - Comando: \`npm test -- auth\`
- **Implementar:** Criar rota POST /login.
- **Aceite vinculado:** A1, A2
<!-- oxe-task: {"id":"T1","wave":1,"type":"feature","files":[],"done":false,"complexity":"M"} -->

### T2 — Criar middleware JWT
- **Arquivos prováveis:** \`src/middleware/jwt.ts\`
- **Depende de:** T1
- **Onda:** 2
- **Complexidade:** S
- **Verificar:**
  - Comando: \`npm test -- jwt\`
- **Implementar:** Implementar verificação de token.
- **Aceite vinculado:** A3
- **Decisão vinculada:** D-01, D-02
<!-- oxe-task: {"id":"T2","wave":2,"type":"feature","files":[],"done":false,"complexity":"S"} -->
`;
    const r = parsePlan(md);
    assert.equal(r.totalTasks, 2);
    assert.equal(r.tasks[0].id, 'T1');
    assert.equal(r.tasks[0].wave, 1);
    assert.deepEqual(r.tasks[0].dependsOn, []);
    assert.deepEqual(r.tasks[0].aceite, ['A1', 'A2']);
    assert.deepEqual(r.tasks[0].decisions, []);
    assert.equal(r.tasks[0].verifyCommand, 'npm test -- auth');
    assert.equal(r.tasks[0].done, false);
    assert.equal(r.tasks[1].id, 'T2');
    assert.equal(r.tasks[1].wave, 2);
    assert.deepEqual(r.tasks[1].dependsOn, ['T1']);
    assert.deepEqual(r.tasks[1].aceite, ['A3']);
    assert.deepEqual(r.tasks[1].decisions, ['D-01', 'D-02']);
    assert.deepEqual(r.waves, { 1: ['T1'], 2: ['T2'] });
  });

  it('meta done:true marca tarefa como concluida', () => {
    const md = `
### T1 — Tarefa concluida
- **Onda:** 1
- **Aceite vinculado:** A1
<!-- oxe-task: {"id":"T1","wave":1,"done":true} -->
`;
    const r = parsePlan(md);
    assert.equal(r.tasks[0].done, true);
  });

  it('meta JSON malformado resulta em meta:null sem quebrar', () => {
    const md = `
### T1 — Tarefa com meta quebrado
- **Onda:** 1
- **Aceite vinculado:** A1
<!-- oxe-task: {id: broken json -->
`;
    const r = parsePlan(md);
    assert.equal(r.tasks[0].meta, null);
    assert.equal(r.tasks[0].done, false);
  });

  it('tarefa sem Onda fica wave:null e nao entra em waves', () => {
    const md = `
### T1 — Tarefa sem onda
- **Aceite vinculado:** A1
`;
    const r = parsePlan(md);
    assert.equal(r.tasks[0].wave, null);
    assert.deepEqual(r.waves, {});
  });

  it('task ID multi-digito (T10, T15) parseia corretamente', () => {
    const md = `
### T10 — Decima tarefa
- **Onda:** 3
- **Depende de:** T1, T9
- **Aceite vinculado:** A10
<!-- oxe-task: {"id":"T10","wave":3,"done":false} -->

### T15 — Decima quinta tarefa
- **Onda:** 3
- **Aceite vinculado:** A15
<!-- oxe-task: {"id":"T15","wave":3,"done":false} -->
`;
    const r = parsePlan(md);
    assert.equal(r.tasks[0].id, 'T10');
    assert.deepEqual(r.tasks[0].dependsOn, ['T1', 'T9']);
    assert.equal(r.tasks[1].id, 'T15');
    assert.deepEqual(r.waves[3], ['T10', 'T15']);
  });

  it('verifyCommand: formato bold **Verificação:**', () => {
    const md = `
### T1 — Tarefa
- **Onda:** 1
- **Verificação:** \`npm test\`
`;
    assert.equal(parsePlan(md).tasks[0].verifyCommand, 'npm test');
  });

  it('verifyCommand: formato bold **Verify command:**', () => {
    const md = `
### T1 — Tarefa
- **Onda:** 1
- **Verify command:** \`node --test\`
`;
    assert.equal(parsePlan(md).tasks[0].verifyCommand, 'node --test');
  });

  it('verifyCommand: formato bold **Verification:**', () => {
    const md = `
### T1 — Tarefa
- **Onda:** 1
- **Verification:** \`pytest\`
`;
    assert.equal(parsePlan(md).tasks[0].verifyCommand, 'pytest');
  });

  it('tarefa sem aceite, files e decisions retorna arrays vazios', () => {
    const md = `
### T1 — Tarefa minima
- **Onda:** 1
`;
    const r = parsePlan(md);
    assert.deepEqual(r.tasks[0].aceite, []);
    assert.deepEqual(r.tasks[0].files, []);
    assert.deepEqual(r.tasks[0].decisions, []);
    assert.equal(r.tasks[0].verifyCommand, null);
  });

  it('multiplos arquivos provaveis sao extraidos corretamente', () => {
    const md = `
### T1 — Tarefa com arquivos
- **Arquivos prováveis:** \`src/a.ts\`, \`src/b.ts\`, \`tests/c.test.ts\`
- **Onda:** 1
`;
    const r = parsePlan(md);
    assert.deepEqual(r.tasks[0].files, ['src/a.ts', 'src/b.ts', 'tests/c.test.ts']);
  });
});

// ---------------------------------------------------------------------------
// parseSpec
// ---------------------------------------------------------------------------

describe('parseSpec', () => {
  it('string vazia retorna estrutura vazia', () => {
    const r = parseSpec('');
    assert.deepEqual(r, { objective: null, criteria: [], requiredSections: [] });
  });

  it('SPEC.md bem-formado extrai objetivo e criterios', () => {
    const md = `
## Objetivo

Implementar autenticação JWT para a API REST.

## Critérios de aceite

| ID | Critério | Como verificar |
|----|----------|----------------|
| A1 | Login retorna token | GET /me com token retorna 200 |
| A2 | Token expirado retorna 401 | GET /me com token vencido retorna 401 |
| A3 | Sem token retorna 401 | GET /me sem header retorna 401 |

## Suposições
`;
    const r = parseSpec(md);
    assert.equal(r.objective, 'Implementar autenticação JWT para a API REST.');
    assert.equal(r.criteria.length, 3);
    assert.equal(r.criteria[0].id, 'A1');
    assert.equal(r.criteria[1].id, 'A2');
    assert.equal(r.criteria[2].id, 'A3');
    assert.ok(r.criteria[0].howToVerify.includes('200'));
    assert.ok(r.requiredSections.includes('## Objetivo'));
    assert.ok(r.requiredSections.includes('## Suposições'));
  });

  it('SPEC sem tabela de criterios retorna criteria vazio', () => {
    const md = `
## Objetivo

Refatorar módulo de pagamentos.

## Escopo
`;
    const r = parseSpec(md);
    assert.equal(r.objective, 'Refatorar módulo de pagamentos.');
    assert.deepEqual(r.criteria, []);
  });

  it('linha separadora |---|---| nao e incluida nos criterios', () => {
    const md = `
## Critérios de aceite

| ID | Critério | Como verificar |
|----|----------|----------------|
| A1 | Critério um | via teste |
`;
    const r = parseSpec(md);
    assert.equal(r.criteria.length, 1);
    assert.equal(r.criteria[0].id, 'A1');
  });

  it('criterio sem terceira coluna tem howToVerify vazio', () => {
    const md = `
## Critérios de aceite

| ID | Critério |
|----|----------|
| A1 | Apenas descricao |
`;
    const r = parseSpec(md);
    assert.equal(r.criteria[0].id, 'A1');
    assert.equal(r.criteria[0].howToVerify, '');
  });

  it('multiplos headings aparecem em requiredSections', () => {
    const md = `
## Objetivo
Texto.
## Escopo
Texto.
## Critérios de aceite
Texto.
## Suposições
Texto.
`;
    const r = parseSpec(md);
    assert.ok(r.requiredSections.includes('## Objetivo'));
    assert.ok(r.requiredSections.includes('## Escopo'));
    assert.ok(r.requiredSections.includes('## Critérios de aceite'));
    assert.ok(r.requiredSections.includes('## Suposições'));
    assert.equal(r.requiredSections.length, 4);
  });

  it('SPEC sem secao Objetivo retorna objective:null', () => {
    const md = `
## Escopo
Apenas escopo sem objetivo.
`;
    const r = parseSpec(md);
    assert.equal(r.objective, null);
  });
});

// ---------------------------------------------------------------------------
// validateDecisionFidelity
// ---------------------------------------------------------------------------

describe('validateDecisionFidelity', () => {
  it('discuss sem decisoes retorna ok:true e listas vazias', () => {
    const discuss = `
## Contexto
Sem decisoes ainda.
`;
    const plan = `
### T1 — Tarefa
- **Onda:** 1
- **Aceite vinculado:** A1
`;
    const r = validateDecisionFidelity(discuss, plan);
    assert.equal(r.ok, true);
    assert.deepEqual(r.gaps, []);
    assert.deepEqual(r.covered, []);
  });

  it('decisao coberta por tarefa aparece em covered', () => {
    const discuss = `
## Decisões

| ID | Decisão | Data |
|----|---------|------|
| D-01 | Usar JWT para autenticação | 2026-04-01 |
`;
    const plan = `
### T1 — Implementar JWT
- **Onda:** 1
- **Aceite vinculado:** A1
- **Decisão vinculada:** D-01
<!-- oxe-task: {"id":"T1","wave":1,"done":false} -->
`;
    const r = validateDecisionFidelity(discuss, plan);
    assert.equal(r.ok, true);
    assert.equal(r.gaps.length, 0);
    assert.equal(r.covered.length, 1);
    assert.equal(r.covered[0].decisionId, 'D-01');
    assert.deepEqual(r.covered[0].taskIds, ['T1']);
  });

  it('decisao sem tarefa vinculada aparece em gaps e ok:false', () => {
    const discuss = `
## Decisões

| ID | Decisão | Data |
|----|---------|------|
| D-01 | Usar JWT | 2026-04-01 |
| D-02 | Usar Redis para cache | 2026-04-01 |
`;
    const plan = `
### T1 — Implementar JWT
- **Onda:** 1
- **Aceite vinculado:** A1
- **Decisão vinculada:** D-01
<!-- oxe-task: {"id":"T1","wave":1,"done":false} -->
`;
    const r = validateDecisionFidelity(discuss, plan);
    assert.equal(r.ok, false);
    assert.equal(r.gaps.length, 1);
    assert.equal(r.gaps[0].decisionId, 'D-02');
    assert.equal(r.covered.length, 1);
  });

  it('decisao revertida e ignorada no gap check', () => {
    const discuss = `
## Decisões

| ID | Decisão | Data |
|----|---------|------|
| D-01 | Usar JWT | 2026-04-01 |
| D-02 | *(revertida por D-03)* Usar sessao de cookie | 2026-04-01 |
| D-03 | Revertendo D-02 — usar token no header | 2026-04-02 |
`;
    const plan = `
### T1 — Implementar autenticacao
- **Onda:** 1
- **Aceite vinculado:** A1
- **Decisão vinculada:** D-01, D-03
<!-- oxe-task: {"id":"T1","wave":1,"done":false} -->
`;
    const r = validateDecisionFidelity(discuss, plan);
    assert.equal(r.ok, true);
    assert.equal(r.gaps.length, 0);
    assert.equal(r.covered.length, 2);
  });

  it('mix: coberta, nao-coberta e revertida', () => {
    const discuss = `
## Decisões

| ID | Decisão | Data |
|----|---------|------|
| D-01 | Usar JWT | 2026-04-01 |
| D-02 | Usar Postgres | 2026-04-01 |
| D-03 | *(revertida)* Usar Mongo | 2026-04-01 |
`;
    const plan = `
### T1 — Auth
- **Onda:** 1
- **Aceite vinculado:** A1
- **Decisão vinculada:** D-01
<!-- oxe-task: {"id":"T1","wave":1,"done":false} -->
`;
    const r = validateDecisionFidelity(discuss, plan);
    assert.equal(r.ok, false);
    assert.equal(r.gaps.length, 1);
    assert.equal(r.gaps[0].decisionId, 'D-02');
    assert.equal(r.covered.length, 1);
    assert.equal(r.covered[0].decisionId, 'D-01');
  });

  it('plano sem tarefas e discuss com decisoes — todas sao gaps', () => {
    const discuss = `
## Decisões

| ID | Decisão | Data |
|----|---------|------|
| D-01 | Decisao A | 2026-04-01 |
| D-02 | Decisao B | 2026-04-01 |
`;
    const r = validateDecisionFidelity(discuss, '');
    assert.equal(r.ok, false);
    assert.equal(r.gaps.length, 2);
    assert.equal(r.covered.length, 0);
  });
});
