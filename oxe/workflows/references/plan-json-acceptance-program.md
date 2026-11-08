# OXE — Referência: PLAN.json canônico, aceite congelado e programa por fases

> Lida pelo `/oxe-plan` (`oxe/workflows/plan.md`). Obrigatória quando o projeto usa o runtime.

**`PLAN.json` canônico (1.19):** gravar também `PLAN.json` no mesmo diretório do `PLAN.md`, seguindo `oxe/schemas/plan.schema.json`. O runtime lê o `PLAN.json` (o `PLAN.md` é a leitura humana e o parser markdown vira fallback com aviso). As duas versões devem descrever as mesmas tarefas:

```json
{
  "schema_version": 1,
  "phase": "F1",
  "tasks": [
    { "id": "T1", "title": "…", "wave": 1, "depends_on": [], "files": ["src/a.js"],
      "verify": { "commands": ["node --test test/a.test.js"] }, "acceptance": ["A1"], "complexity": "S" }
  ]
}
```

**Testes de aceite do plano (congelados):** para cada A* com comportamento verificável, o `/oxe-plan` **escreve o teste de aceite agora, antes da execução** — em arquivo próprio fora do escopo das tarefas (ex.: `test/acceptance/a4.test.js`) — e o declara em `PLAN.json`:

```json
"acceptance_tests": [
  { "criterion": "A4", "files": ["test/acceptance/a4.test.js"], "command": "node --test test/acceptance/a4.test.js" }
]
```

O teste fixa a interface exigida em código (nomes, assinatura, formato de retorno, erros) — é a SPEC executável. O runtime congela o hash no compile; o executor recebe o teste no prompt, não pode escrevê-lo (`tool denied`) e o verify reprova se ele mudar (`acceptance_tampered`) ou faltar. Motivo: quando o mesmo agente implementa e escreve a prova, uma leitura errada do requisito é "provada" pelo próprio teste (falso verde do e2e real da 1.19). O executor pode e deve escrever testes próprios adicionais em outros arquivos. `acceptance_tests_required: true` no `config.json` torna obrigatório um teste de aceite por A* da fase.

Antes de declarar o plano pronto, rodar **`oxe-cc plan lint`** e corrigir todos os erros: ids únicos, dependências existentes e em onda anterior, escopos disjuntos na mesma onda, A* existentes na SPEC, tarefa mutável com entrada no IMPLEMENTATION-PACK e `plan_max_tasks_per_wave`.

**Programa por fases:** se existir `.oxe/program/PROGRAM.json` com fase ativa, planejar **somente essa fase**: os A* do plano devem ser exatamente os da fase (o lint reprova A* de outra fase e A* da fase sem tarefa) e `PLAN.json` declara `"phase": "<id>"`. Ler `.oxe/program/interfaces/*.json` das fases fechadas: tarefas que consomem esses módulos devem importá-los pelos nomes/assinaturas registrados, não reimplementá-los. No IMPLEMENTATION-PACK, todo símbolo público de módulo (`kind` function/class/const/type) vira contrato verificado: o verify reprova com `exports_missing` se o arquivo não o exportar.

## Prova executada e dossiê vivo (1.20)

- **Prova executada:** cada `acceptance_tests[]` pode declarar `proves: ["nome do teste", "arquivo › nome"]`. O verify só aceita o critério se esses testes **aparecem como aprovados na saída do runner**; senão `proof_not_executed`, mesmo com exit 0. Use um reporter que liste os nomes: `vitest --reporter=verbose`, `jest --verbose`, `node --test` (TAP) ou `pytest -v`.
- **Dossiê da fase:** `oxe-cc runtime dossier` projeta `.oxe/dossier/<fase>/` com:
  - `context.md`: objetivo, critérios, decisões, riscos e fora de escopo;
  - `architecture.md`: o contrato × o diff real;
  - `techspec.md`: critério → teste congelado → prova → resultado;
  - `plan.md`: diário por tarefa, com tentativas, turnos, custo e testes, mais os adiados;
  - `decisions.md` e `notes.md`.

  O texto escrito fora dos marcadores `<!-- oxe:dossier:* -->` é preservado.
