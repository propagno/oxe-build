# OXE — Workflow: plan-agent (plano orientado a agentes)

<objective>
Produzir **dois artefactos alinhados**:

1. **`.oxe/PLAN.md`** — mesmo contrato que o workflow **`plan.md`** (tarefas `Tn`, **Onda**, **Depende de**, **Verificar**, **Aceite vinculado**, **Autoavaliação do Plano** com rubrica e confiança determinística), para **`/oxe-execute`**, **`/oxe-verify`** e gates OXE existentes.
2. **`.oxe/plan-agents.json`** — **blueprint de execução**: objetivo, **agentes** (papéis, âmbito, entradas/saídas esperadas, dependências entre agentes), **estratégia em ondas** (`execution.waves`), **`runId`** e **`lifecycle`** (schema **2**).

O plano **não** é só uma lista de tarefas: cada agente é um **pacote de contexto** (o que ler, o que produzir, que `Tn` cobre). A execução real continua a ser feita pelo utilizador ou por subagentes da IDE, guiados por este blueprint e pelo `PLAN.md`.

**Exclusividade:** os papéis definidos no JSON são **efémeros** e **exclusivos** da trilha PLAN + **`/oxe-execute`** com este `runId`. **`/oxe-quick`** ou trabalho fora do `PLAN.md` **não** reutilizam estes agentes (ver **`quick.md`**, **`execute.md`**, referência **`references/plan-agent-chat-protocol.md`**).

Se o utilizador pedir **`--replan`**: aplicar a mesma lógica de replanejamento descrita em **`plan.md`** (VERIFY, SUMMARY, secção Replanejamento) e **atualizar ou recriar** `plan-agents.json` em coerência com o novo `PLAN.md`; gerar **novo** `runId` e repor `lifecycle.status` → `pending_execute`. Se ainda existir pasta **`.oxe/plan-agent-messages/`** cheia do **run** anterior e o utilizador não precisar dela na raiz, **arquivar** primeiro em **`.oxe/archive/plan-agent-runs/<runId-antigo>/`** (ver **`references/plan-agent-chat-protocol.md`**) ou pedir confirmação antes de sobrescrever; depois recriar **`.oxe/plan-agent-messages/README.md`** para o novo `runId`.
</objective>

<context>
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `PLAN.md`, `plan-agents.json` e `plan-agent-messages/` vivem em `.oxe/<active_session>/plan/`; sem sessão ativa, manter `.oxe/`.
- O `plan-agent` herda integralmente o contrato `oxe/workflows/references/flow-robustness-contract.md`. Não pode emitir percentuais concorrentes por agente; a confiança final do plano é única e visível no `PLAN.md`.
- **Pré-requisitos** iguais a **`plan.md`**: `.oxe/SPEC.md` obrigatória; `discuss_before_plan` + `DISCUSS.md` quando configurado; consumir **NOTES**, **UI-SPEC**, **DISCUSS**, **RESEARCH**, **CODEBASE-DELTA** / **RESUME**, **config.json** (`plan_max_tasks_per_wave`, `default_verify_command`) como em **`plan.md`**.
- **Fonte de verdade das tarefas:** `PLAN.md`. O JSON referencia tarefas via **`taskIds`** em cada agente — **não** duplicar o texto de **Verificar** no JSON; copiar só paths/resumo curto em **`outputs`** quando útil para routing.
- **Agentes ≠ ferramentas externas fixas:** `role` e `scope` descrevem o **comportamento esperado** de um contexto focado (ex.: “Backend Auth Specialist”), não um binário. Quem executa pode ser um único modelo com instruções diferentes por onda.
- **Protocolo agente → agente:** **`oxe/workflows/references/plan-agent-chat-protocol.md`** — mensagens em **`.oxe/plan-agent-messages/`** (ficheiros `W{onda}-{seq}-{from}-to-{dest}.md` com frontmatter YAML). Criar a pasta e copiar o índice a partir de **`oxe/templates/plan-agent-messages-README.template.md`** → `.oxe/plan-agent-messages/README.md`.
- **Estratégias `execution.strategy`:**
  - **`sequential`** — uma onda por agente (ondas com um único id cada) ou execução estritamente ordenada.
  - **`parallel_per_wave`** — dentro de cada onda, agentes sem dependência mútua podem correr em paralelo; ondas são sequenciais.
  - **`hybrid`** — ondas sequenciais; dentro da onda, paralelo quando `dependencies` já satisfeitas (é o caso mais comum).
- **Schema:** **`oxePlanAgentsSchema: 3`** obrigatório nas novas gerações (schema **2** = sem `model_hint`; schema **1** = legado sem `runId`/`lifecycle`). Incluir **`runId`** (string opaca única, ex. `oxe-{ISO8601}-{6 hex aleatórios}`) e **`lifecycle`**: `{ "status": "pending_execute", "since": "<ISO>" }`. Blueprints com schema **2** continuam válidos; schema **1** não aplica exclusividade estrita até serem regerados.
- Modelo JSON: ver **`oxe/templates/plan-agents.template.json`** e **`oxe/schemas/plan-agents.schema.json`**.
</context>

