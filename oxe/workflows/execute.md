# OXE — Workflow: execute

<objective>
Guiar a **implementação** de um plano OXE com dois modos possíveis:

**Modo Solo (padrão):** seguir `.oxe/PLAN.md` onda a onda sem `plan-agents.json`. O agente implementa diretamente cada tarefa Tn da onda atual, roda a verificação e avança. Não exige nenhum artefato além do PLAN.md.

**Modo com Agentes (extensão):** quando existe `.oxe/plan-agents.json` válido (schema 2, lifecycle ativo, runId alinhado ao STATE), adotar roles e personas por agente conforme o blueprint.

**Seleção de execução (redução de requisições):** quando o plano tem 2+ ondas, o usuário escolhe entre Completo (1 sessão), Por onda (N sessões) ou Por tarefa (N tarefas). A escolha é feita **uma vez** no início.

Se existir apenas **`.oxe/QUICK.md`**: tratar passos numerados como onda única (modo sempre Completo).
</objective>

<modo_solo>
## Modo Solo — Execução direta do PLAN.md

O modo padrão. Funciona sem `plan-agents.json`. O agente lê PLAN.md, segue as tarefas Tn na ordem das ondas, implementa e verifica.

**Checklist de onda (solo):**
```markdown
## Checklist — Onda N (OXE Solo)
- [ ] Dependências da onda conferidas (Tk de ondas anteriores concluídos)
- [ ] Tarefas da onda implementadas
- [ ] Comando **Verificar** de cada tarefa executado (ou agendado)
- [ ] STATE.md atualizado com progresso
```

**Ao fechar todas as ondas:** sugerir `/oxe-verify` para validação completa contra SPEC.
</modo_solo>

<execution_mode_selection>
## Seleção de Modo de Execução

**Quando aplicar:** ao início do execute, se PLAN.md tiver **2 ou mais ondas**. Apresentar UMA VEZ e armazenar a escolha em STATE.md para não perguntar novamente nas rodadas seguintes.

**Não aplicar** quando: QUICK.md (sempre Completo), PLAN.md com 1 onda (executar diretamente).

**Apresentar ao usuário:**

```
Este plano tem [N] tarefas em [X] ondas. Como quer executar?

  A) Completo   → todas as [X] ondas nesta sessão
                  ✓ 1 requisição/sessão (ideal: Copilot, Claude, Gemini)
                  ✓ O agente vê todo o contexto e pode otimizar entre tarefas
                  ⚠ Verificação inline — sem pausa entre ondas

  B) Por onda   → onda 1/[X] agora, você verifica e chama de novo para continuar
                  ✓ Validação entre ondas reduz risco de retrabalho
                  ✗ [X] sessões (uma por onda)

  C) Por tarefa → T1 agora, você confirma, depois T2...
                  ✓ Máximo controle
                  ✗ [N] sessões (uma por tarefa)
```

**Modo A — Completo:**
- Executar onda 1 → verificar → onda 2 → verificar → … → última onda
- A cada onda: executar o comando `**Verificar:**` de cada tarefa inline
- Atualizar STATE.md progressivamente (não esperar o final)
- Ao terminar: suário recebe sumário completo + sugestão de `/oxe-verify`

**Modo B — Por onda (padrão quando sem escolha):**
- Executar onda atual → apresentar checklist → parar
- Informar: "Onda N/X concluída. Chame `/oxe-execute` novamente para a Onda N+1."

**Modo C — Por tarefa:**
- Executar próxima tarefa pendente → parar
- Informar: "T[n] concluída. Chame `/oxe-execute` novamente para T[n+1]."

**Persistir escolha:** registrar em STATE.md: `execute_mode: completo | por_onda | por_tarefa`. Se STATE já tiver o campo, não perguntar novamente — usar o modo armazenado.
</execution_mode_selection>

<context>
**Observações pendentes:** verificar `.oxe/OBSERVATIONS.md` no início de cada onda. Se houver entradas `pendente` com impacto `execute` ou `all`, incorporar no trabalho da onda atual e marcá-las `incorporada → execute (data)`.

**Quick-agents (lean PDDA):** se existir **`.oxe/quick-agents.json`** com `status: active` e a execução for baseada em **`QUICK.md`** (não há PLAN.md), adotar o `role` e `persona` de cada agente para os `steps[]` atribuídos. Ao concluir todos os steps, marcar `quick-agents.json` → `status: done` e sugerir `/oxe-verify`.

