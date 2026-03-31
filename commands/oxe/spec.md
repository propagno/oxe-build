---
name: oxe:spec
description: Transforma o pedido do usuário em SPEC.md (escopo, aceite, não-objetivos)
argument-hint: "[texto do pedido ou @arquivo.md]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

**Workflow canónico:** `oxe/workflows/spec.md`

Execute integralmente esse ficheiro. Usa `$ARGUMENTS` e o contexto da conversa como entrada do utilizador (texto ou `@ficheiro`).
