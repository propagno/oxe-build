# Cobertura do ADLC no oxe-build

Para cada etapa do quadro (as 12 etapas canônicas de `alm.states`) e para cada atividade de apoio: o comando do oxe-build, o estado da cobertura e o que falta. Esta matriz é atualizada a cada entrega.

**Legenda:**
- ✅ coberto: há comando, teste e documentação;
- 🟡 parcial: o comando existe, mas falta uma parte, listada na coluna "O que falta";
- ❌ falta: ainda é feito por script ou à mão.

Estado de 14/11/2026, ainda sem commit desde `eb57911`.

## Etapas do quadro

| # | Etapa (coluna do OxeSpace) | Dono | Comando do oxe-build | Estado | O que falta / OXB |
|---|---|---|---|---|---|
| 1 | intake (Backlog) | humano / OXE | `oxe-cc alm intake --type … --summary …`; `alm push` (a partir do PRD, com `stories_source`) | ✅ | — |
| 2 | grooming (Em grooming) | OXE | `oxe-cc grill … --card OXE-n` · `grill publish --card --apply` · `grill report` | ✅ | Lote 1 (15 cards) em Pronto; lote 2 (15 cards) com o grooming respondido. O comentário separa "Fatos (fonte)" de "Perguntas" (G12) |
| 3 | refinement (Em refinamento) | OXE | `oxe-cc alm refine <KEY> --claim --apply` (coleta só de leitura e esqueleto do tipo; cada card diz se moveu e por quê, G14) | ✅ | — |
| 4 | ready (Pronto para desenvolvimento) | OXE | `alm refine lint` → `alm refine apply --dry-run` (simula, nunca grava: G13) → `--apply` (spec-v1; sem perguntas vai para ready, com needs-info volta para grooming); `alm.ready_gate` | ✅ | — |
| 5 | in_progress (Em desenvolvimento) | OXE | `oxe-cc runtime execute` (TaskStarted) · `oxe-cc quick <KEY> "<objetivo>" --apply` (minispec no card, move só para a frente) · `alm sync` · ready gate antes | ✅ | — |
| 6 | review (Em revisão) | CI | `oxe-cc runtime promote` (PR com a chave) · `ship status` | ✅ | O estado é movido pelo jira-sync do OxeSpace (`track` sem review) |
| 7 | verified (Testado) | CI | `runtime verify` (local + `verify.remote`) · `trace publish` (evidência por CA no card) | 🟡 | `verify.remote` de **tarefa** (snapshot sem push forçado, workflow leve), pedido da oxespace-69 |
| 8 | queued (Na fila) | CI | `ship status --repo` (PRs abertos com os rótulos do trem `ship.train_labels`) · `ship status --pr <n> --comment --apply` (veredito no PR) | 🟡 | O motivo de saída do trem (lido do comentário do trem) |
| 9 | integrated (Na main) | CI | `alm sync` (merge via `gh pr view`) · `ship status` | ✅ | — |
| 10 | staging (Em homologação) | CI | — | ❌ | **G6**: a release (homologação → tag → verify do APK e do desktop) |
| 11 | accepted (Homologado) | humano | `runtime signoff` (evidência) | 🟡 | Relatório de HML ligado ao card (G6) |
| 12 | released (Lançado) | CI | `runtime deploy --attach` · `alm sync` (versão lançada) · `alm version ensure` | 🟡 | O release verify do APK e do desktop (G6) |

## Atividades de apoio

| Atividade | Comando | Estado | O que falta / OXB |
|---|---|---|---|
| Descoberta da spec (grill) | `oxe-cc grill …` · `/oxe-spec` | ✅ | — |
| Portão da spec | `oxe-cc spec check` · `spec probe` · `spec approve` | ✅ | — |
| PRD, RFC, ADR | `prd lint` · `rfc new/accept/reject` · `decision add/import/publish` | ✅ | — |
| Rastreabilidade | `oxe-cc trace` · `trace publish` · `alm.trace_gate` (warn / close / strict) | ✅ | O link para o commit do merge nos docs de worktree (adiado) |
| Plano | `/oxe-plan` · `plan lint` · `plan merge` (ids estáveis) · `plan append` | ✅ | — |
| Mudança no meio do caminho | `spec amend/add` · `program phase add/edit` · `runtime feedback` (`--reopen` explícito) · `alm refine import` (fase congelada → CR) | ✅ | — |
| Trava de origem (nada fora do oxe-build) | `runtime execute` (`OXE-Task`/`OXE-Run`) · `quick commit` (`OXE-Quick`/`OXE-Card`) · `oxe-cc ship check-origin [<#PR>]` · hook commit-msg no `guards install` · `origin.exempt` | ✅ | Ligar o `check-origin` no CI do OxeSpace (job do PR) |
| Tarefa pequena | `oxe-cc quick <KEY> "<objetivo>"` · `quick commit` · `quick done --verify` · `/oxe-quick` | ✅ | — |
| Falhas conhecidas de CI | `ship known-failure add/list/remove/prune` no nível do repositório (`<git common dir>/oxe/`, todas as worktrees), expira no merge do PR do conserto · veredito em `ship status --pr/--card/--repo` | ✅ | — |
| Fila e trem de merge | `ship status --repo` (rótulos do trem + veredito de CI por PR) · `--comment --apply` | 🟡 | O motivo de saída do trem |
| pr:ready | — | ❌ | Marcador e hook (hoje `scripts/pr-ready.mjs` no OxeSpace) |
| Goldens do celular | — | ❌ | A troca de branch `ci/record-phone-goldens` |
| Configuração do quadro | `alm doctor` (só leitura) | ✅ | `alm setup --apply` (opcional, para projeto novo) |
| Métricas do fluxo | `alm metrics` (tempo por coluna, lead/cycle, vazão, WIP, gargalo) | ✅ | Os números ganham sentido com 1 a 2 semanas de uso |
| Simulação e escrita explícita | `--dry-run` em qualquer comando que grava: o transporte recusa POST/PUT/PATCH/DELETE (G13, teste por comando) · `alm.require_apply` (sem `--apply` é simulação; aviso de deprecação quando desligado) | ✅ | O padrão `require_apply: true` entra na próxima minor |
| Registro de uso (estresse) | `.oxe/alm/usage.ndjson` · `alm usage` | ✅ | — |
| Ajuda e descoberta | `alm --help`, `alm <sub> --help`, `grill --help`; comando desconhecido sai com exit 2 | ✅ | — |

## OXBs abertos (fila combinada com a coordenação, 14/11)

1. **G6:** a release (homologação → tag → verify do APK e do desktop).
2. **`verify.remote` de tarefa:** snapshot com índice temporário, ref de rascunho próprio, workflow leve.
3. **pr:ready e goldens do celular.**
