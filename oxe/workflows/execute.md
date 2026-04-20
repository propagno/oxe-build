# OXE — Workflow: execute

<objective>
Guiar a **implementação** de um plano OXE com dois modos possíveis.

**Flags suportadas:**
- `--note "texto"` — registrar observação contextual em `OBSERVATIONS.md` antes de iniciar a execução (equivalente a `/oxe-obs`). Pode ser usado com qualquer outro argumento.
- `--debug` — ativar diagnóstico técnico explícito ao primeiro sinal de falha em vez de esperar 2 tentativas (equivalente a `/oxe-debug`). Fornece stack trace detalhado, hipóteses e fix.
- `--deep-diagnosis` — iniciar diretamente em modo de diagnóstico pós-falha persistente (equivalente a `/oxe-forensics`). Usar quando a execução já falhou repetidamente e o estado está corrompido ou inconsistente.
- `--checkpoint "<nome>"` — criar snapshot nomeado do estado da sessão antes de iniciar ou após concluir (equivalente a `/oxe-checkpoint`). Útil antes de experimentos ou ondas arriscadas.
- `--iterative` — ativar modo B com loop automático até verify passar, com retry controlado por `loop_max` (equivalente a `/oxe-loop`).

**Nota de compatibilidade v1.1.0:** `/oxe-obs`, `/oxe-debug`, `/oxe-forensics`, `/oxe-checkpoint` e `/oxe-loop` foram incorporados por este comando. Esses comandos legados continuam funcionando mas exibem aviso de migração.

</objective>

<flags_processing>
## Processamento de flags (executar antes do step 1)

Ao receber qualquer argumento, verificar flags antes de iniciar o fluxo principal:

1. **`--note "texto"`**: escrever entrada em `OBSERVATIONS.md` do escopo resolvido com status `pendente`, impacto `execute`, severidade `info`. Marcar como `incorporada → execute (data)` imediatamente após registrar. Continuar com o fluxo normal.

2. **`--checkpoint "<nome>"`**: executar a lógica de `oxe/workflows/checkpoint.md` com o slug fornecido antes de iniciar a onda. Reportar confirmação do snapshot. Continuar.

3. **`--deep-diagnosis`**: saltar diretamente para o fluxo de `oxe/workflows/forensics.md` com o contexto atual do `EXECUTION-RUNTIME.md` e `STATE.md`. Não iniciar nova onda sem resolução explícita.

4. **`--debug`**: ajustar `<failure_mode>` para acionar diagnóstico imediato na primeira falha (sem 2 tentativas antes). Reportar hipóteses, evidências e fix com mais detalhe.

5. **`--iterative`**: registrar em STATE.md: `execute_mode: por_onda` e `loop_max: 3` (ou o valor de config). Informar ao usuário que o modo iterativo está ativo.
</flags_processing>

<execution_modes>
**Modo Solo (padrão):** seguir `PLAN.md` do escopo resolvido da sessão onda a onda sem `plan-agents.json`. O agente implementa diretamente cada tarefa Tn da onda atual, roda a verificação e avança. Não exige nenhum artefato além do PLAN.md.

**Modo com Agentes (extensão):** quando existe `plan-agents.json` válido no escopo resolvido (schema 2+, lifecycle ativo, runId alinhado ao STATE), adotar roles e personas por agente conforme o blueprint.

**Seleção de execução (redução de requisições):** quando o plano tem 2+ ondas, o usuário escolhe entre Completo (1 sessão), Por onda (N sessões) ou Por tarefa (N tarefas). A escolha é feita **uma vez** no início.

Se existir apenas **`QUICK.md`** no escopo resolvido: tratar passos numerados como onda única (modo sempre Completo).
</execution_modes>

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

**Argumento direto:** se o foco/argumento recebido já for `A`, `B` ou `C` (sozinho), usar diretamente como seleção de modo sem apresentar o menu.

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

<failure_mode>
## Modo de falha inline (Verificar falha durante execute)

