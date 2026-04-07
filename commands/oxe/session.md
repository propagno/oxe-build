---
name: oxe:session
description: "Gerir sessões OXE: new, list, switch, resume, status, close, migrate"
argument-hint: "[new <nome> | list | switch <id> | resume <id> | status | close | migrate <nome>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/session.md`

Executa integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa `$ARGUMENTS` como subcomando e foco da operação da sessão ativa.
