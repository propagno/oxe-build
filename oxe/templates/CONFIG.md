# `.oxe/config.json` — referência

Copia `oxe/templates/config.template.json` para **`.oxe/config.json`** no teu projeto (ou deixa o `oxe-cc` criar na primeira instalação).

| Chave | Tipo | Significado |
|-------|------|-------------|
| `discuss_before_plan` | boolean | Se `true`, o fluxo recomendado pede **`oxe:discuss`** entre spec e plan (perguntas objetivas antes de partir tarefas). |
| `after_verify_suggest_pr` | boolean | Se `true`, o workflow **verify** inclui checklist de PR no fim. |
| `after_verify_draft_commit` | boolean | Se `true`, o **verify** propõe rascunho de mensagem de commit alinhada aos critérios de aceite. |
| `default_verify_command` | string | Comando guarda-chuva opcional (ex. `npm test`) sugerido em **plan**/**verify** quando o projeto não define outro. |

Valores em falta tratam-se como omissões seguras (equivalente ao template).
