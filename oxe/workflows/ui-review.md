# OXE — Workflow: ui-review

<objective>
Produzir **`.oxe/UI-REVIEW.md`**: auditoria da implementação UI face a **`.oxe/UI-SPEC.md`** (e critérios **A*** da SPEC quando tocarem UI), tipicamente **após** trabalho de implementação e **antes** ou **como entrada** para **`verify`**.

Não substitui **`verify`**: cruza contrato UI; o verify global continua a amarrar PLAN + SPEC + evidência técnica.
</objective>

<context>
- Se não existir `UI-SPEC.md`, pedir **`/oxe-ui-spec`** primeiro ou documentar em UI-REVIEW que a revisão é **ad hoc** (menos preferível).
- Incluir checklist curta (ex.: pilares: semântica, foco, contraste, mensagens de erro, mobile).
- **Bloqueios P0** (ex.: inacessível, fluxo quebrado) devem ser listados explicitamente; P1/P2 como melhorias.
</context>

<process>
1. Ler `.oxe/UI-SPEC.md`, `.oxe/SPEC.md` e inspecionar ficheiros de UI relevantes (paths do PLAN ou indicados pelo utilizador).
2. Escrever **`.oxe/UI-REVIEW.md`** com: **Data**, **Âmbito revisto**, **Checklist** (passou / falhou / N/A), **Bloqueios**, **Sugestões**.
3. Atualizar **`.oxe/STATE.md`** se útil (referência a UI-REVIEW pendente de verify).
4. Indicar no chat: se há P0 → próximo passo típico **`/oxe-execute`** (correções); senão **`/oxe-verify`** para fecho global.
</process>

<success_criteria>
- [ ] `UI-REVIEW.md` referencia secções do `UI-SPEC.md` quando existir.
- [ ] Bloqueios P0 são explícitos ou declarado que não há.
- [ ] Fica claro que **`/oxe-verify`** ainda é necessário para a trilha.
</success_criteria>
