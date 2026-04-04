# OXE — Estado

## Fase atual

`initial` — defina após primeiro scan: `scan_complete` | `spec_ready` | `discuss_complete` | `plan_ready` | `quick_active` | `executing` | `verify_complete` | `verify_failed`

## Último scan

- **Data:** (use **YYYY-MM-DD** para o `oxe-cc doctor` avisar scan antigo com `scan_max_age_days` em `.oxe/config.json`)
- **Notas:** (opcional)

## Último compact (codebase + RESUME) (opcional)

- **Data:** (**YYYY-MM-DD** — preenchido por **`/oxe-compact`**: refresh incremental dos mapas em `.oxe/codebase/` + `CODEBASE-DELTA.md` + `RESUME.md`)
- **Notas:** (opcional; ex.: "só STRUCTURE e TESTING")

## Contexto do plano / quick (opcional)

- **Spec / plano:** (revisão informal ou data de `.oxe/SPEC.md` / `.oxe/PLAN.md`)
- **Última onda executada:** (número ou —)
- **Tarefas concluídas:** (ex.: T1, T2 ou passos 1–3 do QUICK.md)

## Blueprint de agentes (sessão) (opcional — `/oxe-plan-agent`)

Espelho do **`.oxe/plan-agents.json`** ativo (schema 2). Atualizar em **`/oxe-plan-agent`**, **`/oxe-execute`**, **`/oxe-verify`**, **`/oxe-quick`** quando o lifecycle mudar.

- **run_id:** (igual a `runId` no JSON; — se não houver blueprint)
- **lifecycle_status:** `pending_execute` | `executing` | `closed` | `invalidated` | —
- **Última onda (execute):** (número ou —)
- **Notas:** (ex.: invalidado por quick; mensagens em `.oxe/plan-agent-messages/`)

## Checklist da onda OXE (opcional — workflow execute)

_(O agente pode preencher após cada onda.)_

- [ ] Onda N — pré-requisitos conferidos
- [ ] Onda N — implementação concluída
- [ ] Onda N — **Verificar** executado ou agendado

## Milestone ativo (opcional — `/oxe-milestone`)

- **ID:** (ex.: M-01 — ou — se não houver milestone ativo)
- **Nome:** (ex.: v1.0 — autenticação básica)
- **Iniciado:** (YYYY-MM-DD)
- **Progresso:** (N/M critérios verificados)

## Último milestone encerrado (opcional)

- **ID:** —
- **Data de encerramento:** —
- **Artefatos:** `.oxe/milestones/M-NN/`

## Workstreams ativos (opcional — `/oxe-workstream`)

- (nenhum ou lista de nomes: ex.: `feature-billing`, `bugfix-auth`)

## Workstream ativo (contexto atual)

- (nome do workstream ativo — ou — para pipeline principal)

## Memory (sidecars de sessão) (opcional — `/oxe-memory`)

Sidecars de memória persistente por agente/sessão. Armazenados em `.oxe/memory/`.

- (nenhum ou lista: ex.: `architect-2025-01-15.md`, `researcher-auth-2025-01-14.md`)

## Decisões persistentes

- (bullet: D-NN: decisão → data)

## Próximo passo sugerido

- Comando: `oxe:scan` | `oxe:spec` | `oxe:discuss` | `oxe:plan` | `oxe:quick` | `oxe:execute` | `oxe:verify`  
  *(no **Cursor**: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, …; Copilot prompts: `oxe-scan`, …)*
- Motivo: (uma linha)

## Bloqueios

- (nenhum ou lista)