- **Gate do `program close`:** dossiê sem drift (arquivo fora do contrato, aceite com hash diferente, prova não executada), handoff **"O que a próxima fase deve saber"** preenchido em `plan.md` e **sign-off** de todo critério manual/UAT:

  ```bash
  oxe-cc runtime signoff --phase F1 --criteria A8 --by <quem> --message "<nota>" --evidence <caminho|url>
  ```
- O `STATE.md` passa a ser projeção (fase, programa, run, próximo passo, bloqueios), atualizada por `program start/close` e `verify`.

## Retomada robusta (1.20c)

- **Gate por tarefa:** `"gate": {"kind": "human"|"external", "reason": "..."}` e `"blocked_by": ["repo#item"]` no PLAN.json. A tarefa espera um gate (`oxe-cc runtime gates`), e as demais seguem.
- **Retry informado e régua suspeita:** a nova tentativa recebe o comando, o motivo e a saída do verify falho. Duas falhas idênticas param a tarefa como `verify_suspect`: revise o comando (`plan lint --dry-verify`) antes de reexecutar.
- **Checkpoint e rollback:** `runtime execute --checkpoint-commits` faz um commit local por tarefa concluída, só do escopo dela. `runtime rollback --task Tn` mostra o que voltaria ao último checkpoint, e `--yes` aplica.
- **Execução interrompida** (OOM, terminal fechado): `runtime recover` reconhece o journal sem dono e o marca `interrupted`, que é retomável.

## Gates do projeto e regras do repositório (1.21)

Num repositório com suíte própria (typecheck, lint, testes de governança como design-lint, allowlists, catálogos, cobertura), o phase gate **é a suíte do repo**. Os testes da feature verdes não bastam.

- **`phase_gates`** no PLAN.json (ou em `.oxe/config.json`; o plano vence no mesmo id):
  ```json
  "phase_gates": [
    { "id": "typecheck", "command": "npm run typecheck", "timeout_ms": 900000 },
    { "id": "governance", "command": "npx vitest run tests/design-lint.test.ts tests/integration/fs-allowlist.test.ts" },
    { "id": "ci", "kind": "ci", "when": "program_close", "repo": "owner/repo" }
  ]
  ```
  - Rodam **uma vez** no `runtime verify` da fase, não por tarefa, como checks `gate-<id>`. Um gate vermelho reprova o verify.
  - O `runner` do gate, ou o `phase_gates_runner` do config, envolve o comando, por exemplo num heavy-lock: `"node {env:TEMP}/lock.mjs -- {command}"`.
  - **Gate vermelho vira CR `constraint` automático** (`by: phase_gate:<id>`), com o trecho da saída como evidência. Ele fecha sozinho quando o mesmo gate fica verde. Não abra um CR manual para isso nem duplique.
  - `when: program_close` roda no `runtime program close`. O close também exige que todos os gates `phase_verify` estejam verdes no último verify.
  - **CI como gate:** `oxe-cc runtime ci --attach <run-id|url> [--head <sha>]` anexa o run à fase. O gate `kind: ci` só fica verde com `success` nessa head (`gh run view`).
  - `--no-gates` pula os gates no verify ou no close. Use só para diagnóstico; nunca para fechar uma fase.
- **O `plan lint` avisa** quando o repositório tem scripts `typecheck`/`lint` ou testes de governança e o plano não declara `phase_gates`.
- **Regras do repositório no prompt do executor:** cada nó recebe `## Regras do repositório`, com:
  - as `policy_rules` do config;
  - as diretivas (never/always/must/nunca/sempre…) de `AGENTS.md`/`CLAUDE.md`;
  - os títulos dos testes de governança.

  `config.repo_rules.tests` acrescenta arquivos, `repo_rules.sources` acrescenta outros markdowns, e `repo_rules.disabled: true` desliga.

## Execução econômica (1.21)

- **Orçamento por run:** `runtime execute --budget-turns N [--budget-usd X]`, ou `"budget": {"turns": 20, "usd": 5, "max_retries": 1}` no PLAN.json. As flags vencem.
  - O ledger `.oxe/runs/<run>.budget.json` soma o uso entre execuções da mesma run.
  - O scheduler confere o orçamento **antes de cada tentativa** e limita a próxima aos turnos que restam, então a run nunca passa do teto de turnos. Ao esgotar, emite `BudgetExhausted` e bloqueia a tarefa.
  - Para continuar, peça OK ao dono do teto. Não faça um reset silencioso: `--budget-reset` só com aprovação.
  - `--max-retries N` substitui o padrão (2) por tarefa.
