# OXE — Walkthrough Reproduzível

> Feature: "Adicionar endpoint REST `GET /api/items` de listagem paginada"
>
> Tempo estimado: 20 minutos. Todos os comandos são reproduzíveis — copie e execute.

---

## Pré-requisitos

```bash
npx oxe-cc doctor
# ✓ Node 18+
# ✓ Workflows presentes
# ✓ Estrutura base .oxe/
```

Se algum item falhar, siga o conselho exibido antes de continuar.

---

## Passo 1 — Descobrir onde você está

```
/oxe
```

**Output esperado (projeto novo):**
```
Estado atual: init
Próximo passo recomendado: /oxe-scan
Motivo: nenhum mapeamento de codebase encontrado em .oxe/codebase/
```

**Artefato gerado:** nenhum (apenas diagnóstico)

---

## Passo 2 — Mapear o codebase

```
/oxe-scan
```

**Output esperado:**
```
Scan completo.
Arquivos mapeados: 47
Módulos detectados: routes/, controllers/, services/, tests/
Artefato: .oxe/codebase/map.json
```

**Artefato gerado:** `.oxe/codebase/map.json`

---

## Passo 3 — Gerar critérios de aceite

```
/oxe-spec

> Adicionar endpoint GET /api/items com paginação (page, limit). Retornar lista de items e metadados de paginação.
```

**Output esperado:**
```
SPEC.md gerado.
Critérios A* (bloqueantes):
  A1. GET /api/items retorna 200 com lista de items
  A2. Parâmetros page e limit são aceitos e validados
  A3. Resposta inclui { items: [...], total, page, limit }
  A4. Testes de integração cobrem os 3 critérios acima

Critérios B (desejáveis):
  B1. Cursor inválido retorna 400 com mensagem clara
  B2. Documentação OpenAPI atualizada
```

**Artefato gerado:** `.oxe/SPEC.md`

Revise os critérios. Se estiverem corretos, avance.

---

## Passo 4 — Planejar a implementação

```
/oxe-plan
```

**Output esperado:**
```
PLAN.md gerado.
Onda 1 (obrigatória):
  T1. Criar route GET /api/items em routes/items.js
  T2. Implementar ItemsController.list() com paginação
  T3. Implementar ItemsService.findPaginated(page, limit)
  T4. Escrever testes de integração para os 3 critérios A*

Hipótese crítica: ItemsService tem acesso ao repositório de dados correto
Arquivos-alvo: routes/items.js, controllers/items.js, services/items.js, tests/items.test.js
```

**Artefato gerado:** `.oxe/PLAN.md`

---

## Passo 5 — Implementar

```
/oxe-execute
```

O executor vai implementar T1→T4 em sequência, marcando cada tarefa concluída.

**Output esperado ao final:**
```
Onda 1 completa.
T1 ✓ routes/items.js — route criada
T2 ✓ controllers/items.js — ItemsController.list() implementado
T3 ✓ services/items.js — ItemsService.findPaginated() implementado
T4 ✓ tests/items.test.js — 4 testes de integração passando

Estado: execute_complete
```

**Para executar uma tarefa específica:**
```
/oxe-execute --task T3
```

---

## Passo 6 — Verificar

```
/oxe-verify
```

**Output esperado:**
```
Verificação completa.

A1 ✓ GET /api/items retorna 200 — evidência: tests/items.test.js:12
A2 ✓ Parâmetros page e limit validados — evidência: controllers/items.js:34
A3 ✓ Resposta inclui {items, total, page, limit} — evidência: controllers/items.js:41
A4 ✓ Testes cobrem A1–A3 — evidência: tests/items.test.js (4 testes)

Riscos residuais: nenhum
Estado: verify_complete
```

**Artefato gerado:** `.oxe/VERIFY.md`

---

## Passo 7 — Gate de aprovação (opcional, runtime-first)

Se o projeto usa runtime gates:

```bash
npx oxe-cc runtime gates list --dir .
```

**Output esperado:**
```
Gates pendentes: 1
  ⏳ gate-001  tipo: verify_complete  estado: pending
               ação sugerida: approve
               impacto: bloqueia promoção para pr_draft
```

Para aprovar:
```bash
npx oxe-cc runtime gates resolve --dir . --gate gate-001 --decision approve --actor "seu-nome"
```

**Output esperado:**
```
✓ Gate gate-001 aprovado.
Run pode avançar para promoção — nenhum gate restante.
```

---

## Passo 8 — Promover para PR draft

```bash
npx oxe-cc runtime promote --dir . --target pr_draft
```

**Output esperado:**
```
Promoção para pr_draft iniciada.
Branch: feature/items-endpoint
VERIFY.md incluído como evidência
PR draft criado: https://github.com/seu-org/repo/pull/42
```

---

## Estado final dos artefatos

```
.oxe/
├── STATE.md          # fase: verify_complete (ou pr_draft após promote)
├── SPEC.md           # critérios A1–A4 + B1–B2
├── PLAN.md           # ondas e tarefas T1–T4
├── VERIFY.md         # evidências para cada critério A*
└── codebase/
    └── map.json      # mapa do projeto
```

---

## Validação rápida

```bash
npx oxe-cc status
```

**Output esperado:**
```
Estado: verify_complete
Próximo passo: runtime promote --target pr_draft (ou abrir PR manualmente)
SPEC: 4 critérios A* — todos verificados
VERIFY.md: presente
Gates pendentes: 0
```

---

## Se algo der errado

| Sintoma | Comando |
|---------|---------|
| Travado em uma tarefa | `/oxe-debug` |
| Critério A* não verificado | `/oxe-verify` + revisar implementação |
| Gate stale (>24h) | Ver [`docs/INCIDENT-PLAYBOOK.md`](INCIDENT-PLAYBOOK.md) |
| Plano desatualizado | `/oxe-plan` novamente (sobrescreve PLAN.md) |
| Estado incoerente | `npx oxe-cc status --full` + `/oxe` para rediagnóstico |
