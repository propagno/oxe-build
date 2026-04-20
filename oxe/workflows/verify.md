# OXE — Workflow: verify

<objective>
Executar ou orientar verificação pós-implementação em **quatro camadas progressivas**:

1. **Auditoria de pré-execução** — verificar que o PLAN está íntegro antes de iniciar (gate de qualidade).
2. **Verificação de tarefas e critérios** — rodar comandos do PLAN e cruzar cada critério da SPEC (IDs **A1**, **A2**, …) com evidência.
3. **Fidelidade de decisões** — cruzar cada decisão **D-NN** do DISCUSS.md com a implementação.
4. **UAT (Checklist de aceite)** — checklist manual para o usuário confirmar entregáveis.

Resultado registrado em **`.oxe/VERIFY.md`** com atualização de **STATE**.

Se o usuário indicar uma tarefa (ex.: `T2`), focar só nela nas camadas 1–2; as camadas 3–4 são sempre de escopo completo.

**Flags suportadas:**
- `--gaps` — ativar Camada 5 (auditoria de cobertura) explicitamente, independente de `verification_depth` na config (equivalente a `/oxe-validate-gaps`).
- `--security` — ativar Camada 6 (auditoria OWASP) explicitamente, independente de `security_in_verify` na config (equivalente a `/oxe-security`).
- `--ui` — incluir auditoria de implementação UI baseada em `UI-SPEC.md` (equivalente a `/oxe-ui-review`). Ativado automaticamente se `UI-SPEC.md` existir no escopo.
- `--pr` — incluir revisão de PR antes de fechar o verify (equivalente a `/oxe-review-pr`). Usa o diff do branch atual contra o branch base.
- `--diff branchA...branchB` — revisão de diff específico entre dois branches ou SHAs.
- `--skip-retro` — pular a retrospectiva automática ao final do verify.

**Retro automática:** ao fechar `verify_complete`, executar automaticamente a lógica de `oxe/workflows/retro.md` para sintetizar 3–5 lições em `.oxe/global/LESSONS.md`. Usar `--skip-retro` para desativar.

**Nota de compatibilidade v1.1.0:** `/oxe-validate-gaps`, `/oxe-security`, `/oxe-ui-review`, `/oxe-review-pr` e `/oxe-retro` foram incorporados por este comando. Esses comandos legados continuam funcionando mas exibem aviso de migração.
</objective>

<flags_processing>
## Processamento de flags (executar antes do step 1)

Ao receber qualquer argumento, verificar flags antes de iniciar o fluxo principal:

1. **`--gaps`**: registrar internamente que Camada 5 deve ser executada independentemente de `verification_depth` na config.

2. **`--security`**: registrar internamente que Camada 6 deve ser executada independentemente de `security_in_verify` na config.

3. **`--ui`**: registrar internamente que auditoria UI deve ser executada. Se `UI-SPEC.md` não existir no escopo, avisar e perguntar se deseja executar `/oxe-spec --ui` primeiro.

4. **`--pr`**: após as camadas principais, executar a lógica de `oxe/workflows/review-pr.md` com o diff do branch atual. Incluir achados na seção **Revisão de PR** do VERIFY.md.

5. **`--diff branchA...branchB`**: equivalente a `--pr`, mas com o diff específico informado.

6. **`--skip-retro`**: registrar que a retro automática deve ser pulada ao final.

**Verificação automática de UI:** independente de flags, se `UI-SPEC.md` existir no escopo e houver critérios A* que toquem interface, executar auditoria UI parcial.
</flags_processing>

