---
name: oxe:update
description: OXE — Atualiza workflows e integrações para a versão mais recente do oxe-cc no npm
argument-hint: "[--force] [--check] [--if-newer]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canônico:** `oxe/workflows/update.md`

Execute integralmente esse ficheiro. Verifica versão no npm, reinstala com --force se necessário e valida com doctor. `$ARGUMENTS` = flags opcionais.
