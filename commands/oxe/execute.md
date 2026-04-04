---
name: oxe:execute
description: "Executar plano (solo ou com agentes): escolha Completo (1 sessão) | Por onda | Por tarefa — controle explícito de requisições"
argument-hint: "[A=completo | B=por-onda | C=por-tarefa | onda N | Tn]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

**Workflow canónico:** `oxe/workflows/execute.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa `$ARGUMENTS` como foco (onda, tarefa, confirmação).