<context>
- Aplicar `oxe/workflows/references/reasoning-review.md` como contrato deste passo. A resposta no chat deve começar por achados, não por resumo.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `VERIFY.md`, `VALIDATION-GAPS.md`, `SECURITY.md`, `UI-REVIEW.md` e `SUMMARY.md` vivem no escopo da sessão; `.oxe/STATE.md` continua global.
- Seguir `oxe/workflows/references/flow-robustness-contract.md`. O verify não valida só se passou; valida também se o plano estava bem calibrado para começar.
- Antes da leitura ampla, resolver `.oxe/context/packs/verify.md` e `.oxe/context/packs/verify.json` como entrada prioritária do passo.
- Se o pack estiver fresco e coerente, usar `read_order`, `selected_artifacts`, `gaps` e `conflicts` como mapa primário da evidência. Se estiver stale, ausente ou com lacunas críticas, fazer fallback explícito para leitura direta e registar isso em `VERIFY.md`.
- **Runtime enterprise como caminho padrão:** quando `oxe-cc runtime` estiver disponível, executar ou solicitar `oxe-cc runtime verify --dir <projeto>` como caminho primário deste passo. Tratar `verification-manifest.json`, `residual-risk-ledger.json` e `evidence-coverage.json` da run ativa como fonte primária de evidência técnica, e o `VERIFY.md` projetado pelo runtime como base do artefato final.
- Se `runtime verify` retornar `partial`, continuar com as camadas manuais usando os gaps explícitos do runtime como backlog obrigatório da revisão; não cair silenciosamente para narrativa solta.
- Se o runtime não estiver compilado, indisponível ou não puder ser executado no ambiente atual, declarar `fallback legado` explicitamente antes de seguir com a verificação manual baseada em markdown e comandos locais.
- Ler `EXECUTION-RUNTIME.md` e `CHECKPOINTS.md` do escopo resolvido quando existirem. Eles são evidência tática para saber o que realmente foi executado, bloqueado, aprovado ou desviado.
- Se a trilha tocar Azure, ler `.oxe/cloud/azure/INVENTORY.md`, `SERVICEBUS.md`, `EVENTGRID.md`, `SQL.md` e `operations/*.md|json` para confirmar recursos reais, checkpoints e mutações aplicadas.
- **Observações CI como evidência:** se `OBSERVATIONS.md` do escopo resolvido tiver obs do tipo `ci_failure` com `CI-evidência` preenchida, usar como evidência adicional para critérios A* de qualidade (ex.: cobertura, build verde). Se obs tiver `ci_run_url`, referenciar na coluna **Evidência** da tabela de critérios. Se obs estiver `pendente` e critério A* de qualidade existir, marcar o critério como `evidence_pending_ci` — não como passou — até o CI ser resolvido.
- Preferir rodar comandos reais no terminal quando o ambiente permitir; se o sandbox bloquear, marcar como "não executado aqui" e deixar o comando para o usuário.
- Não destruir `PLAN.md`; registrar achados em `VERIFY.md`.
- Ler **`.oxe/config.json`** se existir: `after_verify_draft_commit`, `after_verify_suggest_pr`, e `verification_depth` (`"standard"` por padrão; `"thorough"` ativa camadas 3–4 completas; `"quick"` pula camadas 3–4 e UAT).
- Os critérios na SPEC devem estar na tabela **Critérios de aceite** com colunas **ID** / **Critério** / **Como verificar**; o verify deve **cruzar cada ID** com evidência (arquivo, comando, trecho).
- **Legado:** quando **Comando** for `—` ou inexistente, evidência válida inclui **Read/Grep**, existência de ficheiros referenciados e checklist manual — não marcar critério como passou sem evidência; se o ambiente host/desktop não estiver disponível, registar **não executado aqui** e próximo passo. Ver **`oxe/workflows/references/legacy-brownfield.md`**.
- **Debug:** investigação técnica de falhas **durante** a implementação segue **`oxe/workflows/debug.md`** (`/oxe-debug`). Resolver um bug com debug **não** dispensa este passo — após correções, **ainda** é necessário **`verify`** para fechar a trilha face à SPEC/PLAN.
- **UI:** se existirem `UI-SPEC.md` / `UI-REVIEW.md` no escopo resolvido, incorporar na evidência quando os critérios **A*** ou tarefas **Tn** tocarem interface.
- **Camada 5 — Validate-gaps (automático quando `verification_depth: "thorough"`):** após as 4 camadas, se `verification_depth: "thorough"` em `.oxe/config.json`, executar automaticamente a lógica de `oxe/workflows/validate-gaps.md` e produzir `.oxe/VALIDATION-GAPS.md` como parte deste verify. Não requer comando separado.
- **Camada 6 — Security (automático quando `security_in_verify: true`):** se `security_in_verify: true` em `.oxe/config.json`, executar automaticamente a lógica de `oxe/workflows/security.md` e produzir `.oxe/SECURITY.md` como parte deste verify. Não requer comando separado.
- **Camada QC — Quality Contract (automático quando SPEC.md contiver critérios R-RB):** se a SPEC.md do escopo resolvido contiver requisitos com ID `R-RB-NN` (gerados pela Fase 3.5 — Elevação de Robustez), executar a Camada QC conforme `<camada_qc_quality_contract>`. Não requer comando separado.
- **Rotina compact/checkpoint (opcional):** se esta entrega alterou **estrutura**, **stack** ou **pastas** de forma relevante, `/oxe-scan` em modo refresh alinha `.oxe/codebase/` ao repo. Após **verify** com sucesso, `/oxe-project checkpoint` com slug curto pode marcar estado estável.
</context>

