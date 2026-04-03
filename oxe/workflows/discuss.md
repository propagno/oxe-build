# OXE — Workflow: discuss

<objective>
Esclarecer requisitos **antes** do plano: registrar perguntas, respostas e decisões em **`.oxe/DISCUSS.md`**, e atualizar **`.oxe/STATE.md`**. Mantido enxuto (máx. **7** perguntas).

Usar quando: SPEC existe mas há ambiguidade, risco técnico, ou `discuss_before_plan: true` em `.oxe/config.json`.
</objective>

<context>
- Ler `.oxe/SPEC.md`, `.oxe/STATE.md` e trechos relevantes de `.oxe/codebase/OVERVIEW.md` / `STACK.md`.
- Se existir **`.oxe/NOTES.md`**, rever bullets em aberto: promover para perguntas/decisões em `DISCUSS.md` ou marcar como *descartado* / *adiado* com uma linha de justificativa.
- Se `.oxe/config.json` existir e `discuss_before_plan` for `true`, tratar este passo como **recomendado** antes de `oxe:plan`.
</context>

<process>
1. Se não existir `.oxe/SPEC.md`, pedir **spec** primeiro (ou **quick** se for trabalho trivial).
2. Se existir **`.oxe/NOTES.md`**, rever bullets em aberto e decidir o que entra em **Perguntas** ou **Decisões** (ou marcar *descartado* / *adiado* com justificativa curta).
3. Identificar **lacunas** (escopo, dados, UX, edge cases, compatibilidade) — no máximo **7** perguntas objetivas.
4. Criar ou atualizar **`.oxe/DISCUSS.md`** com estrutura fixa:
   - **Contexto** — 2–4 bullets do que já se sabe da SPEC.
   - **Perguntas** — numeradas; para cada uma: resposta (se o usuário já respondeu na mensagem) ou `_(pendente)_`.
   - **Decisões** — bullets com decisão + data (só as já fechadas).
   - **Implicações para o plano** — bullets (ex.: “migrations necessárias”, “feature flag”).
5. Se ainda houver perguntas **pendentes** críticas, listá-las no chat (máx. 7) e parar até resposta; depois atualizar DISCUSS.md.
6. Atualizar **`.oxe/STATE.md`**: fase `discuss_complete`, próximo passo `oxe:plan`.
7. Resumo no chat em ≤8 linhas.
</process>

<success_criteria>
- [ ] `.oxe/DISCUSS.md` existe com perguntas e decisões alinhadas à SPEC.
- [ ] Se existir `.oxe/NOTES.md`, as entradas relevantes foram tratadas (promovidas, descartadas ou adiadas com nota).
- [ ] Nenhuma ambiguidade crítica ficou sem registro (como pendente ou suposição explícita na SPEC).
- [ ] `STATE.md` indica próximo passo **plan**.
</success_criteria>
