# `.oxe/config.json` — referência

Copie `oxe/templates/config.template.json` para **`.oxe/config.json`** no seu projeto (ou deixe o `oxe-cc` criar na primeira instalação).

| Chave | Tipo | Significado |
|-------|------|-------------|
| `discuss_before_plan` | boolean | Se `true`, o fluxo recomenda **`oxe:discuss`** entre spec e plan. |
| `after_verify_suggest_pr` | boolean | Se `true`, o workflow **verify** inclui checklist de PR no fim. |
| `after_verify_draft_commit` | boolean | Se `true`, o **verify** propõe rascunho de mensagem de commit alinhado aos critérios de aceite. |
| `default_verify_command` | string | Comando guarda-chuva opcional (ex.: `npm test`) sugerido em **plan**/**verify** quando o projeto não define outro. |
| `scan_max_age_days` | number | Se **> 0**, `oxe-cc doctor` / `status` avisam quando a **Data** do último scan em `STATE.md` é mais antiga que esse número de dias. Use **0** para desligar. |
| `scan_focus_globs` | string[] | Padrões (ex.: `src/api/**`) que o workflow **scan** deve priorizar; só orientação para o agente. |
| `scan_ignore_globs` | string[] | Padrões a tratar como baixa prioridade ou omitir no scan (ex.: `**/dist/**`). |
| `spec_required_sections` | string[] | Cabeçalhos que **devem** existir em `SPEC.md` (ex.: `"## Critérios de aceite"`). `doctor` / `status` emitem aviso se faltar. |
| `plan_max_tasks_per_wave` | number | Se **> 0**, `doctor` / `status` avisam se alguma **Onda** no `PLAN.md` tiver mais tarefas `T1…` que esse limite. **0** desliga. |

Chaves desconhecidas são listadas como aviso no `doctor` / `status`. Valores em falta usam o mesmo significado que no template (omissões seguras).
