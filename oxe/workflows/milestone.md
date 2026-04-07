# OXE — Workflow: milestone

<objective>
Gerenciar **marcos de entrega** do projeto: registrar versões entregues, arquivar fases concluídas e preparar o contexto para a próxima iteração.

Subcomandos:
- `/oxe-milestone new [nome]` — iniciar novo milestone.
- `/oxe-milestone complete` — fechar milestone ativo, arquivar artefatos, preparar próxima iteração.
- `/oxe-milestone status` — exibir progresso do milestone ativo.
- `/oxe-milestone audit` — verificar se o milestone atingiu sua definição de pronto.
</objective>

<context>
- Milestone ≠ Checkpoint. **Checkpoint** (`/oxe-checkpoint`) é um snapshot de sessão — restaurável a qualquer momento. **Milestone** é uma entrega — marcador de versão com artefatos arquivados e critérios de pronto validados.
- Nesta versão, milestones são **globais**: usar `.oxe/global/MILESTONES.md` e `.oxe/global/milestones/`, ignorando `active_session` para escrita do índice global.
- Milestones são rastreados em **`.oxe/global/MILESTONES.md`** (índice) e cada entrega tem uma entrada com status, data e links aos artefatos.
- O milestone ativo é registrado no **STATE.md** na seção **Milestone ativo**.
- Um milestone é considerado **pronto** quando:
  1. Todos os critérios A* da SPEC estão com `verify_complete` no STATE.
  2. VERIFY.md não tem gaps abertos.
  3. Checklist UAT foi preenchido pelo usuário (se aplicável).
  4. Rascunho de commit ou PR foi gerado.
</context>

<process_new>
**`/oxe-milestone new [nome]`**

1. Verificar se há milestone ativo em STATE.md. Se houver, alertar e pedir confirmação antes de criar novo.
2. Gerar ID sequencial: **M-01**, **M-02**, …
3. Criar entrada em **`.oxe/global/MILESTONES.md`**:
   ```markdown
   ## M-01 — [nome] (ativo)
   - **Status:** ativo
   - **Iniciado:** YYYY-MM-DD
   - **SPEC:** `.oxe/SPEC.md` (versão atual)
   - **Critérios:** A1, A2, … (lista dos IDs da SPEC)
   - **Entregável:** (descrever o que será entregue)
   ```
4. Atualizar **STATE.md**: seção **Milestone ativo** com ID e nome.
5. Confirmar no chat: `Milestone M-01 iniciado — próximo passo: /oxe-spec (ou /oxe-plan se SPEC já existir)`.
</process_new>

<process_complete>
**`/oxe-milestone complete`**

Pré-requisitos (verificar antes de executar):
- [ ] STATE.md indica `verify_complete`.
- [ ] VERIFY.md não tem gaps abertos.
- [ ] Checklist UAT preenchido (se aplicável).

Se pré-requisitos não forem satisfeitos: listar os que faltam e pausar. Com `--force`: documentar pré-requisitos não satisfeitos e continuar com aviso.

Passos:
1. Arquivar artefatos do milestone:
   - Copiar os artefatos do escopo ativo da sessão, se houver, para `.oxe/global/milestones/M-NN/`
   - Sem sessão ativa, copiar da raiz `.oxe/`
   - Criar `.oxe/global/milestones/M-NN/MILESTONE.md` com resumo da entrega.
2. Atualizar **`.oxe/global/MILESTONES.md`**: marcar milestone como `entregue`, adicionar data de encerramento e links aos artefatos arquivados.
3. Atualizar **STATE.md**: limpar seção **Milestone ativo**, registrar **Último milestone** com ID e data.
4. Sugerir próximo milestone ou nova spec: `Milestone M-NN concluído. Próximos passos: /oxe-milestone new v2 | /oxe-spec | /oxe-checkpoint`.
</process_complete>

<process_status>
**`/oxe-milestone status`**

1. Ler STATE.md para identificar milestone ativo (ID e nome).
2. Ler `.oxe/global/MILESTONES.md` para detalhes.
3. Ler SPEC.md para listar critérios A* e seu status (verificado / pendente).
4. Ler VERIFY.md (se existir) para gaps abertos.
5. Exibir no chat:
   - Milestone ativo: ID, nome, data de início.
   - Progresso: N/M critérios verificados.
   - Gaps abertos: lista ou "nenhum".
   - Próximo passo sugerido.
</process_status>

<process_audit>
**`/oxe-milestone audit`**

Verificar definição de pronto (Definition of Done):
1. [ ] `verify_complete` no STATE.
2. [ ] VERIFY.md sem gaps.
3. [ ] Checklist UAT preenchido (ou ausente se inaplicável).
4. [ ] Rascunho de commit ou PR gerado.
5. [ ] Artefatos do milestone existem (SPEC, PLAN, VERIFY).

Resultado: `Milestone M-NN: PRONTO` ou lista de itens pendentes.
</process_audit>

<success_criteria>
- [ ] `.oxe/global/MILESTONES.md` existe e tem entrada para o milestone ativo.
- [ ] STATE.md indica milestone ativo (ID e nome).
- [ ] Ao completar: artefatos arquivados em `.oxe/milestones/M-NN/`.
- [ ] Ao completar: MILESTONES.md atualizado com status `entregue` e data.
</success_criteria>