<camada_1_pre_exec_audit>
**Camada 1 — Auditoria de pré-execução** (roda *antes* de iniciar os comandos de verify)

Verificar que o PLAN.md está apto para verificação:
1. Toda tarefa `### Tn` tem bloco **Verificar** com pelo menos Comando ou Manual.
2. Todo **Aceite vinculado** referencia IDs que existem na tabela de SPEC.md (`A1`, `A2`, …).
3. Se houver `DISCUSS.md` no escopo resolvido, toda decisão técnica com ID **D-NN** aparece em **Decisão vinculada:** de alguma tarefa (ou nota explícita de gap no PLAN).
4. Não há dependências `Tk` inválidas (ID inexistente no PLAN).
5. `PLAN.md` contém a seção **Autoavaliação do Plano** com `Melhor plano atual`, `Confiança` e rubrica preenchida.

Se auditoria falhar: registrar na seção **Auditoria de pré-execução** do VERIFY.md os itens com problema e **pausar** — pedir correção do PLAN antes de continuar. Se o usuário forçar continuar com `--skip-audit`, documentar e prosseguir com aviso.
</camada_1_pre_exec_audit>

<camada_2_tarefas_e_criterios>
**Camada 2 — Verificação de tarefas e critérios SPEC**

Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn). Para **cada ID de critério** usado na SPEC (A1, A2, …), registrar se passou com evidência (Read/Grep, saída de teste resumida).
</camada_2_tarefas_e_criterios>

<camada_3_fidelidade_decisoes>
**Camada 3 — Fidelidade de decisões** (ativa se existir `DISCUSS.md` no escopo resolvido com IDs D-NN)

Para cada decisão na tabela de DISCUSS.md:
1. Localizar a(s) tarefa(s) que referenciam esse ID em **Decisão vinculada:**.
2. Verificar que a implementação reflete a decisão (Grep/Read dos arquivos da tarefa).
3. Registrar na tabela **Fidelidade de decisões** do VERIFY.md: ID | Decisão (resumo) | Tarefa(s) | Implementado? | Evidência.

Se uma decisão D-NN não tem tarefa vinculada **e** não há nota de gap no PLAN: marcar como `divergência` e adicionar ao bloco **Gaps**.
</camada_3_fidelidade_decisoes>

<camada_4_uat>
**Camada 4 — UAT (User Acceptance Testing)** (ativa se `after_verify_suggest_uat` não for `false` na config)

Gerar uma **Checklist UAT** no VERIFY.md com passos manuais derivados dos critérios de aceite. Formato:

```markdown
## Checklist UAT (aceite manual)

Para cada critério da SPEC que exige validação manual:
- [ ] A1: (descrição do passo a executar pelo usuário, em linguagem simples)
- [ ] A2: …

**Instruções:** execute os itens acima no ambiente real e marque ✓. Se algum falhar, abra um item em Gaps abaixo.
```

O preenchimento da checklist é responsabilidade do **usuário** (não do agente de IA).
</camada_4_uat>

<calibracao_do_plano>
**Calibração do plano** (obrigatória quando existir `PLAN.md`)

Ler a `## Autoavaliação do Plano` e comparar com o resultado real:
1. Se `Confiança >= 85%` e houver falha precoce em critérios centrais ou tarefas iniciais, marcar **erro de calibração do plano**.
2. Se `Confiança < 70%` e as falhas ocorrerem nas incertezas previstas, marcar **autoavaliação aderente**.
3. Se `Confiança >= 70%` e os critérios/tarefas passarem de forma consistente, marcar **plano calibrado**.
4. Se `Confiança < 70%` e o ciclo passar amplamente, marcar **plano conservador demais**.

Registrar em `VERIFY.md`: `Resultado de calibração | Confiança declarada | Resultado observado | Notas`.
</calibracao_do_plano>

<runtime_e_checkpoints>
**Coerência do runtime e checkpoints** (obrigatória quando `EXECUTION-RUNTIME.md` ou `CHECKPOINTS.md` existirem)

