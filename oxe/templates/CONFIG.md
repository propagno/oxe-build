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
| `checkpoint_related_tests` | bool \| object | Opcional (OXB-172). `true` ou `{ command, run_command, max_files, timeout_ms }`. Antes do checkpoint ficar valendo, roda na árvore do próprio commit os testes que importam os arquivos de código que **a tarefa** mudou. Padrão: `npx vitest related --run {files}`, até 40 arquivos e 10 min. Vermelho desfaz o commit. Teste no escopo da tarefa: `checkpoint_failed` `related_tests`, e o próximo execute roda esse teste no verify dela (`run_command`, padrão `npx vitest run {files}`). Teste fora do escopo: `scope_insufficient`, com o teste nomeado; a tarefa espera uma edição do plano ou um CR, e `plan reopen` limpa a marca. |
| `verify.phase_suites` | bool \| object | Opcional (OxeSpace 15/11). `true` ou `{ include, guards, run_command, max_files, runner }`. O verify da fase roda, como gate implícito `phase-suites`, as suítes sob `include` (padrão `tests/acceptance/`) que importam um arquivo mudado pela fase ou o citam (um caminho de `readFileSync`), mais os `guards` sempre: as guardas do repo que varrem `src/**`, como a de classes CSS. Comando padrão: `npx vitest run {files}`; até 60 arquivos. Sem a chave, nada muda. e2e/axe: declare um `phase_gate` com `remote-verify`. |
| `checkpoint_dom_hooks` | bool \| `"warn"` | Padrão ligado (OxeSpace 15/11). Check estático, sem rodar e2e: um atributo `data-*` ou `cmdk-*` que o commit **remove** da marcação (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`), que some do produto inteiro e que ainda é lido por um arquivo de e2e ou de teste, desfaz o checkpoint (`checkpoint_failed` `dom_hooks`), com o atributo e os leitores nomeados. `"warn"` só avisa; `false` desliga. Também cobre nomes acessíveis: um `aria-label="…"` removido, ou `aria-label={t('chave')}`, com a forma objeto `{ "mode": "error", "locale": "shared/locales/en/app.json" }`, que resolve a chave no texto. O e2e lê esses nomes por role + nome. |
| `generated_files` | array | Opcional (OxeSpace 15/11). `[{ file, source, test?, generator? }]`, com globs. Um commit que muda um arquivo gerado (`file`) sem mudar nenhuma das fontes dele (`source`) desfaz o checkpoint (`generated_file`): a edição vai na fonte, e depois roda o gerador. Exemplo: `{ "file": "mobile/android/**/strings.xml", "source": "shared/locales/*/mobile.json", "generator": "node scripts/android/generate.mjs", "test": "tests/android-generated.test.ts" }`. |
| `stub_check` | false | object | Opcional (OXB-108). Anti-stub, ligado por padrão. Cada tarefa de código ganha no verify a checagem de **existe** (símbolos do pack definidos) e **substantivo** (sem stub nas linhas acrescentadas: "not implemented", TODO(), função exportada vazia, componente placeholder…). A fase ganha o gate `stub-check` sobre o diff dela. `{ wired: true }` também reprova arquivo novo que nada importa. `entries` (globs de pontos de entrada), `ignore` (globs) e o comentário `oxe-stub-ok` na linha são as exceções. `false` desliga. |
| `lint.test_scope` / `executor.scope_insufficient` | string | Opcional (OXB-171). `lint.test_scope: "error"` torna fatal o aviso "o teste congelado importa/lê X, fora de files". `executor.scope_insufficient: "retry"` desliga a parada na 1ª tentativa quando o teste que falha precisa de um arquivo fora do escopo (o padrão é parar). |
| `lint.registry_pairs` / `lint.registry_pairs_level` | array / string | Opcional (G43). Pares `[{ "registry": "shared/types/ipc.ts", "manifest": "shared/mcp-coverage.ts" }]`: quando uma tarefa tem o registro no escopo e o manifesto não (nem num ancestral), o `plan lint` avisa. `registry_pairs_level: "error"` torna fatal. `lint.registry_detect: true` também acha pares sozinho (a suíte usa constantes dos dois, e o manifesto importa o registro por valor); desligado por padrão, porque o par declarado é a forma confiável. |
| `lint.suite_impact` | string | Opcional (G30). O `plan lint` lista, por tarefa, as suítes existentes que importam um arquivo de `files` e não estão no verify nem no escopo. Isso é aviso. Vira erro quando a tarefa cita uma lista ou constante exportada que a suíte importa pelo nome. `"warn"` deixa tudo como aviso; `"off"` desliga a regra. |
| `lint.precheck` | boolean | Opcional (G36 parte 2). Padrão `true`: quando o plano tem testes congelados novos ou alterados em tarefas pendentes, o `oxe-cc plan lint` roda cada teste local contra o esqueleto planejado (`plan skeleton`) numa worktree temporária e grava o hash LF aprovado em `precheck-cache.json` (ao lado do `PLAN.json`) para não repetir sem mudança. Entradas com `remote-verify` são puladas no modo padrão com aviso (rode `plan lint --precheck-tests` para validar na CI, ignorando o cache). `false` desliga o precheck padrão no projeto; `--no-precheck` desliga numa execução avulsa, e `--precheck-timeout <s>` ajusta o teto por execução. |
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
| `prd` | object | Opcional. `{ "required": true }` torna o `.oxe/PRD.md` obrigatório no `plan lint`, e a rastreabilidade história ↔ critério vira erro (o padrão é aviso, e só quando o PRD existe). |
| `rfc` | object \| false | Opcional. `{ "required": "risk" }`: fase com critério P0/P1 precisa de RFC aceito antes do plano (erro); `"always"`: toda fase; `"never"` ou `false`: desliga. Padrão: aviso nas fases de risco. |
| `adr` | object \| false | Opcional. Pasta dos ADRs publicados do registro de decisões: `{ "dir": "docs/adr" }` (padrão). `false` desliga. |
| `docs_publish` | object \| false | Opcional. Pasta versionada para PRD, RFCs, ADRs e SYSTEM-DESIGN (`{ "dir": "docs" }`). O `oxe-cc docs publish` usa `docs/` sem a chave. Com a chave configurada, o close da fase também publica e inclui os documentos no commit dela, exceto num branch com PR aberto. `false` desliga. |
| `alm` | object | Opcional. ALM do projeto (Jira ou Azure DevOps); sem ele, o fluxo segue igual. Ver a seção abaixo. |
| `delivery` | string | object | Opcional. `"pr"` ou `{ "mode": "pr", "deploy_env": "staging" }`: depois do verify verde, o próximo passo guia a entrega (`/oxe-ship`: PR → CI/merge → deploy anexado → close). Sem ela, a fase fecha com o commit local do close, como antes. |
| `verify` | object | Opcional. `verify.remote` roda os checks pesados no CI do repositório (ver a seção abaixo); `verify.where` força onde roda cada check, critério ou tarefa (`{ "A7": "remote", "gate-lint": "local" }`). |

## ALM (`alm`): Jira ou Azure DevOps

As credenciais nunca ficam no arquivo: o bloco diz o **nome** da variável de ambiente.

```json
"alm": {
  "provider": "jira",
  "program": "152code",
  "jira": { "project": "OXE" },
  "epic": "OXE-4",
  "fix_version": { "F1": "1.5.2", "F3": "1.5.3" },
  "labels": ["area-oxecode"],
  "states": { "in_progress": "Em andamento", "in_review": "Em revisão", "queued": "Na fila", "merged": "Na main", "released": "Lançado" },
  "track": ["in_progress"],
  "adopt_prefixes": ["CODE", "VIS", "BRD"]
}
```

| Chave | O que faz |
|---|---|
| `provider` | `jira`, `azure-devops` ou `none`. |
| `transport` | `rest` (padrão): o `oxe-cc` fala com a API, e o token fica na variável de ambiente. `mcp`: sem token. O `oxe-cc` põe as escritas na fila `.oxe/program/alm-mcp-queue.json`, e o agente as executa com as ferramentas MCP do Jira ou do Azure DevOps ligadas à sessão (`oxe-cc alm queue` e `alm ack`). A fila só anda com um agente na sessão. Ver `oxe/workflows/references/product-docs-alm.md`. |
| `jira` | `project` (chave), `site_env` / `email_env` / `token_env` (padrão `JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`), `types` (`{ "epic": "Epic", "story": "Story", "task": "Task", "bug": "Task" }`), `bug_label` (padrão `bug`). |
| `azure_devops` | `project`, `org_env` / `token_env` (padrão `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_EXT_PAT`), `types` (`User Story`, `Task`, `Bug`), `area_path`, `iteration_path`. |
| `program` | Entra no rótulo de idempotência `ref-<programa>-<ref>` (ex.: `ref-152code-F2-T5`). Padrão: o nome da pasta do projeto. |
| `epic` | Pai das histórias e tarefas: uma chave ou uma por fase (`{ "F1": "OXE-4" }`). Sem ela, o `alm push` cria o épico a partir do título do PRD. |
| `fix_version` | Versão-alvo dos itens: uma, ou uma por fase. |
| `labels` | Somados aos rótulos da própria tarefa (`labels` no PLAN.json), nunca no lugar deles. |
| `states` | A coluna do quadro de cada etapa canônica, pelo **nome**; o id da transição é resolvido na hora. Etapas, em ordem: `intake`, `grooming`, `refinement`, `ready`, `in_progress`, `review`, `verified`, `queued`, `integrated`, `staging`, `accepted`, `released`. Uma etapa sem coluna é pulada. Os nomes antigos `todo`, `in_review` e `merged` continuam aceitos. Donos e provas: o OXE move `grooming` (grill), `refinement` e `ready` (refine) e `in_progress` (tarefa iniciada); `review` a `released` costumam ser da CI (PR, pr:ready, trem, main, homologação, release). |
| `wip` | Limite de cards por etapa (`{ "in_progress": 5 }`), só como aviso no `oxe-cc alm metrics`. |
| `track` | Etapas que o OXE move (padrão: todas). Um repositório que já move PR, trem e tag por conta própria (ex.: um workflow `jira-sync`) deixa só `["in_progress"]`: o OXE cria, liga, comenta e move A fazer → Em andamento, e o resto fica com o workflow. Em qualquer modo, o OXE lê o estado real antes de mover e nunca recua um item que outra ferramenta já avançou. |
| `release_version` | `true` lança a versão no deploy. Desligado quando uma pipeline de tag já faz isso. |
| `adopt_prefixes` | Códigos antigos (`CODE-8` no título da tarefa, ou `refs: ["CODE-8"]`): o item com o rótulo `ref-CODE-8` é adotado em vez de criar outro. |
| `ledger_guard` / `search_settle_ms` | A busca do Jira por rótulo pode levar minutos para ver um item novo, e o registro local (`.oxe/program/alm-links.ndjson`) é a defesa principal contra duplicata. Com `ledger_guard: true`, um push sem esse registro se recusa a criar. `alm push --rebuild-ledger` refaz o registro pela busca, sem criar nada; `--first-push` vale para o primeiro push de um programa. `search_settle_ms` é a espera antes da segunda busca: 5 s, ou 60 s com o guard. |
| `dry_run` / `auto` | `dry_run: true` só mostra; `auto: false` desliga a sincronização automática nos pontos do ciclo. |
| `ref_label` | `"program"` (padrão): o rótulo do intake é `ref-<programa>-<ref>`, porque refs como F2-T5 se repetem entre programas. `"plain"`: `ref-<ref>`, para ids de intake únicos por si (ref-TOKENS-1-CAMADA, a convenção do quadro). |
| `require_apply` | `true`: gravar exige `--apply` explícito. Sem ele, todo comando que escreve (`push`, `sync`, `move`, `comment`, `defect`, `intake`, `version ensure`, `refine --claim`, `refine apply`) roda como simulação. A sincronização automática também vira simulação. Em qualquer modo, `--dry-run` nunca grava: o transporte recusa POST, PUT, PATCH e DELETE. |
| (sessão leitora) | Uma sessão que não é o escritor (`alm.writer` diferente de `OXE_ALM_WRITER`) não grava no card. O quick dela registra o comentário e o movimento em `.oxe/alm/pending.ndjson`. O escritor lista com `oxe-cc alm pending` e drena com `oxe-cc alm pending apply` (com `--apply` sob `require_apply`): os comentários vão em ordem, o movimento é só para frente, e depois roda um `sync`. Um pedido aplicado nunca é reaplicado. |
| (início da tarefa) | O `runtime execute` sincroniza quando uma tarefa começa (`TaskStarted`), e não só quando o execute termina, então o card vai para `in_progress` na hora. Numa sessão leitora, isso fica para o `sync` do escritor. |
| `docs` | `{ "repo": "https://github.com/<org>/<repo>", "branch": "main", "dir": "docs" }`: a base dos links do comentário "Documentos (OXE)" que o `oxe-cc trace publish` mantém em cada card (PRD, ADRs). |
| `stories_source` | `"prd"` (padrão, projeto novo: o push cria as histórias do PRD) ou `"alm"` (os cards já existem): o push só liga a história do PRD ao card que a linha dela cita (ex.: `OXE-48` na linha da US) e nunca cria história nem épico. Uma história sem card fica listada como pendente. Em qualquer modo, um item que cita a chave do seu card (`(OXE-20)` no título da tarefa) é adotado por ela, conferido por GET. |
| `ready_gate` | `true` (rótulo `spec-v1`) ou o nome de outro rótulo: Definition of Ready. Um item sem o rótulo não vai para "Em andamento". O sync deixa a mudança pendente e diz por quê; ela acontece quando o card for refinado (`oxe-cc alm refine`). |
| `writer` | Um único escritor por programa. Com `"writer": "coord"`, só a sessão que exporta `OXE_ALM_WRITER=coord` cria e move itens; as demais leem (ensaios, status, fila) e comentam (`oxe-cc alm comment <ref|chave> --text "…"`). Na mesma máquina, uma trava local (`.oxe/program/alm-write.lock`) recusa dois escritores ao mesmo tempo. |

Uma falha do ALM nunca derruba o comando do OXE: a escrita é tentada 3 vezes com backoff, é relida depois de feita, e, se não passar, fica pendente para o próximo `oxe-cc alm sync`.

## Verificação remota (`verify.remote`)

Os checks pesados (e2e, build empacotado, Android) rodam no CI do repositório no GitHub; vitest, tsc e lint ficam locais. Não há token novo: usa o `gh` já autenticado.

```json
"verify": {
  "remote": { "provider": "github", "workflow": "ci.yml", "wait_minutes": 60, "required": false, "protected": ["release/*"] },
  "where": { "A7": "remote" }
}
```

- **Onde roda cada check:** o `where` explícito vence (no check, em `acceptance_tests[]` ou `tasks[]` do PLAN.json, ou em `verify.where`). Sem ele, um comando pesado (playwright, cypress, detox, gradlew, electron-builder, smoke…) vai para o remoto. `remote_job` liga o check ao nome do job no workflow; sem ele, vale o id do check.
- **Execução:**
  1. Empurra o branch da fase, só se ele já tem upstream (sem upstream: `oxe-cc runtime verify --push`).
  2. Reaproveita um run já verde no mesmo commit. Se não houver, dispara `gh workflow run <workflow> --ref <branch>` **sem inputs** e acha o run pelo commit e pelo evento `workflow_dispatch`.
  3. Espera até `wait_minutes` e lê o resultado por job. O run vira evidência de CI da fase.
- **Travas:**
  - nunca empurra para main/master nem para um branch protegido (`protected` aceita globs, e a proteção do GitHub também conta);
  - nunca usa `--force`: um push recusado deixa o check "não verificado";
  - um input de publish, release ou deploy em `inputs` é recusado.
- **Falhas:**
  - Um job vermelho reprova o critério, com o link do run no VERIFY.
  - GitHub fora do ar, `gh` ausente ou tempo esgotado deixam o check como "não verificado", e a fase segue com o local. Com `required: true`, a fase só fecha com o remoto verde.
  - `--no-remote` roda tudo local.
- **Espera leve e retomável:** sem `gh run watch` de longa duração. São consultas curtas (`poll_seconds`, padrão 30) com o estado em `.oxe/program/remote-verify.json`; o verify seguinte retoma o mesmo run. Com `detach: true`, o verify dispara o run e retorna na hora.
- **Trace da CI:** quando um job falha, os artefatos (`artifacts`, padrão `*trace*`, `*playwright-report*`, `*test-results*`, `*screenshot*`; `[]` desliga) são baixados para `.oxe/evidence/remote/`. Com `where: "both"`, o check roda aqui e na CI; vermelho só na CI vira `ci_only`, e a leitura certa é o trace da CI, não uma reprodução local.
- **`verify.min_free_mb`:** com menos memória livre que isso, nenhum check pesado roda na máquina. Ele vai para a CI quando há `verify.remote`; sem ela, fica como "não verificado (memória baixa)" e o verify termina parcial.

## Retomada automática do execute (`autoresume`)

```json
"autoresume": { "enabled": true, "min_free_mb": 2560, "wait_memory_minutes": 30, "max_restarts": 3, "window_hours": 6 }
```

- Todo `runtime execute` grava um lease (`EXECUTE-LEASE.json`, ao lado do `ACTIVE-RUN.json`) com o pid, os argumentos sem segredo (`--api-key` nunca entra) e o estado. Um fim limpo fecha o lease (`finished`, `paused`, `blocked`, `failed`); Ctrl+C fecha como `stopped`. Um lease ainda `running` com o pid morto quer dizer reinício ou kill.
- `oxe-cc runtime execute --supervise` roda o execute como filho e o relança quando ele cai no meio do run, que é o kill por memória com a máquina ligada.
- `oxe-cc runtime autoresume install` põe `autoresume run` no logon. No Windows é um `.cmd` na pasta Inicializar do usuário, sem admin, um por projeto. Nos outros sistemas, imprime a linha `@reboot` para o crontab. `autoresume status` mostra o estado, a decisão e a próxima tarefa; `uninstall` remove.
- A retomada usa os mesmos argumentos, e o execute pula o que está done, então começa na próxima tarefa não concluída.
- **Nunca retoma** nestes casos:
  - run pausado (`runtime pause`, pausa de cota ou de ambiente, checkpoint esperando aprovação);
  - lease fechado limpo, inclusive `stopped`;
  - `enabled: false`;
  - mais de `max_restarts` retomadas em `window_hours`, porque isso é um laço de queda;
  - memória abaixo da regra: espera até `wait_memory_minutes` por `min_free_mb` livres e desiste dizendo por quê.
- `min_free_mb` cai para `parallel.min_free_mb`, depois para `OXE_EXECUTOR_MIN_FREE_MB` e, sem nenhum dos dois, fica em 2560 (2,5 GB). Os eventos `AutoResumed` e `AutoResumeSkipped` vão para o `OXE-EVENTS.ndjson`.

## Entrega e CI (`ship`)

```json
"ship": { "train_labels": ["na-fila", "no-batch", "fix-main"] }
```

- `oxe-cc ship status --pr <n> | --card <KEY> | --repo` mostra o veredito de CI de um PR (de fase ou não), dos PRs que citam o card no título, na descrição ou no branch, ou de todos os PRs abertos, com os rótulos do trem (`train_labels`). Os vereditos: verde, rodando, falha conhecida (com o `gh run rerun <id> --failed`), VERMELHO (falha nova), sem leitura.
- `--comment --apply` põe o veredito no PR, num comentário "CI (OXE)" atualizado no lugar. É lá que o trem, a CI e as pessoas leem; um arquivo local nunca chega a eles.
- **Falhas conhecidas do repositório:** `oxe-cc ship known-failure add "<teste>" --item <KEY> --pr <n do conserto>` grava em `<git common dir>/oxe/`. Todas as worktrees do clone veem a mesma lista, e o arquivo fica fora de qualquer checkout e de qualquer commit. A falha expira quando o PR do conserto é mergeado: o conserto entrou na main, e um vermelho depois disso é regressão. `ship known-failure prune` remove as expiradas. As entradas antigas de uma worktree (`.oxe/program`) continuam legíveis como `wt:KF-n`.

## Origem dos commits (`origin`)

Regra: nada chega a um PR sem vir do `oxe-cc runtime execute` (trailer `OXE-Task`, mais `OXE-Run`) ou de um quick registrado (`oxe-cc quick <KEY> "<objetivo>"`, trailers `OXE-Quick` e, com ALM, `OXE-Card`). As isenções são só as declaradas aqui.

```json
"origin": {
  "exempt": { "merges": true, "authors": ["github-actions[bot]"], "paths": [".oxe/", "docs/releases/"] },
  "commit_msg": "require",
  "base": "origin/main"
}
```

| Chave | Efeito |
|---|---|
| `exempt.merges` | commits de merge passam (padrão `true`) |
| `exempt.authors` | autores que passam sem trailer: o bot do trem de merge, o bot de release (padrão: nenhum) |
| `exempt.paths` | um commit que só toca esses caminhos passa (padrão `[".oxe/"]`; terminado em `/` é pasta) |
| `commit_msg` | o hook `commit-msg` do `oxe-cc guards install`: `require` (padrão) recusa commit sem origem; `append` só avisa; `off` desliga. Com um quick aberto, o hook acrescenta os trailers dele |
| `exempt.authored` | um autor isento só nos caminhos dele: `[{ "author": "github-actions[bot]", "paths": ["<pasta das goldens>/"] }]`. É o bot que regrava as goldens, e o mesmo bot em outro caminho é recusado |
| `require_card` | o commit de quick precisa de `OXE-Card` (padrão: `true` quando há ALM) |
| `base` | a base do `oxe-cc ship check-origin` sem argumento (padrão `origin/main`) |
| `since` | o corte: um commit (SHA) ou uma data. É histórico, e não é cobrado, o que já está no commit de corte, o que tem data anterior à dele ou, com uma data, o que é anterior a ela |
| `exempt.commits` | isenção pontual: `[{ "sha": "<40 hex>", "reason": "…", "by": "<papel>" }]`. Toda isenção usada aparece no relatório; uma entrada sem SHA completo, reason ou by é recusada e o check-origin sai com 1. O caminho normal continua sendo o trailer |

**Repositório que não versiona `.oxe/`:** ponha o bloco `origin` num `oxe.config.json` versionado na raiz. Ele vence o `.oxe/config.json`, e o pr:ready, a CI e as worktrees leem o mesmo arquivo. `--config <arquivo>` aponta outro arquivo. O `check-origin` roda sem `.oxe/`: só precisa do git e dessa config.

Conferência: `oxe-cc ship check-origin [<#PR>|<a..b>] [--json]` sai com 1 e lista cada commit sem origem. O commit do quick é feito por `oxe-cc quick commit -m "<mensagem>" <arquivos…>`, que acrescenta os trailers.

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
