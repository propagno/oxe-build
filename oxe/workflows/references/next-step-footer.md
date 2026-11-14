# Referência — Próximo passo (rodapé de toda etapa)

Toda etapa da jornada termina dizendo **um** próximo passo, calculado pelo mesmo motor para todos os workflows e para o terminal:

1. Rode `oxe-cc status --json` e leia `next`: `step`, `cursorCmd` e `reason`.
2. Termine a resposta com:

```
**Próximo passo:** <cursorCmd>
**Por quê:** <reason>
```

3. Se o usuário pedir uma visão geral, rode `oxe-cc status --journey`. Ele mostra o mapa das etapas 0 a 9 com ✓ (feito), → (atual), · (pendente) e ○ (opcional).

Não invente outro passo nem ofereça alternativas equivalentes. Se o motor apontar algo que contradiz o que acabou de acontecer (por exemplo, `spec-approve` logo depois de aprovar), rode o comando que ele indica: em geral é um artefato que mudou depois da aprovação ou uma fila do ALM pendente.

| `step` | Significa |
|---|---|
| `spec` | grill aberto ou sem SPEC: continuar o `/oxe-spec` |
| `spec-approve` | grill fechado: `spec check`, `spec probe` e `spec approve` |
| `alm-push` / `alm-queue` | itens do ALM a criar ou fila do MCP a executar |
| `program-start` / `plan` / `discuss` | iniciar a fase, planejar, decidir (RFC) |
| `execute` / `signoff` | construir; aceite humano com evidência |
| `ship` / `ship-wait` / `deploy` | entregar: PR, CI e merge, deploy |
| `program-close` | fechar a fase (regressão, contratos, commit) |
