# OXE — Workflow: validate-gaps

<objective>
Após **`verify`**, produzir ou atualizar **`.oxe/VALIDATION-GAPS.md`**: auditoria **complementar** de cobertura e verificabilidade (critérios **A***, tarefas **Tn**, alinhamento PLAN↔VERIFY), com **sugestões de novas tarefas em texto** — **sem** alterar `.oxe/PLAN.md` por defeito.

Não substitui **`verify`**: não reescreve a evidência em `VERIFY.md`; adiciona uma camada de “gaps” e melhorias para a próxima ronda ou replan.
</objective>

<context>
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `VERIFY.md`, `PLAN.md`, `SPEC.md` e `VALIDATION-GAPS.md` vivem no escopo da sessão; sem sessão ativa, manter `.oxe/`.
- **Pré-requisitos:** `VERIFY.md` e `PLAN.md` existem no escopo resolvido. `SPEC.md` altamente recomendado para cruzar IDs **A***.
- **Quando usar:** equipas que querem fechar dívida de testes, evidência fraca ou desalinhamento após um verify (passou ou falhou).
- **Edição do PLAN:** só se o utilizador pedir explicitamente incorporar as sugestões no plano.
</context>

<process>
1. Ler `PLAN.md` (cada `### Tn`, **Verificar**, **Aceite vinculado:**), `VERIFY.md` (tabelas de tarefas e de critérios SPEC), e `SPEC.md` do escopo resolvido se existir.
2. Aplicar checklist de deteção (marcar cada achado nos **Gaps**):
   - **A*** na SPEC sem linha clara na tabela de critérios do VERIFY, ou com evidência inexistente/vaga.
   - **Tn** com `Comando: —` ou **Manual** vago quando o critério associado pede rigor reprodutível.
   - VERIFY indica sucesso mas a coluna de evidência é só genérica (sem path, comando ou trecho identificável).
   - Tarefa no PLAN sem linha correspondente na tabela de tarefas do VERIFY (verify focado em subset — documentar como gap de escopo).
3. Escrever ou atualizar **`VALIDATION-GAPS.md`** no escopo resolvido com secções fixas:
   - **Data** (ISO) e **Contexto** (verify passou / falhou; ambiente se relevante).
   - **Gaps** — tabela: **ID ou Tn** | **Tipo de gap** | **Severidade sugerida** (P0/P1/P2) | **Nota**.
   - **Sugestões de tarefas** — rascunhos `T_new` ou bullets para incorporar no próximo `oxe:plan --replan`; **apenas texto**.
4. Atualizar **`.oxe/STATE.md`**: quando existirem gaps com severidade **P0 ou P1**, registar referência a `VALIDATION-GAPS.md` pendente de ação (campo `next_step` ou secção Decisões). Para gaps apenas P2 ou puramente informativos, a atualização é opcional.
5. Responder no chat: resumo dos gaps críticos, próximo passo lógico (`oxe:plan --replan`, `oxe:execute`, ou “nenhuma ação” se só informativo).
</process>

<success_criteria>
- [ ] `VALIDATION-GAPS.md` reflete análise cruzada PLAN + VERIFY (+ SPEC quando existir).
- [ ] `PLAN.md` não foi alterado sem pedido explícito do utilizador.
- [ ] `.oxe/STATE.md` foi atualizado quando existiam gaps P0/P1 (passo 4).
- [ ] Fica claro que este passo **não** substitui um novo **`verify`** quando houver correções implementadas.
</success_criteria>
