# OXE — Workflow: swarm/board (Board Manager)

<objective>
Gerenciar o BOARD.md e BOARD.json do Swarm Run — a visão em tempo real do estado de cada tarefa,
agente, bloqueio e wave. Consultado por qualquer agente do swarm para saber o que está acontecendo
e atualizado após cada mudança de estado.
</objective>

<context>
- Usado internamente por `swarm-mode.md` após cada fase.
- Pode ser invocado diretamente pelo usuário via `/oxe-dashboard` para visualizar o swarm ativo.
- Não modifica arquivos de código. Apenas lê `.oxe/swarm/` e atualiza artefatos de board.
</context>

---

## Estrutura do BOARD.md

```markdown
# Swarm Board — <run_id>

**Objetivo:** <texto>
**Status:** running | paused | completed | failed
**Iniciado:** <timestamp> | **Atualizado:** <timestamp>
**Wave atual:** <N> de <total>

## Progresso

| ID | Tarefa | Agente | Wave | Status | Verificação | Revisão |
|----|--------|--------|------|--------|-------------|---------|
| T1 | Criar service de importação | builder-backend | 1 | ✅ done | passed | aprovado |
| T2 | Criar componente de upload | builder-frontend | 1 | 🔄 running | — | — |
| T3 | Criar migration | builder-storage | 1 | ⏳ pending | — | — |
| T4 | Testes de integração | builder-backend | 2 | ⏳ pending | — | — |

## Bloqueios ativos

| Task | Agente | Razão | Desde |
|------|--------|-------|-------|
| — | — | — | — |

## Quality Gates

| Gate | Condição | Status |
|------|----------|--------|
| G1 | Cobertura ≥ 80% | ⏳ pendente |
| G2 | Arquivo de alto risco revisado | ⏳ pendente |

## Log de eventos (últimos 5)

| Timestamp | Evento |
|-----------|--------|
| ... | Scout concluído: 12 arquivos mapeados |
| ... | Builder-backend iniciou T1 |
```

---

## Estrutura do BOARD.json

```json
{
  "run_id": "...",
  "updated_at": "ISO8601",
  "status": "running",
  "current_wave": 1,
  "total_waves": 2,
  "tasks": [
    {
      "id": "T1",
      "title": "...",
      "agent": "builder-backend",
      "wave": 1,
      "status": "done | running | pending | blocked | failed",
      "verification": "passed | failed | null",
      "review": "approved | rejected | null",
      "files_changed": [],
      "started_at": "ISO8601",
      "completed_at": null
    }
  ],
  "blockers": [],
  "quality_gates": [
    {"id": "G1", "condition": "coverage >= 80%", "status": "pending | passed | failed"}
  ],
  "agents": {
    "scout": "done",
    "builders": {"builder-backend": "running", "builder-frontend": "pending"},
    "reviewer": "pending",
    "verifier": "pending"
  }
}
```

---

## Operações disponíveis

### update_task_status(task_id, status, extra)
Atualiza status de uma tarefa em BOARD.json e regenera tabela em BOARD.md.

### add_blocker(task_id, agent, reason)
Adiciona à seção "Bloqueios ativos" em BOARD.md e ao array `blockers` em BOARD.json.

### resolve_blocker(task_id)
Remove da seção de bloqueios. Registra resolução no log.

### update_gate(gate_id, status)
Atualiza status do gate em ambos os artefatos.

### append_log(event_text)
Adiciona linha ao log de eventos (mantém últimos 10).

<success_criteria>
- [ ] BOARD.md renderiza tabela legível a qualquer momento do swarm.
- [ ] BOARD.json é fonte de verdade para todos os agentes lerem estado das tasks.
- [ ] Bloqueios visíveis imediatamente após registro.
- [ ] Quality gates rastreados com status atual.
</success_criteria>
