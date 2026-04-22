---
oxe_doc: execution_runtime
status: active
updated: YYYY-MM-DD
---

# OXE — Runtime Operacional

> Estado tático da execução. Este ficheiro complementa `PLAN.md` e `STATE.md`, mas não os substitui.

## Contexto

- **Sessão / escopo:** …
- **Plano vinculado:** `PLAN.md`
- **Run ID:** `oxe-run-YYYYMMDD-001`
- **Active run:** `.oxe/ACTIVE-RUN.json` ou artefato equivalente de sessão
- **Trace log:** `.oxe/OXE-EVENTS.ndjson` ou artefato equivalente de sessão
- **Autoavaliação do plano:** melhor=`sim|não` | confiança=`NN%`
- **Limiar de execução:** `>90%`

## Onda atual

- **Onda:** —
- **Estado:** planned | running | paused | waiting_approval | failed | completed | replaying | aborted
- **Tarefas ativas:** —
- **Última atualização:** YYYY-MM-DD

## Agentes ativos

| ID | Papel | Tarefas | Estado | Último handoff |
|----|-------|---------|--------|----------------|
| … | … | T1, T2 | active | — |

## Checkpoints

| ID | Tipo | Escopo | Estado | Política | Decisão | Evidência |
|----|------|--------|--------|----------|---------|-----------|
| CP-01 | approval | Onda 1 | pending_approval | require_approval | — | — |

## Handoffs

- W1 · `agent-a -> agent-b`: …

## Grafo operacional

- **Nós:** agent-a, capability-x, checkpoint-CP-01
- **Arestas:** handoff, dependency, blocked_by

## Evidências produzidas

- `path/ou/artefato`: resumo curto

## Bloqueios

- (nenhum ou lista)

## Iterações / retries

- Tarefa/onda | Tentativa | Resultado | Nota

## Tracing operacional

- `run_started` → `phase_entered` → `handoff` → `checkpoint_opened` → `checkpoint_resolved` → `verification_completed`

## Próximo movimento operacional

- **Ação:** …
- **Motivo:** …
