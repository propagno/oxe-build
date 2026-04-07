---
name: oxe-session
agent: agent
description: "OXE — Gerir sessões: new, list, switch, resume, status, close, migrate"
argument-hint: "[new <nome> | list | switch <id> | resume <id> | status | close | migrate <nome>]"
---

Executa o workflow **OXE session** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/session.md`

Usa o texto adicional desta mensagem como foco do subcomando: `new <nome>`, `list`, `switch <id>`, `resume <id>`, `status`, `close` ou `migrate <nome>`. Lê `oxe/workflows/session.md` na raiz do projeto atual (CWD).
