---
name: oxe-security
agent: agent
description: OXE — Auditoria de segurança OWASP (.oxe/SECURITY.md): P0/P1/P2 vinculados ao stack
argument-hint: "[opcional: categoria OWASP, módulo ou arquivo de foco]"
---

Executa o workflow **OXE security** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/security.md`

Lê `.oxe/codebase/STACK.md` para determinar categorias OWASP aplicáveis. `$ARGUMENTS` = foco opcional.
