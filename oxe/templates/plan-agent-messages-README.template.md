# Mensagens agente → agente (OXE)

Esta pasta guarda handoffs entre agentes do blueprint **`.oxe/plan-agents.json`**, conforme **`oxe/workflows/references/plan-agent-chat-protocol.md`**.

- Um ficheiro por mensagem; nome: `W{onda}-{seq}-{from}-to-{dest}.md`
- O campo **`runId`** no frontmatter deve coincidir com o de `plan-agents.json`
- Não editar mensagens depois de criadas; invalidação do blueprint (`lifecycle.invalidated`) encerra novos envios

Gerado por **`/oxe-plan-agent`**. Após **`/oxe-verify`** com sucesso e blueprint **`closed`**, o fluxo OXE **recomenda** mover este conteúdo para **`.oxe/archive/plan-agent-runs/<runId>/messages/`** (ver **`oxe/workflows/references/plan-agent-chat-protocol.md`**). Antes de um **replan** com novo `runId`, arquivar o run anterior se quiser preservar handoffs.
