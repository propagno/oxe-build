---
oxe_doc: lessons
updated: YYYY-MM-DD
---

# Lições Aprendidas OXE

<!-- Consumido automaticamente por /oxe-spec, /oxe-plan, /oxe-execute, /oxe-verify -->
<!-- Cada entrada é PRESCRITIVA: diz o que fazer diferente, não apenas o que aconteceu -->

| Ciclo | Data | Tipo | Lição (resumo) | Aplicar em | Status |
|-------|------|------|----------------|------------|--------|
| C-01 | YYYY-MM-DD | plan | Tarefas de integração requerem Complexidade L mínimo | /oxe-plan | ativo |

---

### C-01 — YYYY-MM-DD

**Fonte:** VERIFY.md (gaps) + FORENSICS.md (causa raiz)

---

**L-01** · Tipo: `plan`
**Lição:** Tarefas que integram APIs de terceiros devem ter `Complexidade: L` mínimo e `Verificar` com mock como fallback quando API estiver indisponível.
**Raiz do problema:** T4 foi marcada `M` mas envolveu 3 serviços externos — estorou 2 ondas.
**Aplicar em:** `/oxe-plan` — ao planejar tarefas com `INTEGRATIONS.md` externos, elevar complexidade automaticamente.
**Status:** ativo

---

**L-02** · Tipo: `spec`
**Lição:** Critérios A* que envolvem "performance" devem incluir métrica mensurável (ex.: "< 200ms p95 em carga de 100 req/s") desde a Fase 3.
**Raiz do problema:** A3 dizia "resposta rápida" — verify não conseguiu evidência objetiva.
**Aplicar em:** `/oxe-spec` Fase 3 — ao criar critérios de performance, pedir métrica específica antes de aprovar o requisito.
**Status:** ativo

---

**L-03** · Tipo: `process`
**Lição:** Quando o plano tem 3+ domínios distintos, sempre usar `/oxe-plan --agents`. Solo em 3+ domínios gera tarefas com contexto insuficiente.
**Raiz do problema:** plano solo com auth + API + UI causou tarefas que misturavam contexto de 2 domínios.
**Aplicar em:** `/oxe-plan` — gate de sugestão de `--agents` já existe; reforçar como obrigatório para 3+.
**Status:** ativo
