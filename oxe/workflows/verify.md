# OXE — Workflow: verify

<objective>
Executar ou orientar verificação pós-implementação: rodar os comandos definidos no **PLAN.md**, confrontar com **SPEC.md**, registrar resultado em **`.oxe/VERIFY.md`** (e atualizar **STATE**).

Se o utilizador indicar uma tarefa (ex. `T2`), focar só nela; caso contrário, percorrer todas as tarefas com blocos **Verificar**.
</objective>

<context>
- Preferir rodar comandos reais no terminal quando o ambiente permitir; se sandbox bloquear, marcar como “não executado aqui” e deixar comando para o utilizador.
- Não destruir `PLAN.md`; anexar achados em `VERIFY.md`.
- Se tudo passar, sugerir commit/PR com mensagem alinhada aos critérios de aceite.
</context>

<process>
1. Ler `.oxe/SPEC.md`, `.oxe/PLAN.md`, `.oxe/STATE.md`.
2. Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn).
3. Checar critérios de aceite da SPEC contra o estado do código (Read/Grep).
4. Escrever **`.oxe/VERIFY.md`** com:
   - Data, ambiente (OS/node versão se relevante).
   - Tabela ou lista: Tarefa | Verificação | Passou? | Notas.
   - **Gaps** — o que falhou e sugestão de correção (pode virar novas entradas no PLAN).
5. Atualizar **`.oxe/STATE.md`**: `verify_complete` ou `verify_failed` + próximo passo (replan, corrigir, ou ship).
6. Opcional: append curto em **`.oxe/SUMMARY.md`** (sessão) se existir ou criar com bullet da sessão.
</process>

<success_criteria>
- [ ] VERIFY.md reflete o que foi de fato verificado.
- [ ] Falhas têm próximo passo claro (qual tarefa replanejar ou qual ficheiro corrigir).
- [ ] STATE.md atualizado.
</success_criteria>
