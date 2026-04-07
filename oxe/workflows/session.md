# OXE — Workflow: session

<objective>
Gerenciar **sessões OXE** em `.oxe/sessions/` para isolar artefatos por ciclo de trabalho, mantendo **`.oxe/STATE.md`** como índice global e preservando o **modo legado** quando não houver sessão ativa.

Subcomandos:
- `new <nome>`
- `list`
- `switch <id-ou-nome>`
- `resume <id-ou-nome>`
- `status`
- `close`
- `migrate <nome>`
</objective>

<context>
- Fonte de regra de path: `oxe/workflows/references/session-path-resolution.md`
- Template da sessão: `oxe/templates/SESSION.template.md`
- Índice global: `.oxe/SESSIONS.md`
- Sessão ativa fica sempre em `.oxe/STATE.md`, campo `active_session`, com path relativo completo: `sessions/sNNN-slug`
- Sem sessão ativa, os workflows continuam a operar na raiz `.oxe/`
- Esta entrega é **workflows only**: `oxe-cc status` / `doctor` continuam legados e isso deve ser assumido nesta versão
</context>

<index_format>
## Formato fixo de `.oxe/SESSIONS.md`

```markdown
# OXE — Índice de sessões

| ID | Nome | Status | Criada | Última atividade | Resumo | Path |
|----|------|--------|--------|------------------|--------|------|
| s001 | auth-redesign | active | 2026-04-07 | 2026-04-07 | Sessão criada por migrate | `sessions/s001-auth-redesign` |
```

- Linha mais recente no topo
- `switch` e `resume` atualizam **Última atividade**
- `close` atualiza **Status** para `archived`
</index_format>

<process_new>
## `new <nome>`

1. Garantir `.oxe/`, `.oxe/sessions/` e `.oxe/global/`.
2. Normalizar o nome para slug ASCII em kebab-case.
3. Ler `.oxe/SESSIONS.md` se existir; calcular o próximo ID `sNNN`.
4. Criar `.oxe/sessions/sNNN-slug/` com:
   - `spec/`
   - `plan/`
   - `execution/`
   - `verification/`
   - `checkpoints/`
   - `research/`
   - `artifacts/`
   - `workstreams/`
5. Criar `SESSION.md` a partir de `SESSION.template.md`.
6. Criar ou atualizar `.oxe/SESSIONS.md` com a nova linha no topo.
7. Atualizar `.oxe/STATE.md`:
   - `active_session: sessions/sNNN-slug`
   - `session_id: sNNN`
   - fase resumida e próximo passo coerentes com a sessão nova
8. Responder no chat com ID, path da sessão e próximo passo sugerido.
</process_new>

<process_list>
## `list`

1. Ler `.oxe/SESSIONS.md`.
2. Se o ficheiro não existir, responder que não há sessões registadas.
3. Exibir a tabela do índice; se o utilizador pedir filtro, aceitar `--status active|archived`.
</process_list>

<process_switch>
## `switch <id-ou-nome>`

1. Ler `.oxe/SESSIONS.md`.
2. Resolver a sessão por `sNNN`, slug ou nome exibido na tabela.
3. Atualizar `.oxe/STATE.md` global:
   - `active_session`
   - `session_id`
   - `Última atividade` dessa sessão em `.oxe/SESSIONS.md`
4. Não mover artefatos; apenas mudar o contexto ativo.
</process_switch>

<process_resume>
## `resume <id-ou-nome>`

- Mesmo comportamento de `switch`
- Usar wording de retomada no chat, mas sem lógica diferente
</process_resume>

<process_status>
## `status`

1. Ler `.oxe/STATE.md` global.
2. Se houver `active_session`, abrir `SESSION.md` da sessão ativa e resumir:
   - metadados
   - índice de artefatos
   - tags
   - último evento do histórico
3. Se não houver sessão ativa, responder com a tabela de `.oxe/SESSIONS.md` (equivalente funcional a `list`).
</process_status>

<process_close>
## `close`

1. Ler `.oxe/STATE.md`; se não houver sessão ativa, pausar e informar.
2. Abrir `SESSION.md` da sessão ativa e marcar `Status: archived`.
3. Atualizar `.oxe/SESSIONS.md` com `Status = archived` e `Última atividade = hoje`.
4. Limpar de `.oxe/STATE.md`:
   - `active_session`
   - `session_id`
5. Responder com a sessão encerrada e lembrar que sessões arquivadas continuam legíveis.
</process_close>

<process_migrate>
## `migrate <nome>`

1. Executar logicamente `new <nome>` para abrir uma nova sessão.
2. Mover apenas artefatos session-scoped existentes da raiz `.oxe/`:
   - `SPEC.md`, `ROADMAP.md`, `DISCUSS.md`, `UI-SPEC.md` → `spec/`
   - `PLAN.md`, `QUICK.md`, `plan-agents.json`, `quick-agents.json`, `plan-agent-messages/` → `plan/`
   - `OBSERVATIONS.md`, `DEBUG.md`, `FORENSICS.md`, `SUMMARY.md` → `execution/`
   - `VERIFY.md`, `VALIDATION-GAPS.md`, `SECURITY.md`, `UI-REVIEW.md` → `verification/`
   - `checkpoints/`, `CHECKPOINTS.md` → `checkpoints/`
   - `research/`, `RESEARCH.md` → `research/`
   - `workstreams/` → `workstreams/`
3. Não mover:
   - `.oxe/STATE.md`
   - `.oxe/config.json`
   - `.oxe/codebase/`
   - `.oxe/SESSIONS.md`
   - `.oxe/global/`
4. No chat, listar:
   - movidos
   - mantidos globais
   - ignorados por inexistência
</process_migrate>

<process_default>
## Sem subcomando

- Se houver sessão ativa: executar `status`
- Se não houver sessão ativa: executar `list`
</process_default>

<success_criteria>
- [ ] `.oxe/sessions/sNNN-slug/` é o path da sessão criado/consultado.
- [ ] `active_session` guarda o path relativo completo no `STATE.md` global.
- [ ] `.oxe/SESSIONS.md` usa as colunas mínimas `ID | Nome | Status | Criada | Última atividade | Resumo | Path`.
- [ ] `close` arquiva sem apagar artefatos.
- [ ] `migrate` move só artefatos session-scoped e preserva os globais.
</success_criteria>
