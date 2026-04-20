# OXE — Primeiros 15 Minutos

> Leitura: ~5 min. Você sai daqui com o projeto configurado e o primeiro ciclo rodando.

---

## 1. Instalar

```bash
npx oxe-cc@latest
```

Responda as perguntas do wizard (IDE, perfil, workstream). O OXE cria `.oxe/` no projeto com STATE.md, config.json e os workflows.

Verifique:

```bash
npx oxe-cc doctor
```

Deve mostrar `✓ Pronto` para Node, workflows e estrutura base. Se aparecer algum `⚠`, siga o conselho na linha.

---

## 2. Primeiro ciclo (modo padrão)

Execute na sua IDE (Cursor, Copilot, Claude Code, etc.):

```
/oxe
```

O router lê STATE.md e sugere exatamente um próximo passo. Siga a recomendação.

**Sequência mínima completa:**

```
/oxe        → descobre onde você está
/oxe-scan   → mapeia o codebase em .oxe/codebase/
/oxe-spec   → gera SPEC.md com critérios de aceite
/oxe-plan   → gera PLAN.md com ondas e tarefas
/oxe-execute → implementa a onda atual
/oxe-verify  → valida os critérios do SPEC
```

Para uma tarefa pequena (S/M), use o modo rápido:

```
/oxe-quick  → spec + plan + execute + verify em uma sessão
```

---

## 3. Quando usar runtime-first

Se o projeto tem o runtime compilado (`lib/runtime/index.js`), os comandos enterprise ficam disponíveis:

```bash
# Verificação formal com manifesto de evidências
npx oxe-cc runtime verify --dir .

# Listar gates pendentes
npx oxe-cc runtime gates list --dir .

# Promover run verificada para PR draft
npx oxe-cc runtime promote --dir . --target pr_draft

# Recuperar run pausada ou interrompida
npx oxe-cc runtime recover --dir . --run-id <id>
```

Se o runtime não estiver compilado, os comandos OXE continuam funcionando no modo legado — sem perda de UX.

---

## 4. Validação dos 5 minutos

Após o primeiro ciclo completo, estas 5 coisas devem estar verdes:

| # | O que checar | Como |
|---|-------------|------|
| 1 | STATE.md mostra `verify_complete` ou `plan_complete` | `cat .oxe/STATE.md` |
| 2 | Nenhum `ERROR` em `oxe-cc doctor` | `npx oxe-cc doctor` |
| 3 | `oxe-cc status` retorna próximo passo claro | `npx oxe-cc status` |
| 4 | SPEC.md tem critérios de aceite preenchidos | `cat .oxe/SPEC.md` |
| 5 | VERIFY.md existe (se ciclo completo) | `cat .oxe/VERIFY.md` |

Se algum falhar, rode `/oxe` — o router vai diagnosticar e sugerir a ação correta.

---

## 5. Próximos passos

- **Para times** → [`docs/TEAM-ADOPTION.md`](docs/TEAM-ADOPTION.md)
- **Por papel (executor/reviewer/operador)** → [`docs/ROLES.md`](docs/ROLES.md)
- **Exemplo completo reproduzível** → [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)
- **Incidentes e gates** → [`docs/INCIDENT-PLAYBOOK.md`](docs/INCIDENT-PLAYBOOK.md)
- **Suporte por runtime** → [`docs/RUNTIME-SMOKE-MATRIX.md`](docs/RUNTIME-SMOKE-MATRIX.md)
- **Referência completa** → [`README.md`](README.md)