1. Verificar se a onda/tarefa que o runtime marca como concluída bate com a evidência real nos arquivos e nos comandos executados.
2. Verificar se checkpoints `pending_approval` foram respeitados, e se `approved`, `rejected` ou `overridden` têm evidência e nota curta.
3. Se runtime ou checkpoints contradisserem `STATE.md`, `PLAN.md` ou `VERIFY.md`, registrar a incoerência explicitamente.
4. Usar esses artefatos como apoio para a seção de gaps e para a calibração do plano.
</runtime_e_checkpoints>

<camada_qc_quality_contract>
**Camada QC — Contrato de Qualidade** (ativa quando SPEC.md contiver requisitos R-RB da Fase 3.5)

**Objetivo:** verificar que os critérios de qualidade comprometidos na spec (R-RB aprovados como v1) foram efetivamente implementados — com o mesmo rigor de evidência aplicado aos critérios A*.

**Execução:**

1. Ler SPEC.md procurando requisitos com ID `R-RB-NN` e versão `v1` na tabela de requisitos.
2. Localizar o **Accepted Risk Registry** da SPEC (seção "Suposições e riscos" ou "Riscos Aceitos") — anotar itens R-RB declinados.
3. Para cada R-RB aprovado como v1, verificar implementação com evidência (Grep, Read, teste):

   | ID R-RB | Critério (resumo) | Tier | Evidência | Implementado? |
   |---------|-------------------|------|-----------|---------------|
   | RB-SEC-A1 | Bcrypt salt≥10 | Piso | `grep bcrypt src/` → linha X | ✓ / ✗ |

4. Calcular **Quality Score realizado:**
   ```
   QS_realizado = (Piso_implementados / Piso_aprovados × 60) + (Base_implementados / Base_aprovados × 40)
   ```
5. Comparar com Quality Score comprometido na spec (se registrado).
6. Registrar na seção **Contrato de Qualidade** do VERIFY.md:
   - Tabela de critérios R-RB (acima)
   - Quality Score comprometido vs realizado
   - Gap: itens aprovados como v1 mas não implementados

**Severidade dos gaps:**
- R-RB **Piso** não implementado → gap P0 → bloqueia `verify_complete` (mesma regra do security P0)
- R-RB **Base** não implementado → gap P1 → registrar, não bloqueia
- R-RB **Excelência** não implementado → informativo (estava em v2, não esperado)

**Pulável apenas se:** SPEC.md não contiver nenhum R-RB-NN com versão v1.
</camada_qc_quality_contract>

<process>
1. **Camada 1 — Auditoria de pré-execução:** checar integridade do PLAN.md e DISCUSS.md conforme `<camada_1_pre_exec_audit>`. Documentar resultado.
2. Resolver o context pack `verify` primeiro:
   - ler `.oxe/context/packs/verify.md|json` (ou `oxe-cc context inspect --workflow verify --json`);
   - se estiver fresco e coerente, usar o pack como mapa primário da verificação;
   - se estiver stale, incompleto ou ausente, registar `fallback para leitura direta` antes de ampliar a leitura.
3. Ler `SPEC.md`, `PLAN.md` e `DISCUSS.md` do escopo resolvido, além de `.oxe/STATE.md` global. Com pack válido, começar pelos artefatos de `read_order`; só expandir a leitura quando faltar evidência para um critério, tarefa, decisão ou checkpoint.
3a. **Caminho padrão do runtime enterprise:** se `oxe-cc runtime` estiver disponível:
   - executar ou solicitar `oxe-cc runtime verify --dir <projeto>` antes das camadas manuais;
   - usar `verification-manifest.json`, `residual-risk-ledger.json`, `evidence-coverage.json` e a projeção de `VERIFY.md` como base primária da verificação;
   - se o resultado vier como `partial`, tratar os gaps explícitos como backlog obrigatório das camadas manuais;
   - se o runtime não puder ser executado por indisponibilidade do pacote, registar `fallback legado`.
