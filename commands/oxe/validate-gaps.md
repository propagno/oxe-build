---
name: oxe:validate-gaps
description: OXE — Auditoria Nyquist-lite (.oxe/VALIDATION-GAPS.md) após verify
argument-hint: "[opcional: Tn ou A*]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/validate-gaps.md`

Execute integralmente esse ficheiro na raiz do repositório. Pré-requisito: `VERIFY.md` e `PLAN.md`. `$ARGUMENTS` = foco opcional.
