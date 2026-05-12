# OXE — Workflow: swarm-mode (Swarm Mode)

<objective>
Orquestração multi-agente para objetivos complexos (3+ domínios, 8+ arquivos ou feature completa).
Coordena 5 papéis em sequência controlada: Scout → Coordinator (Task Graph + File Ownership) → Builder(s) em paralelo → Reviewer → Verifier/Integrator.
Ao final, aciona aprendizado: padrões → CANDIDATES.ndjson → LESSONS.md.
</objective>

<context>
- Invocado por `conduct.md` quando `intent_score = complexo`.
- Reaproveitamento obrigatório:
  - `packages/runtime/src/scheduler/multi-agent-coordinator.ts` — coordenação parallel/cooperative
  - `oxe/schemas/plan-agents.schema.json` v3 — blueprint de agentes
  - `oxe/workflows/references/plan-agent-chat-protocol.md` — mensagens inter-agente
  - `packages/runtime/src/compiler/graph-compiler.ts` — ExecutionGraph
- Artefatos em `.oxe/swarm/` (run-scoped: `.oxe/swarm/<run_id>/` quando múltiplos runs ativos).
- Aplicar `oxe/workflows/references/reasoning-planning.md` na fase de decomposição.
- Aplicar `oxe/workflows/references/reasoning-execution.md` em cada Builder.
- Aplicar `oxe/workflows/references/reasoning-review.md` no Reviewer.
</context>

---

## Fase 1 — Inicialização do Swarm

Gerar `run_id` único: `swarm-<YYYYMMDD>-<seq>`

Criar `.oxe/swarm/SWARM-RUN.json`:

```json
{
  "run_id": "swarm-YYYYMMDD-001",
  "started_at": "ISO8601",
  "status": "running",
  "objective": "<objetivo do usuário>",
  "intent_tags": [],
  "memory_applied": false,
  "agents": {
    "scout": {"status": "pending"},
    "coordinator": {"status": "pending"},
    "builders": [],
    "reviewer": {"status": "pending"},
    "verifier": {"status": "pending"}
  },
  "task_graph": null,
  "file_ownership": null,
  "waves": [],
  "quality_gates": []
}
```

Criar `.oxe/swarm/BOARD.md` (tabela inicial):

```markdown
# Swarm Board — <run_id>

**Objetivo:** <texto>
**Status:** running
**Iniciado:** <timestamp>

| ID | Tarefa | Agente | Status | Arquivos |
|----|--------|--------|--------|----------|
| — | — | Scout | em andamento | — |
```

---

## Fase 2 — Scout

Invocar `oxe/workflows/swarm/scout.md` com o objetivo e intent_tags.

O Scout produz (em `.oxe/swarm/scout/`):
- `CODEBASE-MAP.md` — visão geral dos módulos relevantes ao objetivo
- `PATTERNS.md` — padrões de código existentes (naming, estrutura, convenções)
- `RISK-MAP.md` — arquivos críticos, arquivos compartilhados, riscos de regressão
- `FILE-CANDIDATES.json` — `[{file, domain, risk_level: low|med|high, suggested_agent}]`
- `TEST-CANDIDATES.json` — `[{test_file, covers, existing_coverage_pct}]`

Ao completar, atualizar `SWARM-RUN.json` → `agents.scout.status = "done"`.

---

## Fase 3 — Coordinator: Task Graph + File Ownership

O Coordinator (Conductor) usa os artefatos do Scout para:

### 3.1 Decomposição em tarefas

Decompor o objetivo em tarefas Tn seguindo os princípios de `oxe/personas/planner.md`:
- Cada tarefa: domínio claro, mutation_scope explícito, critério de aceite verificável
- Agrupar em ondas: tarefas sem dependência → mesma onda

### 3.2 Atribuição de Builders

Para cada domínio detectado, criar um Builder com:
- `id`: `builder-<domínio>` (ex.: `builder-backend`, `builder-frontend`)
- `persona`: persona mais adequada ao domínio (via mapeamento de conduct.md Fase 3)
- `taskIds`: tarefas atribuídas
- `model_hint`: fast | balanced | powerful

### 3.3 File Ownership

Criar `.oxe/swarm/FILE-OWNERSHIP.json`:

```json
{
  "run_id": "...",
  "created_at": "ISO8601",
  "locks": [
    {
      "file": "src/api/import.ts",
      "owner_agent": "builder-backend",
      "status": "locked",
      "locked_at": "ISO8601"
    }
  ],
  "free": []
}
```

**Regra de conflito:** se dois Builders têm o mesmo arquivo em seu write_set → serializar em waves sequenciais (não paralelas). Registrar decisão em `.oxe/swarm/DECISIONS.md`.

### 3.4 Atualizar artefatos

Gravar `.oxe/swarm/TASK-GRAPH.json`:
```json
{
  "run_id": "...",
  "tasks": [
    {"id": "T1", "title": "...", "domain": "...", "agent": "builder-backend", "wave": 1, "depends_on": [], "mutation_scope": [], "verify": "..."}
  ],
  "waves": [[["T1", "T2"]], [["T3"]]]
}
```

Gravar `plan-agents.json` conforme schema v3 em `oxe/schemas/plan-agents.schema.json`.

Atualizar `BOARD.md` com todas as tarefas.

---

## Fase 4 — Builders (execução em ondas)

Para cada onda, executar os Builders em paralelo (sem conflito de arquivo validado na Fase 3):

