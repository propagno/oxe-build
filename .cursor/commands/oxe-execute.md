---
description: "OXE — Executar plano (solo ou com agentes): escolha Completo (1 sessão) | Por onda | Por tarefa para controlar requisições"
argument-hint: "[opcional: A/B/C para modo, onda N, ou Tn]"
oxe_workflow_slug: execute
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: a33b293fc6a29a70
---

OXE — Executar plano (solo ou com agentes): escolha Completo (1 sessão) | Por onda | Por tarefa para controlar requisições

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** execute
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `a33b293fc6a29a70`
- **Entrada de contexto prioritária:** `.oxe/context/packs/execute.md` e `.oxe/context/packs/execute.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow execute --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan_or_quick
- **Referência canónica:** `.oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE execute** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`.oxe/workflows/execute.md`

Usa o texto adicional desta mensagem como foco: `A` (Completo), `B` (Por onda), `C` (Por tarefa), `onda N`, `Tn`, ou confirmação de progresso. Lê `.oxe/workflows/execute.md` na raiz do projeto atual (CWD).
