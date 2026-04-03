---
name: oxe:plan-agent
description: Gera PLAN.md e plan-agents.json (blueprint de agentes e ondas)
argument-hint: "[--replan se já existe PLAN.md]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
---

**Workflow canónico:** `oxe/workflows/plan-agent.md`

Execute integralmente esse ficheiro. Se `$ARGUMENTS` contiver `--replan`, seguir a variante de replanejamento descrita no workflow.