Cada Builder opera com o protocolo de `oxe/personas/executor.md`:
1. Ler tarefa(s) atribuída(s) + contexto de memória (inject de `conduct.md` Fase 2)
2. Discovery mínimo (confirmar arquivos, padrões)
3. Implementar com write set declarado no `FILE-OWNERSHIP.json`
4. Verificar (critério de aceite da tarefa)
5. Registrar resultado em `.oxe/swarm/BOARD.json`:
   ```json
   {"task_id": "T1", "agent": "builder-backend", "status": "done", "files_changed": [], "verification": "passed"}
   ```
6. Emitir mensagem de handoff em `.oxe/swarm/MESSAGES.ndjson` para o próximo agente

Se verificação falhar:
- Registrar em `.oxe/swarm/BLOCKERS.ndjson`: `{"task_id": "...", "agent": "...", "reason": "...", "ts": "..."}`
- Atualizar BOARD.md com status `blocked`
- Coordinator decide: retry | replan local | escalar para usuário

---

## Fase 5 — Reviewer

Após cada onda de Builders, invocar `oxe/personas/verifier.md` como Reviewer:

Para cada tarefa concluída:
1. Ler arquivos modificados pelo Builder
2. Verificar: padrões seguidos? Critério de aceite satisfeito? Sem side effects não declarados?
3. Gravar `.oxe/swarm/reviews/<task_id>-REVIEW.md`:
   ```markdown
   ## Review — T1
   **Status:** aprovado | reprovado
   **Checklist:** [lista]
   **Observações:** [texto ou —]
   ```
4. Se reprovado: Builder refaz → nova revisão (máx 2 tentativas por tarefa antes de escalar)

Atualizar BOARD.md.

---

## Fase 6 — Quality Gates

Antes de passar para o Verifier, avaliar gates automáticos baseados em `risk_score`:

| Condição | Gate |
|----------|------|
| Algum arquivo com `risk_level: high` foi modificado | Gate humano obrigatório |
| Cobertura de testes abaixo do threshold do projeto | Gate automático: bloquear até cobrir |
| Alguma tarefa falhou revisão 2x | Gate humano obrigatório |
| Nenhuma condição acima | Gate automático: aprovado |

Gravar `.oxe/swarm/QUALITY-GATES.md`:
```markdown
## Quality Gates — <run_id>

| Gate | Condição | Status | Resolução |
|------|----------|--------|-----------|
| G1 | Arquivo de alto risco modificado | pendente | — |
```

---

## Fase 7 — Verifier/Integrator

Invocar `oxe/personas/verifier.md` como Verifier final:

1. Integrar todas as mudanças (merge de worktrees se modo git_worktree)
2. Executar suite de testes completa
3. Verificar critérios de aceite do objetivo original (não só das tarefas individuais)
4. Gravar `.oxe/swarm/FINAL-INTEGRATION.md`:
   ```markdown
   ## Integração Final — <run_id>

   **Objetivo:** <texto>
   **Status:** integrado | falhou
   **Testes:** N passando / M falhando
   **Critérios de aceite:** [checklist com resultado]
   **Evidências:** [lista de arquivos de evidência]
   ```
5. Atualizar `.oxe/VERIFY.md` com resultado da integração

---

## Fase 8 — Learning

Ao completar (sucesso ou falha parcial), acionar `oxe/workflows/distill.md`:

- Entrada: `SWARM-RUN.json` + `FINAL-INTEGRATION.md` + `BLOCKERS.ndjson` + reviews
- Saída: `.oxe/learning/CANDIDATES.ndjson` + atualização de `.oxe/global/LESSONS.md`

---

## Fase 9 — Eventos e Fechamento

Emitir para `.oxe/OXE-EVENTS.ndjson`:
```json
{"type": "RunStarted", "payload": {"mode": "swarm", "run_id": "...", "objective": "..."}}
{"type": "WorkItemCompleted", "payload": {"task_id": "T1", "agent": "..."}}
...
{"type": "RunCompleted", "payload": {"run_id": "...", "status": "completed|partial|failed"}}
```

Atualizar `SWARM-RUN.json` → `status = completed | partial | failed`.
Atualizar `BOARD.md` com resumo final.

---

## Saída para o usuário

```
Swarm Mode — concluído
Objetivo: <texto resumido>
Agentes: Scout + N Builders + Reviewer + Verifier
Tasks: X concluídas / Y falharam
Integração: passou | falhou
Quality Gates: N aprovados / M pendentes

Arquivos principais alterados:
- <lista>

Learning: N lições registradas / M skill candidatas

Próximo passo: <recomendação>
```

<success_criteria>
- [ ] SWARM-RUN.json criado e atualizado em todas as fases.
- [ ] Scout produz todos os 5 artefatos em `.oxe/swarm/scout/`.
- [ ] FILE-OWNERSHIP.json sem conflitos entre Builders paralelos.
- [ ] BOARD.md atualizado em tempo real por fase.
- [ ] Cada tarefa tem review em `.oxe/swarm/reviews/`.
- [ ] QUALITY-GATES.md avaliado antes da integração.
- [ ] FINAL-INTEGRATION.md gerado pelo Verifier.
- [ ] VERIFY.md atualizado.
- [ ] Learning acionado (distill.md invocado).
- [ ] OXE-EVENTS.ndjson atualizado.
</success_criteria>
