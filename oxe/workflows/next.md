# OXE — Workflow: next

<objective>
Inspecionar `.oxe/STATE.md` e a existência de `SPEC.md`, `PLAN.md`, `QUICK.md`, `VERIFY.md` e `.oxe/codebase/` para recomendar **exatamente um** próximo passo OXE e **uma** frase de justificativa — sem lista de alternativas equiparáveis.
</objective>

<context>
- O usuário pode rodar **`npx oxe-cc status`** no terminal para a mesma lógica resumida.
- Se houver empate aparente (ex.: poderia ser spec ou quick), preferir **spec** quando já existir mapa de codebase; preferir **quick** só se o usuário deixar explícito que é correção mínima.
</context>

<process>
1. Se `.oxe/` ou `STATE.md` não existir → **único** passo: **scan** (ou `oxe-cc init-oxe` seguido de scan).
2. Se não houver `.oxe/codebase/*.md` completos (sete mapas) e o trabalho **não** for só um quick isolado → **scan**.
3. Se fase `quick_active` ou existir `QUICK.md` **sem** `PLAN.md` → **execute** (se há passos pendentes); se o trabalho cresceu (muitos arquivos, contrato público, segurança) → **spec** como passo único de promoção.
4. Se não houver `SPEC.md` e não for quick intencional declarado → **spec** (passo único).
5. Se houver SPEC mas não PLAN → se `.oxe/config.json` tiver `discuss_before_plan: true` e faltar **`.oxe/DISCUSS.md`** com decisões → **discuss**; senão → **plan**.
6. Se PLAN existe, **VERIFY.md** ainda **não** existe ou está claramente antes da implementação atual → **execute** (onda atual).
7. Se PLAN existe e VERIFY falta após implementação declarada → **verify**.
8. Se VERIFY indica falha ou gaps não resolvidos → **plan** (replanejamento) como passo único, com referência a `SUMMARY.md`.
9. Se VERIFY OK e estado coerente → **spec** ou **quick** para **próxima** entrega, ou mensagem “fluxo da feature atual concluído”.

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
