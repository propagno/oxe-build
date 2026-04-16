# OXE — Contrato de Raciocínio: Status

Use este contrato em workflows de ajuda, roteamento, leitura de estado, dashboard e recomendação de próximo passo.

## Ordem obrigatória

1. Ler o estado e os artefatos mínimos.
2. Resolver a situação atual sem inventar contexto.
3. Dar uma recomendação única e acionável.
4. Explicitar a razão da recomendação.

## Regras

- Preferir resposta curta e orientada a decisão.
- Não abrir múltiplas opções equivalentes sem necessidade.
- Se o estado estiver incompleto ou ambíguo, dizer isso explicitamente.
- Quando houver recomendação, ela deve vir com o motivo e o artefato que a sustenta.

## Saída esperada

- **Leitura atual**
- **Recomendação**
- **Motivo**
- **Confiança / lacuna**
