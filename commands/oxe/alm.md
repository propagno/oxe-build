---
name: oxe:alm
description: >
  Configura e opera o ALM do projeto (Jira ou Azure DevOps, por REST ou pelas ferramentas MCP da sessão):
  setup do bloco alm por perguntas, status, push das histórias e tarefas, fila do MCP e defeitos.
argument-hint: "[setup | status | push | queue | defect]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
oxe_workflow_slug: alm
oxe_reasoning_mode: execution
oxe_question_policy: explore_first
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 71d0f0398b01871b
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** alm
- **Modo:** execução
- **Perguntas:** explorar primeiro
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `71d0f0398b01871b`
- **Entrada de contexto prioritária:** `.oxe/context/packs/alm.md` e `.oxe/context/packs/alm.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow alm --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/core/workflows/alm.md, .oxe/workflows/alm.md ou oxe/workflows/alm.md (nessa ordem). Ler e aplicar integralmente o primeiro ficheiro encontrado. No layout core (`.oxe/core/` existe), todo caminho `.oxe/workflows/…` ou `.oxe/templates/…` citado neste comando fica em `.oxe/core/workflows/…` / `.oxe/core/templates/…`. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir (um worktree sem .oxe/, um repo sem a cópia dos workflows), rodar `oxe-cc workflow path alm` (sem `oxe-cc` no PATH: `npx oxe-cc@<oxe_version de .oxe/oxe-version.json> workflow path alm` — nunca o `npx oxe-cc` sem versão, que pega outra release): ele devolve o workflow do pacote oxe-cc instalado. Aplicar esse ficheiro e avisar uma vez: "este repositório não tem .oxe/workflows; para fixar a versão, rode oxe-cc install --oxe-only .". Só se o comando também falhar, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Sem ALM configurado, o fluxo do OXE segue igual. Credenciais nunca entram em arquivo; toda escrita no ALM passa antes por `--dry-run` e só acontece com o OK do usuário.
