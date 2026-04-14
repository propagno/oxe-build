---
name: oxe-update
agent: agent
description: Atualizar oxe-cc no projeto — verificar versão no npm, alinhar ficheiros OXE e validar com doctor
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

Executa o workflow **OXE update**. Lê e segue **integralmente**:

`oxe/workflows/update.md` (na raiz do repositório em contexto; ou `.oxe/workflows/update.md` se a instalação aninhou os workflows)

Na prática: na raiz do projeto, correr **`npx oxe-cc update --check`**, depois (se aplicável) **`npx oxe-cc update`** ou **`npx oxe-cc update --if-newer`**, e por fim **`npx oxe-cc doctor`**.
