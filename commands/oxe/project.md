---
name: oxe:project
description: OXE — Gestão de projeto: milestone (M-NN), workstream (trilhas paralelas), checkpoint (snapshot)
argument-hint: "milestone new|complete|status|audit | workstream new|switch|list|close <nome> | checkpoint [slug]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canônico:** `oxe/workflows/project.md`

Execute integralmente esse ficheiro. `$ARGUMENTS` = subcomando. Sem argumento: mostra status atual (milestone ativo, workstreams, último checkpoint).
