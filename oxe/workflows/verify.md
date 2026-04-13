# OXE — Workflow: verify

<objective>
Executar ou orientar verificação pós-implementação em **quatro camadas progressivas**:

1. **Auditoria de pré-execução** — verificar que o PLAN está íntegro antes de iniciar (gate de qualidade).
2. **Verificação de tarefas e critérios** — rodar comandos do PLAN e cruzar cada critério da SPEC (IDs **A1**, **A2**, …) com evidência.
3. **Fidelidade de decisões** — cruzar cada decisão **D-NN** do DISCUSS.md com a implementação.
4. **UAT (Checklist de aceite)** — checklist manual para o usuário confirmar entregáveis.

Resultado registrado em **`.oxe/VERIFY.md`** com atualização de **STATE**.

Se o usuário indicar uma tarefa (ex.: `T2`), focar só nela nas camadas 1–2; as camadas 3–4 são sempre de escopo completo.
</objective>

<context>
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `VERIFY.md`, `VALIDATION-GAPS.md`, `SECURITY.md`, `UI-REVIEW.md` e `SUMMARY.md` vivem no escopo da sessão; `.oxe/STATE.md` continua global.
- Seguir `oxe/workflows/references/flow-robustness-contract.md`. O verify não valida só se passou; valida também se o plano estava bem calibrado para começar.
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

<process>
1. **Camada 1 — Auditoria de pré-execução:** checar integridade do PLAN.md e DISCUSS.md conforme `<camada_1_pre_exec_audit>`. Documentar resultado.
2. Ler `SPEC.md`, `PLAN.md` e `DISCUSS.md` do escopo resolvido, além de `.oxe/STATE.md` global.
3. **Camada 2:** Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn). Para **cada ID de critério** da SPEC (A1, A2, …), registrar se passou com evidência.
4. **Camada 3:** Se existir `.oxe/DISCUSS.md` com IDs D-NN, executar **Fidelidade de decisões** conforme `<camada_3_fidelidade_decisoes>`.
5. Executar a verificação de coerência do runtime e checkpoints conforme `<runtime_e_checkpoints>`.
5a. Para operações Azure, confirmar o estado final com inventário/saída real do provider Azure; não considerar mutação aprovada sem evidência em `.oxe/cloud/azure/operations/`.
6. Escrever **`VERIFY.md`** no escopo resolvido com:
   - Data, ambiente (SO / versão do Node se relevante).
   - **Seção — Auditoria de pré-execução:** resultado da Camada 1.
   - **Tabela — Tarefas:** Tarefa (Tn) | Verificação (comando/checklist) | Passou? | Notas.
   - **Tabela — Critérios SPEC:** ID (A1…) | Critério (resumo) | Evidência | Passou? | Notas.
   - **Tabela — Fidelidade de decisões** (se DISCUSS.md existir): ID | Decisão | Tarefa(s) | Implementado? | Evidência.
   - **Seção — Coerência operacional:** runtime, checkpoints, bloqueios, handoffs e divergências.
   - **Seção — Calibração do plano:** resultado conforme `<calibracao_do_plano>`.
   - **Checklist UAT** (Camada 4).
   - **Gaps** — o que falhou e sugestão de correção; se não houver, escrever `Nenhum gap restante`.
6. Atualizar **`.oxe/STATE.md`** global: `verify_complete` ou `verify_failed` + próximo passo (replan, corrigir ou publicar).
6b. **Blueprint plan-agent:** se **todas** as verificações relevantes **passaram**, existir **`.oxe/plan-agents.json`** com `oxePlanAgentsSchema >= 2` e `lifecycle.status === "executing"` (ou `pending_execute`), actualizar o JSON: `lifecycle: { "status": "closed", "since": "<ISO>" }` e espelhar em **`STATE.md`** (**lifecycle_status** → `closed`). Não fechar como `closed` se `verify_failed` ou gaps por resolver.
7. Acrescentar entrada em **`SUMMARY.md`** do escopo resolvido: se não existir, criar a partir de **`oxe/templates/SUMMARY.template.md`**. **Obrigatório** quando `verify_failed` ou quando a seção **Gaps** tiver itens.
7b. **Retrospectiva (pós-verify):** se `verify_complete`, sugerir **`/oxe-retro`** para capturar aprendizados do ciclo em `.oxe/LESSONS.md`. Especialmente importante quando: houve replanejamento (`--replan`), houve falhas em execute que precisaram de debug, critérios A* foram ajustados durante o ciclo, ou o ciclo durou mais de 2 ondas. Retro antes do próximo spec garante que lições orientem o próximo ciclo.
7b. **Camada 5 — Validate-gaps automático:** se `verification_depth: "thorough"` em `.oxe/config.json`, executar a lógica de `oxe/workflows/validate-gaps.md` e adicionar seção **Gaps de Cobertura** ao VERIFY.md (mesmo conteúdo de VALIDATION-GAPS.md). Também escrever `.oxe/VALIDATION-GAPS.md` separado.
7c. **Camada 6 — Security automático:** se `security_in_verify: true` em `.oxe/config.json`, executar a lógica de `oxe/workflows/security.md` e adicionar seção **Auditoria de Segurança** ao VERIFY.md. Também escrever `.oxe/SECURITY.md` separado. Achados P0 bloqueiam o `verify_complete` — registrar `verify_failed` até P0s serem resolvidos.
8. **Só se todas as verificações relevantes passarem:** se `after_verify_draft_commit` não for `false`: acrescentar em **VERIFY.md** a seção **Rascunho de commit** — mensagem convencional (ex.: `feat:` / `fix:`) + bullets alinhados aos critérios **A*** e decisões **D-NN**; **não** incluir segredos.
9. **Só se passou:** se `after_verify_suggest_pr` não for `false`: acrescentar **Checklist PR** — branch base, título sugerido, screenshots se UI, links a SPEC/PLAN/DISCUSS, testes executados.
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
</success_criteria>
