---
name: oxe:milestone
description: "Marcos de entrega (M-NN) — new, complete (arquiva SPEC/PLAN/VERIFY em .oxe/milestones/M-NN/), status, audit"
argument-hint: "new <nome> | complete | status | audit"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/milestone.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como subcomando e contexto (ex.: `new sprint-1`, `complete`, `audit`).