<agent_isolation_rule>
## Regra de Isolamento de Agentes (Plan-Driven Dynamic Agents)

**Cada `/oxe-plan-agent` cria agentes NOVOS para ESTE plano específico.**

| Regra | Descrição |
|-------|-----------|
| **`runId` único** | Gerar `runId` NOVO a cada execução — nunca reutilizar `runId` de `plan-agents.json` anterior |
| **`role` específico** | Descrever o papel no domínio desta demanda: "Especialista em autenticação JWT para este plano", não "Backend Developer" genérico |
| **Não há reuso** | Agentes de planos ou demandas anteriores são inválidos para este plano. `lifecycle.status: invalidated` em qualquer blueprint anterior com `invalidatedBy: "new_plan"` |
| **Lifecycle exclusivo** | Agentes vivem somente enquanto `lifecycle.status ∈ { pending_execute, executing }` e `runId` alinhado ao STATE.md |
| **Gate de unicidade** | No quality gate: verificar que o `runId` gerado não existe em nenhum `plan-agents.json` anterior no repositório |

**Invalidação de blueprint anterior:**
Se já existir `.oxe/plan-agents.json` com status não-terminal (`pending_execute` ou `executing`), invalidá-lo antes de criar o novo:
```json
"lifecycle": {
  "status": "invalidated",
  "since": "<ISO agora>",
  "invalidatedBy": "new_plan",
  "invalidatedReason": "Novo /oxe-plan-agent iniciado para nova demanda"
}
```
</agent_isolation_rule>

<format_plan_md>
Seguir **integralmente** o bloco **`<format_plan>`** e **`<plan_quality_gate>`** do ficheiro **`oxe/workflows/plan.md`** ao escrever `.oxe/PLAN.md` (incluindo gate antes de fechar).
</format_plan_md>

<model_hints>
## Model Hints por Agente (schema v3, opcional)

Cada agente pode declarar `model_hint` para orientar qual tier de modelo usar:

| Valor | Quando usar |
|-------|-------------|
| `"powerful"` | Agentes de análise, arquitetura, pesquisa, decisões de design |
| `"balanced"` | Agentes de implementação de features, integração, refactor |
| `"fast"` | Agentes de review, testes, lint, validação, tarefas repetitivas |

**Regra de uso:** quando o `plan-agents.json` tiver `model_hint`, o **`execute.md`** exibe a sugestão ao apresentar a atribuição do agente — permitindo ao usuário configurar o modelo antes de iniciar aquele agente.

`model_hint` é opcional: omitir significa "sem preferência" (executa com o modelo padrão da sessão).
</model_hints>

<format_plan_agents_json>
Raiz do ficheiro **`.oxe/plan-agents.json`**:

| Campo | Obrigatório | Significado |
|-------|-------------|-------------|
| `oxePlanAgentsSchema` | sim | **3** nas gerações atuais ( **2** = sem `model_hint`; **1** = legado sem `runId`/`lifecycle` obrigatórios). |
| `runId` | sim (schema ≥ 2) | Identidade da sessão do blueprint; nova em cada plan-agent / replan. |
| `lifecycle` | sim (schema ≥ 2) | `status`: `pending_execute` \| `executing` \| `closed` \| `invalidated`; `since` ISO; opcional `invalidatedReason`, `invalidatedBy` (`quick` \| `out_of_scope` \| `new_plan` \| `manual`). |
| `goal` | sim | Frase curta alinhada ao objetivo da entrega (eco da SPEC). |
| `specRef` | não | Referência livre (ex.: path `.oxe/SPEC.md` ou nota de versão). |
| `agents` | sim | Lista de objetos agente (ver abaixo). |
| `execution` | sim | `strategy` + `waves` (lista de listas de `id` de agentes). |

Cada **agente**:

| Campo | Obrigatório | Significado |
|-------|-------------|-------------|
| `id` | sim | Slug único estável (`agent-db`, `agent-backend-auth`). |
| `role` | sim | Nome legível do papel. |
| `persona` | não | ID de persona em `oxe/personas/` (ex.: `executor`, `architect`). O workflow `/oxe-execute` carrega a persona para instruir o LLM. Ver `oxe/personas/README.md`. |
| `scope` | sim | Lista de strings (o que este agente faz, em bullets curtos). |
| `taskIds` | sim | Lista de IDs **`T1`…`Tn`** que este agente implementa (subconjunto do `PLAN.md`). |
| `dependencies` | não | Lista de **`id`** de outros agentes que devem concluir antes (grafo entre agentes). |
| `inputs` | não | Caminhos ou nomes de artefactos a carregar no contexto (ex.: `.oxe/STATE.md`, `.oxe/SPEC.md`). |
| `outputs` | não | Paths ou padrões de ficheiros esperados (orientação; o código real vem do PLAN). |
| `model_hint` | não | Tier de modelo sugerido: `"fast"` \| `"balanced"` \| `"powerful"`. Ver `<model_hints>`. |

