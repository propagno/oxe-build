# OXE — Workflow: update

<objective>
Alinhar o projeto e integrações OXE à **versão mais recente** do pacote **oxe-cc** publicada no npm: verificar se há atualização, aplicar a reinstalação com `--force` quando fizer sentido e validar com **`oxe-cc doctor`**.
</objective>

<context>
- Trabalhar na **raiz do repositório** do projeto (onde está `.oxe/` ou onde o utilizador instalou o OXE).
- O CLI compara a **versão do binário em execução** com a tag **latest** no npm (não confundir com `node_modules/oxe-cc` se existir como dependência de app).
- **`--force`** na reinstalação pode gerar backup de ficheiros alterados localmente em **`~/.oxe-cc/oxe-local-patches/`** (comportamento do instalador).
- Para **só consultar** o registo sem instalar: `npx oxe-cc update --check` (saída `0` = já em dia ou mais novo, `1` = há versão mais nova no npm, `2` = erro ou `OXE_UPDATE_SKIP_REGISTRY`).
- Para **só correr o npx se houver versão mais nova**: `npx oxe-cc update --if-newer` (sem rede ou com `OXE_UPDATE_SKIP_REGISTRY=1` termina com código `2` e **não** executa o npx).
</context>

<process>
1. Na raiz do projeto, executar **`npx oxe-cc update --check`** (ou equivalente com `oxe-cc` no PATH). Relatar ao utilizador: versão em execução, `latest` no npm e se há atualização.
2. Se o utilizador quiser atualizar (ou se `--check` indicou versão mais nova e pediu explícito), executar **`npx oxe-cc update`** na mesma raiz — opcionalmente **`npx oxe-cc update --if-newer`** para evitar npx quando já está na última. Repassar flags extra ao pacote novo se o utilizador pedir (ex.: `--cursor --global`).
3. Após uma instalação bem-sucedida, executar **`npx oxe-cc doctor`** e resumir o resultado (OK vs avisos/erros).
4. Registar a atualização em **`.oxe/STATE.md`** do projeto (se existir): acrescentar linha `oxe_updated: YYYY-MM-DD vX.Y.Z` ou nota na secção Decisões com a versão nova.
5. Se o utilizador usar **Copilot CLI / skills**, lembrar **`/skills reload`** (ou reinício) após mudanças nos ficheiros do HOME; no **Gemini CLI**, **`/commands reload`** quando aplicável.
</process>

<output>
- Resumo do que foi executado (comandos e códigos de saída relevantes).
- Se `--check` apenas: não propor `npx` sem confirmação do utilizador quando há versão nova.
- Próximo passo sugerido: retomar o fluxo OXE (ex.: **`/oxe-scan`** se o projeto mudou muito) ou continuar a tarefa em curso. Se só o **mapa em `.oxe/codebase/`** puder ter ficado defasado face ao código, mencionar **`/oxe-compact`** como opção (não obrigatória).
</output>

<success_criteria>
- [ ] Correram na raiz do projeto, nesta ordem quando aplicável: `npx oxe-cc update --check`; depois `npx oxe-cc update` ou `npx oxe-cc update --if-newer` (ou o utilizador recusou atualizar após o `--check`).
- [ ] Após qualquer instalação concluída, correr `npx oxe-cc doctor` e reportar se passou ou que avisos/erros restam.
- [ ] O resumo menciona versões ou resultado da consulta ao npm quando `--check` ou update foi usado.
- [ ] `.oxe/STATE.md` foi atualizado com a versão instalada (passo 4), quando o ficheiro existe.
- [ ] Reload de skills/comandos externos (Copilot CLI, Gemini) foi lembrado quando relevante.
</success_criteria>
