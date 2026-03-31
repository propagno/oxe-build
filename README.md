# oxe-build

Fluxo **spec-driven** enxuto (inspirado em context engineering / GSD), com prefixo **OXE** e artefatos em **`.oxe/`**.

Os alvos **iniciais** são **Cursor** e **GitHub Copilot** (VS Code e IDEs compatíveis). Outros clientes podem usar os mesmos workflows em Markdown.

## Instalação com `npx` (estilo GSD)

Precisas de **Node.js 18+**. O pacote npm chama-se **`oxe-cc`** e o executável também é **`oxe-cc`**.

```bash
# Na raiz do projeto onde queres OXE (por omissão: Cursor + Copilot + oxe/ + commands/oxe + AGENTS.md)
cd /caminho/do/teu-projeto
npx oxe-cc@latest
```

**Nota:** `npx oxe-cc@latest` só resolve depois do pacote estar publicado no npm. Antes disso: `npm link` a partir deste repo, ou `node /caminho/para/oxe-build/bin/oxe-cc.js` (ver secção “Desenvolvimento local” abaixo).

Opções úteis:

| Opção | Efeito |
|--------|--------|
| *(omissão)* | **Cursor + Copilot** + `oxe/` + `commands/oxe` + `AGENTS.md` |
| `--all`, `-a` | Garante Cursor e Copilot (mesmo efeito que omitir `--cursor` e `--copilot`) |
| `--dir <pasta>` | Instala noutro diretório em vez do cwd |
| `--cursor` | Só `.cursor/commands` e `.cursor/rules` |
| `--copilot` | Só `.github/copilot-instructions.md` e `.github/prompts` |
| `--vscode` | Copia também `.vscode/settings.json` (`chat.promptFiles`) |
| `--no-commands` | Não copia `commands/oxe/` |
| `--no-agents` | Não copia `AGENTS.md` |
| `--force` / `-f` | Sobrescreve ficheiros já existentes |
| `--dry-run` | Mostra o que faria sem escrever |
| `--no-init-oxe` | Não cria `.oxe/STATE.md` nem `.oxe/codebase/` após instalar |
| `--oxe-only` | Copia só a pasta `oxe/` (sem Cursor, Copilot, `commands/oxe`, `AGENTS.md`) |
| `-h` / `--help`, `-v` / `--version` | Ajuda e versão |

**Subcomandos:**

| Comando | Efeito |
|---------|--------|
| `oxe-cc doctor [dir]` | Verifica Node.js, compara `oxe/workflows/*.md` com o pacote, nota `.oxe/STATE.md` |
| `oxe-cc init-oxe [dir]` | Só inicializa `.oxe/` (STATE a partir do template + pasta `codebase/`) |

A pasta **`oxe/`** (workflows + templates) é **sempre** copiada na instalação normal. `--cursor` / `--copilot` apenas controlam se entram ficheiros em `.cursor/` e `.github/`.

Instalação global (opcional): `npm install -g oxe-cc` e depois `oxe-cc` em qualquer pasta.

### Publicar o teu fork (para usar `npx oxe-cc@latest` a partir do teu nome)

1. Edita `package.json`: campo **`name`** (ex. `@tua-org/oxe-cc`) e **`repository.url`**.  
2. `npm login` e, na pasta do repo: **`npm publish --access public`** (scopes `@org/pkg` precisam de `--access public` na primeira vez).

### CLI com nome personalizado

No `package.json`, o binário é o mapa **`bin`**: a chave é o comando no terminal, o valor é o script.

```json
"bin": {
  "oxe-cc": "bin/oxe-cc.js",
  "meu-oxe": "bin/oxe-cc.js"
}
```

Depois de publicar, o comando extra fica disponível **globalmente** com `npm i -g nome-do-pacote` como `meu-oxe`. Com **npx**, o pacote continua a identificar-se pelo **`name`** em `package.json`; para correr um binário que não é o nome do pacote, usa por exemplo `npx -p oxe-cc meu-oxe` (ajusta `oxe-cc` / `meu-oxe` aos teus nomes).

O ficheiro do script (`bin/oxe-cc.js`) pode ser renomeado desde que atualizes o caminho no mapa `bin`.

**Desenvolvimento local sem publicar:** na pasta `oxe-build`, `npm link` e no projeto alvo `npm link oxe-cc`, depois `oxe-cc`; ou `node /caminho/para/oxe-build/bin/oxe-cc.js`. Testes: `npm test`.

## Fonte única

Os passos detalhados vivem em **`oxe/workflows/`** (`scan.md`, `spec.md`, `plan.md`, `quick.md`, `execute.md`, `verify.md`, `next.md`, `help.md`). Comandos Cursor, prompts Copilot e o atalho `commands/oxe/*` apenas **delegam** para esses ficheiros.

Por omissão, após instalar, o CLI cria **`.oxe/`** mínimo (`STATE.md` a partir de `oxe/templates/STATE.md` e pasta `codebase/`) se ainda não existir — exceto com `--no-init-oxe`.

