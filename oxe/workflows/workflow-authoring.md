# OXE — Workflow: workflow-authoring (revisão de um passo)

<objective>
Rever **um** ficheiro de workflow indicado pelo utilizador (caminho explícito ou relativo ao repo) contra o guia **`oxe/templates/WORKFLOW_AUTHORING.md`** (ou `.oxe/templates/` após instalação). Produzir feedback acionável: cortes, outcomes mais claros, divisão em `references/` ou templates, alinhamento de tags — **sem** gerar código de terceiros nem copiar conteúdo de outros ecossistemas.
</objective>

<context>
- O guia canónico no pacote é **`oxe/templates/WORKFLOW_AUTHORING.md`**; no projeto pode estar em **`.oxe/templates/WORKFLOW_AUTHORING.md`** (layout aninhado).
- Se o utilizador não der path, pedir o ficheiro alvo (ex.: `oxe/workflows/spec.md` ou `.oxe/workflows/plan.md`).
- Não alterar ficheiros no disco **a menos que** o utilizador peça explicitamente aplicação das alterações.
</context>

<process>
1. Ler o guia `WORKFLOW_AUTHORING.md` (resumo mental das secções: outcome-first, tags, progressive disclosure, frontmatter, script vs agente, `.oxe/`).
2. Ler o workflow alvo na íntegra.
3. Avaliar:
   - **Outcome-first:** parágrafos redundantes ou que não melhoram o resultado em `.oxe/` ou na resposta do passo.
   - **Estrutura:** presença e ordem de `<objective>`, `<context>`, `<process>`; critérios em `<success_criteria>` ou equivalente documentado (`<success>`, `<output>` em `help.md`, `<format_plan>` em `plan.md`).
   - **Tamanho:** se justifica extração para `oxe/workflows/references/` ou reutilização em `oxe/templates/`.
   - **Verificação:** o que poderia ser comando/CI em vez de instrução vaga ao modelo.
4. Responder com secções fixas:
   - **Resumo** (2–4 frases).
   - **Pontos fortes** (lista curta).
   - **Sugestões** (numeradas, cada uma com *o quê* e *por quê*).
   - **Proposta opcional de estrutura** (outline de ficheiros se dividir).
5. Se o ficheiro violar só convenções leves (ex.: falta de checklist), referir que `oxe-cc doctor` / SDK podem avisar com `WORKFLOW_SHAPE` quando configurado no projeto.
</process>

<success_criteria>
- [ ] O path do workflow revisto foi confirmado ou pedido ao utilizador.
- [ ] O feedback referencia explicitamente pelo menos um critério do guia (outcome-first, tags, progressive disclosure ou script vs agente).
- [ ] Nenhuma sugestão copia texto ou estrutura proprietária de produtos externos; só práticas genéricas e o guia OXE.
- [ ] A saída é acionável (o autor sabe o que editar a seguir).
</success_criteria>
