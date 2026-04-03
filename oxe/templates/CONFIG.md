# `.oxe/config.json` — referência

Copie `oxe/templates/config.template.json` para **`.oxe/config.json`** no seu projeto (ou deixe o `oxe-cc` criar na primeira instalação).

| Chave | Tipo | Significado |
|-------|------|-------------|
| `discuss_before_plan` | boolean | Se `true`, o fluxo recomenda **`oxe:discuss`** entre spec e plan. |
| `after_verify_suggest_pr` | boolean | Se `true`, o workflow **verify** inclui checklist de PR no fim. |
| `after_verify_draft_commit` | boolean | Se `true`, o **verify** propõe rascunho de mensagem de commit alinhado aos critérios de aceite. |
| `default_verify_command` | string | Comando guarda-chuva opcional (ex.: `npm test`) sugerido em **plan**/**verify** quando o projeto não define outro. |
| `scan_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando a **Data** do último scan em `STATE.md` é mais antiga que esse número de dias. Use **0** para desligar. |
| `compact_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando a **Data** em **Último compact (codebase + RESUME)** em `STATE.md` é mais antiga que esse número de dias (preenchida por **`/oxe-compact`**). Use **0** para desligar. |
| `scan_focus_globs` | string[] | Padrões (ex.: `src/api/**`) que o workflow **scan** deve priorizar; só orientação para o agente. |
| `scan_ignore_globs` | string[] | Padrões a tratar como baixa prioridade ou omitir no scan (ex.: `**/dist/**`). |
| `spec_required_sections` | string[] | Cabeçalhos que **devem** existir em `SPEC.md` (ex.: `"## Critérios de aceite"`). `doctor` / `status` emitem aviso se faltar. |
| `plan_max_tasks_per_wave` | number | Se **> 0**, `doctor` / `status` avisam se alguma **Onda** no `PLAN.md` tiver mais tarefas `T1…` que esse limite. **0** desliga. |
| `install` | object | Opcional. Preferências de **instalação** quando corre `npx oxe-cc` **sem** `--cursor` / `--copilot` / `--all` / `--oxe-only` (flags na CLI prevalecem). Ver tabela abaixo. |

### Objeto `install`

| Chave | Tipo | Significado |
|-------|------|-------------|
| `profile` | string | `recommended` (Cursor+Copilot), `cursor`, `copilot`, `core` (só `.oxe`/workflows no projeto, sem integrações em `~`), `cli` (+ Copilot CLI / skills), `all_agents` (multi-plataforma como `--all-agents`). |
| `repo_layout` | string | `nested` = só `.oxe/workflows` (padrão enxuto); `classic` = pasta `oxe/` na raiz + `.oxe/`. Equivale a `--local` / `--global` quando não passa essas flags. |
| `vscode` | boolean | Se `true`, copia `.vscode/settings.json` do pacote quando o layout for `classic`. |
| `include_commands_dir` | boolean | Com layout `classic`, copiar `commands/oxe/` para o repo. |
| `include_agents_md` | boolean | Com layout `classic`, copiar `AGENTS.md` para a raiz. |

Use `npx oxe-cc --no-install-config` para ignorar este bloco numa instalação.

Chaves desconhecidas são listadas como aviso no `doctor` / `status`. Valores em falta usam o mesmo significado que no template (omissões seguras).

### Exemplo: repositório legado (COBOL / JCL / copybooks / VB6 / SQL)

Para **scan** e **spec** orientarem o agente sem assumir Node/Java, use `scan_focus_globs` / `scan_ignore_globs` alinhados ao layout real (nomes `cpy` vs `copy` variam). Opcionalmente reforce secções da SPEC com `spec_required_sections`, por exemplo:

- `"## Contratos de dados"`
- `"## Fluxos batch"`
- `"## Integrações desktop-DB"`

Guia completo de análise e verificação nestes repos: [`oxe/workflows/references/legacy-brownfield.md`](../workflows/references/legacy-brownfield.md) (no pacote npm; após `npx oxe-cc`, cópia em `.oxe/workflows/references/`).

**Layout opcional da pasta `docs/`** (índice por intenção, técnico/negócio, glossário, comparativos): [`DOCS_BROWNFIELD_LAYOUT.md`](DOCS_BROWNFIELD_LAYOUT.md).

**Autoria de workflows:** ver [`WORKFLOW_AUTHORING.md`](WORKFLOW_AUTHORING.md) (mantenedores).
