---
name: oxe-execute
agent: agent
description: "OXE — Executar plano (solo ou com agentes): escolha Completo (1 sessão) | Por onda | Por tarefa para controlar requisições"
argument-hint: "[opcional: A/B/C para modo, onda N, ou Tn]"
---

Executa o workflow **OXE execute** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/execute.md`

Usa o texto adicional desta mensagem como foco: `A` (Completo), `B` (Por onda), `C` (Por tarefa), `onda N`, `Tn`, ou confirmação de progresso. Lê `oxe/workflows/execute.md` na raiz do projeto atual (CWD).
