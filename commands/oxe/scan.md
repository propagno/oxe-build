---
name: oxe:scan
description: Escaneia o repositório e gera mapa em .oxe/codebase/ + STATE.md
argument-hint: "[área opcional, ex. auth, api]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/scan.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Se o utilizador passar texto em `$ARGUMENTS`, usa-o como **foco opcional** de área (pastas/módulos) no mapeamento.
