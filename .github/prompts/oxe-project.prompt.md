---
name: oxe-project
agent: agent
description: OXE — Gestão de projeto unificada: milestone, workstream e checkpoint
argument-hint: "milestone new <nome> | workstream switch <nome> | checkpoint [slug]"
---

Executa o workflow **OXE project** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/project.md`

`$ARGUMENTS` = subcomando: `milestone new|complete|status|audit`, `workstream new|switch|list|close <nome>`, `checkpoint [slug]`, ou vazio para status atual.
