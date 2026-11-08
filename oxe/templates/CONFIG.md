# `.oxe/config.json` — referência

Copie `oxe/templates/config.template.json` para **`.oxe/config.json`** no seu projeto (ou deixe o `oxe-cc` criar na primeira instalação).

## Chaves principais

| Chave | Tipo | Significado |
|-------|------|-------------|
| `profile` | string | Profile de execução: `balanced` (padrão) \| `strict` \| `fast` \| `legacy`. Expande automaticamente outras keys — keys explícitas prevalecem. Ver tabela abaixo. |
| `discuss_before_plan` | boolean | Se `true`, o fluxo recomenda **`oxe:discuss`** entre spec e plan. |
| `verification_depth` | string | Profundidade da verificação: `standard` (padrão) \| `thorough` (ativa Camada 5 — validate-gaps automático) \| `quick` (skip camadas 3–4 e UAT). |
| `plan_confidence_threshold` | number | Limiar mínimo de confiança para o `execute` aceitar um `PLAN.md`. Padrão canónico: `90`, com gate estrito (`Confiança` precisa ser **maior que** o limiar). Valores menores que 90 não reduzem esse gate. |
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
| `task_gates` | array | Opcional (OXB-048). Gates leves no verify de cada tarefa que escreve código: `{ "id": "tsc", "command": "npx tsc --noEmit --incremental" }`, `{ "id": "related", "command": "npx vitest related --run {files}", "applies_to": "\\.tsx?$" }`. O PLAN.json `task_gates` vence no mesmo id. |
| `task_suite_command` | string | Modelo com `{suites}` para rodar as `affected_suites` da tarefa (ex.: `npx vitest run {suites}`). |
| `suite_rules` | array | `[{ "paths": "^electron/main/db/migrations/", "suite": "tests/integration/migrations.test.ts", "reason": "…" }]`: o `plan lint` avisa quando uma tarefa toca `paths` sem a suíte no verify nem em `affected_suites`. |
| `verify_timeout_ms` | number | Opcional (OXB-072). Limite por check no `runtime verify`; padrão 600000 (10 min). Um check que passa do limite sai como `error` com `timed_out`, não como FAIL. Um teste de aceite pode ter o próprio `timeout_ms` no PLAN.json. |
| `executor.scratch_ignore` | string[] \| false | Opcional (OXB-159). Arquivos de rascunho que uma tentativa deixa no repositório e que não contam como violação de escopo. São removidos quando a tentativa os criou (novos e não versionados). Padrão: `*.log` e `*.tsbuildinfo` na raiz (um glob sem `/` vale só para a raiz; `**` atravessa pastas). `false` desliga. Cada tarefa também tem `.oxe/tmp/<tarefa>/`, citada no prompt, que o git ignora e que é apagada quando a tarefa passa. |
| `worktree.copy_local` | string[] | Opcional (OXB-163). Arquivos locais da máquina, fora do git (ex.: `mobile/android/local.properties` com `sdk.dir`, `.env.local`), que uma worktree nova precisa para compilar. São copiados pelo `program init --from`, pela worktree temporária do `promote` e pelas worktrees do `--parallel-mutating`. Por padrão nada é copiado, porque um arquivo local pode ter segredos. Um arquivo versionado ou que já existe no destino nunca é sobrescrito. Aceita `*` e `**`. |
| `executor.max_run_ms` | number | Opcional (OXB-165). Limite de duração do `runtime execute` inteiro, verificado entre ondas. Padrão: sem limite (a guarda de progresso parado já cobre travamentos). `--max-run-ms` tem precedência. |
| `checkpoint_check` | string | Opcional (OXB-170). Comando do projeto (ex.: `npm run typecheck`) que roda na árvore do **próprio** commit de checkpoint: uma worktree temporária com junction do node_modules, desfeito antes da remoção. Vermelho desfaz o commit, e a tarefa fica `checkpoint_failed` (não done). `checkpoint_check_timeout_ms` (padrão 900000). Desligado por padrão, porque custa um typecheck por tarefa. |
| `lint.test_scope` / `executor.scope_insufficient` | string | Opcional (OXB-171). `lint.test_scope: "error"` torna fatal o aviso "o teste congelado importa/lê X, fora de files". `executor.scope_insufficient: "retry"` desliga a parada na 1ª tentativa quando o teste que falha precisa de um arquivo fora do escopo (o padrão é parar). |
| `deps_optional_ignore` | array | Opcional (OXB-074). Nomes de dependências opcionais que podem faltar em node_modules sem aviso (ex.: `["cpu-features", "buildcheck", "nan"]`, os aceleradores nativos do ssh2). Um opcional ausente é só aviso; um não opcional ausente bloqueia. |
| `native_check` | string | Opcional (OXB-039). Comando do projeto que valida os módulos nativos (ex.: `node scripts/run-native-verification.mjs`). Roda no `doctor --project` e uma vez no preflight de cada execute (não no `plan lint`); se falhar, bloqueia com as últimas linhas da saída. `native_check_timeout_ms` (padrão 300000). |
| `parallel` | object | Opcional (OXB-050), para `runtime execute --parallel-mutating`: `{ "max": 2, "min_free_mb": 1536 }`. São os agentes ao mesmo tempo e a memória livre mínima para iniciar mais um (padrão: `OXE_EXECUTOR_MIN_FREE_MB`). |
| `deps_strategy` | string | Para as worktrees do modo paralelo: `link` (junction para o node_modules de `deps_link_from`, removida antes de todo dispose), `copy-from`, `ci` (com a checagem de presença da OXB-039) ou `none`. Obrigatório no modo paralelo. No `link`, uma tarefa que muda package.json/lockfile ou instala no verify é recusada. |
| `deps_link_from` | string | A checkout cujo node_modules validado as worktrees usam (ex.: `"."`, a checkout do programa). Explícito, nunca inferido. |
| `deps_protected` | array | Caminhos que nunca podem ser `deps_link_from` (ex.: a checkout principal da pessoa). |
| `parked_tests` | array | Opcional (OXB-080). Globs de testes congelados que o planner commita adiantado para fases seguintes. No dossiê eles saem como "estacionados", não como drift. Padrão: `["tests/acceptance/**"]`. |
| `spec_ref` | string | Opcional (OXB-032). Caminho versionado da SPEC, relativo à raiz (ex.: `docs/roadmap/oxe/SPEC.md`). O runtime lê e emenda esse arquivo em vez de `.oxe/SPEC.md`, e o `doctor` avisa se uma cópia em `.oxe/` divergir. |
| `roadmap_ref` | string | Opcional (OXB-032). O mesmo para o ROADMAP (`program init`, `program phase add/edit`). |
| `oxe_stale_days` | number | Opcional (OXB-043). Dias sem atividade para o `.oxe/` ser marcado stale no `status` e no `doctor`. Padrão: 14. |
| `program.standing_acceptance` | array | Opcional (OXB-091). Critérios permanentes (ex.: `["A70"]`, um gate de UI): valem em **todo** close de fase por sign-off daquela fase com evidência (`runtime signoff --phase Fn --criteria A70 --evidence …`), nunca são "de outra fase" nem "sem tarefa" no lint. `spec add criterion … --standing` os registra aqui. |
| `program` | object | Opcional. `program.export_dir`: pasta versionada (fora de `.oxe/`) onde `oxe-cc program export` grava SPEC.md, ROADMAP.md, PROGRAM.json e changes.ndjson. Com ela definida, `spec amend`/`spec add`/`program phase add` atualizam o export, e o `doctor` deixa de avisar sobre `.oxe/` no .gitignore. |
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
