# OXE — Workflow: ui-review

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-verify`.
> Use: `/oxe-verify --ui` para incluir auditoria de implementação UI.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Produzir **`.oxe/UI-REVIEW.md`**: auditoria da implementação UI face a **`.oxe/UI-SPEC.md`** (e critérios **A*** da SPEC quando tocarem UI), tipicamente **após** trabalho de implementação e **antes** ou **como entrada** para **`verify`**.

Não substitui **`verify`**: cruza contrato UI; o verify global continua a amarrar PLAN + SPEC + evidência técnica.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-review.md`. A revisão UI deve começar pelos achados e bloqueios, não por resumo.
- Se não existir `UI-SPEC.md`, pedir **`/oxe-ui-spec`** primeiro ou documentar em UI-REVIEW que a revisão é **ad hoc** (menos preferível).
- Incluir checklist curta (ex.: pilares: semântica, foco, contraste, mensagens de erro, mobile).
- **Bloqueios P0** (ex.: inacessível, fluxo quebrado) devem ser listados explicitamente; P1/P2 como melhorias.
</context>

<process>
1. Resolver `active_session` conforme `session-path-resolution.md`; ler `UI-SPEC.md` e `SPEC.md` do escopo resolvido e inspecionar ficheiros de UI relevantes (paths do PLAN ou indicados pelo utilizador).
2. Escrever **`UI-REVIEW.md`** no escopo de `verification/` da sessão ativa (ou `.oxe/` legado) com: **Data**, **Âmbito revisto**, **Checklist** (passou / falhou / N/A), **Bloqueios**, **Sugestões**.
3. Atualizar **`.oxe/STATE.md`** global se útil (referência a UI-REVIEW pendente de verify).
4. Indicar no chat nesta ordem:
   - **Findings**
   - **Perguntas abertas**
   - **Riscos residuais**
   - **Resumo**
   Se há P0 → próximo passo típico **`/oxe-execute`** (correções); senão **`/oxe-verify`** para fecho global.
</process>

<success_criteria>
- [ ] `UI-REVIEW.md` referencia secções do `UI-SPEC.md` quando existir.
- [ ] Bloqueios P0 são explícitos ou declarado que não há.
- [ ] Fica claro que **`/oxe-verify`** ainda é necessário para a trilha.
</success_criteria>
