# OXE — Workflow: quick

<objective>
Registar trabalho **rápido a médio** sem SPEC/PLAN completos: objetivo claro, passos curtos e uma verificação. Saída principal: **`.oxe/QUICK.md`** + atualização de **`.oxe/STATE.md`**.

Usar quando: correção pontual, refactor local, uma feature pequena, ou protótipo que **não** justifica critérios de aceite longos.

**Promover para fluxo completo** (spec → plan) se: tocar em **mais de ~8 ficheiros**, alterar **contrato público** (API, schema, eventos), ou houver **risco de segurança/dados**.
</objective>

<context>
- Ler `.oxe/STATE.md` e, se existirem, `OVERVIEW.md` e `STACK.md` em `.oxe/codebase/` para não contradizer o repo.
- Não apagar `SPEC.md` / `PLAN.md` se existirem; este fluxo é paralelo ou temporário.
</context>

<process>
1. Garantir `.oxe/` (usar `oxe/templates/STATE.md` só se `STATE.md` não existir).
2. Criar ou substituir **`.oxe/QUICK.md`** com:
   - **Objetivo** — uma frase.
   - **Contexto** — 2–5 bullets (ficheiros/pastas já vistos).
   - **Passos** — lista numerada, **máximo 10** passos acionáveis.
   - **Verificar** — pelo menos um: comando de terminal (ex. `npm test`) **ou** checklist manual explícito.
   - **Promover para spec/plan?** — sim/não + critério (uma linha).
3. Atualizar **`.oxe/STATE.md`**: fase `quick_active`, próximo passo `oxe:execute` ou implementação manual + `oxe:verify` (se usares plano completo depois, volta a `oxe:spec`).
4. Responder no chat com resumo em ≤8 linhas e o comando de verificação escolhido.
</process>

<success_criteria>
- [ ] `.oxe/QUICK.md` existe com passos e bloco **Verificar**.
- [ ] `STATE.md` reflete fase `quick_active` e próximo passo coerente.
- [ ] Fica explícito quando **não** usar quick (promoção a spec/plan).
</success_criteria>
