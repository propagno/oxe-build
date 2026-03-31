---
name: oxe:execute
description: Executar onda do PLAN.md ou passos do QUICK.md
argument-hint: "[opcional: onda ou Tn]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/execute.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa `$ARGUMENTS` como foco (onda, tarefa, confirmação).
