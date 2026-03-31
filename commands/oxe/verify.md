---
name: oxe:verify
description: Valida implementação contra SPEC e PLAN; produz checklist e gaps
argument-hint: "[Tn opcional — focar uma tarefa]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

**Workflow canónico:** `oxe/workflows/verify.md`

Execute integralmente esse ficheiro. Se `$ARGUMENTS` indicar um id de tarefa (ex. `T2`), restringir a verificação a essa tarefa.
