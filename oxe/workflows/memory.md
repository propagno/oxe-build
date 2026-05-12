# OXE — Workflow: memory (Memory Kernel)

<objective>
Protocolo de recuperação de memória para o Conductor Agent.
Lê as 4 camadas de memória do OXE na ordem correta, filtra por relevância ao objetivo atual
e retorna um context pack para injeção antes de qualquer execução (Agent Mode ou Swarm Mode).
</objective>

<context>
- Invocado por `conduct.md` Fase 2 (Memory Retrieval).
- Não modifica artefatos de projeto. Apenas lê e grava em `.oxe/memory/retrieved/`.
- Reaproveitamento: `buildMemoryLayers()` em `bin/lib/oxe-operational.cjs:2364` define a ordem das camadas.
- Reaproveitamento: `extractSemanticFragment()` em `bin/lib/oxe-context-engine.cjs` para extração filtrada.
- Parâmetros de entrada: `intent_tags`, `phase` (conduct|spec|plan|execute|verify), `objective`.
</context>

---

## Camadas de memória (ordem de leitura)

| # | Camada | Arquivo | Conteúdo |
|---|--------|---------|----------|
| 1 | runtime_state | `.oxe/STATE.md` | Fase atual, sessão ativa, run ativo |
| 2 | session_memory | `.oxe/<session>/SESSION.md` | Contexto da sessão ativa (se existir) |
| 3 | project_memory | `.oxe/memory/REPO-MEMORY.md` | Decisões cross-session, pitfalls, preferências |
| 4 | lessons | `.oxe/global/LESSONS.md` | Lições de ciclos anteriores |
| 5 | observations | `.oxe/OBSERVATIONS.md` | Observações pendentes |

---

## Fase 1 — Leitura das camadas

Para cada camada, verificar se o arquivo existe. Se não existir, pular silenciosamente.

**Filtro de relevância:** para cada camada, extrair apenas seções que contenham pelo menos uma das `intent_tags` no texto, ou que estejam marcadas com `Aplicar em` compatível com a `phase` atual.

**Para LESSONS.md:** filtrar por:
- `Status: ativo`
- `Impacto: alto` (prioridade máxima) ou `Frequência >= 2` (lições recorrentes)
- `Aplicar em` contém a `phase` atual

**Para OBSERVATIONS.md:** filtrar por:
- `Status: pendente`
- `Impacto` inclui a `phase` atual ou `all`

---

## Fase 2 — Ranking por relevância

Para cada fragmento extraído, atribuir score de relevância:

| Critério | Score |
|---------|-------|
| Tag exata em intent_tags | +3 |
| Impacto: alto | +2 |
| Frequência >= 3 | +2 |
| Phase match exato | +2 |
| Frequência >= 2 | +1 |
| Menção ao objetivo (palavras-chave) | +1 |

Ordenar fragmentos por score decrescente. Manter top-10 para injeção (ou todos se < 10).

---

## Fase 3 — Geração do Context Pack

Gerar arquivo de injeção baseado no mode:

**Agent Mode** → `.oxe/agent/MEMORY-INJECTIONS.md`
**Swarm Mode** → `.oxe/swarm/DECISIONS.md` (seção "Contexto de Memória")

Formato do context pack:
```markdown
## Contexto de Memória — <phase> / <timestamp>

**Objetivo:** <texto>
**Intent Tags:** <lista>
**Fontes:** <camadas lidas>

### Lições aplicáveis
<fragmentos de LESSONS.md ordenados por relevância>

### Pitfalls conhecidos
<fragmentos de REPO-MEMORY.md relevantes>

### Observações pendentes
<fragmentos de OBSERVATIONS.md com impacto na fase atual>

### Estado atual
<fragmento de STATE.md>
```

---

## Fase 4 — Snapshot rastreável

Gravar snapshot do contexto injetado em `.oxe/memory/retrieved/<phase>.md` para auditoria.

Se o diretório `.oxe/memory/retrieved/` não existir, criar.

---

## Estrutura `.oxe/memory/REPO-MEMORY.md`

Quando criado pela primeira vez (após primeiro swarm run completo), deve seguir:

```markdown
# Memória do Repositório

> Memória cross-session. Atualizada automaticamente pelo Learning Kernel ao final de cada Swarm Run.
> Contém decisões arquiteturais, pitfalls recorrentes e preferências do projeto.

## Decisões Arquiteturais

| ID | Decisão | Contexto | Data |
|----|---------|----------|------|

## Pitfalls Conhecidos

| ID | Problema | Causa | Solução | Frequência |
|----|---------|-------|---------|-----------|

## Preferências do Projeto

| Categoria | Preferência | Fonte |
|-----------|------------|-------|

## Padrões Validados

| Padrão | Contexto | Data |
|--------|---------|------|
```

---

## Estrutura `.oxe/memory/MEMORY-INDEX.json`

```json
{
  "updated_at": "ISO8601",
  "entries": [
    {
      "id": "MEM-001",
      "type": "lesson | pitfall | decision | preference | pattern",
      "phase": ["spec", "plan", "execute", "verify", "conduct"],
      "relevance_tags": ["backend", "auth"],
      "source": ".oxe/global/LESSONS.md#C-01-L1",
      "summary": "Uma frase resumindo o conteúdo",
      "created_at": "ISO8601",
      "last_applied": "ISO8601",
      "apply_count": 2
    }
  ]
}
```

<success_criteria>
- [ ] Camadas lidas na ordem correta (runtime_state → session → project → lessons → observations).
- [ ] Filtro de relevância aplicado por intent_tags e phase.
- [ ] Context pack gerado no caminho correto (agent ou swarm).
- [ ] Snapshot gravado em `.oxe/memory/retrieved/<phase>.md`.
- [ ] Arquivos ausentes pular silenciosamente (sem erro).
</success_criteria>
