# OXE — Workflow: verify

<objective>
Executar ou orientar verificação pós-implementação: rodar os comandos definidos no **PLAN.md**, confrontar **cada critério da SPEC** (IDs **A1**, **A2**, …) com o código e os testes, e registrar o resultado em **`.oxe/VERIFY.md`** (e atualizar **STATE**).

Se o usuário indicar uma tarefa (ex.: `T2`), focar só nela; caso contrário, percorrer todas as tarefas com blocos **Verificar**.
</objective>

<context>
- Preferir rodar comandos reais no terminal quando o ambiente permitir; se o sandbox bloquear, marcar como “não executado aqui” e deixar o comando para o usuário.
- Não destruir `PLAN.md`; registrar achados em `VERIFY.md`.
- Ler **`.oxe/config.json`** se existir: `after_verify_draft_commit` e `after_verify_suggest_pr` controlam passos opcionais (se o arquivo não existir, use o mesmo padrão do `config.template.json`).
- Os critérios na SPEC devem estar na tabela **Critérios de aceite** com colunas **ID** / **Critério** / **Como verificar**; o verify deve **cruzar cada ID** com evidência (arquivo, comando, trecho).
- **Legado:** quando **Comando** for `—` ou inexistente, evidência válida inclui **Read/Grep**, existência de ficheiros referenciados e checklist manual — não marcar critério como passou sem evidência; se o ambiente host/desktop não estiver disponível, registar **não executado aqui** e próximo passo. Ver **`oxe/workflows/references/legacy-brownfield.md`**.
- **Debug:** investigação técnica de falhas **durante** a implementação segue **`oxe/workflows/debug.md`** (`/oxe-debug`). Resolver um bug com debug **não** dispensa este passo — após correções, **ainda** é necessário **`verify`** para fechar a trilha face à SPEC/PLAN.
- **UI:** se existirem `.oxe/UI-SPEC.md` / `.oxe/UI-REVIEW.md`, incorporar na evidência quando os critérios **A*** ou tarefas **Tn** tocarem interface.
- **Pós-verify (opcional):** para auditoria de **cobertura** e gaps de verificabilidade (sem substituir este passo), **`oxe:validate-gaps`** → `.oxe/VALIDATION-GAPS.md` (ver **`oxe/workflows/validate-gaps.md`**).
- **Rotina compact/checkpoint (opcional):** se esta entrega alterou **estrutura**, **stack** ou **pastas** de forma relevante, sugira **`/oxe-compact`** para alinhar `.oxe/codebase/` ao repo (e `CODEBASE-DELTA.md` + `RESUME.md`). Após **verify** com sucesso e antes de abrir nova entrega grande, um **`/oxe-checkpoint`** com slug curto pode marcar estado estável — **não** faz parte dos critérios de sucesso abaixo.
</context>

<process>
1. Ler `.oxe/SPEC.md`, `.oxe/PLAN.md`, `.oxe/STATE.md`.
2. Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn).
3. Para **cada ID de critério** usado na SPEC (A1, A2, …), registrar se passou, com evidência (Read/Grep, saída de teste resumida).
4. Escrever **`.oxe/VERIFY.md`** com:
   - Data, ambiente (SO / versão do Node se relevante).
   - **Tabela — Tarefas:** Tarefa (Tn) | Verificação (comando/checklist) | Passou? | Notas.
   - **Tabela — Critérios SPEC:** ID (A1…) | Critério (resumo) | Evidência | Passou? | Notas.
   - **Gaps** — o que falhou e sugestão de correção (pode virar novas entradas no PLAN); se não houver, escrever explicitamente `Nenhum gap restante` ou equivalente.
5. Atualizar **`.oxe/STATE.md`**: `verify_complete` ou `verify_failed` + próximo passo (replan, corrigir ou publicar).
5b. **Blueprint plan-agent:** se **todas** as verificações relevantes **passaram**, existir **`.oxe/plan-agents.json`** com `oxePlanAgentsSchema === 2` e `lifecycle.status === "executing"` (ou `pending_execute` se ainda não houve execute formal mas a trilha fechou aqui), actualizar o JSON: `lifecycle: { "status": "closed", "since": "<ISO>" }` e espelhar em **`STATE.md`** (**lifecycle_status** → `closed`). Não fechar como `closed` se `verify_failed` ou gaps por resolver.
5c. **Arquivo plan-agent (opcional, recomendado após fecho com sucesso):** se o passo **5b** marcou o blueprint como **`closed`** e existem **`.oxe/plan-agent-messages/`** (com mensagens) ou **`plan-agents.json`** na raiz `.oxe/`, propor ao utilizador **arquivar** em **`.oxe/archive/plan-agent-runs/<runId>/`** conforme **`oxe/workflows/references/plan-agent-chat-protocol.md`** (secção *Artefactos no repositório após fecho*): subpasta **`messages/`** com os handoffs, cópia de **`plan-agents.json`**, depois **esvaziar** **`.oxe/plan-agent-messages/`** (ou recriar só `README.md` a partir do template) e **remover** **`.oxe/plan-agents.json`** da raiz se já estiver copiado no arquivo. Se o utilizador preferir **manter** tudo na raiz para um PR único, respeitar — o protocolo trata o arquivo como **recomendação**, não obrigatório do gate de verify.
6. Acrescentar entrada em **`.oxe/SUMMARY.md`** (sessão): se não existir, criar a partir de **`oxe/templates/SUMMARY.template.md`**. **Obrigatório** quando `verify_failed` ou quando a seção **Gaps** tiver itens — isso alimenta o replanejamento.
7. **Só se todas as verificações relevantes passarem:** se `after_verify_draft_commit` não for `false`: acrescentar em **VERIFY.md** a seção **Rascunho de commit** — mensagem convencional (ex.: `feat:` / `fix:`) + bullets alinhados aos critérios **A***; **não** incluir segredos.
8. **Só se passou:** se `after_verify_suggest_pr` não for `false`: acrescentar **Checklist PR** — branch base, título sugerido, screenshots se UI, links a SPEC/PLAN, testes executados.
</process>

<success_criteria>
- [ ] VERIFY.md reflete o que foi de fato verificado (tarefas **e** critérios SPEC por ID).
- [ ] Falhas têm próximo passo claro (qual tarefa replanejar ou qual arquivo corrigir); se falhou, próximo passo inclui **plan** com replanejamento ou correção direta.
- [ ] STATE.md atualizado.
- [ ] SUMMARY.md atualizado quando houver falha ou gaps relevantes.
- [ ] Se passou: seções **Rascunho de commit** e **Checklist PR** presentes em VERIFY.md, salvo se desativadas na config.
</success_criteria>
