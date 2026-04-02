# OXE — Workflow: ui-spec

<objective>
Produzir **`.oxe/UI-SPEC.md`**: contrato de UI/UX derivado de **`.oxe/SPEC.md`** (e mapas em `.oxe/codebase/` quando útil), para **planear e verificar** trabalho front-end na mesma trilha OXE.

**Ordem:** só depois de existir SPEC com critérios; antes ou em paralelo cognitivo ao **`plan`** (o PLAN deve poder referenciar secções do UI-SPEC).
</objective>

<context>
- Se o projeto **não** tiver interface (só API/CLI/backend), não gerar UI-SPEC; indicar no chat que esta vertical não se aplica.
- Não substituir a SPEC: UI-SPEC **refina** entrega visual/UX alinhada aos **A***.
- Secções sugeridas em `UI-SPEC.md`: **Âmbito** (ecrãs/componentes), **Estados** (vazio/carregamento/erro/sucesso), **Acessibilidade** (foco, labels, teclado), **Breakpoints** (se aplicável), **Tokens ou estilo** (ligação a design system existente, se houver).
</context>

<process>
1. Ler `.oxe/SPEC.md` e, se existirem, `OVERVIEW.md` / `CONVENTIONS.md` em `.oxe/codebase/`.
2. Criar ou atualizar **`.oxe/UI-SPEC.md`** com as secções acima preenchidas de forma verificável (checklist ou critérios numerados **U1**, **U2**… opcionais).
3. Atualizar **`.oxe/STATE.md`**: nota de fase ou próximo passo `oxe:plan` (se ainda não há PLAN) ou manter `oxe:execute` se o plano já referencia UI.
4. Resumo no chat: o que ficou no UI-SPEC e como o **`/oxe-plan`** deve citar as secções (ex.: “cumprir UI-SPEC §2”).
</process>

<success_criteria>
- [ ] `UI-SPEC.md` existe apenas quando há entrega UI real prevista na SPEC.
- [ ] Conteúdo é verificável (estados, a11y, responsividade quando relevante).
- [ ] Não antecede uma SPEC vazia ou inexistente.
</success_criteria>
