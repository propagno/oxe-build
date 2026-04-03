---
name: oxe-compact
mode: agent
description: OXE — refresh .oxe/codebase vs repo + CODEBASE-DELTA + RESUME
---

Executa o workflow **OXE compact** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/compact.md`

Atualiza os **sete** mapas em **`.oxe/codebase/`** (incremental ou bootstrap como scan), gera **`.oxe/CODEBASE-DELTA.md`** e **`.oxe/RESUME.md`**. Texto extra do utilizador: foco ou decisões/bloqueios a incluir no RESUME.