Quando o comando `**Verificar:**` de uma tarefa `Tn` falha, **não parar silenciosamente**. Executar este ciclo inline sem exigir que o usuário chame `/oxe-debug` separadamente:

1. **Diagnóstico rápido:** listar 2-3 hipóteses de causa baseadas no output de erro.
2. **Fix mais provável:** aplicar o fix para a hipótese #1.
3. **Re-verificar:** rodar o `Verificar` novamente.
4. Se passou: continuar onda normalmente; registrar na onda que houve 1 iteração de fix.
5. Se falhou novamente (2ª tentativa): aplicar hipótese #2 e tentar 1 vez mais.
6. Se falhou após 2 tentativas: **pausar** — exibir as hipóteses testadas, evidências coletadas, e sugerir `/oxe-forensics` com contexto completo. Registrar em STATE.md: `execute_blocked: Tn | motivo`.

**Auto-loop no Modo B:** se `execute_mode: por_onda` e `loop_max` > 1 em STATE.md, o ciclo de retry roda automaticamente até `loop_max` tentativas antes de escalar para forensics.
</failure_mode>

<context>
**Contrato de raciocínio:** aplicar `oxe/workflows/references/reasoning-execution.md`. Antes de mutar, fazer reconhecimento curto; durante a execução, operar no menor write set viável e validar após cada fatia relevante.

**Contrato de robustez:** seguir `oxe/workflows/references/flow-robustness-contract.md`. Antes de executar, validar os artefatos obrigatórios e o gate do plano.

**Context pack prioritário:** antes de abrir o conjunto amplo de artefatos, resolver `.oxe/context/packs/execute.md` e `.oxe/context/packs/execute.json` como entrada principal do passo. Se o pack estiver fresco/coerente, usar `read_order` e `selected_artifacts` para limitar o reconhecimento inicial à onda/tarefa atual. Se estiver stale, ausente ou com lacunas críticas, fazer fallback explícito para leitura direta e registrar isso no runtime ou no resumo da execução.

**Runtime operacional:** usar `EXECUTION-RUNTIME.md` do escopo resolvido como artefato tático da execução. Ele deve refletir agentes ativos, onda atual, handoffs, evidências, retries, checkpoints pendentes e tarefas bloqueadas. O `PLAN.md` continua estratégico; o runtime regista a operação do ciclo.

**Runtime enterprise como caminho padrão:** quando `oxe-cc runtime` estiver disponível no ambiente, preferir o caminho formal deste passo:
- executar `oxe-cc runtime compile --dir <projeto>` antes da primeira mutação para materializar `compiled_graph`, `canonical_state` e `verification_suite`;
- tratar `ACTIVE-RUN.json` e `.oxe/runs/<run_id>.json` como fonte operacional primária da onda/tarefa atual;
- executar `oxe-cc runtime project --dir <projeto>` ao fim de cada onda ou bloco concluído para reprojetar `PLAN.md`, `STATE.md`, `VERIFY.md`, `RUN-SUMMARY.md`, `COMMIT-SUMMARY.md` e `PROMOTION-SUMMARY.md`.
Se o runtime não estiver compilado, falhar por indisponibilidade do pacote ou não puder ser executado no ambiente atual, declarar `fallback legado` explicitamente antes de seguir apenas com os artefatos markdown.

**Checkpoints de aprovação:** usar `CHECKPOINTS.md` do escopo resolvido para gates humanos explícitos. Estados válidos: `pending_approval`, `approved`, `rejected`, `overridden`. Se houver checkpoint pendente antes de uma onda de risco, side effect externo ou fecho sensível, a execução deve pausar até resolução explícita.

**Capabilities nativas:** ler `.oxe/CAPABILITIES.md` e capabilities locais relevantes antes de propor automações, pesquisa extra, publicação ou conectores. Só sugerir capabilities que existam no projeto ou estejam claramente ausentes.