- **Turn limit não descarta trabalho:** quando a tentativa esgota os turnos depois de escrever no escopo, o runtime roda o verify da tarefa antes de classificá-la. Se o verify passar, a tarefa conclui (`completed_by: verify_after_turn_limit`); se reprovar, entra no retry informado. No último turno, o executor é instruído a fechar e reportar.
- **`done` persistido:** cada tarefa concluída ganha `done`, `done_at` e `done_commit` no PLAN.json, e o próximo compile a pula.
  - Uma tarefa pendente com checkpoint (`OXE-Task: Tn`) e verify já verde é **erro** no `plan lint --dry-verify`. A correção é `oxe-cc plan done Tn`.
- **Convenção de commit do checkpoint:** `commit_convention` no `.oxe/config.json`:
  - os campos são `template`, `type`, `scope`, `pattern`, `trailers` e `require_task_message`;
  - a mensagem própria de cada tarefa vai em `"commit"` no PLAN.json, escrita pelo planner no idioma e na convenção do projeto;
  - todo checkpoint leva o trailer `OXE-Task: Tn`;
  - o `plan lint` valida o `pattern`.
- **Pack:** o `plan lint` e o preflight usam o mesmo validador. `symbols` só é exigido quando a tarefa escreve um arquivo de código; tarefas de CSS, config ou docs não precisam declarar symbols.

## Ambiente e incerteza (1.21)

- **`oxe-cc doctor --project`** compara a máquina com o que o projeto pede. O preflight do execute faz a mesma checagem e bloqueia com `project_env:<motivo>`. Entram:
  - `engines` (node/npm), `.nvmrc`/`.node-version` e `packageManager` com lockfile;
  - o **`engines` das dependências diretas no `package-lock.json`**;
  - a memória livre.

  Com `"project_env_check": "warn"` no config, a divergência é só reportada; isso é para quando ela foi aceita de propósito, com dono. Com `false`, a checagem é pulada. A evidência do verify registra o toolchain usado.
- **Spike:** quando a confiança do plano está abaixo do limiar por causa de uma pergunta técnica em aberto, planeje uma tarefa `"kind": "spike"` com `"question"`:
  - o spike escreve só `.oxe/spikes/<Tn>.md`, com as linhas `Pergunta:`, `Resposta:` (ou `Decisão:`) e `Evidência:`;
  - o verify dele é o próprio relatório;
  - no pack, declare-o com `mode: docs_only`;
  - ao concluir, a resposta vira a decisão `D-SPIKE-Tn` em `decisions.ndjson` e aparece no dossiê;
  - replaneje com a evidência antes de executar as tarefas de código.

## Coesão entre fases e maturidade medida (1.21)

- **Handoff no contexto:** o executor de cada fase recebe `## O que as fases anteriores deixaram`, com o handoff ("O que a próxima fase deve saber") do dossiê de cada fase fechada. Escreva nele as decisões, os limites e as armadilhas que a próxima fase não pode redescobrir. Os gates do projeto valem em todas as fases.
- **Scorecard:** `oxe-cc runtime scorecard [--json] [--write]` mede, a partir dos registros do próprio runtime:

  | Métrica | Meta |
  |---|---|
  | `first_attempt_rate` (tarefas concluídas na 1ª tentativa) | ≥ 0,80 |
  | `turns_on_finished_work` (turnos pagos depois de concluir) | 0 |
  | `budget_overruns` | 0 |
  | `crs_closed_without_proof` | 0 |
  | `post_green_crs` (CR que a CI, a revisão ou o UAT abriram depois do verify verde) | 0 |

- **Release:** a partir da 1.21.0, o `doctor --release` exige `.oxe/release/scorecard-report.json` com **≥ 2 projetos reais**, cada um com ≥ 10 tarefas e dentro das metas. Gere com `oxe-cc runtime scorecard --dir <projeto> --release-report <oxe-build>/.oxe/release/scorecard-report.json --name <projeto>`.
- **Worktrees:** o `dispose` do `git_worktree` desfaz, sem segui-los, os links que saem do worktree (junction de `node_modules`, links de workspace) antes do `worktree remove --force`. Assim, o diretório real nunca é apagado junto.

