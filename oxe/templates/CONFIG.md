# `.oxe/config.json` — referência

Copie `oxe/templates/config.template.json` para **`.oxe/config.json`** no seu projeto (ou deixe o `oxe-cc` criar na primeira instalação).

## Chaves principais

| Chave | Tipo | Significado |
|-------|------|-------------|
| `profile` | string | Profile de execução: `balanced` (padrão) \| `strict` \| `fast` \| `legacy`. Expande automaticamente outras keys — keys explícitas prevalecem. Ver tabela abaixo. |
| `discuss_before_plan` | boolean | Se `true`, o fluxo recomenda **`oxe:discuss`** entre spec e plan. |
| `verification_depth` | string | Profundidade da verificação: `standard` (padrão) \| `thorough` (ativa Camada 5 — validate-gaps automático) \| `quick` (skip camadas 3–4 e UAT). |
| `security_in_verify` | boolean | Se `true`, executa auditoria OWASP automaticamente no **verify** como **Camada 6** (produz `.oxe/SECURITY.md`). Achados P0 bloqueiam `verify_complete`. Padrão: `false`. |
| `after_verify_suggest_pr` | boolean | Se `true`, o workflow **verify** inclui checklist de PR no fim. |
| `after_verify_draft_commit` | boolean | Se `true`, o **verify** propõe rascunho de mensagem de commit alinhado aos critérios de aceite. |
| `after_verify_suggest_uat` | boolean | Se `true`, o **verify** gera checklist UAT (Camada 4). Ativo automaticamente com `profile: strict`. |
| `default_verify_command` | string | Comando guarda-chuva opcional (ex.: `npm test`) sugerido em **plan**/**verify** quando o projeto não define outro. |
| `scan_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando a **Data** do último scan em `STATE.md` é mais antiga que esse número de dias. Use **0** para desligar. |
| `compact_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando a **Data** em **Último compact** em `STATE.md` é mais antiga que esse número de dias. Use **0** para desligar. |
| `lessons_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando o campo `last_retro` em `STATE.md` é mais antigo que esse número de dias (ciclos sem retrospectiva). Use **0** para desligar (padrão). |
| `scale_adaptive` | boolean | Se `true` (padrão), o workflow **scan** sugere automaticamente um `profile` baseado no tamanho do projeto. |
| `scan_focus_globs` | string[] | Padrões (ex.: `src/api/**`) que o workflow **scan** deve priorizar; só orientação para o agente. |
| `scan_ignore_globs` | string[] | Padrões a tratar como baixa prioridade ou omitir no scan (ex.: `**/dist/**`). |
| `spec_required_sections` | string[] | Cabeçalhos que **devem** existir em `SPEC.md` (ex.: `"## Critérios de aceite"`). `doctor` / `status` emitem aviso se faltar. |
| `plan_max_tasks_per_wave` | number | Se **> 0**, `doctor` / `status` avisam se alguma **Onda** no `PLAN.md` tiver mais tarefas `T1…` que esse limite. **0** desliga. |
| `plugins` | array | Caminhos de plugins customizados em `.oxe/plugins/` (strings relativas). Padrão: `[]`. Ver [`PLUGINS.md`](PLUGINS.md). |
| `workstreams` | array | Lista de nomes de workstreams ativos (strings). Usado como referência pelo agente em **`/oxe-workstream`**. Padrão: `[]`. |
| `milestones` | array | Lista de milestones ativos (objetos `{ "id": "M-01", "name": "..." }`). Usado como referência pelo agente em **`/oxe-milestone`**. Padrão: `[]`. |
| `install` | object | Opcional. Preferências de **instalação** quando corre `npx oxe-cc` **sem** flags de CLI. Ver tabela abaixo. |

## Profiles de execução (`profile`)

| Profile | `discuss_before_plan` | `verification_depth` | `after_verify_suggest_uat` | `scan_max_age_days` |
|---------|----------------------|---------------------|---------------------------|---------------------|
| `balanced` (padrão) | false | standard | false | 0 |
| `strict` | true | thorough | true | 14 |
| `fast` | false | quick | false | 0 |
| `legacy` | true | thorough | true | 0 |

Keys explícitas no `config.json` **prevalecem** sobre os valores do profile.

## Objeto `install`

| Chave | Tipo | Significado |
|-------|------|-------------|
| `profile` | string | `recommended` (Cursor+Copilot), `cursor`, `copilot`, `core` (só `.oxe`/workflows no projeto, sem integrações em `~`), `cli` (+ Copilot CLI / skills), `all_agents` (multi-plataforma como `--all-agents`). |
| `repo_layout` | string | `nested` = só `.oxe/workflows` (padrão enxuto); `classic` = pasta `oxe/` na raiz + `.oxe/`. Equivale a `--local` / `--global` quando não passa essas flags. |
| `vscode` | boolean | Se `true`, copia `.vscode/settings.json` do pacote quando o layout for `classic`. |
| `include_commands_dir` | boolean | Com layout `classic`, copiar `commands/oxe/` para o repo. |
| `include_agents_md` | boolean | Com layout `classic`, copiar `AGENTS.md` para a raiz. |

Use `npx oxe-cc --no-install-config` para ignorar este bloco numa instalação.

### Plan-agent, arquivo e Git

**`.oxe/plan-agents.json`** e **`.oxe/plan-agent-messages/`** são artefactos de trabalho durante a trilha **plan → execute → verify**. Após verify com sucesso, o fluxo OXE **recomenda** arquivar em **`.oxe/archive/plan-agent-runs/<runId>/`** (mensagens + cópia do JSON) para limpar a raiz de `.oxe/` — ver **`oxe/workflows/references/plan-agent-chat-protocol.md`**. Não há chave em `config.json` para isto; é passo manual ou proposto pelo agente em **`verify`**. Se não quiser versionar handoffs, pode adicionar **`.oxe/archive/plan-agent-runs/`** ou **`.oxe/plan-agent-messages/`** ao **`.gitignore`** do projeto (perde histórico no Git).

Chaves desconhecidas são listadas como aviso no `doctor` / `status`. Valores em falta usam o mesmo significado que no template (omissões seguras).

## Exemplo: projeto pequeno (< 50 arquivos)

```json
{
  "profile": "fast",
  "default_verify_command": "npm test",
  "scale_adaptive": true
}
```

## Exemplo: projeto grande / crítico

```json
{
  "profile": "strict",
  "default_verify_command": "npm test",
  "scan_max_age_days": 7,
  "compact_max_age_days": 14,
  "plan_max_tasks_per_wave": 5
}
```

## Exemplo: repositório legado (COBOL / JCL / copybooks / VB6 / SQL)

Para **scan** e **spec** orientarem o agente sem assumir Node/Java, use `scan_focus_globs` / `scan_ignore_globs` alinhados ao layout real (nomes `cpy` vs `copy` variam). Opcionalmente reforce secções da SPEC com `spec_required_sections`, por exemplo:

- `"## Contratos de dados"`
- `"## Fluxos batch"`
- `"## Integrações desktop-DB"`

```json
{
  "profile": "legacy",
  "scan_focus_globs": ["jcl/**", "cbl/**", "cpy/**"],
  "scan_ignore_globs": ["dist/**"],
  "spec_required_sections": ["## Contratos de dados", "## Fluxos batch"]
}
```

Guia completo de análise e verificação nestes repos: [`oxe/workflows/references/legacy-brownfield.md`](../workflows/references/legacy-brownfield.md) (no pacote npm; após `npx oxe-cc`, cópia em `.oxe/workflows/references/`).

**Layout opcional da pasta `docs/`** (índice por intenção, técnico/negócio, glossário, comparativos): [`DOCS_BROWNFIELD_LAYOUT.md`](DOCS_BROWNFIELD_LAYOUT.md).

**Autoria de workflows:** ver [`WORKFLOW_AUTHORING.md`](WORKFLOW_AUTHORING.md) (mantenedores).

**Plugin system:** ver [`PLUGINS.md`](PLUGINS.md) para criar plugins em `.oxe/plugins/*.cjs`.
