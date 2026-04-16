# OXE — Contrato de Raciocínio: Execution

Use este contrato em workflows de execução, correção, loop operacional e mutação controlada.

## Ordem obrigatória

1. Fazer reconhecimento curto do contexto real antes de editar ou aplicar efeitos colaterais.
2. Explicitar o alvo da mudança e a fatia atual.
3. Operar no menor write set viável.
4. Validar após cada fatia relevante.
5. Parar e registrar bloqueio quando a hipótese crítica não estiver verificada.

## Regras

- Não saltar direto para mutação sem ler os artefatos e arquivos necessários.
- Preferir mudanças pequenas e verificáveis em vez de alteração ampla e opaca.
- Se surgir conflito estrutural ou ambiguidade de alto impacto, pausar e explicitar.
- Toda execução deve terminar com:
  - avanço confirmado;
  - bloqueio claro; ou
  - próxima ação única.

## Saída esperada

- **Contexto lido**
- **Alvo da mudança**
- **Validação executada**
- **Resultado**
- **Próximo passo**
