# Referência — Próximo passo (rodapé de toda etapa)

Toda etapa da jornada termina dizendo **um** próximo passo, calculado pelo mesmo motor para todos os workflows e para o terminal:

1. Rode `oxe-cc status --json` e leia os campos canónicos do topo: `nextStep` (o passo), `cursorCmd` (o comando) e `reason` (o porquê). Um alias `next` pode existir por compatibilidade; prefira sempre os três canónicos.
2. Termine a resposta com:

```
**Próximo passo:** <cursorCmd>
**Por quê:** <reason>
```

3. Se o usuário pedir uma visão geral, rode `oxe-cc status --journey`. Ele mostra o mapa das etapas 0 a 9 com ✓ (feito), → (atual), · (pendente) e ○ (opcional).

Quem decide é o motor: não invente outro passo nem ofereça alternativas equivalentes. Se ele apontar algo que contradiz o que acabou de acontecer (por exemplo, `spec-approve` logo depois de aprovar), rode o comando que ele indica: em geral é um artefato que mudou depois da aprovação ou uma fila do ALM pendente. Sem o `oxe-cc` disponível, use o fallback de `oxe/workflows/next.md` e diga que é fallback.

| `nextStep` | Significa |
|---|---|
| `oxe` / `scan` | projeto novo ou sem mapa de codebase: `oxe-cc init-oxe`, `/oxe` ou `/oxe-spec --refresh` |
| `spec` | grill aberto ou sem SPEC: continuar o `/oxe-spec` |
| `spec-approve` | grill fechado, ou SPEC com ROADMAP de 2+ fases sem aprovação (com ou sem grill): `spec check`, `spec probe` e `spec approve` |
| `program-init` | SPEC aprovada e ROADMAP com 2+ fases, sem programa: `oxe-cc runtime program init` (depois `program start`) |
| `alm-push` / `alm-queue` | itens do ALM a criar ou fila do MCP a executar |
| `program-start` / `plan` / `discuss` | iniciar a fase, planejar, decidir (rascunho de RFC a aceitar/recusar) |
| `rfc` | RFC exigido (`rfc.required`): escrever o rascunho (`oxe-cc rfc new`), citar no RFC global os critérios que o `reason` nomeia, ou decidir a alternativa de um RFC recusado (`/oxe-discuss --rfc`) |
| `quick` | quick aberta: terminar e fechar com `oxe-cc quick done --verify "<comando>"` |
| `execute` / `signoff` | construir; aceite humano com evidência |
| `verify` | tarefas concluídas: validar com `/oxe-verify` |
| `ship` | entregar: `/oxe-ship` (PR com `runtime promote`, ou `oxe-cc quick promote --open-pr` para uma quick com `delivery.mode: "pr"` numa branch ≠ base; `--local` no modo local) |
| `ship-wait` | PR aberto: acompanhar CI e merge com `oxe-cc ship status` (o ciclo só fecha depois do merge) |
| `deploy` | merge feito e `delivery.deploy_env` configurado: `oxe-cc runtime deploy --attach <env> …` |
| `program-close` | fechar a fase do programa (regressão, contratos, commit) |
| `retro` / `next` | ciclo fechado (inclui quick entregue: commits locais no modo local, PR com merge/deploy no modo pr): a retro já roda dentro do `/oxe-verify`; a próxima entrega começa em `/oxe-spec` ou `/oxe-quick` |
