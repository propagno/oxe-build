---
name: oxe-loop
agent: agent
description: OXE — Loop iterativo por onda com retries automáticos e diagnóstico inline
argument-hint: "onda <N> [max:<tentativas>]"
---

Executa o workflow **OXE loop** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/loop.md`

`$ARGUMENTS` = onda alvo e máximo de tentativas (ex.: `onda 2 max:5`). Pré-requisito: `.oxe/PLAN.md`.
