# OXE — Estado

## Fase atual

`initial` — defina após primeiro scan: `scan_complete` | `spec_ready` | `discuss_complete` | `plan_ready` | `quick_active` | `executing` | `verify_complete` | `verify_failed`

## Último scan

- **Data:** (use **YYYY-MM-DD** para o `oxe-cc doctor` avisar scan antigo com `scan_max_age_days` em `.oxe/config.json`)
- **Notas:** (opcional)

## Contexto do plano / quick (opcional)

- **Spec / plano:** (revisão informal ou data de `.oxe/SPEC.md` / `.oxe/PLAN.md`)
- **Última onda executada:** (número ou —)
- **Tarefas concluídas:** (ex.: T1, T2 ou passos 1–3 do QUICK.md)

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
