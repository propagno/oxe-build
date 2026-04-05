---
name: oxe:review-pr
description: OXE — Revisão de diff/PR: analisa alterações, riscos, convenções e sugestões acionáveis
argument-hint: "<URL do PR ou branch:base..head>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canônico:** `oxe/workflows/review-pr.md`

Execute integralmente esse ficheiro. Recebe URL de PR do GitHub (`org/repo#N`) ou par de branches/SHAs. `$ARGUMENTS` = referência do diff.
