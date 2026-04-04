---
name: oxe:loop
description: OXE — Execução iterativa de onda com retries automáticos e diagnóstico inline
argument-hint: "onda <N> [max:<tentativas>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Edit
  - Task
---

**Workflow canônico:** `oxe/workflows/loop.md`

Execute integralmente esse ficheiro na raiz do repositório. `$ARGUMENTS` = onda alvo e máximo de tentativas. Pré-requisito: `.oxe/PLAN.md`.
