<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

**Fluxo spec-driven e context engineering para [Cursor](https://cursor.com) e [GitHub Copilot](https://github.com/features/copilot) — inspirado na ideia do [GSD](https://github.com/gsd-build/get-shit-done), com **menos comandos** e foco em **`.oxe/`** (workflows em **`.oxe/workflows/`** por defeito, ou **`oxe/workflows/`** com `--global`).**

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

```bash
npx oxe-cc@latest
```

**Manter atualizado:** `npx oxe-cc@latest --force` (na raiz do projeto).

[Para quem é](#para-quem-é) · [Começar](#começar) · [Como funciona](#como-funciona) · [Modo rápido](#modo-rápido) · [Porque funciona](#porque-funciona) · [Comandos](#comandos) · [Configuração](#configuração) · [Problemas](#resolução-de-problemas)

</div>

---

## Para quem é

Para quem quer **descrever o que quer e ver isso construído de forma consistente** — **sem** simular uma organização enorme de processos em cima do repositório.

OXE é **enxuto**: não há dezenas de slash commands. Há **um CLI** que deixa o repositório **só com `.oxe/`** (layout por defeito) ou **`oxe/` + `.oxe/`** com **`--global`**, e instala integrações em **`~/.cursor`**, **`~/.copilot`** e **`~/.claude`** — **workflows em Markdown** e **estado em disco** para a sessão não “inchada” com tudo o que já foi decidido.

---

## Começar

**Requisito:** [Node.js 18+](https://nodejs.org/).

Na **raiz do repositório** do teu projeto:

```bash
npx oxe-cc@latest
```

Em **terminal interativo**, o instalador pergunta em dois passos (à la **GSD**): (1) **que integrações** queres (Cursor, Copilot, núcleo só workflows + `.oxe/`, etc.); (2) **layout no repositório** — **clássico** (`oxe/` na raiz + `.oxe/`, com opcional `commands/oxe/`, `AGENTS.md`) ou **mínimo** (**só `.oxe/`**, com **`.oxe/workflows/`** e templates lá dentro). **Cursor, Copilot e Claude** usam **sempre** as pastas do utilizador (`~/.cursor`, `~/.copilot`, `~/.claude`); **não** são criados `.cursor` / `.github` / `.claude` dentro do repo. Com layout clássico e **`--vscode`**, **`.vscode/`** continua no projeto.

Sem TTY (CI), o **layout mínimo** (só `.oxe/`) e integrações no **HOME** são o padrão. Usa **`--global`** para também ter **`oxe/`** na raiz. Flags: **`--cursor`**, **`--copilot`**, **`--oxe-only`**, **`OXE_NO_PROMPT=1`**, etc.

No fim, em interativo, pergunta se queres instalar o **`oxe-cc` globalmente** (`npm install -g`) ou continuar só com **`npx`**. Em CI ou scripts usa **`--no-global-cli`** / **`-l`**, ou define **`OXE_NO_PROMPT=1`**. Para instalar o CLI sem pergunta: **`--global-cli`** / **`-g`**.

**GitHub Copilot CLI (experimental):** **`--copilot-cli`** copia comandos para **`~/.claude/commands/`** (não para a pasta do projeto). Usa na raiz do repo: `npx oxe-cc@latest --force --copilot --copilot-cli`. Depois experimenta **`/oxe-scan`** na sessão do CLI. O suporte depende da versão; vê [discussão no copilot-cli](https://github.com/github/copilot-cli/issues/1113).

**Confirmar instalação no agente**

| Onde | O que correr |
|------|----------------|
| **Cursor** | `/oxe-help` |
| **Copilot** (VS Code) | `/oxe-help` no chat, se [prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files) estiverem ativos (`"chat.promptFiles": true` — exemplo em [`.vscode/settings.json`](.vscode/settings.json)) |

> **Nota:** Instruções e prompt files do Copilot ficam em **`~/.copilot/`** (alinhado ao GSD), não em `.github/` no repo. **`oxe-cc doctor`** aceita workflows em **`.oxe/workflows/`** ou **`oxe/workflows/`**. Sem prompt files, ainda podes pedir em linguagem natural com o repo em contexto.

**Sem pacote no npm** (`npm view oxe-cc version` → 404): clone este repo, `npm link` na pasta **oxe-build**, `npm link oxe-cc` no teu projeto, e corre `oxe-cc`. Alternativa: `node /caminho/oxe-build/bin/oxe-cc.js`.

<details>
<summary><strong>Instalação: flags úteis (CI, ou só parte do pacote)</strong></summary>

| Flag | Efeito |
|------|--------|
| `--force` / `-f` | Sobrescreve ficheiros já existentes (**obrigatório** para atualizar cópias antigas) |
| `--dry-run` | Lista ações sem escrever |
| `--cursor` / `--copilot` | Instala só uma das stacks |
| `--oxe-only` | Só workflows + templates dentro de **`.oxe/`** (sem integrações IDE) |
| `--no-init-oxe` | Não corre o bootstrap de `STATE.md` / `config.json` / `codebase/` (mantém `.oxe/workflows` se copiados) |
| `--global` | Layout **clássico**: **`oxe/`** na raiz do repo + **`.oxe/`**; IDE em `~/.cursor`, `~/.copilot`, `~/.claude` |
| `--local` | Layout **mínimo** (predefinido): **só `.oxe/`** com **`.oxe/workflows/`**; IDE nas mesmas pastas do utilizador |
| `--global-cli` / `-g` | Após copiar: `npm install -g oxe-cc@versão` (sem pergunta) |
| `--no-global-cli` / `-l` | Não pergunta nem instala o CLI global (útil em CI) |
| `--copilot-cli` | Copia comandos OXE para **`~/.claude/commands/`** |
| `--vscode` | Copia `.vscode/settings.json` (só com layout **`--global`**) |
| `--no-commands` | Omite `commands/oxe/` |
| `--no-agents` | Omite `AGENTS.md` |
| `--dir <pasta>` ou argumento posicional | Destino em vez do diretório atual |

**Global:** `npm install -g oxe-cc`.

**Subcomandos:** `oxe-cc doctor` (valida Node, workflows, `.oxe/`), `oxe-cc init-oxe` (só bootstrap `.oxe/`).

</details>

<details>
<summary><strong>Desenvolvimento (clonar o oxe-build)</strong></summary>

```bash
git clone https://github.com/propagno/oxe-build.git
cd oxe-build
npm test
node bin/oxe-cc.js --help
```

Para testar no teu app: `npm link` aqui, depois `npm link oxe-cc` no projeto alvo.

</details>

---

## Como funciona

**Já tens código?** Começa por **`/oxe-scan`**. Gera mapas em **`.oxe/codebase/`** (stack, estrutura, testes, convenções, etc.). Assim o **spec** e o **plan** alinham com o repo real — à semelhança de correres *map-codebase* antes do roadmap no GSD.

### 1. Mapear — `/oxe-scan`

Inventaria o projeto e preenche **`.oxe/codebase/*.md`**, atualiza **`.oxe/STATE.md`**. Podes indicar foco opcional (ex. “só API”).

### 2. Especificar — `/oxe-spec`

Produz ou atualiza **`.oxe/SPEC.md`**: objetivo, escopo, critérios de aceite, riscos. Isto é o contrato antes do plano.

### 3. Discutir *(opcional)* — `/oxe-discuss`

Captura decisões de implementação (UI, API, tom, edge cases) em **`.oxe/DISCUSS.md`**, para o plano não “adivinhar” o que preferes. Útil quando `discuss_before_plan` está ativo em `.oxe/config.json`. Saltar = defaults razoáveis; usar = mais próximo da tua visão.

### 4. Planear — `/oxe-plan`

Gera **`.oxe/PLAN.md`**: tarefas **atómicas**, **ondas** (paralelo vs sequencial), e bloco **Verificar** (comando de teste ou checklist) **por tarefa**. Ideia: cada tarefa cabe num contexto de agente focado, com verificação explícita — mesmo espírito dos planos XML pequenos do GSD, em Markdown.

Ondas em resumo: tarefas **independentes** na mesma onda podem correr em paralelo; **dependentes** vão para ondas posteriores (como no diagrama de *waves* do GSD, só que com menos cerimónia).

### 5. Executar — implementação + `/oxe-execute` *(opcional)*

Implementas no editor ou deixas o agente seguir **`/oxe-execute`** sobre o plano (ou QUICK). O OXE não impõe subagentes nem commits atómicos por tarefa como o GSD; isso fica ao teu fluxo Git.

### 6. Verificar — `/oxe-verify`

Cruza **SPEC** + **PLAN** com o código; escreve **`.oxe/VERIFY.md`**. Se algo falhar, corrigis ou replanejas (`/oxe-plan` com lógica de replanejamento descrita no workflow).

### 7. Seguir em frente — `/oxe-next` e ciclo

Para a **próxima** feature ou fase: de novo **spec → plan → …** ou **`/oxe-next`** para sugerir o passo lógico a partir de **STATE.md**.

---

## Modo rápido

Para trabalho **adhoc** sem roadmap completo — equivalente conceptual ao **`/gsd:quick`**:

**`/oxe-quick`** gera **`.oxe/QUICK.md`** com passos curtos e verificação. Depois podes usar **`/oxe-execute`** em cima disso ou implementar direto e fechar com **`/oxe-verify`**.

Se o trabalho crescer, **promove** para spec + plan completos.

---

## Porque funciona

**Context engineering:** o agente não precisa de “lembrar” tudo na janela principal — o que importa está em ficheiros **pequenos e por etapa**.

| Artefato | Função |
|----------|--------|
| `.oxe/STATE.md` | Fase, decisões, próximo passo — memória entre sessões |
| `.oxe/codebase/*.md` | Mapa do repo após scan |
| `.oxe/SPEC.md` | O que entregar e como saber que está certo |
| `.oxe/DISCUSS.md` | Preferências antes do plano *(opcional)* |
| `.oxe/PLAN.md` | Tarefas atómicas + **Verificar** por item |
| `.oxe/QUICK.md` | Modo rápido |
| `.oxe/VERIFY.md` | Resultado das verificações |
| `oxe/workflows/*.md` | **Fonte única** dos passos (Cursor e Copilot só delegam aqui) |

**Formato:** planos em Markdown com secções fixas (incl. verificação), legíveis por humanos e por modelos — sem XML obrigatório, mas com a mesma ideia de *precise instructions + verify*.

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
| `/oxe-review-pr` | Segue `oxe/workflows/review-pr.md`: diff estilo PR (`git diff base...head`, `gh pr diff <n>`, ou fetch `pull/<n>/head`), riscos, testes e checklist. Podes colar o **link da PR** (ex. `https://github.com/org/repo/pull/10`) ou indicar `main` e `feature/x`. **Não** há slash command em `.cursor/commands/`; no Cursor podes pedir o mesmo em linguagem natural com o workflow em contexto. |

### Outros clientes

Em **Claude Code** (ou ferramentas que leem `commands/oxe/`), os mesmos passos expõem nomes **`oxe:scan`**, **`oxe:plan`**, etc. (frontmatter `name:`).

---

## Configuração

Preferências do projeto em **`.oxe/config.json`** (criado no bootstrap a partir de `oxe/templates/config.template.json`). Chaves e comportamento: [`oxe/templates/CONFIG.md`](oxe/templates/CONFIG.md) (ex.: `discuss_before_plan`, texto pós-verify, comando de teste por defeito).

---

## Resolução de problemas

| Situação | O que tentar |
|----------|----------------|
| Comandos não aparecem no Cursor | Confirma que `.cursor/commands/` existe; reinicia o Cursor |
| Prompts `/oxe-*` não aparecem no Copilot | Ativa `"chat.promptFiles": true`; confirma `.github/prompts/*.prompt.md` |
| Slash `/oxe-*` no **Copilot CLI** | Instala com **`--copilot-cli`** (pasta `.claude/commands/`); atualiza o CLI; comportamento ainda experimental |
| **`ETARGET`** / versão não encontrada no `npx` | `npm cache clean --force`, `npx clear-npx-cache`, ou fixa versão: `npx oxe-cc@0.3.0`. Verifica `npm config get registry` |
| **404** no `npm view oxe-cc` | Pacote com outro nome (scope) ou ainda não publicado — usa `npm link` ou `node …/bin/oxe-cc.js` |
| Ficheiros não atualizam | Reinstala com **`--force`** |

**Ajuda no terminal:** `oxe-cc --help`. **Diagnóstico:** `oxe-cc doctor`.

**Banner no CLI:** [`bin/banner.txt`](bin/banner.txt) (`{version}`). `OXE_NO_BANNER=1` desliga; `NO_COLOR` remove cores.

<details>
<summary><strong>Publicar no npm (mantenedores)</strong></summary>

Sobe `version` em `package.json`, `npm login` (2FA se exigido), `npm publish --access public`. O `prepublishOnly` corre testes e `scan:assets`.

</details>

<details>
<summary><strong>Estrutura do repositório</strong></summary>

| Caminho | Função |
|---------|--------|
| `assets/readme-banner.svg` | Banner deste README |
| `bin/oxe-cc.js`, `bin/banner.txt` | CLI |
| `oxe/workflows/` | Workflows canónicos |
| `oxe/templates/` | Modelos e CONFIG |
| `.cursor/`, `.github/` | Cursor e Copilot |
| `commands/oxe/` | `oxe:*` para outros runtimes |
| `tests/`, `scripts/`, `.github/workflows/` | CI e qualidade |

</details>

---

## Licença

[GPL-3.0](LICENSE).