**Blueprint plan-agent (Modo com Agentes):** adotar `role`/`scope` de **`.oxe/plan-agents.json`** SOMENTE quando:
1. `lifecycle.status` ∈ `{ pending_execute, executing }` (não usar se `closed` ou `invalidated`).
2. **`runId`** no JSON coincide com **`run_id`** no STATE.md (secção Blueprint de agentes).
3. O pedido mapeia para pelo menos uma tarefa **`Tn`** no **`PLAN.md`**.

Se condições não atendidas: responder sem persona; sugerir `/oxe-plan-agent` para novo blueprint.

**Transição `pending_execute` → `executing`:** na primeira onda com blueprint válido, atualizar `plan-agents.json` → `lifecycle: { "status": "executing", "since": "<ISO>" }` e espelhar em STATE.md.

**Protocolo agente → agente (blueprint):** mensagens em `.oxe/plan-agent-messages/` conforme `oxe/workflows/references/plan-agent-chat-protocol.md`.

**Se PLAN.md não existir mas QUICK.md existir:** seguir QUICK.md — passos = onda única, sempre Modo Completo.

**Se nem PLAN nem QUICK existir:** recomendar `oxe:plan` ou `oxe:quick` primeiro.

**Legado / brownfield:** entregáveis podem ser só documentação. Ver **`oxe/workflows/references/legacy-brownfield.md`**.

**Rotina compact/checkpoint:** antes de onda experimental ou refactor grande, `/oxe-checkpoint` com slug ajuda a retomar. Após ondas que mudem stack ou árvore, lembrar `/oxe-compact`.
</context>

<process>
1. Ler **`.oxe/STATE.md`**, **`PLAN.md`** (se existir) e **`QUICK.md`** (se PLAN não existir).
2. Verificar **`.oxe/OBSERVATIONS.md`** — incorporar pendentes de impacto `execute` ou `all` antes de iniciar.
3. **Seleção de modo** (apenas se PLAN.md com 2+ ondas e `execute_mode` não definido em STATE): apresentar opções A/B/C e aguardar escolha; registrar em STATE.md.
4. Identificar **onda ou bloco atual**: no PLAN, todas as tarefas da mesma onda sem dependências pendentes; no QUICK, passos ainda não marcados como feitos.
5. Listar no chat: tarefas/passos desta onda, arquivos prováveis, comando **Verificar** de cada tarefa.
6. **Implementar** conforme o modo escolhido:
   - **Modo Completo:** executar todas as ondas em sequência com verificação inline entre ondas; sumarizar ao final.
   - **Modo Por onda:** executar onda atual, apresentar checklist, parar.
   - **Modo Por tarefa:** executar próxima tarefa pendente, parar.
7. Após cada onda concluída, incluir checklist:
   ```markdown
   ## Checklist — Onda N (OXE)
   - [ ] Pré-requisitos da onda conferidos (dependências Tk atendidas)
   - [ ] Implementação da onda concluída
   - [ ] Comando Verificar de cada tarefa executado (ou agendado)
   ```
8. Atualizar **`.oxe/STATE.md`**: última onda executada, tarefas concluídas (Tn), próximo passo.
9. Marcar OBS incorporadas como `incorporada → execute (data)` em `.oxe/OBSERVATIONS.md`.
</process>

<success_criteria>
- [ ] Modo de execução foi selecionado (ou herdado do STATE) antes de implementar.
- [ ] Onda ou bloco de passos explicitado antes de "implementar".
- [ ] Checklist da onda apresentado ou refletido no STATE.md.
- [ ] STATE.md registra progresso (Tn ou passos) e próximo passo.
- [ ] Verificação alinhada ao bloco **Verificar** do PLAN ou QUICK.
- [ ] OBS pendentes de impacto `execute` incorporadas no início da onda.
- [ ] Com quick-agents ativos: cada agente trabalha só em seus `steps[]`; ao concluir, `quick-agents.json` → `done`.
- [ ] Com blueprint schema 2 válido: não adotar persona para pedidos fora das `Tn`; `runId` alinhado entre JSON e STATE; handoffs escritos quando protocolo exige.
</success_criteria>
