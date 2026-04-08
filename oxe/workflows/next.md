# OXE — Workflow: next

<objective>
Inspecionar `.oxe/STATE.md` global, a sessão ativa quando existir, e a existência de `SPEC.md`, `PLAN.md`, `QUICK.md`, `VERIFY.md` e `.oxe/codebase/` para recomendar **exatamente um** próximo passo OXE e **uma** frase de justificativa — sem lista de alternativas equiparáveis.
</objective>

<context>
- O usuário pode rodar **`npx oxe-cc status`** no terminal para a mesma lógica resumida. **`npx oxe-cc status --hints`** (ou **`--json --hints`**) acrescenta lembretes **paralelos** (idade do scan/compact por config) — **não** altera o único passo canónico que este workflow deve devolver.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, preferir os artefatos da sessão antes de olhar a raiz legada.
- Se houver empate aparente (ex.: poderia ser spec ou quick), preferir **spec** quando já existir mapa de codebase; preferir **quick** só se o usuário deixar explícito que é correção mínima.
- **Blueprint plan-agent:** se **`.oxe/plan-agents.json`** tiver `lifecycle.status === "invalidated"`, o próximo passo **não** assume papéis desse JSON; continuar a raciocinar só com **PLAN.md** / **QUICK.md** / **VERIFY.md** e **STATE.md**. Se o utilizador quiser de novo agentes + mensagens, indicar **`/oxe-plan-agent`**.
- Priorizar sempre o passo que **reduz incerteza primeiro**. Se o plano existente não for o melhor plano atual ou estiver abaixo do limiar de confiança, o próximo passo não pode ser `execute`.
</context>

<process>
1. Se `.oxe/` ou `STATE.md` não existir → **único** passo: **scan** (ou `oxe-cc init-oxe` seguido de scan).
2. Se não houver `.oxe/codebase/*.md` completos (sete mapas) e o trabalho **não** for só um quick isolado → **scan**.
3. Se fase `quick_active` ou existir `QUICK.md` no escopo resolvido **sem** `PLAN.md`:
   - Se `QUICK.md` contiver linha `Promover para spec/plan?: sim` → **spec** (promoção declarada pelo autor; ignorar demais heurísticas).
   - Se o `QUICK.md` tiver **mais de 10 passos**, ou o utilizador/descrição indicar **contrato público**, **segurança**, **dados pessoais**, ou **>8 ficheiros** tocados ou previstos → **spec** (promoção obrigatória).
   - Senão → **execute** (há passos curtos a implementar).
4. Se não houver `SPEC.md` no escopo resolvido e não for quick intencional declarado → **spec** (passo único).
5. Se houver SPEC no escopo resolvido mas não PLAN → se `.oxe/config.json` tiver `discuss_before_plan: true` e faltar **`DISCUSS.md`** com decisões → **discuss**; senão → **plan**.
6. Se PLAN existe mas a seção **Autoavaliação do Plano** disser `Melhor plano atual: não`, ou a `Confiança` estiver abaixo do limiar configurado (padrão 70%), o próximo passo deve ser **plan** (replanejar) ou **discuss/research** se a própria autoavaliação indicar isso.
7. Se PLAN existe, **VERIFY.md** ainda **não** existe ou está claramente antes da implementação atual → **execute** (onda atual).
8. Se PLAN existe e VERIFY falta após implementação declarada → **verify**.
9. Se VERIFY indica falha ou gaps não resolvidos → **plan** (replanejamento) como passo único, com referência a `SUMMARY.md`.
10. Se VERIFY OK e estado coerente → **spec** ou **quick** para **próxima** entrega, ou mensagem “fluxo da feature atual concluído”.

**Saída obrigatória (só isto, nesta ordem):**

- **Próximo passo:** um único entre `scan` | `spec` | `discuss` | `plan` | `quick` | `execute` | `verify`
- **Comando:** o slash correspondente (ex.: `/oxe-scan`) **ou** `npx oxe-cc status` para conferir de novo
- **Por quê:** uma frase
- **Artefatos em jogo:** lista curta (máx. 4 itens)
</process>

<success_criteria>
- [ ] Foi indicado **exatamente um** próximo passo entre os valores canónicos (`scan`, `spec`, `discuss`, `plan`, `quick`, `execute`, `verify`) ou mensagem explícita de fluxo concluído.
- [ ] A justificativa é **uma** frase; não há lista equiparável de alternativas como “próximo passo”.
- [ ] O comando sugerido corresponde ao passo (slash `/oxe-*` ou `npx oxe-cc status` quando aplicável).
- [ ] **Artefatos em jogo** tem no máximo quatro itens e são caminhos ou nomes reais em `.oxe/`.
</success_criteria>
