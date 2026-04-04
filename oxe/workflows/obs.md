# OXE — Workflow: obs

<objective>
Registrar uma **observação contextual** em **`.oxe/OBSERVATIONS.md`** durante ou fora de uma execução. A observação é incorporada automaticamente nos próximos `/oxe-spec`, `/oxe-plan`, `/oxe-discuss` ou `/oxe-execute` sem necessidade de re-explicar.

**Princípio:** *observation-without-re-explaining* — registre em 1 request, receba o benefício em todos os workflows seguintes sem custo extra de requisição.

Entrada: texto livre com a observação (restrição, descoberta técnica, preferência, risco, decisão).
</objective>

<context>
- Pode ser chamado **a qualquer momento**: antes, durante ou após qualquer passo da trilha OXE.
- Não interrompe o fluxo em curso — a observação é armazenada e incorporada na próxima oportunidade.
- Se chamado **durante execute** (fase `executing` no STATE) com impacto `execute` ou `all`: oferecer opção de aplicar agora (pausar onda atual) ou continuar e aplicar na próxima rodada.
- Ler **`.oxe/STATE.md`** para capturar o contexto automático (fase atual, tarefa ativa, workstream ativo).
- Usar `oxe/templates/OBSERVATIONS.template.md` para criar o arquivo se ainda não existir.
</context>

<format_observations_md>
Arquivo: **`.oxe/OBSERVATIONS.md`**

```markdown
# Observações OXE

| ID | Data | Contexto | Impacto | Status |
|----|------|----------|---------|--------|
| OBS-001 | 2026-04-04 | execute/T3 | spec, plan | pendente |
| OBS-002 | 2026-04-04 | pós-spec | execute | incorporada → execute (2026-04-04) |

---

### OBS-001 — 2026-04-04 | execute/T3
**Impacto:** spec, plan
**Status:** pendente

JWT expiration deve ser configurável via `JWT_EXPIRES_IN` env var, não hardcoded 7d.

---

### OBS-002 — 2026-04-04 | pós-spec
**Impacto:** execute
**Status:** incorporada → execute (2026-04-04)

API deve retornar mensagens de erro em português do Brasil.
```

**IDs:** sequenciais `OBS-001`, `OBS-002`, … (continuar do último ID existente no arquivo).

**Impacto:** classificar automaticamente com base no conteúdo:
- `spec` — afeta requisitos, critérios de aceite ou escopo
- `plan` — afeta tarefas, ondas, dependências ou verificação
- `execute` — afeta a implementação da tarefa atual ou próxima
- `all` — afeta múltiplas camadas

**Status lifecycle:** `pendente` → `incorporada → <workflow> (YYYY-MM-DD)`
</format_observations_md>

<process>
1. Ler **`.oxe/STATE.md`**: capturar `phase`, `last_task` ou tarefa ativa na onda, `active_workstream`.
2. Determinar o **próximo ID** (OBS-NNN): contar entradas existentes em `.oxe/OBSERVATIONS.md` ou começar em OBS-001.
3. Classificar o **impacto** automaticamente com base no texto; se ambíguo, usar `all`.
4. Criar ou atualizar **`.oxe/OBSERVATIONS.md`**:
   - Adicionar linha na tabela de índice.
   - Adicionar seção `### OBS-NNN` com contexto, impacto, status e texto.
5. Avaliar **urgência**:
   - Se `phase` ∈ `{ executing, quick_active }` **e** impacto ∈ `{ execute, all }`:
     - Apresentar ao usuário: "Observação registrada. Deseja aplicar agora (pausar onda atual) ou continuar e incorporar na próxima rodada?"
     - Se pausar: sugerir revisão do bloco `**Verificar:**` da tarefa ativa e ajuste inline.
     - Se continuar: confirmar que será incorporado no início da próxima onda.
   - Em qualquer outro caso: confirmar registro e mencionar quando será incorporado.
6. Atualizar **`.oxe/STATE.md`**: adicionar ou atualizar campo `obs_pendentes: true` (remover ou marcar `false` quando todos os OBS estiverem `incorporada`).
7. Responder no chat com: ID atribuído (OBS-NNN), impacto classificado, próximo passo sugerido (qual workflow incorporará a observação).
</process>

<auto_incorporation_rule>
Qualquer workflow que leia `.oxe/OBSERVATIONS.md` deve:
1. Verificar se há entradas com `Status: pendente` relevantes ao seu escopo de impacto.
2. Incorporar o conteúdo na lógica do workflow (enriquecer requisitos, ajustar tarefas, modificar implementação).
3. Após incorporar: atualizar a linha no índice e na seção `### OBS-NNN` para `incorporada → <workflow> (data)`.
4. Se `STATE.md` tiver `obs_pendentes: true` e todas as observações relevantes foram incorporadas: atualizar para `obs_pendentes: false`.

**Workflows que incorporam observações:**
- `/oxe-spec` (Fase 3 — Requisitos): impacto `spec` ou `all`
- `/oxe-plan`: impacto `plan` ou `all`
- `/oxe-discuss`: impacto `spec`, `plan` ou `all` (como contexto adicional)
- `/oxe-execute`: impacto `execute` ou `all` — incorporar no início da onda atual
</auto_incorporation_rule>

<success_criteria>
- [ ] `.oxe/OBSERVATIONS.md` existe com entrada OBS-NNN na tabela e seção de detalhe.
- [ ] Impacto classificado corretamente (spec | plan | execute | all).
- [ ] `STATE.md` tem `obs_pendentes: true`.
- [ ] Se urgência execute: usuário foi consultado sobre pausar ou continuar.
- [ ] Resposta no chat inclui ID, impacto e próximo passo de incorporação.
</success_criteria>