**Provider Azure:** quando a tarefa tocar Azure, usar os artefatos em `.oxe/cloud/azure/` como contexto real e tratar `oxe-cc azure ...` como capability operacional nativa. Operações `plan` e `apply` devem entrar no runtime, abrir checkpoint antes de mutação e registrar evidência em `.oxe/cloud/azure/operations/`.

**Observações pendentes:** verificar `OBSERVATIONS.md` do escopo resolvido no início de cada onda. Processar por severidade antes de executar qualquer tarefa:
- **`Severidade: blocking`** — não avançar para nenhuma tarefa da onda sem resolver. Apresentar o bloqueio ao usuário com contexto da onda atual e as opções A/B/C (ver `obs.md` passo 5). A onda só avança após o usuário escolher e o bloqueio ser tratado.
- **`Severidade: adjustment`** — incorporar como restrição nas tarefas afetadas desta onda antes de executar; não bloqueia o avanço.
- **`Severidade: info`** (ou sem campo Severidade — formato legado) — incorporar normalmente se impacto `execute` ou `all`.

Após incorporar: marcar `incorporada → execute (data)` em `OBSERVATIONS.md`.

**Quick-agents (lean PDDA):** se existir **`quick-agents.json`** do escopo resolvido com `status: active` e a execução for baseada em **`QUICK.md`** (não há PLAN.md), adotar o `role` e `persona` de cada agente para os `steps[]` atribuídos. Ao concluir todos os steps, marcar `quick-agents.json` → `status: done` e sugerir `/oxe-verify`.

**Model hints (blueprint com agentes):** ao apresentar a atribuição de cada agente no início da onda, exibir `model_hint` se presente:
```
Agente: agent-auth — "Especialista em JWT"  [modelo: powerful]
Tarefas: T1, T2
```
Se `model_hint` estiver ausente, não exibir a linha. O usuário pode configurar o modelo no IDE antes de iniciar aquele agente.

**Blueprint plan-agent (Modo com Agentes):** adotar `role`/`scope` de **`plan-agents.json`** do escopo resolvido SOMENTE quando:
1. `lifecycle.status` ∈ `{ pending_execute, executing }` (não usar se `closed` ou `invalidated`).
2. **`runId`** no JSON coincide com **`run_id`** no STATE.md (secção Blueprint de agentes).
3. O pedido mapeia para pelo menos uma tarefa **`Tn`** no **`PLAN.md`**.

Se condições não atendidas: responder sem persona; sugerir `/oxe-plan-agent` para novo blueprint.

**Transição `pending_execute` → `executing`:** na primeira onda com blueprint válido, atualizar `plan-agents.json` → `lifecycle: { "status": "executing", "since": "<ISO>" }` e espelhar em STATE.md.

**Protocolo agente → agente (blueprint):** mensagens em `plan-agent-messages/` do escopo resolvido conforme `oxe/workflows/references/plan-agent-chat-protocol.md`.

**Se PLAN.md não existir mas QUICK.md existir:** seguir QUICK.md — passos = onda única, sempre Modo Completo.

**Se nem PLAN nem QUICK existir:** recomendar `oxe:plan` ou `oxe:quick` primeiro.

**Legado / brownfield:** entregáveis podem ser só documentação. Ver **`oxe/workflows/references/legacy-brownfield.md`**.

**Rotina compact/checkpoint:** antes de onda experimental ou refactor grande, `/oxe-checkpoint` com slug ajuda a retomar. Após ondas que mudem stack ou árvore, lembrar `/oxe-compact`.
</context>

<process>
1. Ler **`.oxe/STATE.md`** global para resolver `active_session`, depois ler **`PLAN.md`** (se existir) e **`QUICK.md`** do escopo resolvido.
1a. Resolver o context pack `execute` primeiro:
   - ler `.oxe/context/packs/execute.md|json` (ou `oxe-cc context inspect --workflow execute --json`);
   - se o pack estiver fresco e coerente, usá-lo como mapa primário para o reconhecimento inicial da onda/tarefa;
   - se estiver stale, incompleto ou ausente, declarar `fallback para leitura direta` antes de seguir.
