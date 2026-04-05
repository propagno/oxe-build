---
name: oxe:retro
description: OXE — Retrospectiva de ciclo: sintetiza lições prescritivas em .oxe/LESSONS.md (alimenta ciclos futuros automaticamente)
argument-hint: "[opcional: contexto sobre o ciclo]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canônico:** `oxe/workflows/retro.md`

Execute integralmente esse ficheiro. Lê VERIFY.md, FORENSICS.md, SUMMARY.md para sintetizar 3–5 lições prescritivas. `$ARGUMENTS` = contexto extra opcional.