## Cursor

| Slash | Workflow |
|-------|----------|
| `/oxe-scan` | `oxe/workflows/scan.md` |
| `/oxe-spec` | `oxe/workflows/spec.md` |
| `/oxe-plan` | `oxe/workflows/plan.md` |
| `/oxe-quick` | `oxe/workflows/quick.md` |
| `/oxe-execute` | `oxe/workflows/execute.md` |
| `/oxe-verify` | `oxe/workflows/verify.md` |
| `/oxe-next` | `oxe/workflows/next.md` |
| `/oxe-help` | `oxe/workflows/help.md` |

Ficheiros: `.cursor/commands/oxe-*.md` e regra `.cursor/rules/oxe-workflow.mdc`.

## GitHub Copilot

1. **Instruções do repositório** — [`.github/copilot-instructions.md`](.github/copilot-instructions.md): ativadas automaticamente no chat quando o repositório está em contexto (ver [documentação](https://docs.github.com/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)).
2. **Prompt files** — [`.github/prompts/*.prompt.md`](.github/prompts/): no chat, escreve `/` e escolhe por exemplo **`oxe-scan`**, **`oxe-quick`**, **`oxe-execute`**, etc. (o `name` no frontmatter define o comando). Cada prompt referencia `oxe/workflows/<passo>.md` na **raiz do repo em contexto**.

Este repo inclui [`.vscode/settings.json`](.vscode/settings.json) com `"chat.promptFiles": true` para expor a pasta `.github/prompts`. Podes copiar essa definição para o teu `settings.json` global se preferires.

3. **Agentes** — [`AGENTS.md`](AGENTS.md) resume o pacote para modos que leem instruções de agente no repo.

## Fluxo recomendado

**Completo:** 1. **scan** → 2. **spec** → 3. **plan** → 4. **execute** (opcional, onda a onda) → 5. implementar → 6. **verify** → 7. **next**.

**Rápido (tarefas pequenas):** **quick** gera `.oxe/QUICK.md` com passos curtos + verificação; depois **execute** (sobre o QUICK) ou implementação direta e **verify**. Promover a spec/plan se o trabalho crescer (muitos ficheiros, API pública, segurança).

## Artefatos (`.oxe/` no projeto alvo)

| Caminho | Conteúdo |
|---------|----------|
| `.oxe/STATE.md` | Fase, último scan, próximo passo |
| `.oxe/codebase/*.md` | Mapa (OVERVIEW, STACK, STRUCTURE, TESTING, **INTEGRATIONS**) |
| `.oxe/SPEC.md` | Especificação |
| `.oxe/PLAN.md` | Plano com verificação por tarefa |
| `.oxe/QUICK.md` | Modo rápido: passos curtos + verificar |
| `.oxe/VERIFY.md` | Resultado das verificações |
| `.oxe/SUMMARY.md` | Resumo de sessão / contexto para replan (opcional) |

Templates: **`oxe/templates/`** (`STATE.md`, `SPEC.template.md`, `PLAN.template.md`, `SUMMARY.template.md`).

Neste repositório, **`.oxe/` está no `.gitignore`** para não versionar scans locais do *oxe-build*. No teu produto, remove ou ajusta essa regra se quiseres commitar `.oxe/` com a equipa.

## Usar noutro projeto

Recomendado: **`npx oxe-cc@latest`** na raiz do repo alvo (ou `npx oxe-cc` após publicares o pacote).

Alternativa manual: copia os mesmos caminhos que o instalador usa (`oxe/`, `.cursor/`, `.github/`, `commands/oxe`, `AGENTS.md`, opcionalmente `.vscode/settings.json` ou só `"chat.promptFiles": true` nas definições).

`commands/oxe/*.md` mantém frontmatter estilo GSD (`name: oxe:scan`, …) para ferramentas que importam comandos nesse formato.

## Estrutura deste repositório

| Pasta / ficheiro | Função |
|------------------|--------|
| `bin/oxe-cc.js` | CLI: instalar, `doctor`, `init-oxe` |
| `package.json` | Metadados npm (`oxe-cc`, `files`, `bin`) |
| `oxe/workflows/` | Workflows canónicos (fonte única) |
| `oxe/templates/` | Modelos (STATE, SPEC, PLAN, SUMMARY) |
| `.cursor/commands/` | Slash commands Cursor |
| `.cursor/rules/` | Regras do projeto Cursor |
| `.github/copilot-instructions.md` | Instruções Copilot no repo |
| `.github/prompts/` | Ficheiros `*.prompt.md` (`/oxe-scan`, …) |
| `commands/oxe/` | Comandos com frontmatter estilo GSD |
| `AGENTS.md` | Resumo para agentes (ex. Copilot) |

## Licença

[GPL-3.0](LICENSE) — ver [LICENSE](LICENSE).
