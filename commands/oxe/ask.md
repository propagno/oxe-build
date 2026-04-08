---
name: oxe:ask
description: "Perguntar ao OXE sobre a situação atual com leitura robusta de STATE, sessão ativa e artefatos da trilha"
argument-hint: "[pergunta em texto livre]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

**Workflow canónico:** `oxe/workflows/ask.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como pergunta e foco.
