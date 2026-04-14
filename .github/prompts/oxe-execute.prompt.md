---
name: oxe-execute
agent: agent
description: "OXE — Executar plano (solo ou com agentes): escolha Completo (1 sessão) | Por onda | Por tarefa para controlar requisições"
argument-hint: "[opcional: A/B/C para modo, onda N, ou Tn]"
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE execute** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/execute.md`

Usa o texto adicional desta mensagem como foco: `A` (Completo), `B` (Por onda), `C` (Por tarefa), `onda N`, `Tn`, ou confirmação de progresso. Lê `oxe/workflows/execute.md` na raiz do projeto atual (CWD).
