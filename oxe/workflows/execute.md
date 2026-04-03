# OXE — Workflow: execute

<objective>
Guiar a **implementação por ondas** com base em **`.oxe/PLAN.md`**, atualizando **`.oxe/STATE.md`** com progresso (tarefas Tn). Não substitui o editor: estrutura o trabalho e confirma pré-requisitos antes de cada onda.

Se existir apenas **`.oxe/QUICK.md`** (fluxo quick), tratar os **Passos** numerados como lista única “onda 1” em vez de tarefas T1…Tn.
</objective>

<context>
- Se **PLAN.md** não existir mas **QUICK.md** existir, seguir **QUICK.md** neste workflow (passos = trabalho da sessão).
- Se nem PLAN nem QUICK existir, recomendar `oxe:plan` ou `oxe:quick` primeiro.
- **Legado / brownfield:** entregáveis podem ser só documentação (`.md`, diagramas). Exigir pré-requisitos de ambiente (mainframe, IDE VB6) quando a tarefa depender disso — ver **`oxe/workflows/references/legacy-brownfield.md`**.
- **Rotina compact/checkpoint (opcional):** antes de uma onda **experimental** ou refactor que mude muito o layout, **`/oxe-checkpoint`** com slug (ex.: `antes-refactor-modulo-x`) ajuda a retomar. Depois de ondas que mudem **stack** ou **árvore** do projeto, lembrar **`/oxe-compact`** para não deixar `.oxe/codebase/` desatualizado face ao código — **não** substitui o checklist da onda nem o **Verificar** do PLAN.
</context>

<process>
1. Ler `.oxe/STATE.md`, `PLAN.md` (se existir) e `QUICK.md` (se PLAN não existir).
2. Identificar **onda atual** (ou próxima): no PLAN, todas as tarefas da mesma **Onda** sem dependências pendentes; no QUICK, os passos ainda não marcados como feitos (se STATE não indicar, assumir desde o início).
3. Listar no chat: tarefas/passos desta onda, arquivos prováveis, comando **Verificar** associado (do PLAN ou do QUICK).
4. Incluir no final da mensagem (ou pedir atualização no `STATE.md`) um bloco **Checklist da onda** em Markdown, para o usuário ou o agente marcar:
   ```markdown
   ## Checklist — Onda N (OXE)
   - [ ] Pré-requisitos da onda conferidos (dependências T* atendidas)
   - [ ] Implementação da onda concluída
   - [ ] Comando **Verificar** desta onda executado (ou agendado)
   ```
5. Após o usuário confirmar que a onda foi implementada (ou após você aplicar as mudanças), atualizar **`.oxe/STATE.md`**:
   - Marcar no checklist acima (ou em bullets) **Última onda executada**, **Tarefas concluídas** (Tn ou números dos passos).
   - Próximo passo: continuar próxima onda, `oxe:verify` (se todas as ondas terminadas), ou `oxe:plan` se o plano ficou obsoleto.
6. Se o PLAN tiver várias ondas, repetir execute por onda sob pedido; não apagar tarefas do PLAN.
</process>

<success_criteria>
- [ ] Onda ou bloco de passos está explícito antes de “implementar”.
- [ ] Checklist da onda foi apresentado ou refletido no `STATE.md`.
- [ ] `STATE.md` registra progresso (Tn ou passos) e próximo passo.
- [ ] Verificação alinhada ao bloco **Verificar** do PLAN ou QUICK.
</success_criteria>
