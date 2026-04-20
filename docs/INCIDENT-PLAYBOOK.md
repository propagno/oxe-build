# OXE — Incident Playbook

> Para operadores de gate e tech leads. Este guia cobre os cenários de bloqueio mais comuns e como resolvê-los.

---

## Gate stale (>24h sem resolução)

**Sintoma:** `oxe-cc runtime gates list` mostra `⚠ stale` para um ou mais gates.

**Quando agir:** gate stale bloqueia a promoção da run. Se o ciclo precisa avançar, o operador deve tomar uma decisão explícita.

**Sequência de diagnóstico:**

```bash
# 1. Ver detalhes do gate
npx oxe-cc runtime gates show --dir . --gate <gate-id>

# Output mostra:
#   tipo, critério bloqueado, tempo em aberto, run afetada

# 2. Avaliar o risco
cat .oxe/runs/<run-id>/residual-risks.json
```

**Decisões possíveis:**

| Decisão | Quando usar | Comando |
|---------|-------------|---------|
| `approve` | Evidências suficientes, risco aceitável | `--decision approve` |
| `reject` | Implementação não atende o critério | `--decision reject` |
| `waive` | Gate válido, mas contexto mudou (urgência, POC) | `--decision waive` |

```bash
npx oxe-cc runtime gates resolve \
  --dir . \
  --gate <gate-id> \
  --decision waive \
  --actor "nome-do-operador" \
  --reason "Hotfix urgente — evidência formal na próxima sprint"
```

**Output esperado:**
```
⚠ Gate <gate-id> dispensado (waive).
Motivo registrado. Run pode avançar.
Gates restantes: 0
```

**Importante:** `waive` não remove o gate do histórico — ele fica registrado com o motivo para auditoria posterior.

---

## Run bloqueada (não avança mesmo sem gates pendentes)

**Sintoma:** `runtime promote` falha ou `status` mostra run como `blocked`.

**Sequência de diagnóstico:**

```bash
# 1. Ver estado completo
npx oxe-cc status --full

# 2. Tentar replay (re-executa último evento da run)
npx oxe-cc runtime replay --dir . --run-id <run-id>
```

**Se replay não desbloquear:**

```bash
# 3. Diagnóstico detalhado
npx oxe-cc runtime recover --dir . --run-id <run-id>
```

**Output de `runtime recover`:**
```
RECOVERY SUMMARY — run-id: <run-id>
─────────────────────────────────────
Work items órfãos: 2
  - task-T3: última atualização há 47min, sem commit associado
  - task-T4: dependência de T3 não satisfeita

Policy drift: sim
  - SPEC.md modificado após geração do PLAN.md (hash divergente)

Evidence gaps: 1
  - Critério A2 sem evidência registrada no VERIFY.md

Ação recomendada: re-run /oxe-verify para fechar evidence gap
```

**Ações corretivas:**

| Problema | Ação |
|----------|------|
| Work items órfãos | Marcar tarefas como concluídas ou rodar `/oxe-execute --task <id>` |
| Policy drift (SPEC alterado) | Rodar `/oxe-verify` novamente — vai reprocessar com SPEC atual |
| Evidence gaps | Rodar `/oxe-verify` — vai preencher lacunas de evidência |
| State corrompido | `runtime recover --force` reinicia a run preservando artefatos |

---

## Como interpretar o RECOVERY-SUMMARY

### Work items órfãos

Tarefas que foram planejadas mas não têm evidência de conclusão. Causas comuns:
- Executor saiu no meio da onda sem marcar a tarefa como concluída
- Sessão fechada antes de completar a execução

**O que fazer:** verificar o código gerado para a tarefa e marcar como concluída se a implementação existir, ou re-executar com `/oxe-execute --task <id>`.

### Policy drift

O hash do SPEC.md divergiu do hash registrado na run. Isso acontece quando o SPEC é editado manualmente após o início da execução.

**O que fazer:** se as mudanças no SPEC são intencionais, rodar `/oxe-verify` para reconciliar. Se foram acidentais, restaurar o SPEC original com `git checkout -- .oxe/SPEC.md`.

### Evidence gaps

Critérios A* do SPEC sem evidência correspondente no VERIFY.md. Causas comuns:
- `/oxe-verify` rodou antes da implementação estar completa
- Critério adicionado ao SPEC após a verificação

**O que fazer:** rodar `/oxe-verify` novamente — vai re-escanear implementação e preencher lacunas.

---

## Dashboard como painel operacional

```bash
npx oxe-cc runtime dashboard --dir .
```

O dashboard mostra o estado de todas as runs ativas em uma view consolidada.

**O que observar por estado:**

| Estado no dashboard | Significado | Ação |
|--------------------|-------------|------|
| `execute_complete` | Onda executada, aguardando verify | Rodar `/oxe-verify` |
| `verify_complete` | Pronto para promoção | `runtime promote --target pr_draft` |
| `blocked` | Bloqueada por gate ou error | Ver seção "Run bloqueada" acima |
| `stale` | Run sem atividade por >24h | Investigar ou fechar sessão |
| `pr_draft` | PR draft criado | Aguardar review do time |

**Indicadores de saúde no dashboard:**

- **Gates pendentes:** número de gates aguardando decisão — deve ser 0 para promoção
- **Runs ativas:** runs com sessão aberta — fechar as que não estão em uso
- **Evidence coverage:** percentual de critérios A* com evidência — deve ser 100% antes de promote

---

## Referência rápida de comandos

```bash
# Ver todos os gates com estado visual
npx oxe-cc runtime gates list --dir .

# Ver detalhes de um gate específico
npx oxe-cc runtime gates show --dir . --gate <id>

# Resolver gate
npx oxe-cc runtime gates resolve --dir . --gate <id> --decision <approve|reject|waive> --actor <nome>

# Promover run
npx oxe-cc runtime promote --dir . --target <pr_draft|staging|production>

# Re-executar último evento da run
npx oxe-cc runtime replay --dir . --run-id <id>

# Diagnóstico e recovery
npx oxe-cc runtime recover --dir . --run-id <id>

# Estado operacional completo
npx oxe-cc status --full

# Dashboard consolidado
npx oxe-cc runtime dashboard --dir .
```