4. **Camada 2:** Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn). Para **cada ID de critério** da SPEC (A1, A2, …), registrar se passou com evidência.
5. **Camada 3:** Se existir `.oxe/DISCUSS.md` com IDs D-NN, executar **Fidelidade de decisões** conforme `<camada_3_fidelidade_decisoes>`.
6. Executar a verificação de coerência do runtime e checkpoints conforme `<runtime_e_checkpoints>`.
6a. Para operações Azure, confirmar o estado final com inventário/saída real do provider Azure; não considerar mutação aprovada sem evidência em `.oxe/cloud/azure/operations/`.
6b. Escrever **`VERIFY.md`** no escopo resolvido com:
   - Data, ambiente (SO / versão do Node se relevante).
   - **Seção — Contexto consumido:** pack usado, freshness, fallback acionado (ou não) e artefatos adicionais lidos fora do pack.
   - **Seção — Auditoria de pré-execução:** resultado da Camada 1.
   - **Tabela — Tarefas:** Tarefa (Tn) | Verificação (comando/checklist) | Passou? | Notas.
   - **Tabela — Critérios SPEC:** ID (A1…) | Critério (resumo) | Evidência | Passou? | Notas.
   - **Tabela — Fidelidade de decisões** (se DISCUSS.md existir): ID | Decisão | Tarefa(s) | Implementado? | Evidência.
   - **Seção — Coerência operacional:** runtime, checkpoints, bloqueios, handoffs e divergências.
   - **Seção — Calibração do plano:** resultado conforme `<calibracao_do_plano>`.
   - **Checklist UAT** (Camada 4).
   - **Gaps** — o que falhou e sugestão de correção; se não houver, escrever `Nenhum gap restante`.
   Quando `runtime verify` já tiver projetado `VERIFY.md`, usar essa projeção como base e complementar manualmente apenas as seções ou evidências que o runtime ainda não cobrir.
7. Atualizar **`.oxe/STATE.md`** global: `verify_complete` ou `verify_failed` + próximo passo (replan, corrigir ou publicar).
7a. **Registro de calibração:** após escrever `STATE.md`, se `PLAN.md` contiver bloco `<confidence_vector>` — extrair o vetor e comparar com o resultado real. Criar ou atualizar `.oxe/calibration.json` com um novo record no formato:
```json
{ "cycle": "C-NN", "plan_global_confidence": 0.74, "plan_dimensions": { "technical_risk": 0.45 }, "outcome": { "verify_status": "complete", "actual_waves": 3, "estimated_waves": 2 }, "calibration_error": { "technical_risk": 0.35 } }
```
O `calibration_error` de cada dimensão = `|score declarado - resultado observado|`. Para `technical_risk` e `dependencies`, o resultado observado é estimado por: `1.0` se sem bloqueios nessa dimensão, `0.5` se houve 1 bloqueio, `0.0` se houve 2+ bloqueios. Omitir o registro se PLAN.md não tiver `<confidence_vector>`.
7b. **Camada 4a — Auditoria Adversarial (opcional):** se `adversarial_verify: true` em `.oxe/config.json` (padrão: `false`):
   - Abrir novo contexto com pack no modo auditor: `oxe-cc context inspect --workflow verify --mode auditor --json` (inclui apenas `state`, `spec`, `verify` — exclui `plan`, `runtime`).
   - Executar `oxe/workflows/verify-audit.md` com esse contexto restrito.
   - O auditor não vê PLAN.md nem EXECUTION-RUNTIME.md — restrição intencional.
   - Incorporar a seção `## Auditoria Adversarial` no VERIFY.md.
   - Se o resultado for `REPROVADO`, registrar `verify_failed` e não avançar para SUMMARY/commit.
7c. **Blueprint plan-agent:** se **todas** as verificações relevantes **passaram**, existir **`.oxe/plan-agents.json`** com `oxePlanAgentsSchema >= 2` e `lifecycle.status === "executing"` (ou `pending_execute`), actualizar o JSON: `lifecycle: { "status": "closed", "since": "<ISO>" }` e espelhar em **`STATE.md`** (**lifecycle_status** → `closed`). Não fechar como `closed` se `verify_failed` ou gaps por resolver.
8. Acrescentar entrada em **`SUMMARY.md`** do escopo resolvido: se não existir, criar a partir de **`oxe/templates/SUMMARY.template.md`**. **Obrigatório** quando `verify_failed` ou quando a seção **Gaps** tiver itens.
8b. **Retrospectiva automática (pós-verify):** se `verify_complete` e `--skip-retro` não foi passado, executar automaticamente a lógica de `oxe/workflows/retro.md`:
   - Sintetizar 3–5 lições prescritivas com base nos achados do ciclo atual
   - Escrever/atualizar `.oxe/global/LESSONS.md` (com fallback para `.oxe/LESSONS.md`)
   - Incluir seção **Retrospectiva** resumida no VERIFY.md
   - Especialmente importante quando: houve replanejamento, falhas em execute, critérios A* ajustados, ou ciclo durou mais de 2 ondas
   - Com `--skip-retro`: pular esta etapa e mencionar que a retrospectiva está disponível via `/oxe-retro` manualmente
