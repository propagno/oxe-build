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
