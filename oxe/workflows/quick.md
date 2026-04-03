# OXE — Workflow: quick

<objective>
Registrar trabalho **rápido a médio** sem SPEC/PLAN completos: objetivo claro, passos curtos e uma verificação. Saída principal: **`.oxe/QUICK.md`** + atualização de **`.oxe/STATE.md`**.

Usar quando: correção pontual, refactor local, uma feature pequena, ou protótipo que **não** justifica critérios de aceite longos.
</objective>

<context>
- Ler `.oxe/STATE.md` e, se existirem, `OVERVIEW.md` e `STACK.md` em `.oxe/codebase/` para não contradizer o repo.
- Não apagar `SPEC.md` / `PLAN.md` se existirem; este fluxo é paralelo ou temporário.
- **Blueprint plan-agent:** este fluxo **não** reutiliza papéis (`role` / `scope`) de **`.oxe/plan-agents.json`**. Se existir `plan-agents.json` com **`oxePlanAgentsSchema: 2`** e `lifecycle.status` **não** for já `invalidated`, **invalidar** o blueprint após criar/substituir **`QUICK.md`**: `lifecycle: { "status": "invalidated", "since": "<ISO>", "invalidatedBy": "quick", "invalidatedReason": "oxe-quick substitui trilha focada do blueprint" }`. Actualizar **`.oxe/STATE.md`** — secção **Blueprint de agentes (sessão)**: **lifecycle_status** → `invalidated`, nota “invalidado por quick”. Não escrever novas mensagens em **`.oxe/plan-agent-messages/`** para o `runId` invalidado.
</context>

## Perfil fast (modo trivial)

Uso **sem** novo slash: é o mesmo `/oxe-quick` com redação mínima.

- **Objetivo** — uma frase no `.oxe/QUICK.md`.
- **Passos** — lista numerada, **máximo 10**; cada passo acionável numa linha.
- **Verificar** — um comando de terminal **ou** checklist manual explícito.
- **Promover para spec/plan?** — preencher sempre; se qualquer gatilho abaixo for verdadeiro, resposta **sim** e parar de acumular trabalho no QUICK — passar a **`/oxe-spec`** (e depois discuss/plan conforme config).

O perfil fast **não** é uma segunda trilha: continua sujeito à mesma promoção obrigatória quando o trabalho deixa de ser trivial.

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
3. Se existir **`.oxe/plan-agents.json`** com schema 2 e lifecycle ainda não `invalidated`, aplicar a invalidação descrita em **context** (actualizar JSON + **STATE.md** — blueprint de agentes).
4. Atualizar **`.oxe/STATE.md`**: fase `quick_active`, próximo passo `oxe:execute` ou implementação manual + `oxe:verify`.
5. Responder no chat com resumo em ≤8 linhas e o comando de verificação escolhido; se promover = sim, destacar **`/oxe-spec`** como próximo passo lógico; se o blueprint foi invalidado, mencionar **`/oxe-plan-agent`** para novo roteiro com agentes.
</process>

<success_criteria>
- [ ] `.oxe/QUICK.md` existe com passos e bloco **Verificar**.
- [ ] `STATE.md` reflete fase `quick_active` e próximo passo coerente.
- [ ] Fica explícito quando **promover** para spec/plan (regra acima + campo no arquivo).
- [ ] Se havia blueprint schema 2 activo, `plan-agents.json` e `STATE.md` reflectem **`invalidated`** por quick.
</success_criteria>