1b. **Verificação de hipóteses críticas:** se o context pack contiver o campo `hypotheses` com entradas `status: pending` cujo `checkpoint` coincide com a onda atual — validar cada uma antes de iniciar qualquer mutação. Se a hipótese for refutada, registrar bloqueio explícito em `EXECUTION-RUNTIME.md` e não editar código antes de resolver. Se for validada, atualizar `status: validated` no `PLAN.md`.
1c. Fazer reconhecimento curto dos artefatos e arquivos prováveis da onda atual antes da primeira mudança. Com pack válido, limitar essa leitura aos artefatos de `read_order` e aos arquivos prováveis da onda; sem pack válido, expandir só o necessário.
2. Se existir `PLAN.md`, validar a seção `## Autoavaliação do Plano` antes de qualquer implementação:
   - `Melhor plano atual` deve ser `sim`;
   - `Confiança` deve existir em `0–100%`;
   - se `.oxe/config.json` definir `plan_confidence_threshold`, usar esse limiar; senão, usar `70%`;
   - se a confiança estiver abaixo do limiar, **não executar**. Registrar o bloqueio e orientar redução de incerteza (`/oxe-discuss`, `/oxe-research` ou `/oxe-plan --replan`).
3. Antes da primeira mudança, verificar `CHECKPOINTS.md` e `EXECUTION-RUNTIME.md` do escopo resolvido:
   - se houver checkpoint `pending_approval` que se aplique à onda atual, **não avançar**;
   - inicializar ou atualizar o runtime com onda atual, status, agentes ativos, handoffs e evidências esperadas.
3a. **Caminho padrão do runtime enterprise:** se `oxe-cc runtime` estiver disponível:
   - executar ou solicitar `oxe-cc runtime compile --dir <projeto>` antes da primeira mutação;
   - se compilar com sucesso, tratar `ACTIVE-RUN.json`, `.oxe/runs/<run_id>.json`, `compiled_graph` e `canonical_state` como estado operacional primário da execução;
   - se existir gate operacional além dos checkpoints markdown, consultar `oxe-cc runtime gates list --dir <projeto>` antes da onda de mutação;
   - se falhar apenas por indisponibilidade do runtime, registrar `fallback legado` e continuar com o fluxo markdown.
4. Verificar **`OBSERVATIONS.md`** do escopo resolvido antes de iniciar cada onda:
   - Se houver obs com `Status: pendente` e `Severidade: blocking`: **não avançar** para nenhuma tarefa da onda — apresentar ao usuário o bloqueio com contexto da onda e opções A/B/C de resolução
   - Se houver obs com `Status: pendente` e `Severidade: adjustment`: incorporar como restrição nas tarefas afetadas desta onda antes de executar
   - Se houver obs sem campo Severidade (formato legado) ou `Severidade: info` com impacto `execute` ou `all`: incorporar normalmente
   - Após incorporar: marcar `incorporada → execute (data)` em `OBSERVATIONS.md`
5. **Gate de permissões:** se `.oxe/config.json` define `permissions[]` (array não-vazio):
   - Para cada tarefa da onda, coletar os caminhos listados em **Arquivos prováveis:** do PLAN.md
   - Avaliar cada caminho contra as regras em ordem (first-match wins):
     - `action: deny` → **bloquear** a onda. Listar arquivos bloqueados e a regra que disparou. Não avançar sem que o utilizador remova a regra ou altere o plano.
     - `action: ask` → **pausar** e apresentar: "Os seguintes arquivos requerem confirmação: [lista]. Regra: `pattern`. Confirma execução? (s/n)". Avançar só após confirmação explícita.
     - `action: allow` ou nenhuma regra matchou → avançar normalmente
   - O mesmo gate aplica-se em Azure `apply` quando `scope: apply` ou `all`
