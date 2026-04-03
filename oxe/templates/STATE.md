# OXE — Estado

## Fase atual

`initial` — defina após primeiro scan: `scan_complete` | `spec_ready` | `discuss_complete` | `plan_ready` | `quick_active` | `executing` | `verify_complete` | `verify_failed`

## Último scan

- **Data:** (use **YYYY-MM-DD** para o `oxe-cc doctor` avisar scan antigo com `scan_max_age_days` em `.oxe/config.json`)
- **Notas:** (opcional)

## Último compact (codebase + RESUME) (opcional)

- **Data:** (**YYYY-MM-DD** — preenchido por **`/oxe-compact`**: refresh incremental dos mapas em `.oxe/codebase/` + `CODEBASE-DELTA.md` + `RESUME.md`)
- **Notas:** (opcional; ex.: “só STRUCTURE e TESTING”)

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

## Decisões persistentes

- (bullet: decisão → data)

## Próximo passo sugerido

- Comando: `oxe:scan` | `oxe:spec` | `oxe:discuss` | `oxe:plan` | `oxe:quick` | `oxe:execute` | `oxe:verify`  
  *(no **Cursor**: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, …; Copilot prompts: `oxe-scan`, …)*
- Motivo: (uma linha)

## Bloqueios

- (nenhum ou lista)
