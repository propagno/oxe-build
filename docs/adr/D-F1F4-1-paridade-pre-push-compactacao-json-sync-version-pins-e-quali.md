<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-F1F4-1 — Paridade pre-push, compactacao JSON, sync version_pins e qualidade mecanica de specs e cards (v1.22.2)

- **Status:** Aceita
- **Data:** 2026-11-27
- **Fase:** F1–F4
- **Critérios:** A1, A11
- **Histórias:** US-1, US-11
- **Por:** architect
- **Origem:** RFC-1

## Contexto

No uso real do `oxe-build` na `v1.6.3` do OXESpace e no bench `v1.22.0 → v1.22.1`, 55%–70% do leadtime foi consumido após o PR aberto em retrabalho de CI, enquanto payloads `--json` de ~2,2 MB truncavam terminais de agentes e a falta de checagem mecânica de paths/símbolos permitiu referências desatualizadas em specs e cards (`US-1`..`US-11`, `R1`..`R11`, `A1`..`A11`).

## Decisão

1. **Paridade pré-push (`A1`):** estender `phase_gates` com `paths`/`globs` (fallback conservador quando `changedFiles` é indisponível) e agregar `preflight.triggers` no `runRuntimeVerify` (`bin/lib/oxe-phase-gates.cjs`, `bin/lib/oxe-preflight.cjs`, `bin/lib/oxe-operational.cjs`).
2. **Saída `--json` compacta (`A2`):** compactar `runtime verify --json` (`< 4 KB`, salvando `.oxe/runs/<run_id>/verify-full.json`), `plan lint --json` e `status --json` por padrão, mantendo `--full` opt-in (`bin/oxe-cc.js`).
3. **Recursos sequenciais e escopo pós-CI (`A3`, `A4`):** adicionar `sync.version_pins` em `bin/lib/oxe-sync.cjs` com hook em `runtimePromote`, e `plan scope add --auto-cr` atômico com reabertura automática de tarefas `done`.
4. **Telemetria offline e qualidade mecânica de upstream (`A8`, `A11`):** `computeLeadtimeAndCiMetrics` 100% offline em `bin/lib/oxe-scorecard.cjs`; validação mecânica de paths/ADRs no disco, símbolos citados como existentes e detector anti-"combo" em `bin/lib/oxe-alm-refine.cjs`; validação de profundidade (Bordas/Proibições), critérios sobrecarregados e paths no disco em `bin/lib/oxe-spec-check.cjs`.

## Alternativas consideradas

- **Criar chave separada `verify.path_gates`** — recusada: recusada por duplicar `phase_gates` e `preflight.triggers` e fragmentar a configuração dos projetos consumidores. (por architect)
- **Lock distribuído entre worktrees (`program lock`)** — recusada: recusada por adicionar estado remoto frágil e deadlocks; `oxe-cc sync` com `version_pins` + hook no `runtimePromote` resolve colisões de forma determinística no momento da promoção. (por architect)
- **Auto-confirmação de ramos no `grill import`** — recusada: recusada por violar a governança humana de playback e aprovação do OXE. (por architect)
- **Usar apenas revisão textual/Plan Mode nativo para validar specs e cards** — recusada: recusada porque modelos podem aprovar paths e campos inventados em prosa; validação mecânica no disco via `lintSpec` e `checkSpec` é determinística e agnóstica de IDE. (por architect)

## Consequências

- Fallback de `git diff` ocultar gate em worktree sem base → quando `changedFiles` não pode ser calculado, o gate executa (conservador).
- Compactação de `--json` quebrar automações legadas → `--full` preserva 100% do payload original e `verify-full.json` é sempre gravado em disco.
- Falsos positivos de validação de paths em cards que criam arquivos novos → paths explicitamente marcados `(novo)`/`(criar)`/`a criar` ou globs/placeholders são respeitados, e apenas `Referências` / `Arquitetura e fluxo` exigem existência prévia.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
