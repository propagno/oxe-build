# OXE — Workflow: skill

<objective>
Descobrir, invocar e gerenciar **skills** — wrappers de invocação que unificam personas (comportamento LLM) e capabilities (ferramentas executáveis) num único ponto de entrada via `@<skill-id>`.

Subcomandos:
- `list`
- `explain <id>`
- `new <id>`
- `@<id>` (invocação inline)
</objective>

<context>
- **Skills globais** vivem em `oxe/personas/` (type: persona) — 8 roles builtin do pacote: `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`. Invocáveis via `@executor`, `@researcher`, etc.
- **Skills de projeto** vivem em `.oxe/skills/<id>/SKILL.md` com frontmatter OXE. Têm prioridade sobre globais quando IDs colidem.
- **Capabilities como skills:** capabilities em `.oxe/capabilities/<id>/` que tenham `SKILL.md` próprio também aparecem como skills de projeto.
- **Resolução:** project (`.oxe/skills/`) → capabilities (`.oxe/capabilities/`) → global (`oxe/personas/`). Primeiro match vence.
- Template: `oxe/templates/SKILL.template.md`
</context>

<process>
1. **`list`** — Enumerar skills disponíveis em três camadas:
   - Ler `oxe/personas/*.md` no pacote (globais, type persona)
   - Ler `.oxe/skills/*/SKILL.md` se existir (projeto)
   - Ler `.oxe/capabilities/*/SKILL.md` se existir (capabilities com manifest de skill)
   - Apresentar tabela: `ID | Type | Scope | Invoke | Descrição`
2. **`explain <id>`** — Resolver o skill pelo ID (project → capabilities → global), exibir frontmatter + seção Descrição + Saída esperada. Se não encontrar, listar skills disponíveis.
3. **`new <id>`** — Criar `.oxe/skills/<id>/SKILL.md` a partir de `SKILL.template.md`. Solicitar ao utilizador: `name`, `type` (persona/capability/composite), `description`. Se o ID já existir, informar e oferecer `explain <id>`.
4. **`@<id>` (inline)** — Quando o chat mencionar `@skill-id`:
   - Resolver o skill pela ordem: project → capabilities → global
   - Para type `persona`: ler e adotar o conteúdo da persona referenciada (princípios, ativação, saída esperada)
   - Para type `capability`: ler manifesto da capability e orientar uso conforme `approval_policy`
   - Para type `composite`: carregar ambas as referências em `references[]`
   - Se não encontrado: listar skills disponíveis e pedir correção
5. Atualizar `.oxe/STATE.md` apenas se o utilizador pedir registo explícito: `last_skill_invoked: @<id> — YYYY-MM-DD`.
</process>

<success_criteria>
- [ ] `@<id>` resolve para exatamente um skill sem ambiguidade.
- [ ] Skills de projeto têm prioridade sobre globais quando IDs colidem.
- [ ] Nenhum artefato de SPEC/PLAN foi criado ou alterado por este passo.
- [ ] `list` mostra skills de todas as três camadas com escopo identificado.
</success_criteria>
</output>