## Execução com o plano como fonte (1.21.1)

- **O grafo é projeção:** o `runtime execute` recompila sozinho quando o PLAN.json, o PLAN.md, a SPEC ou o pack mudaram desde o último compile. Tarefas `done` nunca são refeitas.
  - Para refazer uma tarefa, **reabra-a**: um CR `defect`/`spec_gap` (`runtime feedback`) reabre só a tarefa que fecha o critério, ou as que `--tasks T7[,T8]` nomear. As outras impactadas aparecem como "impactadas, não reabertas", e uma tarefa entregue por fora (`external_delivery`, `verify_only`, `blocked_by`) nunca é reaberta. `oxe-cc plan reopen Tn` reabre à mão.
  - Ondas com escopos disjuntos (OXB-050): `runtime execute --parallel-mutating --checkpoint-commits` roda as tarefas mutáveis da onda em paralelo, uma worktree por tarefa (`deps_strategy` no config). Escopos que se sobrepõem nunca rodam juntos. Só os arquivos do escopo entram na checkout, e o verify roda de novo no tree integrado. O padrão continua serial.
  - Gates por tarefa (OXB-048): `task_gates` (PLAN.json ou config) rodam no verify de toda tarefa que escreve código, por exemplo typecheck incremental e `vitest related {files}`. Declare `affected_suites` quando a tarefa pode quebrar uma suíte vizinha (migração → suíte de migrações). Os `phase_gates` continuam rodando uma vez no verify da fase.
  - Branch do programa × main: `oxe-cc runtime sync --from origin/main` (merge local + reverify das tarefas done tocadas pela base) e `oxe-cc runtime promote Tn --base main` (branch por tarefa, cherry-pick -x dos checkpoints e dos testes congelados, `pr:ready`; PR só com `--open-pr`). Nunca copie arquivos inteiros entre branches: vazam hunks de outras tarefas.
  - Emendas e fases novas têm comando (1.21.2, sem editar SPEC/ROADMAP/PROGRAM à mão): `oxe-cc spec amend A<n>` (qualquer fase), `oxe-cc spec add criterion|requirement`, `oxe-cc program phase add --after Fn` (renumera só fases `pending` sem plano/run e recusa o resto), `oxe-cc program phase edit Fn`, `oxe-cc program criterion move A<n> --from Fn --to Fm` e `oxe-cc program export <pasta>`.
  - Uma emenda de critério (`spec_gap`) é `changing` por padrão: todo teste de aceite de versão anterior fica stale. Com `--additive`, a emenda só acrescenta ao critério: os testes anteriores continuam valendo, e só o teste novo leva `"version"` e `"resolves"`.
- **A verificação do critério roda na tarefa que o completa:** o "Como verificar" de um critério com várias tarefas roda só no verify da última delas. Se várias terminam em paralelo, a verificação fica para o verify da fase.
  - Não ponha o teste de aceite do critério no `verify.commands` de uma tarefa intermediária: ele só pode passar quando o critério inteiro estiver pronto. O `plan lint` avisa.
- **Trabalho que chega por outro caminho:**
  - `"blocked_by": ["owner/repo#594"]` trava só a tarefa, sem gate humano. Quando o PR é mergeado, o compile seguinte a destrava sozinho (via `gh`).
  - `"kind": "verify_only"` (ou `external_delivery`) roda só o verify, sem agente e sem custo, e conclui quando o verify passa.
- **Ambiente dos processos filhos:** executor, ferramentas, verify e gates não herdam `OXESPACE_*` nem segredos (`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `CREDENTIAL`, `PRIVATE_KEY`).
  - Para ajustar: `env_scrub` (regex extras) e `env_allow` (nomes) no config.
  - `oxe-cc doctor --project` mostra o que será removido.
- **Modo inplace:** quando uma tarefa falha de vez, a tentativa é guardada em `.oxe/runs/<run>/attempts/<task>-failed/` (patch e arquivos novos) e o escopo dela é restaurado. Arquivos que você já tinha alterado antes do execute não são tocados. Cada tentativa tem seu log em `attempts/<task>-<n>.log`, e `--wave N` roda só a onda N.
