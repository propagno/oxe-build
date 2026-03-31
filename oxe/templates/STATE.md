# OXE — Estado

## Fase atual

`initial` — defina após primeiro scan: `scan_complete` | `spec_ready` | `discuss_complete` | `plan_ready` | `quick_active` | `executing` | `verify_complete` | `verify_failed`

## Último scan

- **Data:** (ISO ou legível)
- **Notas:** (opcional)

## Contexto do plano / quick (opcional)

- **Spec / plano:** (revisão informal ou data de `.oxe/SPEC.md` / `.oxe/PLAN.md`)
- **Última onda executada:** (número ou —)
- **Tarefas concluídas:** (ex.: T1, T2 ou passos 1–3 do QUICK.md)

## Decisões persistentes

- (bullet: decisão → data)

## Próximo passo sugerido

- Comando: `oxe:scan` | `oxe:spec` | `oxe:discuss` | `oxe:plan` | `oxe:quick` | `oxe:execute` | `oxe:verify`  
  *(no **Cursor**: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, …; Copilot prompts: `oxe-scan`, …)*
- Motivo: (uma linha)

## Bloqueios

- (nenhum ou lista)
