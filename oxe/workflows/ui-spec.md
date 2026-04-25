# OXE — Workflow: ui-spec

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-spec`.
> Use: `/oxe-spec --ui` para gerar o contrato UI/UX ao final da spec.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Produzir **`.oxe/UI-SPEC.md`**: contrato de UI/UX derivado de **`.oxe/SPEC.md`** (e mapas em `.oxe/codebase/` quando útil), para **planear e verificar** trabalho front-end na mesma trilha OXE.

**Ordem:** só depois de existir SPEC com critérios; antes ou em paralelo cognitivo ao **`plan`** (o PLAN deve poder referenciar secções do UI-SPEC).
</objective>

<context>
- Se o projeto **não** tiver interface (só API/CLI/backend), não gerar UI-SPEC; indicar no chat que esta vertical não se aplica.
- Não substituir a SPEC: UI-SPEC **refina** entrega visual/UX alinhada aos **A***.
- Secções obrigatórias em `UI-SPEC.md`: **Âmbito** (ecrãs/componentes), **Design system**, **Tokens**, **Estados** (vazio/carregamento/erro/sucesso), **Copywriting**, **Acessibilidade** (foco, labels, teclado), **Breakpoints**, **Registry safety** e **Checker sign-off**.
- Agentes úteis: `oxe-ui-researcher` cria o contrato; `oxe-ui-checker` valida se ele é implementável antes do plano.
</context>

<process>
1. Resolver `active_session` conforme `session-path-resolution.md`; ler `SPEC.md` do escopo resolvido e, se existirem, `OVERVIEW.md` / `CONVENTIONS.md` em `.oxe/codebase/`.
2. Criar ou atualizar **`UI-SPEC.md`** em `.oxe/<active_session>/spec/` (ou `.oxe/` legado) com as secções acima preenchidas de forma verificável (checklist ou critérios numerados **U1**, **U2**… opcionais). Se componente externo/registry for citado, registrar origem, inspeção mínima e risco.
3. Atualizar **`.oxe/STATE.md`** global: nota de fase ou próximo passo `oxe:plan` (se ainda não há PLAN) ou manter `oxe:execute` se o plano já referencia UI.
4. Resumo no chat: o que ficou no UI-SPEC e como o **`/oxe-plan`** deve citar as secções (ex.: “cumprir UI-SPEC §2”).
</process>

<success_criteria>
- [ ] `UI-SPEC.md` existe apenas quando há entrega UI real prevista na SPEC.
- [ ] Conteúdo é verificável (estados, a11y, responsividade quando relevante).
- [ ] Não antecede uma SPEC vazia ou inexistente.
</success_criteria>
