---
name: oxe-execute
agent: agent
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
oxe_semantics_hash: 0e6003de070d497f
---

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
- **Checksum semântico:** `0e6003de070d497f`
- **Entrada de contexto prioritária:** `.oxe/context/packs/execute.md` e `.oxe/context/packs/execute.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow execute --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan_or_quick
- **Caminho runtime padrão:** `oxe-cc runtime compile --dir <projeto>` → `oxe-cc runtime project --dir <projeto>`
- **Artefatos canónicos primários:** `ACTIVE-RUN.json` · `.oxe/runs/<run_id>.json` · `compiled_graph` · `canonical_state`
- **Fallback runtime:** Se o runtime não estiver compilado ou falhar por indisponibilidade do pacote, declarar fallback explícito para o fluxo legado antes de mutar.
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/execute.md ou oxe/workflows/execute.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa o texto adicional desta mensagem como foco: `A` (Completo), `B` (Por onda), `C` (Por tarefa), `onda N`, `Tn`, ou confirmação de progresso.
