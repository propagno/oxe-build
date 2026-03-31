# OXE — Workflow: verify

<objective>
Executar ou orientar verificação pós-implementação: rodar os comandos definidos no **PLAN.md**, confrontar com **SPEC.md**, registrar resultado em **`.oxe/VERIFY.md`** (e atualizar **STATE**).

Se o utilizador indicar uma tarefa (ex. `T2`), focar só nela; caso contrário, percorrer todas as tarefas com blocos **Verificar**.
</objective>

<context>
- Preferir rodar comandos reais no terminal quando o ambiente permitir; se sandbox bloquear, marcar como “não executado aqui” e deixar comando para o utilizador.
- Não destruir `PLAN.md`; anexar achados em `VERIFY.md`.
- Ler **`.oxe/config.json`** se existir: chaves `after_verify_draft_commit` e `after_verify_suggest_pr` controlam passos opcionais abaixo (omissão = `true` onde o template por defeito as define).
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
6. Append curto em **`.oxe/SUMMARY.md`** (sessão) se existir; se não existir, criar a partir de **`oxe/templates/SUMMARY.template.md`** e acrescentar a entrada desta sessão.
7. **Só se todas as verificações relevantes passarem:** se `after_verify_draft_commit` não for `false` em `.oxe/config.json` (se o ficheiro não existir, assumir `true` como no template): acrescentar a **VERIFY.md** secção **Rascunho de commit** — mensagem convencional (ex. `feat:` / `fix:`) + bullets alinhados aos critérios de aceite; **não** incluir segredos.
8. **Só se passou:** se `after_verify_suggest_pr` não for `false` (ausência de config = `true`): acrescentar **Checklist PR** — branch base, título sugerido, screenshots se UI, ligações a SPEC/PLAN, testes corridos.
</process>

<success_criteria>
- [ ] VERIFY.md reflete o que foi de fato verificado.
- [ ] Falhas têm próximo passo claro (qual tarefa replanejar ou qual ficheiro corrigir); se falhou, próximo passo inclui **plan --replan** ou correção direta.
- [ ] STATE.md atualizado.
- [ ] Se passou: secções **Rascunho de commit** e **Checklist PR** presentes em VERIFY.md salvo se desativadas em config.
</success_criteria>
