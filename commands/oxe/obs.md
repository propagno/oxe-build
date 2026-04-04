---
name: oxe:obs
description: "Observação contextual — registra em .oxe/OBSERVATIONS.md, incorporada automaticamente no próximo spec/plan/execute sem re-explicar"
argument-hint: "[observação: restrição, descoberta, preferência, risco ou decisão]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/obs.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como a observação a registrar.
