# OXE — Workflow: dashboard

<objective>
Gerar ou atualizar uma camada visual opcional para acompanhar execução, agentes, ondas, checkpoints e verify, usando apenas artefatos OXE como fonte de verdade.
</objective>

<context>
- A visualização é opcional e não substitui `.oxe/STATE.md`, `PLAN.md`, runtime operacional nem `VERIFY.md`.
- A dashboard deve refletir o estado atual, nunca inventar progresso.
</context>

<process>
1. Ler `.oxe/STATE.md`, runtime operacional, blueprint de agentes e `VERIFY.md` quando existirem.
2. Consolidar: fase, onda atual, agentes, checkpoints, bloqueios e evidências.
3. Gerar artefato visual local ou estado preparado para renderização.
4. Se faltar runtime operacional, explicar a lacuna antes de tentar visualizar.
</process>

<success_criteria>
- [ ] A dashboard usa somente artefatos OXE como entrada.
- [ ] Conflitos entre artefatos são explicitados.
</success_criteria>
