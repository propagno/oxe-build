---
name: oxe:security
description: OXE — Auditoria de segurança OWASP (.oxe/SECURITY.md): P0 crítico / P1 alto / P2 médio
argument-hint: "[opcional: categoria OWASP, módulo ou arquivo]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canônico:** `oxe/workflows/security.md`

Execute integralmente esse ficheiro na raiz do repositório. Lê `STACK.md` para determinar categorias OWASP pertinentes. `$ARGUMENTS` = foco opcional.
