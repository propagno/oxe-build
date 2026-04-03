---
description: "OXE — Revisão de PR (link GitHub, branches ou SHAs)"
---

OXE — Revisão de PR (link GitHub, branches ou SHAs)

Executa o workflow **OXE review-pr**. Lê e aplica **integralmente**:

`oxe/workflows/review-pr.md` (na raiz do repositório em contexto)

**Exemplos de entrada:** cola o URL da PR (`https://github.com/org/repo/pull/10`, com ou sem `/files`); ou `org/repo#10`; ou **base** e **head** (branches/tags/SHAs). Sem refs, o agente infere (ex.: `main` vs branch atual).
