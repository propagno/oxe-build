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
- Preferir rodar comandos reais no terminal quando o ambiente permitir; se o sandbox bloquear, marcar como "não executado aqui" e deixar o comando para o usuário.
- Não destruir `PLAN.md`; registrar achados em `VERIFY.md`.
- Ler **`.oxe/config.json`** se existir: `after_verify_draft_commit`, `after_verify_suggest_pr`, e `verification_depth` (`"standard"` por padrão; `"thorough"` ativa camadas 3–4 completas; `"quick"` pula camadas 3–4 e UAT).
- Os critérios na SPEC devem estar na tabela **Critérios de aceite** com colunas **ID** / **Critério** / **Como verificar**; o verify deve **cruzar cada ID** com evidência (arquivo, comando, trecho).
- **Legado:** quando **Comando** for `—` ou inexistente, evidência válida inclui **Read/Grep**, existência de ficheiros referenciados e checklist manual — não marcar critério como passou sem evidência; se o ambiente host/desktop não estiver disponível, registar **não executado aqui** e próximo passo. Ver **`oxe/workflows/references/legacy-brownfield.md`**.
- **Debug:** investigação técnica de falhas **durante** a implementação segue **`oxe/workflows/debug.md`** (`/oxe-debug`). Resolver um bug com debug **não** dispensa este passo — após correções, **ainda** é necessário **`verify`** para fechar a trilha face à SPEC/PLAN.
- **UI:** se existirem `.oxe/UI-SPEC.md` / `.oxe/UI-REVIEW.md`, incorporar na evidência quando os critérios **A*** ou tarefas **Tn** tocarem interface.
- **Pós-verify (opcional):** para auditoria de **cobertura** e gaps de verificabilidade, **`oxe:validate-gaps`** → `.oxe/VALIDATION-GAPS.md` (ver **`oxe/workflows/validate-gaps.md`**). Com `verification_depth: "thorough"`, sugerir proativamente.
- **Rotina compact/checkpoint (opcional):** se esta entrega alterou **estrutura**, **stack** ou **pastas** de forma relevante, sugira **`/oxe-compact`** para alinhar `.oxe/codebase/` ao repo. Após **verify** com sucesso, um **`/oxe-checkpoint`** com slug curto pode marcar estado estável.
</context>

<camada_1_pre_exec_audit>
**Camada 1 — Auditoria de pré-execução** (roda *antes* de iniciar os comandos de verify)

Verificar que o PLAN.md está apto para verificação:
1. Toda tarefa `### Tn` tem bloco **Verificar** com pelo menos Comando ou Manual.
2. Todo **Aceite vinculado** referencia IDs que existem na tabela de SPEC.md (`A1`, `A2`, …).
3. Se houver `.oxe/DISCUSS.md`, toda decisão técnica com ID **D-NN** aparece em **Decisão vinculada:** de alguma tarefa (ou nota explícita de gap no PLAN).
4. Não há dependências `Tk` inválidas (ID inexistente no PLAN).

Se auditoria falhar: registrar na seção **Auditoria de pré-execução** do VERIFY.md os itens com problema e **pausar** — pedir correção do PLAN antes de continuar. Se o usuário forçar continuar com `--skip-audit`, documentar e prosseguir com aviso.
</camada_1_pre_exec_audit>

<camada_2_tarefas_e_criterios>
**Camada 2 — Verificação de tarefas e critérios SPEC**

Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn). Para **cada ID de critério** usado na SPEC (A1, A2, …), registrar se passou com evidência (Read/Grep, saída de teste resumida).
</camada_2_tarefas_e_criterios>

<camada_3_fidelidade_decisoes>
**Camada 3 — Fidelidade de decisões** (ativa se existir `.oxe/DISCUSS.md` com IDs D-NN)

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

<process>
1. **Camada 1 — Auditoria de pré-execução:** checar integridade do PLAN.md e DISCUSS.md conforme `<camada_1_pre_exec_audit>`. Documentar resultado.
2. Ler `.oxe/SPEC.md`, `.oxe/PLAN.md`, `.oxe/STATE.md`.
3. **Camada 2:** Para cada tarefa relevante, executar **Verificar: Comando** do PLAN (ou subconjunto se foco Tn). Para **cada ID de critério** da SPEC (A1, A2, …), registrar se passou com evidência.
4. **Camada 3:** Se existir `.oxe/DISCUSS.md` com IDs D-NN, executar **Fidelidade de decisões** conforme `<camada_3_fidelidade_decisoes>`.
5. Escrever **`.oxe/VERIFY.md`** com:
   - Data, ambiente (SO / versão do Node se relevante).
   - **Seção — Auditoria de pré-execução:** resultado da Camada 1.
   - **Tabela — Tarefas:** Tarefa (Tn) | Verificação (comando/checklist) | Passou? | Notas.
   - **Tabela — Critérios SPEC:** ID (A1…) | Critério (resumo) | Evidência | Passou? | Notas.
   - **Tabela — Fidelidade de decisões** (se DISCUSS.md existir): ID | Decisão | Tarefa(s) | Implementado? | Evidência.
   - **Checklist UAT** (Camada 4).
   - **Gaps** — o que falhou e sugestão de correção; se não houver, escrever `Nenhum gap restante`.
6. Atualizar **`.oxe/STATE.md`**: `verify_complete` ou `verify_failed` + próximo passo (replan, corrigir ou publicar).
6b. **Blueprint plan-agent:** se **todas** as verificações relevantes **passaram**, existir **`.oxe/plan-agents.json`** com `oxePlanAgentsSchema === 2` e `lifecycle.status === "executing"` (ou `pending_execute`), actualizar o JSON: `lifecycle: { "status": "closed", "since": "<ISO>" }` e espelhar em **`STATE.md`** (**lifecycle_status** → `closed`). Não fechar como `closed` se `verify_failed` ou gaps por resolver.
7. Acrescentar entrada em **`.oxe/SUMMARY.md`** (sessão): se não existir, criar a partir de **`oxe/templates/SUMMARY.template.md`**. **Obrigatório** quando `verify_failed` ou quando a seção **Gaps** tiver itens.
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
</success_criteria>
