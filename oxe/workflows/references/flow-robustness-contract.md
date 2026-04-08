# OXE — Contrato de Robustez do Fluxo

<objective>
Definir um contrato canónico para reduzir alucinação estrutural no OXE. Este ficheiro é consumido por `spec`, `plan`, `quick`, `execute`, `verify`, `next`, `status` e `doctor`.
</objective>

## Ordem determinística do fluxo

Todo passo OXE deve seguir esta ordem, sem saltar etapas:

1. Ler os artefatos obrigatórios do estado atual.
2. Resolver `active_session` e os paths do escopo.
3. Validar pré-condições mínimas antes de prosseguir.
4. Produzir a saída principal do passo.
5. Executar autoavaliação ou gate de qualidade do próprio passo.
6. Registrar um próximo passo único.

## Invariantes mínimos

Todo workflow deve declarar com clareza:

- quais artefatos lê;
- quais artefatos escreve;
- quais invariantes valida antes de operar;
- qual fallback legado é permitido quando não há sessão ativa.

## Proibição de saltos sem evidência

- `plan` não deve avançar sem `SPEC.md` válido.
- `execute` não deve avançar sem `PLAN.md` ou `QUICK.md` válido no escopo resolvido.
- `verify` não deve avançar sem evidência mínima de execução ou de artefatos resultantes.
- `next` não deve sugerir um passo que viole os gates acima.

## Contrato de autoavaliação do plano

Todo `PLAN.md` deve conter uma seção visível `## Autoavaliação do Plano` com:

- `Melhor plano atual:` `sim` ou `não`
- `Confiança:` `0–100%`
- `Base da confiança:` rubrica fixa, não narrativa livre
- `Principais incertezas:` lista curta
- `Alternativas descartadas:` resumo curto
- `Condição para replanejar:` critério objetivo

### Rubrica obrigatória

| Dimensão | Peso |
|----------|------|
| Completude dos requisitos | 25 |
| Dependências conhecidas | 15 |
| Risco técnico | 20 |
| Impacto no código existente | 15 |
| Clareza da validação / testes | 15 |
| Lacunas externas / decisões pendentes | 10 |

**Total:** 100 pontos

### Faixas semânticas

- `85–100%` → pronto para executar
- `70–84%` → executável com risco controlado
- `50–69%` → precisa refino antes de execução
- `<50%` → não executar

## Calibração pós-execução

`verify` deve comparar o resultado real com a autoavaliação do plano:

- confiança alta + falha precoce = erro de calibração do plano;
- confiança baixa + falha em risco previsto = autoavaliação aderente;
- confiança alta + sucesso consistente = plano calibrado;
- confiança baixa + sucesso amplo = plano conservador demais.

## Uso por `status` e `doctor`

`status` e `doctor` devem refletir a saúde lógica do fluxo com categorias determinísticas:

- `healthy` — sem bloqueio lógico conhecido;
- `warning` — fluxo operável, mas com gaps ou drift relevante;
- `broken` — artefato crítico ausente, incoerência severa ou gate indispensável falhado.
