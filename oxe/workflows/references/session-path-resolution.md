# OXE — Referência: Session Path Resolution

<objective>
Padronizar a resolução de caminhos quando o projeto usa **sessões OXE** em `.oxe/sessions/`, preservando o modo legado quando **`.oxe/STATE.md`** não tiver `active_session`.
</objective>

<resolution_rule>
## Regra de resolução

1. Ler **`.oxe/STATE.md`** global.
2. Procurar o campo **`active_session`** na secção **Sessão ativa**.
3. Se existir e tiver valor diferente de `—`, usar:
   - `session_path = .oxe/<active_session>/`
   - `active_session` deve guardar sempre o path relativo completo, por exemplo: `sessions/s001-auth-redesign`
4. Se não existir:
   - `session_path = .oxe/`
   - O workflow opera em **modo legado**

## Convenções auxiliares

- **global_state_path** = `.oxe/STATE.md`
- **global_config_path** = `.oxe/config.json`
- **global_codebase_path** = `.oxe/codebase/`
- **global_sessions_index_path** = `.oxe/SESSIONS.md`
- **global_lessons_path** = `.oxe/global/LESSONS.md`
- **global_milestones_index_path** = `.oxe/global/MILESTONES.md`
- **global_milestones_dir** = `.oxe/global/milestones/`
</resolution_rule>

<artifact_matrix>
## Matriz de artefatos

| Tipo | Escopo | Caminho com sessão ativa | Caminho legado |
|------|--------|--------------------------|----------------|
| STATE global | global | `.oxe/STATE.md` | `.oxe/STATE.md` |
| Config | global | `.oxe/config.json` | `.oxe/config.json` |
| Codebase | global | `.oxe/codebase/*` | `.oxe/codebase/*` |
| SESSIONS | global | `.oxe/SESSIONS.md` | `.oxe/SESSIONS.md` |
| LESSONS | global | `.oxe/global/LESSONS.md` | `.oxe/LESSONS.md` |
| MILESTONES | global | `.oxe/global/MILESTONES.md` | `.oxe/MILESTONES.md` |
| SPEC / ROADMAP / DISCUSS / UI-SPEC | sessão | `.oxe/<active_session>/spec/` | `.oxe/` |
| PLAN / QUICK / plan-agents / quick-agents | sessão | `.oxe/<active_session>/plan/` | `.oxe/` |
| STATE local / OBS / DEBUG / FORENSICS | sessão | `.oxe/<active_session>/execution/` | `.oxe/` |
| VERIFY / VALIDATION-GAPS / SECURITY / UI-REVIEW | sessão | `.oxe/<active_session>/verification/` | `.oxe/` |
| CHECKPOINTS | sessão | `.oxe/<active_session>/checkpoints/` | `.oxe/checkpoints/` |
| RESEARCH | sessão | `.oxe/<active_session>/research/` | `.oxe/research/` |
| WORKSTREAMS | sessão | `.oxe/<active_session>/workstreams/` | `.oxe/workstreams/` |
</artifact_matrix>

<reading_rule>
## Regra de leitura

- Quando um workflow ler um artefato da sua trilha, deve tentar primeiro o caminho da sessão ativa.
- Se não houver sessão ativa, usar o caminho legado.
- Se houver sessão ativa mas o artefato ainda não existir, o workflow pode:
  - criar no caminho da sessão, se for writer da fase
  - ou fazer fallback de leitura para o legado, quando isso preservar retrocompatibilidade e ajudar numa migração

Exemplos:
- `plan` lê `spec/SPEC.md` da sessão antes de cair para `.oxe/SPEC.md`
- `verify` lê `plan/PLAN.md` e `spec/SPEC.md` da sessão antes do legado
- `execute` lê sempre `.oxe/STATE.md` global **antes** de tudo, só para resolver `active_session`
</reading_rule>

<cross_session_refs>
## Referências cruzadas

- Em `SESSION.md`, referências a outras sessões usam o formato **`@sNNN`**
- O texto pode complementar com o path, por exemplo: `@s003 ver sessions/s003-auth-hardening/SESSION.md`
- Não existe sessão múltipla ativa: o formato `@sNNN` é apenas referência documental
</cross_session_refs>