**Personas disponíveis:** `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`. Ver `oxe/personas/README.md` para descrição de cada uma. Personas customizadas do projeto ficam em `.oxe/personas/`.

**Regras de desenho:** preferir **um agente por domínio** (DB, API, UI) e **várias `Tn`** no mesmo agente quando partilham contexto; usar **agentes separados** quando o contexto mínimo diverge forte (evita fugas de foco).
</format_plan_agents_json>

<plan_agent_quality_gate>
Antes de finalizar, validar **em conjunto** `PLAN.md` + `plan-agents.json`:

1. **Schema:** JSON válido; `oxePlanAgentsSchema ∈ {2, 3}` (3 para novos blueprints); presentes **`runId`** e **`lifecycle`** com `status: pending_execute` e `since` ISO; todos os `id` de agente únicos. Se schema 3: `model_hint` de cada agente é `"fast"`, `"balanced"`, `"powerful"` ou ausente.
2. **Cobertura de tarefas:** a união dos `taskIds` de todos os agentes é **igual** ao conjunto de `### Tn` presentes no `PLAN.md` (sem tarefa órfã nem tarefa duplicada entre agentes).
3. **Dependências de agente:** só referenciam `id` existentes; **sem ciclos**; se o agente A depende de B, então **onda(B) < onda(A)** em `execution.waves` (primeira aparição do id define a onda).
4. **Ondas:** cada `id` em `agents` aparece **exatamente uma vez** no total das `waves`; ordem das ondas reflete dependências e alinha com **Onda:** do `PLAN.md` (tarefas na mesma onda do PLAN podem mapear para agentes na mesma wave se não houver dependência agente-a-agente).
5. **Gate do PLAN:** o **`plan.md`** `<plan_quality_gate>` sobre `PLAN.md` continua **obrigatório** (dependências `Tk`, ciclos T*, cobertura A*, limites por onda, UI-SPEC).
6. **Alinhamento SPEC:** cada `scope` relevante deve ser rastreável a critérios **A*** via `taskIds` → **Aceite vinculado** no PLAN.
7. **Artefactos de mensagens:** pasta **`.oxe/plan-agent-messages/`** existe e contém **`README.md`** (conteúdo baseado em **`oxe/templates/plan-agent-messages-README.template.md`**).

8. **Isolamento:** `runId` gerado é novo e único; se havia blueprint anterior com status não-terminal, foi invalidado com `invalidatedBy: "new_plan"` antes de criar o novo (ver `<agent_isolation_rule>`).

Resumo obrigatório no chat: `Gate plan-agent: OK` ou `Gate plan-agent: corrigido (N problemas)`.
</plan_agent_quality_gate>

<process>
1. Executar os passos 1–4 de **`<process>`** em **`oxe/workflows/plan.md`** (ler SPEC, discuss, notes, codebase, etc.).
2. Conceber **agentes** e **ondas** (grafo por dependências de domínio); depois derivar **tarefas `Tn`** com o formato habitual do PLAN (uma tarefa continua a ser a unidade de **Verificar** e **Aceite vinculado**).
3. Escrever **`.oxe/PLAN.md`** (cabeçalho YAML como em `oxe/templates/PLAN.template.md`; em **--replan**, secção Replanejamento).
4. Gerar **`runId`** novo e **`lifecycle`**: `{ "status": "pending_execute", "since": "<ISO agora>" }`.
5. Escrever **`.oxe/plan-agents.json`** a partir de **`oxe/templates/plan-agents.template.json`**, com **`oxePlanAgentsSchema: 3`**, `goal`, `agents` (incluindo `model_hint` por agente conforme `<model_hints>`), `execution`, `runId`, `lifecycle`.
6. Criar `plan-agent-messages/` e `plan-agent-messages/README.md` no escopo resolvido a partir de **`oxe/templates/plan-agent-messages-README.template.md`**.
7. Atualizar **`.oxe/STATE.md`**: fase `plan_ready`, próximo passo `oxe:execute`; preencher **Blueprint de agentes (sessão)** — `run_id` (= `runId`), `lifecycle_status` (= `pending_execute`), **última onda** — (ou `—`).
8. Aplicar **`<plan_agent_quality_gate>`**; corrigir até passar.
9. No chat: resumo do gate plan-agent, `runId`, número de agentes, ondas, tarefas, referência ao protocolo em **`references/plan-agent-chat-protocol.md`**.
</process>

<success_criteria>
- [ ] `PLAN.md` existe e passa o gate de **`plan.md`**.
- [ ] `plan-agents.json` existe com schema **3**, `runId`, `lifecycle`, `model_hint` por agente (ou omitido), e passa **`<plan_agent_quality_gate>`**.
- [ ] Cada tarefa `Tn` aparece em **exatamente um** `taskIds`.
- [ ] `execution.waves` reflete dependências entre agentes sem ciclos.
- [ ] `.oxe/plan-agent-messages/README.md` presente.
</success_criteria>
