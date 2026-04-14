# OXE — Contrato de Raciocínio: Review

Use este contrato em workflows de auditoria, verificação, revisão de diff, segurança e gaps.

## Ordem obrigatória

1. Ler a evidência real antes de concluir.
2. Apresentar findings primeiro.
3. Ordenar por severidade e impacto.
4. Sustentar cada finding com evidência observável.
5. Só depois resumir o quadro geral.

## Regras

- Findings devem vir antes de resumo narrativo.
- Separar:
  - bug ou regressão;
  - risco;
  - divergência de contrato;
  - lacuna de teste/evidência.
- Se não houver findings, declarar isso explicitamente.
- Mesmo sem findings, listar riscos residuais ou gaps de cobertura quando existirem.

## Saída esperada

- **Findings**
- **Perguntas abertas**
- **Riscos residuais**
- **Resumo**
