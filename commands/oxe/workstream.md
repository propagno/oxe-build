---
name: oxe:workstream
description: "Trilhas paralelas — list, new <nome>, switch <nome>, status, close <nome> — artefatos independentes em .oxe/workstreams/<nome>/"
argument-hint: "list | new <nome> | switch <nome> | status | close <nome>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/workstream.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como subcomando e contexto.
