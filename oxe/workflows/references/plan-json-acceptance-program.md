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
