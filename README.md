<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

**Fluxo spec-driven e context engineering para [Cursor](https://cursor.com) e [GitHub Copilot](https://github.com/features/copilot)** — **poucos comandos slash**, foco em **`.oxe/`** (workflows em **`.oxe/workflows/`** por padrão, ou **`oxe/workflows/`** com `--global`). Textos do CLI e resumos pós-comando estão em **português (Brasil)**.

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

```bash
npx oxe-cc@latest
# equivalente explícito:
# npx oxe-cc@latest install
```

**Manter atualizado:** `npx oxe-cc@latest --force` ou `npx oxe-cc update` (na raiz do projeto). Com **`--force`**, alterações locais em arquivos rastreados geram backup em **`~/.oxe-cc/oxe-local-patches/`**.

[Para quem é](#para-quem-é) · [Começar](#começar) · [Como funciona](#como-funciona) · [Modo rápido](#modo-rápido) · [Porque funciona](#porque-funciona) · [Comandos](#comandos) · [Configuração](#configuração) · [SDK](#sdk-api-programática) · [Problemas](#resolução-de-problemas)

</div>

---

## Para quem é

Para quem quer **descrever o que quer e ver isso construído de forma consistente** — **sem** simular uma organização enorme de processos em cima do repositório.

OXE é **enxuto**: não há dezenas de slash commands. Há **um CLI** que deixa o repositório **só com `.oxe/`** (layout **padrão**) ou **`oxe/` + `.oxe/`** com **`--global`**, e instala integrações em **`~/.cursor`**, **`~/.copilot`** e **`~/.claude`** — **workflows em Markdown** e **estado em disco** para a sessão não ficar **sobrecarregada** com tudo o que já foi decidido.

---

## Começar

**Requisito:** [Node.js 18+](https://nodejs.org/).

Na **raiz do repositório** do seu projeto:

```bash
npx oxe-cc@latest
```

Em **terminal interativo**, o instalador pergunta em **dois passos**: (1) **onde integrar** o OXE (Cursor, Copilot, só núcleo com `.oxe/`, etc.); (2) **layout no repositório** — **clássico** (`oxe/` na raiz + `.oxe/`, com opcional `commands/oxe/`, `AGENTS.md`) ou **mínimo** (**só `.oxe/`**, com **`.oxe/workflows/`** e templates). **Cursor, Copilot e CLI** usam **sempre** as pastas do **usuário** (`~/.cursor`, `~/.copilot`, `~/.claude`); **não** são criados `.cursor` / `.github` / `.claude` dentro do repo. Com layout clássico e **`--vscode`**, **`.vscode/`** fica no projeto.

Ao terminar, o CLI mostra um **resumo do que foi criado ou atualizado** e **próximos passos sugeridos** (por exemplo `npx oxe-cc doctor`, `/oxe-scan`).

Sem TTY (CI), o **layout mínimo** (só `.oxe/`) e integrações no **HOME** são o padrão (Cursor + Copilot, sem multi-agente). Use **`--global`** para também ter **`oxe/`** na raiz. Flags: **`--cursor`**, **`--copilot`**, **`--all`**, **`--oxe-only`**, **`OXE_NO_PROMPT=1`**, etc.

Se já existir **`.oxe/config.json`** com o bloco **`install`** (perfil, `repo_layout`, …), o `oxe-cc` aplica isso **quando não passas** flags explícitas de integração — útil em CI. Para ignorar o ficheiro nessa corrida: **`--no-install-config`**. Detalhes: [`oxe/templates/CONFIG.md`](oxe/templates/CONFIG.md).

No fim, em modo interativo, pergunta se você quer instalar o **`oxe-cc` globalmente** (`npm install -g`) ou continuar só com **`npx`**. Em CI ou scripts use **`--no-global-cli`** / **`-l`**, ou defina **`OXE_NO_PROMPT=1`**. Para instalar o CLI sem pergunta: **`--global-cli`** / **`-g`**.

**GitHub Copilot CLI:** o CLI **não** trata `~/.copilot/commands/` como slash commands (isso é legado estilo Claude/Cursor). Com **`--copilot-cli`**, o OXE instala **agent skills** em **`~/.copilot/skills/`** (ex.: `oxe-scan/SKILL.md`, `oxe/SKILL.md`), invocáveis como **`/oxe-scan`**, **`/oxe`** (entrada = mesmo fluxo que `/oxe-help`), etc. Depois de instalar ou atualizar, use **`/skills reload`** ou reinicie o `copilot`. Mantém-se também cópia para **`~/.claude/commands/`** e **`~/.copilot/commands/`** para ferramentas que ainda leiam essa pasta. Se usar **`COPILOT_HOME`**, o `oxe-cc` grava skills nesse diretório (alinhado ao CLI oficial).

**Multi-agente (`--all-agents`):** instalação **paralela** nos homes canónicos de cada ferramenta — **Cursor** e **Copilot** (como no padrão), **Claude Code** (`~/.claude/commands`), **OpenCode** (`$XDG_CONFIG_HOME/opencode/commands` e `~/.opencode/commands`), **Gemini CLI** (`~/.gemini/commands`: `/oxe`, `/oxe:scan` — depois **`/commands reload`**), **Codex** (`~/.agents/skills` + prompts em **`~/.codex/prompts`** como `/prompts:oxe-*`), **Windsurf** (`~/.codeium/windsurf/global_workflows`, workflows `/oxe-scan`), **Antigravity** (`~/.gemini/antigravity/skills`). No menu interativo, opção **6**. O núcleo do fluxo continua em **`.oxe/`** (SPEC/PLAN/VERIFY); não há `PROJECT.md` nem `research/` impostos pelo OXE.

**Confirmar instalação no agente**

| Onde | O que executar |
|------|----------------|
| **Cursor** | `/oxe-help` |
| **Copilot** (VS Code) | `/oxe-help` no chat, se [prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files) estiverem ativos (`"chat.promptFiles": true` — exemplo em [`.vscode/settings.json`](.vscode/settings.json)) |

> **Nota:** Instruções e prompt files do Copilot ficam em **`~/.copilot/`**, não em `.github/` no repo. **`oxe-cc doctor`** aceita workflows em **`.oxe/workflows/`** ou **`oxe/workflows/`**. Sem prompt files, você ainda pode pedir em linguagem natural com o repositório em contexto.

**Sem pacote no npm** (`npm view oxe-cc version` → 404): clone este repo, `npm link` na pasta **oxe-build**, `npm link oxe-cc` no seu projeto e execute `oxe-cc`. Alternativa: `node /caminho/oxe-build/bin/oxe-cc.js`.

<details>
<summary><strong>Instalação: flags úteis (CI, ou só parte do pacote)</strong></summary>

| Flag | Efeito |
|------|--------|
| `--force` / `-f` | Sobrescreve arquivos já existentes (**obrigatório** para atualizar cópias antigas) |
| `--dry-run` | Lista ações sem escrever |
| `--cursor` / `--copilot` | Instala só uma das stacks |
| `--oxe-only` | Só workflows + templates dentro de **`.oxe/`** (sem integrações IDE) |
| `--no-init-oxe` | Não executa o bootstrap de `STATE.md` / `config.json` / `codebase/` (mantém `.oxe/workflows` se copiados) |
| `--global` | Layout **clássico**: **`oxe/`** na raiz do repo + **`.oxe/`**; IDE em `~/.cursor`, `~/.copilot`, `~/.claude` |
| `--local` | Layout **mínimo** (padrão): **só `.oxe/`** com **`.oxe/workflows/`**; IDE nas mesmas pastas do usuário |
| `--global-cli` / `-g` | Após copiar: `npm install -g oxe-cc@versão` (sem pergunta) |
| `--no-global-cli` / `-l` | Não pergunta nem instala o CLI global (útil em CI) |
| `--copilot-cli` | **Skills** em **`~/.copilot/skills/`** (`/oxe`, `/oxe-scan`, …) + cópia legado em **`~/.claude/commands/`** e **`~/.copilot/commands/`** |
| `--all-agents` | Tudo de `--copilot-cli` **mais** OpenCode, Gemini (TOML), Codex, Windsurf, Antigravity (ver texto acima) |
| `--all` / `-a` | Cursor + Copilot (padrão quando não indicas `--cursor` nem `--copilot`) |
| `--vscode` | Copia `.vscode/settings.json` (só com layout **`--global`**) |
| `--no-commands` | Omite `commands/oxe/` |
| `--no-agents` | Omite `AGENTS.md` |
| `--no-install-config` | Ignora o bloco `install` em `.oxe/config.json` nesta instalação |
| `--config-dir` / `-c` | Pasta base para **uma** integração (`--cursor`, `--copilot` ou `--copilot-cli`); não combina com `--all-agents` |
| `--dir <pasta>` ou argumento posicional | Destino em vez do diretório atual |

**Global:** `npm install -g oxe-cc`.

**Subcomandos**

| Comando | Função |
|---------|--------|
| `oxe-cc` ou `oxe-cc install` | Instalação predefinida (mesmo comportamento; `install` é alias explícito) |
| `oxe-cc doctor` | Valida Node, workflows do pacote, `.oxe/`, coerência STATE vs arquivos, scan antigo (`scan_max_age_days`), seções da SPEC, ondas do PLAN |
| `oxe-cc status` | Leve: coerência `.oxe/` + **um** próximo passo sugerido (espelha o workflow `next`; não exige o conjunto completo de workflows como o `doctor`) |
| `oxe-cc init-oxe` | Só o bootstrap `.oxe/` (STATE, config, codebase) |
| `oxe-cc uninstall` | Remove integrações OXE em `~/.cursor`, `~/.copilot`, `~/.claude` e pastas de workflows no repo (`--ide-only` só no HOME) |
| `oxe-cc update` | Executa `npx oxe-cc@latest --force` na pasta do projeto (útil para atualizar tudo de uma vez) |

</details>

<details>
<summary><strong>Desenvolvimento (clonar o oxe-build)</strong></summary>

```bash
git clone https://github.com/propagno/oxe-build.git
cd oxe-build
npm test
node bin/oxe-cc.js --help
```

Para testar no seu app: `npm link` aqui, depois `npm link oxe-cc` no projeto alvo.

</details>

---

## Como funciona

**Já tem código no repositório?** Comece por **`/oxe-scan`**. Isso gera mapas em **`.oxe/codebase/`** (stack, estrutura, testes, convenções, etc.). Assim o **spec** e o **plan** alinham com o repo real antes de planear em grande escala.

### 1. Mapear — `/oxe-scan`

Inventaria o projeto e preenche **`.oxe/codebase/*.md`**, atualiza **`.oxe/STATE.md`**. Você pode indicar foco opcional (ex.: “só API”).

### 2. Especificar — `/oxe-spec`

Produz ou atualiza **`.oxe/SPEC.md`**: objetivo, escopo, critérios de aceite, riscos. Isso é o contrato antes do plano.

### 3. Discutir *(opcional)* — `/oxe-discuss`

Captura decisões de implementação (UI, API, tom, edge cases) em **`.oxe/DISCUSS.md`**, para o plano não “adivinhar” o que você prefere. Útil quando `discuss_before_plan` está ativo em `.oxe/config.json`. **Pular** este passo = defaults razoáveis; **usar** = mais próximo da sua visão.

### 4. Planear — `/oxe-plan`

Gera **`.oxe/PLAN.md`**: tarefas **atômicas**, **ondas** (paralelo vs sequencial), e bloco **Verificar** (comando de teste ou checklist) **por tarefa**. Ideia: cada tarefa cabe num contexto de agente focado, com verificação explícita — em Markdown, sem XML obrigatório.

Ondas em resumo: tarefas **independentes** na mesma onda podem **rodar** em paralelo; **dependentes** vão para ondas posteriores (organização por ondas, com pouca cerimônia).

### 5. Executar — implementação + `/oxe-execute` *(opcional)*

Implemente no editor ou deixe o agente seguir **`/oxe-execute`** sobre o plano (ou QUICK). O OXE não impõe subagentes nem commits atômicos por tarefa; isso fica a cargo do **seu** fluxo com Git.

### 6. Verificar — `/oxe-verify`

Cruza **SPEC** + **PLAN** com o código; escreve **`.oxe/VERIFY.md`**. Se algo falhar, corrija ou replaneje (`/oxe-plan` com lógica de replanejamento descrita no workflow).

### 7. Seguir em frente — `/oxe-next` e ciclo

Para a **próxima** feature ou fase: de novo **spec → plan → …** ou **`/oxe-next`** para sugerir o passo lógico a partir de **STATE.md**.

---

## Modo rápido

Para trabalho **ad hoc** sem roadmap completo:

**`/oxe-quick`** gera **`.oxe/QUICK.md`** com passos curtos e verificação. Depois você pode usar **`/oxe-execute`** em cima disso ou implementar direto e fechar com **`/oxe-verify`**.

Se o trabalho crescer, **promova** para spec + plan completos.

---

## Porque funciona

**Context engineering:** o agente não precisa de “lembrar” tudo na janela principal — o que importa está em arquivos **pequenos e por etapa**.

| Artefato | Função |
|----------|--------|
| `.oxe/STATE.md` | Fase, decisões, próximo passo — memória entre sessões |
| `.oxe/codebase/*.md` | Mapa do repo após scan |
| `.oxe/SPEC.md` | O que entregar e como saber que está certo |
| `.oxe/DISCUSS.md` | Preferências antes do plano *(opcional)* |
| `.oxe/PLAN.md` | Tarefas atômicas + **Verificar** por item |
| `.oxe/QUICK.md` | Modo rápido |
| `.oxe/VERIFY.md` | Resultado das verificações |
| `.oxe/SUMMARY.md` | Resumo para replanejamento *(opcional)* |
| `oxe/workflows/*.md` ou `.oxe/workflows/*.md` | **Fonte única** dos passos no **projeto** após instalar (no **pacote** npm, os modelos vivem em `oxe/workflows/`) |

**Formato:** planos em Markdown com seções fixas (incl. verificação), legíveis por humanos e por modelos — sem XML obrigatório, mas com a mesma ideia de *precise instructions + verify*.

---

## Comandos

### Fluxo principal

| Comando | O que faz |
|---------|-----------|
| `/oxe-scan` | Mapeia o codebase → `.oxe/codebase/` |
| `/oxe-spec` | Escreve/atualiza `.oxe/SPEC.md` |
| `/oxe-discuss` | Decisões antes do plano → `.oxe/DISCUSS.md` |
| `/oxe-plan` | Pesquisa no repo + plano com ondas e Verificar |
| `/oxe-execute` | Execução guiada do plano (ou QUICK) |
| `/oxe-verify` | Validação; `.oxe/VERIFY.md` |
| `/oxe-next` | Sugere o próximo passo |
| `/oxe-help` | Ajuda e visão geral |

### Modo rápido

| Comando | O que faz |
|---------|-----------|
| `/oxe-quick` | `.oxe/QUICK.md` — tarefa pontual |

### Revisão de PR / diff entre branches *(só Copilot)*

| Prompt | O que faz |
|--------|-----------|
| `/oxe-review-pr` | Segue `oxe/workflows/review-pr.md`: diff estilo PR (`git diff base...head`, `gh pr diff <n>`, ou fetch `pull/<n>/head`), riscos, testes e checklist. Você pode colar o **link da PR** (ex.: `https://github.com/org/repo/pull/10`) ou indicar `main` e `feature/x`. **Não** há slash command em `.cursor/commands/`; no Cursor você pode pedir o mesmo em linguagem natural com o workflow em contexto. |

### Outros clientes

Em **Claude Code** (ou ferramentas que leem `commands/oxe/`), os mesmos passos expõem nomes **`oxe:scan`**, **`oxe:plan`**, etc. (frontmatter `name:`).

---

## Configuração

Preferências do projeto em **`.oxe/config.json`** (criado no bootstrap a partir de `oxe/templates/config.template.json`). Inclui opções de fluxo (`discuss_before_plan`, `scan_max_age_days`, `spec_required_sections`, …) e, opcionalmente, o bloco **`install`** (perfil de integração e layout do repo quando corres o instalador sem flags IDE). Referência completa: [`oxe/templates/CONFIG.md`](oxe/templates/CONFIG.md).

---

## SDK (API programática)

O pacote **`oxe-cc`** expõe entrada npm (`main` / `exports`) para scripts e CI:

```js
const oxe = require('oxe-cc');
const result = oxe.runDoctorChecks({ projectRoot: process.cwd() });
// result.ok, result.errors, result.warnings, result.healthReport, …
```

Também estão disponíveis `oxe.health`, `oxe.workflows`, `oxe.install.resolveOptionsFromConfig`, `oxe.manifest`, `oxe.agents`. TypeScript: `lib/sdk/index.d.ts`. Documentação: [`lib/sdk/README.md`](lib/sdk/README.md).

---

## Resolução de problemas

| Situação | O que tentar |
|----------|----------------|
| Comandos não aparecem no Cursor | Confirme que `~/.cursor/commands/` (ou a pasta configurada) existe; reinicie o Cursor |
| Prompts `/oxe-*` não aparecem no Copilot | Ative `"chat.promptFiles": true`; confirme prompts em **`~/.copilot/prompts/`** (o OXE não coloca `.github/` no repo para o Copilot) |
| **`/oxe` ou `/oxe-*` não aparecem no Copilot CLI** | O CLI usa **skills** em **`~/.copilot/skills/`**, não a pasta `commands`. Rode `npx oxe-cc --copilot-cli` (ou perfil com CLI), depois **`/skills reload`**. Use **`/oxe`** (ajuda) ou **`/oxe-scan`**, etc. |
| **`ETARGET`** / versão não encontrada no `npx` | `npm cache clean --force`, `npx clear-npx-cache`, ou fixe a versão: `npx oxe-cc@0.3.0`. Verifique `npm config get registry` |
| **404** no `npm view oxe-cc` | Pacote com outro nome (scope) ou ainda não publicado — use `npm link` ou `node …/bin/oxe-cc.js` |
| Arquivos não atualizam | Reinstale com **`--force`** (com backup local se você tiver editado arquivos rastreados) |
| Erro no **WSL** sobre Node do Windows | Use **Node instalado dentro do WSL** (o `oxe-cc` recusa `node.exe` do Windows em ambiente WSL para evitar caminhos quebrados) |

**Ajuda no terminal:** `oxe-cc --help`. **Diagnóstico:** `oxe-cc doctor`.

**Banner no CLI:** [`bin/banner.txt`](bin/banner.txt) (`{version}`). `OXE_NO_BANNER=1` desativa o banner; `NO_COLOR` remove cores.

<details>
<summary><strong>Variáveis de ambiente (instalação e CLI)</strong></summary>

| Variável | Efeito |
|----------|--------|
| `OXE_NO_PROMPT` | `1` ou `true`: sem perguntas interativas (integração e layout usam padrões ou `.oxe/config.json` / flags) |
| `OXE_NO_BANNER` | `1` ou `true`: oculta o banner do CLI (útil em scripts) |
| `NO_COLOR` / `FORCE_COLOR` | Controlo de cores na saída |
| `CURSOR_CONFIG_DIR` | Diretório base do Cursor em vez de `~/.cursor` |
| `COPILOT_CONFIG_DIR` ou `COPILOT_HOME` | Diretório Copilot (VS Code / skills) em vez de `~/.copilot` |
| `CLAUDE_CONFIG_DIR` | Diretório `~/.claude` alternativo para comandos legado |
| `XDG_CONFIG_HOME` | Usado pelo instalador multi-agente (ex.: OpenCode em `$XDG_CONFIG_HOME/opencode/commands`) |
| `CODEX_HOME` | Raiz alternativa para prompts Codex (`…/prompts`) em instalação multi-agente |

</details>

<details>
<summary><strong>Mantenedores — autoria de workflows</strong></summary>

Quem edita `oxe/workflows/*.md` deve seguir **[`oxe/templates/WORKFLOW_AUTHORING.md`](oxe/templates/WORKFLOW_AUTHORING.md)** (outcome-first, tags recomendadas, progressive disclosure, frontmatter dos comandos). O passo **`workflow-authoring.md`** no mesmo diretório orienta uma revisão guiada de um ficheiro contra esse guia. O `oxe-cc doctor` pode emitir **avisos** não bloqueantes sobre estrutura dos workflows (presença de `<objective>`, critérios de sucesso, tamanho).

</details>

<details>
<summary><strong>Publicar no npm (mantenedores)</strong></summary>

Incremente `version` em `package.json`, rode `npm login` (2FA se exigido) e `npm publish --access public`. O script `prepublishOnly` **executa** os testes e o `scan:assets`.

</details>

<details>
<summary><strong>Estrutura do repositório</strong></summary>

| Caminho | Função |
|---------|--------|
| `assets/readme-banner.svg` | Banner deste README |
| `bin/oxe-cc.js`, `bin/banner.txt` | CLI |
| `bin/lib/*.cjs` | Lógica partilhada (health, workflows, manifest, instalação multi-agente, resolução `install` em config) |
| `lib/sdk/` | SDK npm (`require('oxe-cc')`) |
| `oxe/workflows/` | Workflows canónicos (fonte no pacote) |
| `oxe/templates/` | Modelos, `CONFIG.md`, `config.template.json`, **`WORKFLOW_AUTHORING.md`** (guia para editar workflows) |
| `.cursor/`, `.github/` | Comandos Cursor, prompts Copilot, CI |
| `commands/oxe/` | Comandos estilo `oxe:*` (layout clássico no projeto) |
| `tests/`, `scripts/`, `.github/workflows/` | Testes, `scan:assets`, CI |

</details>

---

## Licença

[GPL-3.0](LICENSE).
