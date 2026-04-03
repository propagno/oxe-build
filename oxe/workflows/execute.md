# OXE — Workflow: execute

<objective>
Guiar a **implementação por ondas** com base em **`.oxe/PLAN.md`**, atualizando **`.oxe/STATE.md`** com progresso (tarefas Tn). Não substitui o editor: estrutura o trabalho e confirma pré-requisitos antes de cada onda.

Se existir apenas **`.oxe/QUICK.md`** (fluxo quick), tratar os **Passos** numerados como lista única “onda 1” em vez de tarefas T1…Tn.
</objective>

<context>
- **Blueprint plan-agent (schema 2):** Só adoptar **`role` / `scope`** de **`.oxe/plan-agents.json`** quando **todas** se verificam:
  1. `lifecycle.status` ∈ `{ pending_execute, executing }` (não usar se `closed` ou `invalidated`).
  2. **`runId`** no JSON coincide com **`run_id`** na secção **Blueprint de agentes (sessão)** do **`.oxe/STATE.md`** (se `STATE` não tiver secção, tratar como mismatch e **não** usar persona do blueprint até alinhar ou rerodar **`/oxe-plan-agent`**).
  3. O pedido do utilizador mapeia para pelo menos uma tarefa **`Tn`** presente no **`.oxe/PLAN.md`** (ou explícita na onda em curso). Se o pedido for **fora** do conjunto de tarefas do plano: responder **sem** persona do blueprint; sugerir **`/oxe-plan`**, **`/oxe-plan-agent`** ou **`/oxe-quick`**; só actualizar `lifecycle` para `invalidated` com `invalidatedBy: out_of_scope` se o utilizador **confirmar** explicitamente.
- **Transição `pending_execute` → `executing`:** na **primeira** mensagem deste workflow que avança uma onda com blueprint válido, actualizar **`plan-agents.json`** → `lifecycle: { "status": "executing", "since": "<ISO>" }` e espelhar em **`STATE.md`** (**lifecycle_status** / **run_id**).
- **Protocolo agente → agente:** entre ondas ou agentes dependentes, escrever mensagens em **`.oxe/plan-agent-messages/`** conforme **`oxe/workflows/references/plan-agent-chat-protocol.md`** (ficheiros imutáveis com `runId` no frontmatter). Antes de um agente destinatário trabalhar, ler mensagens dirigidas a esse `id` (ou `broadcast`) com o mesmo `runId`.
- Se existir **`.oxe/plan-agents.json`** e as condições acima se cumprirem, usar o blueprint como **roteiro de execução por agente**: para cada **onda** em `execution.waves`, listar os **agentes** (papel, `scope`, `inputs` sugeridos) e as **`taskIds`** correspondentes no **PLAN.md**; tarefas da mesma onda do PLAN que caem no mesmo agente podem ser feitas no mesmo contexto focado. O **comando Verificar** e as dependências **`Tk`** continuam a vir **só** do `PLAN.md` (fonte de verdade OXE).
- **Schema 1 / legado** (sem `lifecycle`): pode usar o JSON apenas como **roteiro suave** (lista de agentes/ondas), **sem** garantir exclusividade nem protocolo estrito até **`/oxe-plan-agent`** regerar schema 2.
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
- [ ] Com blueprint schema 2 válido: não adoptar persona do JSON para pedidos fora das `Tn`; `runId` alinhado entre JSON e STATE; handoffs escritos quando o protocolo exige (**`references/plan-agent-chat-protocol.md`**).
</success_criteria>
