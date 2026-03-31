# OXE — Workflow: discuss

<objective>
Esclarecer requisitos **antes** do plano: registar perguntas, respostas e decisões em **`.oxe/DISCUSS.md`**, e atualizar **`.oxe/STATE.md`**. Inspirado na fase “discuss” de fluxos tipo GSD, mantido enxuto (máx. **7** perguntas).

Usar quando: SPEC existe mas há ambiguidade, risco técnico, ou `discuss_before_plan: true` em `.oxe/config.json`.
</objective>

<context>
- Ler `.oxe/SPEC.md`, `.oxe/STATE.md` e trechos relevantes de `.oxe/codebase/OVERVIEW.md` / `STACK.md`.
- Se `.oxe/config.json` existir e `discuss_before_plan` for `true`, tratar este passo como **recomendado** antes de `oxe:plan`.
</context>

<process>
1. Se não existir `.oxe/SPEC.md`, pedir **spec** primeiro (ou **quick** se for trabalho trivial).
2. Identificar **lacunas** (escopo, dados, UX, edge cases, compatibilidade) — no máximo **7** perguntas objetivas.
3. Criar ou atualizar **`.oxe/DISCUSS.md`** com estrutura fixa:
   - **Contexto** — 2–4 bullets do que já se sabe da SPEC.
   - **Perguntas** — numeradas; para cada uma: resposta (se o utilizador já respondeu na mensagem) ou `_(pendente)_`.
   - **Decisões** — bullets com decisão + data (só as já fechadas).
   - **Implicações para o plano** — bullets (ex.: “migrations necessárias”, “feature flag”).
4. Se ainda houver perguntas **pendentes** críticas, listá-las no chat (máx. 7) e parar até resposta; depois atualizar DISCUSS.md.
5. Atualizar **`.oxe/STATE.md`**: fase `discuss_complete` (ou `spec_ready` se preferires manter spec como fase principal e discutir como subpasso), próximo passo `oxe:plan`.
6. Resumo no chat em ≤8 linhas.
</process>

<success_criteria>
- [ ] `.oxe/DISCUSS.md` existe com perguntas e decisões alinhadas à SPEC.
- [ ] Nenhuma ambiguidade crítica ficou sem registo (como pendente ou suposição explícita na SPEC).
- [ ] `STATE.md` indica próximo passo **plan**.
</success_criteria>
