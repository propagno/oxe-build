# OXE — Workflow: deliver (Entrega Autônoma Ponta a Ponta)

<objective>
Conduzir uma solução completa de ponta a ponta a partir de um briefing do usuário:
compreensão imediata (`oxe-cc primer`), pergunta inicial sobre o modo de aprovação (`single-ok` vs. `auto`), geração de SPEC + Fases `F1..Fn`, congelamento de testes de aceite ANTES do código, execução fase por fase com anti-cheat SHA-256, anti-stub, auto-cura/circuit breaker, `FINAL_SMOKE` real e entrega final em `DELIVERY.md`.
</objective>

<context>
- Funciona igualmente em **greenfield** (pasta vazia) e **brownfield** (repositório existente).
- Usa a mesma máquina de estados determinística `.oxe/sessions/<id>/DELIVER.json` tanto no **Modo Chat** (`oxe-cc deliver next/advance` ou MCP `oxe_deliver_*`) quanto no **Modo Terminal Headless** (`oxe-cc deliver run`).
- Regra de segurança: nunca executar `git push`, criar PR remoto ou rodar `npm publish` sem autorização explícita do usuário.
</context>

---

## Passo 1 — Compreensão do Ambiente (`oxe-cc primer`)

1. Rodar `oxe-cc primer --json` (ou chamar a tool MCP `oxe_primer`).
2. Se já existir `active_delivery`, retomar direto com `oxe-cc deliver next --json`.
3. Se for nova entrega, perguntar **uma vez no início** qual modo de aprovação o usuário prefere:
   - **`single-ok` (Aprovação única):** pausa 1 vez após SPEC + Fases `F1..Fn` para o OK do usuário.
   - **`auto` (100% automático):** segue direto sem pausa se o briefing não tiver ambiguidades bloqueantes.

---

## Passo 2 — Intake do Briefing (`oxe-cc deliver init`)

1. Rodar `oxe-cc deliver init --from <briefing.md> --approval <single-ok|auto> --json` (ou `--text "..."`).
2. Se `status === "CLARIFY"`: fazer apenas as `1..5` perguntas bloqueantes retornadas em `blocking_questions`, coletar respostas e rodar `oxe-cc deliver answer --answers-json '{...}' --json`.
3. Se `status === "DESIGN_REVIEW"` (`single-ok`): apresentar objetivo, premissas assumidas, critérios `A1..An` e fases `F1..Fn`, aguardando o OK único (`oxe-cc deliver approve --json`).

---

## Passo 3 — Loop Autônomo Verificado (`F1..Fn` → `FINAL_SMOKE`)

- **No chat (Chat-Driven):** repetir até `state === "DELIVERED"`:
  1. Chamar `oxe-cc deliver next --json` (ou MCP `oxe_deliver_next`).
  2. Executar exatamente a fatia devolvida:
     - `PHASE_FREEZE_TESTS`: escrever testes de aceite verificáveis ANTES de codar e congelar com `oxe-cc deliver advance --frozen-tests <arquivos>`.
     - `PHASE_PLAN`: confirmar tarefas cobrindo 100% dos `A*` da fase e chamar `oxe-cc deliver advance`.
     - `PHASE_IMPLEMENT` / `PHASE_HEAL`: implementar/corrigir **sem jamais editar testes congelados** e chamar `oxe-cc deliver advance`.
     - `FINAL_SMOKE`: executar `oxe-cc deliver advance --json` para rodar o smoke real do produto e gerar `DELIVERY.md`.
  3. Se o circuit breaker pausar em `PAUSED_BLOCKED`, parar limpo, mostrar `blocked_reason` ao usuário e só retomar com `oxe-cc deliver resume`.
- **No terminal (Headless):** rodar `oxe-cc deliver run --from <briefing.md> --approval <single-ok|auto> --executor claude --max-budget-usd <N>`.

---

## Passo 4 — Entrega Pronta (`DELIVERY.md`)

Ao atingir `status === "DELIVERED"`, apresentar ao usuário o resumo de `DELIVERY.md` contendo:
1. O que foi construído e critérios `A1..An` validados.
2. Comandos testados no `FINAL_SMOKE` de **como rodar e testar agora**.
3. Branch local pronta (reforçando que nenhum `git push` foi feito automaticamente).

<success_criteria>
- `oxe-cc primer` executado e modo de aprovação (`single-ok` ou `auto`) definido com o usuário.
- `DELIVER.json`, `SPEC.md` e `ROADMAP.md` criados e todas as fases `F1..Fn` fechadas com testes congelados intactos (SHA-256 verificado).
- `FINAL_SMOKE` executado com saída real (exit 0) e `DELIVERY.md` + `DELIVERY.json` gerados sem side effects remotos automáticos.
</success_criteria>
