# OXE — Workflow: quick

<objective>
Registrar trabalho **rápido a médio** sem SPEC/PLAN completos: objetivo claro, passos curtos e uma verificação. Saída principal: **`.oxe/QUICK.md`** + atualização de **`.oxe/STATE.md`**.

Usar quando: correção pontual, refactor local, uma feature pequena, ou protótipo que **não** justifica critérios de aceite longos.
</objective>

<context>
- Ler `.oxe/STATE.md` e, se existirem, `OVERVIEW.md` e `STACK.md` em `.oxe/codebase/` para não contradizer o repo.
- Não apagar `SPEC.md` / `PLAN.md` se existirem; este fluxo é paralelo ou temporário.
</context>

## Quando promover para spec + plan (obrigatório declarar no QUICK.md)

Promova **nesta sessão ou na próxima** se **qualquer** condição for verdadeira:

- Mais de **~8 arquivos** tocados ou previstos.
- Mudança de **contrato público** (API HTTP, schema de dados exposto, eventos, SDK).
- **Segurança**, **dados pessoais**, **auth** ou **conformidade** envolvidos.
- O próprio quick ficar com **mais de 10 passos** — dividir ou passar a SPEC.

No final de **`.oxe/QUICK.md`**, mantenha a linha:

- **Promover para spec/plan?** `sim` | `não` + **uma linha** com o critério que aplicou.

Se **sim**, o próximo passo recomendado no chat é **`/oxe-spec`** (depois discuss/plan conforme config).

<process>
1. Garantir `.oxe/` (usar template de STATE só se `STATE.md` não existir).
2. Criar ou substituir **`.oxe/QUICK.md`** com:
   - **Objetivo** — uma frase.
   - **Contexto** — 2–5 bullets (arquivos/pastas já vistos).
   - **Passos** — lista numerada, **máximo 10** passos acionáveis.
   - **Verificar** — pelo menos um: comando de terminal (ex.: `npm test`) **ou** checklist manual explícito.
   - **Promover para spec/plan?** — conforme seção acima.
3. Atualizar **`.oxe/STATE.md`**: fase `quick_active`, próximo passo `oxe:execute` ou implementação manual + `oxe:verify`.
4. Responder no chat com resumo em ≤8 linhas e o comando de verificação escolhido; se promover = sim, destacar **`/oxe-spec`** como próximo passo lógico.
</process>

<success_criteria>
- [ ] `.oxe/QUICK.md` existe com passos e bloco **Verificar**.
- [ ] `STATE.md` reflete fase `quick_active` e próximo passo coerente.
- [ ] Fica explícito quando **promover** para spec/plan (regra acima + campo no arquivo).
</success_criteria>
