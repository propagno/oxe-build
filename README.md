<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE — fluxo spec-driven para Cursor e GitHub Copilot" width="920" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/oxe-cc"><img src="https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square" alt="versão npm" /></a>
  <a href="https://www.npmjs.com/package/oxe-cc"><img src="https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square" alt="licença" /></a>
</p>

---

## Índice

Lê por ordem na primeira vez; no GitHub abre o **ícone de conteúdos** (canto superior esquerdo do README) para saltar entre secções.

1. Começar em 3 passos  
2. O que é o OXE?  
3. Pré-requisitos  
4. Instalar no teu projeto  
5. Usar no Cursor e no Copilot  
6. Fluxo de trabalho (completo e rápido)  
7. Pastas e ficheiros importantes  
8. Referência do CLI `oxe-cc`  
9. Atualizar o OXE  
10. Problemas comuns  
11. Manutenção (npm publish)  
12. Banner no terminal  
13. Estrutura do repositório  
14. Licença  

---

## 1 · Começar em 3 passos

| Passo | O que fazer |
|-------|-------------|
| **1** | Garante [Node.js 18+](https://nodejs.org/) e abre o terminal na **raiz do repositório** do teu projeto. |
| **2** | Instala os ficheiros OXE no projeto (escolhe [uma forma na secção 4](#sec-instalacao)). O mais comum é: `npx oxe-cc@latest` |
| **3** | No **Cursor**, usa por exemplo `/oxe-scan`. No **VS Code + Copilot**, escreve `/` no chat e escolhe **`oxe-scan`** (se tiveres [prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files) ativos). |

> **Dica:** Se o pacote ainda não existir no npm ou der erro, usa **clone + `npm link`** — está explicado no [cenário B](#cenario-b).

---

## 2 · O que é o OXE?

O **OXE** é um fluxo **spec-driven** (especificação antes de código): guias em Markdown que o agente segue para **mapear o projeto**, **escrever spec**, **planear com testes por tarefa** e **verificar** o resultado.

- **Para ti:** menos “contexto perdido” entre sessões — o estado fica em ficheiros sob **`.oxe/`**.  
- **Para o agente:** comandos no **Cursor** (`/oxe-*`) e **prompts** no **GitHub Copilot** que apontam sempre para a mesma pasta: **`oxe/workflows/`** (fonte única).

O pacote npm chama-se **`oxe-cc`**. Confirma se está publicado:

```bash
npm view oxe-cc version
```

Se aparecer **404**, o nome ainda não está no registry público — usa o [cenário B](#cenario-b).

---

## 3 · Pré-requisitos

| Requisito | Detalhe |
|-----------|---------|
| **Node.js** | Versão **18 ou superior** (`node -v`). |
| **Cursor** *(opcional)* | Para slash commands em `.cursor/commands/`. |
| **GitHub Copilot** *(opcional)* | Para instruções em `.github/copilot-instructions.md` e ficheiros em `.github/prompts/`. Ativa `"chat.promptFiles": true` no VS Code se quiseres `/oxe-scan` no chat — este repo inclui [`.vscode/settings.json`](.vscode/settings.json) de exemplo. |

---

<a id="sec-instalacao"></a>

## 4 · Instalar no teu projeto

O comando **`oxe-cc`** **copia** ficheiros para a pasta onde estás (por defeito o diretório atual). **Não** substitui automaticamente ficheiros antigos — para isso usa **`--force`**.

### Cenário A · Pacote publicado no npm (uso normal)

Na raiz do teu projeto:

```bash
cd caminho/do/teu-projeto
npx oxe-cc@latest
```

Isto instala, em geral: pasta **`oxe/`** (workflows + templates), **`.cursor/`**, **`.github/`**, **`commands/oxe/`**, **`AGENTS.md`**, e cria um **`.oxe/`** mínimo (`STATE.md`, `config.json`, pasta `codebase/`) — salvo se usares `--no-init-oxe`.

**Já tinhas OXE e saiu versão nova?** Vê a [secção 9 · Atualizar](#sec-atualizar).

<a id="cenario-b"></a>

### Cenário B · Sem pacote no npm (clone local)

Útil enquanto o `npm publish` não está disponível ou para desenvolver o próprio OXE.

```bash
cd caminho/para/oxe-build
npm link

cd caminho/para/teu-projeto
npm link oxe-cc
oxe-cc
```

**Sem `link`**, podes chamar o script diretamente:

```bash
node caminho/para/oxe-build/bin/oxe-cc.js
```

### O que cada flag faz (resumo)

| Opção | Para que serve |
|--------|------------------|
| *(nada)* | Instala **Cursor + Copilot** + `oxe/` + `commands/oxe` + `AGENTS.md` + bootstrap `.oxe/` |
| `--force` / `-f` | **Sobrescreve** ficheiros que já existem (necessário para atualizar cópias antigas) |
| `--dry-run` | Mostra o que faria **sem escrever** |
| `--cursor` | Só ficheiros **Cursor** (`.cursor/`) |
| `--copilot` | Só **Copilot** (`.github/` instruções + prompts) |
| `--vscode` | Copia **`.vscode/settings.json`** (`chat.promptFiles`) |
| `--oxe-only` | Só a pasta **`oxe/`** (sem Cursor, Copilot, commands, AGENTS) |
| `--no-init-oxe` | Não cria **`.oxe/`** no fim |
| `--no-commands` | Não copia **`commands/oxe/`** |
| `--no-agents` | Não copia **`AGENTS.md`** |
| `--dir <pasta>` | Destino em vez do diretório atual |

**Subcomandos úteis:**

| Comando | Função |
|---------|--------|
| `oxe-cc doctor [dir]` | Verifica Node, workflows, `config.json`, mapas em `.oxe/codebase/` |
| `oxe-cc init-oxe [dir]` | Cria só **`.oxe/`** (STATE, config, codebase) |

**Instalação global** (opcional): `npm install -g oxe-cc` → depois `oxe-cc` em qualquer pasta.

**Ajuda no terminal:** `oxe-cc --help` (inclui bloco **Upgrade**).

### Erro: pacote não está no registry (404)

Se `npx oxe-cc@latest` disser que **não existe** no registry:

1. Confirma o **nome** no npm (`npm view oxe-cc`) — se publicaste com **scope** (`@org/oxe-cc`), usa `npx @org/oxe-cc@latest`.  
2. Confirma o registry: `npm config get registry` → para o público deve ser `https://registry.npmjs.org/`.  
3. Até funcionar, usa o [cenário B](#cenario-b).

---

## 5 · Usar no Cursor e no Copilot

### Cursor

Abre o projeto no Cursor. No chat de agente, usa os **slash commands** (definidos em `.cursor/commands/`):

| Comando | O que faz |
|---------|-----------|
| `/oxe-scan` | Mapeia o código → `.oxe/codebase/` |
| `/oxe-spec` | Escreve/atualiza a especificação |
| `/oxe-discuss` | Discussão antes do plano (opcional) |
| `/oxe-plan` | Plano com verificação por tarefa |
| `/oxe-quick` | Modo rápido (`.oxe/QUICK.md`) |
| `/oxe-execute` | Execução guiada (opcional) |
| `/oxe-verify` | Validação e `.oxe/VERIFY.md` |
| `/oxe-next` | Sugere o próximo passo |
| `/oxe-help` | Ajuda e visão geral |

Cada comando diz ao agente para seguir o ficheiro correspondente em **`oxe/workflows/`**.

### GitHub Copilot (VS Code / IDE compatível)

1. **Instruções do repositório** — [`.github/copilot-instructions.md`](.github/copilot-instructions.md) entram no contexto quando o repo está anexado ([documentação GitHub](https://docs.github.com/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)).  
2. **Prompts** — em `.github/prompts/*.prompt.md`: no chat, **`/`** → escolhe **`oxe-scan`**, **`oxe-plan`**, etc.  
3. **`AGENTS.md`** — resumo para modos que leem instruções de agente no repositório.

---

## 6 · Fluxo de trabalho (completo e rápido)

### Fluxo completo (features maiores)

Ordem sugerida:

1. **scan** — gera os mapas em `.oxe/codebase/` (inclui CONVENTIONS, CONCERNS, etc.).  
2. **spec** — objetivo e critérios de aceite.  
3. **discuss** — opcional; recomendado se `discuss_before_plan` estiver ativo em `.oxe/config.json`.  
4. **plan** — tarefas em ondas com **Verificar** (testes/comandos) por item; `--replan` usa secção de replanejamento.  
5. **execute** — opcional, guia execução do plano.  
6. **Implementação manual** no editor quando fizer sentido.  
7. **verify** — confirma spec + plano; pode incluir rascunho de commit / checklist de PR conforme config.  
8. **next** — retomar ou seguir fase.

### Fluxo rápido (tarefas pequenas)

1. **quick** → `.oxe/QUICK.md` com passos curtos.  
2. **execute** sobre o QUICK ou implementação direta.  
3. **verify**.  
Se o trabalho crescer, passa para **spec** + **plan** completos.

**Configuração opcional:** chaves em **`.oxe/config.json`** — documentação em [`oxe/templates/CONFIG.md`](oxe/templates/CONFIG.md).

---

## 7 · Pastas e ficheiros importantes

### No teu projeto (gerados / usados pelo fluxo)

| Caminho | Função |
|---------|--------|
| `.oxe/STATE.md` | Estado: fase, decisões, próximo passo |
| `.oxe/config.json` | Preferências (opcional; template em `oxe/templates/`) |
| `.oxe/codebase/*.md` | Mapa do repositório após **scan** |
| `.oxe/SPEC.md` | Especificação |
| `.oxe/DISCUSS.md` | Discussão (opcional) |
| `.oxe/PLAN.md` | Plano com **Verificar** por tarefa |
| `.oxe/QUICK.md` | Modo rápido |
| `.oxe/VERIFY.md` | Resultado das verificações |
| `.oxe/SUMMARY.md` | Resumo para replan (opcional) |

### No pacote (copiados para o projeto)

- **`oxe/workflows/`** — regras detalhadas (fonte única).  
- **`oxe/templates/`** — modelos (STATE, SPEC, PLAN, CONFIG, …).

**Neste repositório oxe-build**, a pasta `.oxe/` está no `.gitignore` (desenvolvimento do pacote). No **teu** produto podes versionar `.oxe/` se a equipa quiser.

---

## 8 · Referência do CLI `oxe-cc`

Tudo o que o instalador faz está no script [`bin/oxe-cc.js`](bin/oxe-cc.js). Os **workflows** não mudam de local: **`oxe/workflows/*.md`**.

---

<a id="sec-atualizar"></a>

## 9 · Atualizar o OXE

O OXE **não se atualiza sozinho**: voltas a correr o instalador com a versão nova do pacote.

| Como usas | Comando típico |
|-----------|----------------|
| **npx** | Na raiz do projeto: `npx oxe-cc@latest --force` |
| **global** | `npm install -g oxe-cc@latest` → `oxe-cc --force` |
| **npm link** | `git pull` no clone do `oxe-build` → `oxe-cc --force` no projeto |

Ver última versão no npm: `npm view oxe-cc version`.

Se o **npx** parecer preso a uma versão antiga: `npx clear-npx-cache` (npm 7+) e tenta de novo.

**Só workflows:** `npx oxe-cc@latest --oxe-only --force` (não toca em `.cursor/` / `.github/`).

---

## 10 · Problemas comuns

### `ETARGET` / “No matching version found for oxe-cc@…”

Metadados ou **cache** local desatualizados. Tenta:

```bash
npm cache clean --force
npx clear-npx-cache
npx oxe-cc@latest --force
```

Ou fixa versão: `npx oxe-cc@0.3.0 --force` (ajusta à versão que `npm view oxe-cc versions` listar). Confirma também `npm config get registry`.

### 404 no `npm view oxe-cc`

O pacote ainda não foi publicado ou o nome é outro (scope). Usa [cenário B](#cenario-b).

---

## 11 · Manutenção (npm publish)

Para quem publica o pacote:

1. Sobe a **`version`** em `package.json` (semver).  
2. Confirma **`repository`**, **`homepage`**, **`bugs`**.  
3. `npm login` (conta com **2FA** se o npm exigir).  
4. `npm publish --access public` (obrigatório `--access public` na primeira vez com scope `@org/...`).

O script **`prepublishOnly`** corre testes, `scan:assets` e `--version` antes do upload.

### Fork, scope e nome do comando

- **Outro nome no npm:** edita **`name`** e **`repository.url`** em `package.json`, depois `npm publish --access public`.  
- **Dois comandos no terminal:** no `bin` do `package.json` podes mapear o mesmo script duas vezes, por exemplo `"meu-oxe": "bin/oxe-cc.js"`. Com **npx**, o pacote identifica-se pelo `name`; binário extra: `npx -p oxe-cc meu-oxe`.

**Testes no clone:** `npm test`. **Scan de segredos em markdown:** `npm run scan:assets`.

---

## 12 · Banner no terminal

Ao correr **`oxe-cc`** (instalar, `doctor`, `init-oxe`, `--help`), aparece um **ASCII** definido em [`bin/banner.txt`](bin/banner.txt).

- **`{version}`** — substituído pela versão do pacote.  
- **`NO_COLOR`** / **`FORCE_COLOR=0`** — sem cores.  
- **`OXE_NO_BANNER=1`** — desliga o banner (CI).  
- **`--version`** — só uma linha, sem banner.

O **banner deste README** é o ficheiro SVG em [`assets/readme-banner.svg`](assets/readme-banner.svg) (GitHub / site). O **terminal** usa texto em `banner.txt`.

---

## 13 · Estrutura do repositório

| Caminho | Função |
|---------|--------|
| [`assets/readme-banner.svg`](assets/readme-banner.svg) | Banner do README |
| `bin/oxe-cc.js` | CLI |
| `bin/banner.txt` | Banner ASCII do CLI |
| `package.json` | npm: `oxe-cc`, `files`, `bin` |
| `oxe/workflows/` | Workflows canónicos |
| `oxe/templates/` | Modelos e CONFIG.md |
| `scripts/oxe-assets-scan.cjs` | Scan de padrões sensíveis em markdown |
| `.github/workflows/ci.yml` | CI: testes + scan |
| `.cursor/commands/` | Slash Cursor |
| `.cursor/rules/` | Regras Cursor |
| `.github/copilot-instructions.md` | Instruções Copilot |
| `.github/prompts/` | Prompts `*.prompt.md` |
| `commands/oxe/` | Comandos estilo GSD (frontmatter) |
| `AGENTS.md` | Resumo para agentes |

---

## Licença

[GPL-3.0](LICENSE) — ver ficheiro [LICENSE](LICENSE).
