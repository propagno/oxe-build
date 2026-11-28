---
name: oxe:execute
description: >
  Executa as tarefas do PLAN.md onda por onda, com write set mínimo e verificação obrigatória
  antes de avançar. Compila o grafo de execução via LlmTaskExecutor, respeita dependências entre
  tarefas, particiona tools idempotentes (paralelas) e mutáveis (seriais), e registra evidência
  auditável por Tn. Modo --debug ativa diagnóstico de falha inline. --checkpoint '<nome>' cria
  ponto de restauração antes de ondas de alto risco.
argument-hint: "[onda|Tn | --debug | --deep-diagnosis | --checkpoint '<nome>' | --note 'texto' | --iterative]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
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

**Variante enxuta (ler isto antes de abrir qualquer workflow):** se `.oxe/config.json` tiver `"profile": "lean"` ou `"plan_ceremony": "lean"`, o workflow a aplicar é `lean/execute.md` (na mesma pasta de workflows; `oxe-cc workflow path execute` devolve o caminho certo). Leia e aplique só ele, sem abrir o `execute.md` completo.

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/core/workflows/execute.md, .oxe/workflows/execute.md ou oxe/workflows/execute.md (nessa ordem). Ler e aplicar integralmente o primeiro ficheiro encontrado. No layout core (`.oxe/core/` existe), todo caminho `.oxe/workflows/…` ou `.oxe/templates/…` citado neste comando fica em `.oxe/core/workflows/…` / `.oxe/core/templates/…`. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir (um worktree sem .oxe/, um repo sem a cópia dos workflows), rodar `oxe-cc workflow path execute` (sem `oxe-cc` no PATH: `npx oxe-cc@<oxe_version de .oxe/oxe-version.json> workflow path execute` — nunca o `npx oxe-cc` sem versão, que pega outra release): ele devolve o workflow do pacote oxe-cc instalado. Aplicar esse ficheiro e avisar uma vez: "este repositório não tem .oxe/workflows; para fixar a versão, rode oxe-cc install --oxe-only .". Só se o comando também falhar, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa `$ARGUMENTS` como foco (onda, tarefa, confirmação).
