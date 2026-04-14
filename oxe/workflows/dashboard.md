# OXE — Workflow: dashboard

<objective>
Gerar ou atualizar uma camada visual opcional para acompanhar execução, agentes, ondas, checkpoints e verify, usando apenas artefatos OXE como fonte de verdade.
</objective>

<context>
- A visualização é opcional e não substitui `.oxe/STATE.md`, `PLAN.md`, runtime operacional nem `VERIFY.md`.
- A dashboard deve refletir o estado atual, nunca inventar progresso.
- Quando criar `PLAN-REVIEW.md`, usar `oxe/templates/PLAN-REVIEW.template.md` como estrutura inicial.
</context>

<process>
1. Ler `.oxe/STATE.md`, runtime operacional (`ACTIVE-RUN.json`, `OXE-EVENTS.ndjson`), blueprint de agentes e `VERIFY.md` quando existirem.
2. Consolidar: fase, onda atual, agentes, checkpoints, bloqueios e evidências.
3. Gerar ou atualizar o artefato de saída:
   - **Dashboard inline (padrão):** resumo em texto/Markdown no chat com a visão atual.
   - **`PLAN-REVIEW.md` (revisão de equipe):** quando o utilizador pedir revisão colaborativa, escrever em **`.oxe/PLAN-REVIEW.md`** usando `oxe/templates/PLAN-REVIEW.template.md` como estrutura inicial.
   - **Dashboard visual (`oxe-cc dashboard`):** aponta para `localhost` — este workflow não inicia o servidor; orienta o utilizador a correr `npx oxe-cc dashboard`.
4. Se faltar runtime operacional, explicar a lacuna antes de tentar visualizar.
</process>

<success_criteria>
- [ ] A dashboard usa somente artefatos OXE como entrada.
- [ ] Conflitos entre artefatos são explicitados.
- [ ] O artefato de saída é identificado: inline (chat) ou `.oxe/PLAN-REVIEW.md` (em disco, se pedido).
</success_criteria>
