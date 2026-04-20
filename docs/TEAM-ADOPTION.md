# OXE — Adoção em Times

> Para times de 2–20 devs usando OXE em projetos compartilhados.

---

## Fluxo branch/PR recomendado

Cada feature ou fix percorre este caminho:

```
git checkout -b feature/minha-feature
/oxe-spec   → define critérios de aceite em .oxe/SPEC.md
/oxe-plan   → gera .oxe/PLAN.md com ondas e tarefas
/oxe-execute → implementa onda a onda
/oxe-verify  → valida critérios do SPEC com evidências
npx oxe-cc runtime promote --dir . --target pr_draft  → abre PR draft
```

O PR draft já vem com `.oxe/VERIFY.md` como evidência de qualidade. O reviewer usa `/oxe-verify --audit` para validação adversarial antes de aprovar.

**Regra de ouro:** nunca mergear sem `VERIFY.md` existente e fase `verify_complete` no STATE.md.

---

## Ship local vs. promote remoto

| Situação | Comando | Quando usar |
|----------|---------|-------------|
| Tarefa solo, ciclo completo local | `/oxe-quick` | Tasks S/M sem necessidade de review formal |
| Feature com review de time | `/oxe-verify` + `runtime promote --target pr_draft` | Qualquer feature que vai para revisão |
| Hotfix urgente | `/oxe-execute --task T1` + `/oxe-verify` + `runtime promote --target pr_draft` | Correções urgentes com rastreabilidade |
| Experimento / POC | `/oxe-spec` + `/oxe-plan` + `/oxe-execute` sem promote | Validações rápidas, sem PR |

`/oxe-ship` (comando legado) equivale a `/oxe-verify` + `git add/commit/push` sem passar pelo gate de promoção formal. Prefira `runtime promote` quando rastreabilidade importa.

---

## Sessões e workstreams sem poluir `.oxe/`

### Sessões

Cada sessão de trabalho tem um ID único. Para manter o diretório `.oxe/` limpo:

```bash
# Nomear sessão explicitamente
npx oxe-cc runtime session start --name "feat-auth-2fa"

# Ver sessão ativa
npx oxe-cc runtime session status

# Fechar sessão ao final do dia / feature
npx oxe-cc runtime session close
```

**Não deixar sessões abertas.** Sessões esquecidas acumulam gates `stale` e bloqueiam relatórios de status do time.

### Workstreams paralelos

Para times trabalhando em features paralelas no mesmo repo:

```bash
# Workstream A (feature de autenticação)
npx oxe-cc runtime workstream create --name auth --branch feature/auth-2fa

# Workstream B (feature de dashboard)
npx oxe-cc runtime workstream create --name dashboard --branch feature/dashboard-v2
```

Cada workstream mantém STATE.md e gates separados. Use `npx oxe-cc status --workstream auth` para ver o estado de um workstream específico sem poluir a view padrão.

**Regra:** um workstream por feature branch. Nunca compartilhar um workstream entre duas features não relacionadas.

---

## Governança mínima

### Quando exigir `discuss_before_plan`

Ative quando a feature afeta:
- Contratos de API públicos ou schemas compartilhados
- Decisões de arquitetura que impactam outros times
- Mudanças em infraestrutura ou pipelines de CI/CD

```json
// .oxe/config.json
{
  "governance": {
    "discuss_before_plan": ["contracts/**", "infra/**", "*.schema.json"]
  }
}
```

Sem esse gate, o planner vai direto para PLAN.md sem esperar alinhamento.

### Quando ativar `strict`

Modo `strict` exige evidências formais para cada critério A* do SPEC antes de autorizar promoção. Use em:
- Releases com SLA de qualidade (produção, clientes enterprise)
- Features de segurança ou compliance
- Qualquer ciclo onde um reviewer externo vai auditar

```json
{
  "verification": {
    "strict": true
  }
}
```

Em modo `strict`, `runtime promote` falha se qualquer critério A* não tiver evidência verificada.

### Quando usar multi-agent

Use orquestração multi-agent (`/oxe-plan --multi-agent`) quando:
- A feature tem ondas independentes que podem ser paralelizadas
- Time tem múltiplos devs disponíveis para executar simultaneamente
- Tarefa de refactor em múltiplos módulos sem dependência entre eles

Não use multi-agent para:
- Features com dependências sequenciais fortes entre tarefas
- Mudanças em arquivos compartilhados (conflitos de merge)
- Ciclos onde um único dev vai executar tudo

### Quando não usar OXE

- Scripts one-off que não vão para produção
- Experimentos de < 30 minutos sem necessidade de rastreabilidade
- Mudanças em documentação pura (typos, formatação)

Para esses casos, trabalhe direto sem o ciclo spec→plan→execute→verify.

---

## Checklist de integração para times novos

```
[ ] oxe-cc doctor retorna ✓ para todos os checks
[ ] .oxe/config.json criado com profile do time
[ ] Todos os devs têm o wrapper da IDE configurado (/oxe no Cursor, etc.)
[ ] Branch protection rule exige VERIFY.md antes de merge
[ ] Primeiro ciclo completo feito em pair programming
[ ] Operador de gate designado (quem aprova runtime gates)
```

---

## Referências

- **Primeiros 15 minutos** → [`QUICKSTART.md`](../QUICKSTART.md)
- **Por papel** → [`docs/ROLES.md`](ROLES.md)
- **Exemplo completo** → [`docs/WALKTHROUGH.md`](WALKTHROUGH.md)
- **Incidentes e gates** → [`docs/INCIDENT-PLAYBOOK.md`](INCIDENT-PLAYBOOK.md)
