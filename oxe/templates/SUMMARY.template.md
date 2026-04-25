# OXE — Resumo de sessão

> Usado por **execute**, **verify** e **plan --replan** para contexto incremental, evidência e retomada.

## Sessão

- **Data:** (ISO ou legível)
- **Run:** ...
- **Spec / plano:** (referência breve a `.oxe/SPEC.md` / `.oxe/PLAN.md`)
- **Modo:** completo | por_onda | por_tarefa | runtime

## Performance

- **Ondas concluídas:** N/N
- **Tarefas concluídas:** N/N
- **Retries:** N
- **Checkpoints:** aprovados N | pendentes N | waived N

## Feito nesta sessão

- …

## Arquivos criados/modificados

| Path | Motivo | Tarefa |
|------|--------|--------|
| `src/example.ts` | implementação do contrato | T1 |

## Decisões / desvios

- **Decisões aplicadas:** D-01, D-02
- **Desvios do plano:** nenhum | listar com motivo, impacto e evidência
- **Fixes inline:** nenhum | listar hipótese e comando de verificação

## Evidências

- **Manifest:** `verification-manifest.json` | not_available
- **Coverage:** `evidence-coverage.json` | not_available
- **Residual risk:** `residual-risk-ledger.json` | not_available
- **Comandos executados:** ...

## Pendente ou follow-up

- …

## Next Step Readiness

- **Próximo passo recomendado:** `/oxe-verify` | `/oxe-plan --replan` | `/oxe-execute`
- **Bloqueadores:** nenhum | listar
- **Risco residual:** low | medium | high | critical
