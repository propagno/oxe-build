# OXE — Estado

> Porta de entrada enxuta do projeto. Mantenha curto: só o que orienta o próximo passo.
> Catálogo completo dos artefatos do `.oxe/`: veja **`.oxe/README.md`** ou rode **`oxe-cc map`**.
> Seções avançadas (runtime, blueprint de agentes, milestones, workstreams, loop, memória)
> são opcionais e devem ser anexadas **sob demanda** quando o recurso for usado —
> modelo em `oxe/templates/STATE-REFERENCE.md`.

## Fase atual

`initial` — após o primeiro scan use: `scan_complete` | `spec_ready` | `discuss_complete` | `plan_ready` | `quick_active` | `executing` | `verify_complete` | `verify_failed`

## Sessão ativa (opcional — `/oxe-session`)

- **active_session:** (path relativo a `.oxe/` — ex.: `sessions/s001-auth-redesign` — ou — se nenhuma)
- **session_id:** (ex.: `s001` — ou —)

## Próximo passo sugerido

- Comando: `oxe:scan` | `oxe:spec` | `oxe:discuss` | `oxe:plan` | `oxe:quick` | `oxe:execute` | `oxe:verify`
  *(no **Cursor**: `/oxe-scan`, `/oxe-spec`, …; Copilot prompts: `oxe-scan`, …)*
- Motivo: (uma linha)

## Decisões persistentes

- (bullet: D-NN: decisão → data)

## Bloqueios

- (nenhum ou lista)
