---
name: oxe:plan
description: Gera PLAN.md a partir da SPEC com tarefas atômicas e verificação por item
argument-hint: "[--replan se já existe PLAN.md]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
---

**Workflow canónico:** `oxe/workflows/plan.md`

Execute integralmente esse ficheiro. Se `$ARGUMENTS` contiver `--replan`, seguir a variante de replanejamento descrita no workflow.
