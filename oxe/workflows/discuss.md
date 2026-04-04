# OXE — Workflow: discuss

<objective>
Esclarecer requisitos **antes** do plano: registrar perguntas, respostas e decisões em **`.oxe/DISCUSS.md`**, e atualizar **`.oxe/STATE.md`**. Mantido enxuto (máx. **7** perguntas).

Usar quando: SPEC existe mas há ambiguidade, risco técnico, ou `discuss_before_plan: true` em `.oxe/config.json`.
</objective>

<context>
- Ler `.oxe/SPEC.md`, `.oxe/STATE.md` e trechos relevantes de `.oxe/codebase/OVERVIEW.md` / `STACK.md`.
- Se existir **`.oxe/OBSERVATIONS.md`** com entradas `pendente` de impacto `spec`, `plan` ou `all`, carregá-las como contexto adicional para as perguntas e decisões; marcá-las `incorporada → discuss (data)` após uso.
- Se existir **`.oxe/NOTES.md`**, rever bullets em aberto: promover para perguntas/decisões em `DISCUSS.md` ou marcar como *descartado* / *adiado* com uma linha de justificativa.
- Se `.oxe/config.json` existir e `discuss_before_plan` for `true`, tratar este passo como **recomendado** antes de `oxe:plan`.
</context>

<decision_ids>
Toda decisão fechada em `DISCUSS.md` recebe um **ID estável** com prefixo `D-` e número sequencial: **D-01**, **D-02**, …

Regras:
1. O ID é atribuído **quando a decisão é registrada** (não quando a pergunta é feita).
2. IDs não são reutilizados — se uma decisão for revertida, registrar a reversão com novo ID (`D-05: Revertendo D-02 — novo comportamento X`) e marcar D-02 como `*(revertida por D-05)*`.
3. `PLAN.md` deve referenciar os IDs nas tarefas (campo **Decisão vinculada:** `D-01, D-03`).
4. `VERIFY.md` deve cruzar os IDs na seção **Fidelidade de decisões**.
5. O ID é o vínculo de rastreabilidade discuss → plan → verify.
</decision_ids>

<process>
1. Se não existir `.oxe/SPEC.md`, pedir **spec** primeiro (ou **quick** se for trabalho trivial).
2. Se existir **`.oxe/NOTES.md`**, rever bullets em aberto e decidir o que entra em **Perguntas** ou **Decisões** (ou marcar *descartado* / *adiado* com justificativa curta).
3. Identificar **lacunas** (escopo, dados, UX, edge cases, compatibilidade) — no máximo **7** perguntas objetivas.
4. Criar ou atualizar **`.oxe/DISCUSS.md`** com estrutura fixa:
   - **Contexto** — 2–4 bullets do que já se sabe da SPEC.
   - **Perguntas** — numeradas; para cada uma: resposta (se o usuário já respondeu na mensagem) ou `_(pendente)_`.
   - **Decisões** — tabela com colunas **ID** / **Decisão** / **Data** / **Impacto no plano** (só as já fechadas). Atribuir IDs **D-01**, **D-02**, … em sequência.
   - **Implicações para o plano** — bullets (ex.: "migrations necessárias", "feature flag").
5. Se ainda houver perguntas **pendentes** críticas, listá-las no chat (máx. 7) e parar até resposta; depois atualizar DISCUSS.md.
6. Atualizar **`.oxe/STATE.md`**: fase `discuss_complete`, próximo passo `oxe:plan`. Registrar os IDs de decisão na seção **Decisões persistentes** do STATE (ex.: `D-01: escolheu JWT — 2025-01-15`).
7. Resumo no chat em ≤8 linhas, listando decisões com seus IDs.
</process>

<discuss_md_format>
```markdown
---
oxe_doc: discuss
status: (open | closed)
updated: YYYY-MM-DD
---

# OXE — Discuss

## Contexto
- …

## Perguntas

1. **[pergunta]**
   - Resposta: … / _(pendente)_

## Decisões

| ID   | Decisão                          | Data       | Impacto no plano                      |
|------|----------------------------------|------------|---------------------------------------|
| D-01 | (decisão clara e acionável)      | YYYY-MM-DD | (como afeta tarefas / arquivos)       |
| D-02 | …                                | …          | …                                     |

## Implicações para o plano
- …
```
</discuss_md_format>

<success_criteria>
- [ ] `.oxe/DISCUSS.md` existe com perguntas e decisões alinhadas à SPEC.
- [ ] Cada decisão fechada tem ID único **D-NN** na tabela de Decisões.
- [ ] Se existir `.oxe/NOTES.md`, as entradas relevantes foram tratadas (promovidas, descartadas ou adiadas com nota).
- [ ] Nenhuma ambiguidade crítica ficou sem registro (como pendente ou suposição explícita na SPEC).
- [ ] `STATE.md` indica próximo passo **plan** e lista IDs de decisão em **Decisões persistentes**.
</success_criteria>
