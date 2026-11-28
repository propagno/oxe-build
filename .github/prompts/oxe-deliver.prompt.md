---
name: oxe-deliver
agent: agent
description: "OXE — Entrega autônoma ponta a ponta (oxe-cc primer + deliver): briefing → SPEC/Fases → testes congelados → execução → FINAL_SMOKE → DELIVERY.md"
argument-hint: "[briefing ou --approval single-ok|auto]"
oxe_workflow_slug: deliver
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 51b3666c7624b157
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** deliver
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `51b3666c7624b157`
- **Entrada de contexto prioritária:** `.oxe/context/packs/deliver.md` e `.oxe/context/packs/deliver.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow deliver --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/core/workflows/deliver.md, .oxe/workflows/deliver.md ou oxe/workflows/deliver.md (nessa ordem). Ler e aplicar integralmente o primeiro ficheiro encontrado. No layout core (`.oxe/core/` existe), todo caminho `.oxe/workflows/…` ou `.oxe/templates/…` citado neste comando fica em `.oxe/core/workflows/…` / `.oxe/core/templates/…`. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir (um worktree sem .oxe/, um repo sem a cópia dos workflows), rodar `oxe-cc workflow path deliver` (sem `oxe-cc` no PATH: `npx oxe-cc@<oxe_version de .oxe/oxe-version.json> workflow path deliver` — nunca o `npx oxe-cc` sem versão, que pega outra release): ele devolve o workflow do pacote oxe-cc instalado. Aplicar esse ficheiro e avisar uma vez: "este repositório não tem .oxe/workflows; para fixar a versão, rode oxe-cc install --oxe-only .". Só se o comando também falhar, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Use `oxe-cc primer` e `oxe-cc deliver` para conduzir o ciclo autônomo completo (Chat-Driven ou Terminal Headless) sem jamais alterar testes congelados nem executar `git push`/`npm publish` sem autorização explícita.