6. **Seleção de modo** (apenas se PLAN.md com 2+ ondas e `execute_mode` não definido em STATE): se o argumento já for `A`, `B` ou `C`, usá-lo diretamente; senão apresentar opções A/B/C e aguardar escolha; registrar em STATE.md.
7. Identificar **onda ou bloco atual**: no PLAN, todas as tarefas da mesma onda sem dependências pendentes; no QUICK, passos ainda não marcados como feitos.
8. Listar no chat: tarefas/passos desta onda, arquivos prováveis, comando **Verificar** de cada tarefa.
8a. Antes de implementar, explicitar no chat:
   - **Contexto lido** (incluindo se veio de pack fresco ou de fallback)
   - **Alvo da mudança**
   - **Validação prevista**
9. **Implementar** conforme o modo escolhido:
   - **Modo Completo:** executar todas as ondas em sequência com verificação inline entre ondas; sumarizar ao final.
   - **Modo Por onda:** executar onda atual, apresentar checklist, parar.
   - **Modo Por tarefa:** executar próxima tarefa pendente, parar.
   - Em qualquer modo: atualizar `EXECUTION-RUNTIME.md` a cada mudança de onda, bloqueio, retry, handoff, checkpoint ou saída do pack por falta de evidência.
10. Após cada onda concluída, incluir checklist:
   ```markdown
   ## Checklist — Onda N (OXE)
   - [ ] Pré-requisitos da onda conferidos (dependências Tk atendidas)
   - [ ] Implementação da onda concluída
   - [ ] Comando Verificar de cada tarefa executado (ou agendado)
   ```
10a. Quando o runtime enterprise estiver ativo, executar ou solicitar `oxe-cc runtime project --dir <projeto>` após cada onda ou bloco concluído para projetar os markdowns derivados a partir do estado canónico, em vez de depender só de edição manual.
11. Atualizar **`.oxe/STATE.md`** global com progresso resumido e, com sessão ativa, escrever o detalhe operacional em `execution/STATE.md`.
11a. Se o runtime enterprise estiver ativo, preferir o `STATE.md`, `PLAN.md`, `VERIFY.md` e summaries projetados por `runtime project` como superfície oficial; complementar manualmente apenas o que o projection engine ainda não cobrir.
12. Atualizar ou criar `CHECKPOINTS.md` quando surgir gate humano explícito; refletir o status resumido no `STATE.md` global (`checkpoint_status`) e no runtime (`runtime_status`).
13. Marcar OBS incorporadas como `incorporada → execute (data)` em `OBSERVATIONS.md` do escopo resolvido.
14. Se a execução parar por hipótese crítica não verificada, conflito estrutural ou falta de evidência operacional, terminar com bloqueio explícito e um único próximo passo. Se o bloqueio tiver vindo de pack stale/incompleto, dizer isso explicitamente.
</process>

<success_criteria>
- [ ] Modo de execução foi selecionado (ou herdado do STATE) antes de implementar.
- [ ] Onda ou bloco de passos explicitado antes de "implementar".
- [ ] Checklist da onda apresentado ou refletido no STATE.md.
- [ ] STATE.md registra progresso (Tn ou passos) e próximo passo.
- [ ] Verificação alinhada ao bloco **Verificar** do PLAN ou QUICK.
- [ ] OBS pendentes verificadas antes de cada onda: `blocking` resolvidos antes de avançar, `adjustment` incorporados como restrições, `info`/legado incorporados normalmente.
- [ ] Com quick-agents ativos: cada agente trabalha só em seus `steps[]`; ao concluir, `quick-agents.json` → `done`.
- [ ] Com blueprint schema 2 válido: não adotar persona para pedidos fora das `Tn`; `runId` alinhado entre JSON e STATE; handoffs escritos quando protocolo exige.
- [ ] Quando `oxe-cc runtime` estiver disponível, `runtime compile` foi tentado antes da primeira mutação e `runtime project` foi usado para reprojetar artefatos após a onda/bloco.
</success_criteria>
