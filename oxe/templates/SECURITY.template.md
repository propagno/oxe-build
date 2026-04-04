---
oxe_doc: security
status: draft
updated: YYYY-MM-DD
stack_ref: .oxe/codebase/STACK.md
plan_ref: .oxe/PLAN.md
---

# Auditoria de Segurança OXE

## Stack e escopo

**Stack identificado:** [linguagem, framework, DB, auth]
**Categorias OWASP avaliadas:** A01, A02, A03, ...
**Categorias descartadas:** A04 (motivo), A08 (motivo), ...

---

## Achados

### P0 — Crítico (requer ação imediata)

| ID | Categoria | Arquivo:linha | Padrão encontrado | Recomendação | Tarefa |
|----|-----------|--------------|-------------------|--------------|--------|
| S-01 | A07 — Auth | `src/auth/login.ts:42` | Senha comparada sem hash | Usar bcrypt/argon2 | T_new |

### P1 — Alto (antes do próximo deploy)

| ID | Categoria | Arquivo:linha | Padrão encontrado | Recomendação | Tarefa |
|----|-----------|--------------|-------------------|--------------|--------|
| S-02 | A05 — Config | `.env.example:8` | JWT_SECRET sem rotação documentada | Documentar política de rotação | T3 |

### P2 — Médio (ação recomendada, compensação aceitável)

| ID | Categoria | Arquivo:linha | Padrão encontrado | Recomendação | Tarefa |
|----|-----------|--------------|-------------------|--------------|--------|
| S-03 | A09 — Logging | `src/api/handler.ts:15` | Erro logado com stack trace completo em produção | Filtrar dados sensíveis em prod | T_new |

---

## Resultado por categoria

| Categoria OWASP | Status | Achados |
|-----------------|--------|---------|
| A01 — Broken Access Control | ✅ Sem achados | — |
| A02 — Cryptographic Failures | ⚠️ P1 | S-02 |
| A03 — Injection | ✅ Sem achados | — |
| A05 — Security Misconfiguration | ⚠️ P1 | S-02 |
| A07 — Authentication Failures | ❌ P0 | S-01 |
| A09 — Logging & Monitoring | ⚠️ P2 | S-03 |

---

## Sugestões de tarefas novas

```
T_new-S01: Implementar hash de senha com bcrypt (custo ≥ 12)
  Verificar: login falha com senha errada; hash visível no DB.
  Aceite vinculado: [A* de segurança se existir na SPEC]

T_new-S03: Filtrar stack traces em logs de produção
  Verificar: log em NODE_ENV=production não expõe stacktrace.
  Aceite vinculado: —
```

---

## Próximo passo

- **P0 presente:** ação obrigatória antes de qualquer deploy — criar tarefas e adicionar ao PLAN via `/oxe-plan --replan`.
- **Apenas P1/P2:** priorizar P1 na próxima onda; P2 pode ir para backlog v2.
- **Sem achados:** registrar como "auditoria limpa em YYYY-MM-DD" e prosseguir.