8c. **Camada 5 — Validate-gaps:** se `verification_depth: "thorough"` em `.oxe/config.json` **ou** flag `--gaps` foi recebida, executar a lógica de `oxe/workflows/validate-gaps.md` e adicionar seção **Gaps de Cobertura** ao VERIFY.md (mesmo conteúdo de VALIDATION-GAPS.md). Também escrever `.oxe/VALIDATION-GAPS.md` separado.
8d. **Camada 6 — Security:** se `security_in_verify: true` em `.oxe/config.json` **ou** flag `--security` foi recebida, executar a lógica de `oxe/workflows/security.md` e adicionar seção **Auditoria de Segurança** ao VERIFY.md. Também escrever `.oxe/SECURITY.md` separado. Achados P0 bloqueiam o `verify_complete` — registrar `verify_failed` até P0s serem resolvidos.
8d2. **Camada UI — Revisão de implementação:** se `UI-SPEC.md` existir no escopo **ou** flag `--ui` foi recebida, executar a lógica de `oxe/workflows/ui-review.md` e adicionar seção **Auditoria UI** ao VERIFY.md. Também escrever `.oxe/UI-REVIEW.md` separado.
8d3. **Revisão de PR/diff:** se flag `--pr` ou `--diff` foi recebida, executar a lógica de `oxe/workflows/review-pr.md` com o diff relevante e adicionar seção **Revisão de PR** ao VERIFY.md.
8e. **Camada QC — Quality Contract automático:** se SPEC.md contiver requisitos `R-RB-NN` com versão `v1`, executar o bloco `<camada_qc_quality_contract>` e adicionar seção **Contrato de Qualidade** ao VERIFY.md. R-RB Piso não implementados bloqueiam `verify_complete` — registrar `verify_failed` até serem resolvidos ou explicitamente aceitos como risco P0.
9. **Só se todas as verificações relevantes passarem:** se `after_verify_draft_commit` não for `false`: acrescentar em **VERIFY.md** a seção **Rascunho de commit** — mensagem convencional (ex.: `feat:` / `fix:`) + bullets alinhados aos critérios **A*** e decisões **D-NN**; **não** incluir segredos.
10. **Só se passou:** se `after_verify_suggest_pr` não for `false`: acrescentar **Checklist PR** — branch base, título sugerido, screenshots se UI, links a SPEC/PLAN/DISCUSS, testes executados.
11. No chat, responder nesta ordem:
   - **Findings**
   - **Perguntas abertas**
   - **Riscos residuais**
   - **Resumo**
</process>

<success_criteria>
- [ ] VERIFY.md contém as quatro seções: Auditoria de pré-execução, Tabela de tarefas, Tabela de critérios SPEC, Fidelidade de decisões (quando aplicável), Checklist UAT.
- [ ] Auditoria de pré-execução passou ou divergências foram documentadas.
- [ ] Falhas têm próximo passo claro (qual tarefa replanejar ou qual arquivo corrigir); se falhou, próximo passo inclui **plan** com replanejamento ou correção direta.
- [ ] STATE.md atualizado.
- [ ] SUMMARY.md atualizado quando houver falha ou gaps relevantes.
- [ ] Se passou: seções **Rascunho de commit** e **Checklist PR** presentes em VERIFY.md, salvo se desativadas na config.
- [ ] Se existiu DISCUSS.md: tabela de Fidelidade de decisões preenchida sem divergências não documentadas.
- [ ] Se `verification_depth: "thorough"` em config: `.oxe/VALIDATION-GAPS.md` produzido como parte deste verify.
- [ ] Se `security_in_verify: true` em config: `.oxe/SECURITY.md` produzido; achados P0 resolvidos ou `verify_failed` registrado.
- [ ] Se SPEC.md contiver R-RB v1: seção **Contrato de Qualidade** presente em VERIFY.md com Quality Score realizado; R-RB Piso não implementados tratados como gaps P0.
- [ ] Quando `oxe-cc runtime` estiver disponível, `runtime verify` foi tentado como caminho primário; se o resultado foi `partial`, os gaps explícitos do runtime foram cobertos ou documentados.
</success_criteria>
