# OXE — Protocolo de mensagens agente → agente (plan-agent)

Referência normativa para **handoff** entre agentes definidos em **`.oxe/plan-agents.json`**, durante **`/oxe-execute`**. O OXE não implementa transporte em rede: a “caixa de correio” é **disco** em **`.oxe/plan-agent-messages/`**.

## Princípios

1. **`runId`** — Todas as mensagens devem repetir o **`runId`** do `plan-agents.json` ativo. Mensagens com `runId` diferente são **ignoradas** na leitura da sessão corrente (histórico arquivado ou erro de cópia).
2. **Imutabilidade** — Cada ficheiro é **append-only** no sentido OXE: depois de criado, não editar; correções = novo ficheiro com `seq` seguinte.
3. **Exclusividade do blueprint** — Papéis (`role` / `scope`) do JSON **só** se aplicam quando `lifecycle.status` ∈ `{ pending_execute, executing }` e o trabalho mapeia para **`taskIds`** do `PLAN.md`. Ver workflows **`execute.md`**, **`quick.md`**, **`plan-agent.md`**.
4. **Legado schema 1** — Blueprints sem `runId` / `lifecycle` ( `oxePlanAgentsSchema: 1`) funcionam como roteiro **suave**, sem garantias estritas deste protocolo; recomenda-se **regerar** com **`/oxe-plan-agent`** (schema 2).

## Armazenamento

- **Pasta:** `.oxe/plan-agent-messages/` (criada por **`/oxe-plan-agent`**).
- **Nome do ficheiro:** `W{onda}-{seq}-{from}-to-{dest}.md`
  - `onda` — número da onda (1-based), alinhado a **`execution.waves`**.
  - `seq` — contador **por onda**, começando em `01`, `02`, … (dois dígitos recomendados para ordenação léxica).
  - `from` / `dest` — `id` do agente em `plan-agents.json`, ou `broadcast` quando vários consumidores na mesma onda devem ler (raro; preferir uma mensagem por aresta).
- **Caracteres:** usar só `[a-z0-9-]` nos slugs `from`/`dest` para compatibilidade com sistemas de ficheiros.

### Paralelismo na mesma onda

- Agentes **sem** dependência mútua na mesma wave podem produzir mensagens em **paralelo**: usar **`seq`** distinto por remetente (ex.: `W2-01-agent-a-to-agent-c.md` e `W2-01-agent-b-to-agent-c.md` — mesmo `seq` é aceitável se `from` difere; se colidir, incrementar `seq` no remetente).
- Handoff **A → B** quando B depende de A: A escreve **antes** de B iniciar trabalho na onda seguinte.

## Formato do ficheiro (YAML frontmatter + Markdown)

O ficheiro **começa** com frontmatter YAML entre `---`:

```yaml
---
wave: 2
fromAgentId: agent-backend-auth
toAgentId: agent-frontend-login
runId: "oxe-2026-03-31-abc123"
type: handoff_summary
created: "2026-03-31T14:00:00Z"
taskIds: ["T3", "T4"]
---
```

Campos obrigatórios no frontmatter:

| Campo | Tipo | Significado |
|-------|------|-------------|
| `wave` | inteiro ≥ 1 | Onda OXE em execução. |
| `fromAgentId` | string | `id` do agente emissor. |
| `toAgentId` | string | `id` do destinatário ou `broadcast`. |
| `runId` | string | Igual a `plan-agents.json` → `runId`. |
| `type` | enum | Ver tabela abaixo. |
| `created` | string ISO 8601 | Momento da mensagem. |

Opcional: **`taskIds`** — subset das tarefas que esta mensagem cobre.

### Tipos (`type`)

| Valor | Uso |
|-------|-----|
| `handoff_summary` | Resumo do que foi feito, decisões, ficheiros tocados; destinatário continua o trabalho. |
| `blocking_question` | Pergunta que **bloqueia** o destinatário até resposta humana ou decisão explícita; corpo deve ter **Ação esperada**. |
| `artifact_pointer` | Apontadores fortes (paths, commits, URLs internas ao repo). |
| `decision` | Decisão tomada na sessão (API, nome, trade-off) para consumo downstream. |

## Corpo (Markdown após o frontmatter)

- Parágrafo **Resumo** (1–3 frases).
- Lista de **Artefactos** com paths relativos à raiz do repo (`` `src/...` ``).
- Para `blocking_question`: secção **`### Ação esperada`** com o que o humano ou o agente seguinte deve fazer.

## Leitura

- Antes de um agente **B** executar tarefas na onda *N*, ler mensagens com `toAgentId` = `B` ou `broadcast`, `wave` < *N* ou (`wave` = *N* e dependências satisfeitas), e `runId` atual.
- O conteúdo de **Verificar** e critérios **A*** permanecem apenas no **`PLAN.md`** / **SPEC**; este protocolo **não** substitui o gate de verify.

## Ciclo de vida e invalidação

- Novas mensagens **não** devem ser escritas após `lifecycle.status` = `invalidated` ou `closed`.
- **`/oxe-quick`** invalida o blueprint (`invalidatedBy: quick`); não reutilizar papéis do JSON no fluxo quick.
- Trabalho **fora** do conjunto de `Tn` do `PLAN.md`: não assumir persona do blueprint; opcionalmente pedir confirmação para invalidar (`invalidatedBy: out_of_scope`).

## Artefactos no repositório após fecho (recomendação OXE)

Durante a trilha ativa, **`plan-agents.json`** e **`.oxe/plan-agent-messages/`** na raiz de `.oxe/` são práticos (caminhos estáveis para **`/oxe-execute`**). Depois de **`lifecycle.closed`** (tipicamente após **`/oxe-verify`** com sucesso), estes ficheiros **deixam de ser necessários** para o dia a dia e **poluem** o explorador e o `git status` se ficarem sempre na raiz.

**Recomendação (equilíbrio entre limpeza e auditoria):**

1. **Arquivar por sessão (`runId`), não apagar** — Move-se o histórico para **`.oxe/archive/plan-agent-runs/<runId>/`**:
   - **`messages/`** — todo o conteúdo actual de **`.oxe/plan-agent-messages/`** excepto um `README.md` de índice opcional (ou mover também o README antigo para dentro do arquivo).
   - **`plan-agents.json`** — cópia final do blueprint **no momento do fecho** (o JSON na raiz `.oxe/` pode ser **removido** após cópia, ou substituído por um stub mínimo só se outra ferramenta exigir o path; o normal é remover da raiz após arquivo).
2. **Não commitar ruído sem querer** — Quem preferir **não** versionar handoffs: adicionar **`.oxe/archive/plan-agent-runs/`** ou **`.oxe/plan-agent-messages/`** ao **`.gitignore`** do projeto (trade-off: perde-se histórico no Git).
3. **Pastas por sessão desde o primeiro dia** (alternativa maior) — **`.oxe/plan-agent-runs/<runId>/messages/`** + **`plan-agents.json`** dentro da mesma pasta, com um **`plan-agents.active`** ou entrada em **STATE** a apontar o `runId` corrente. Exige alterar todos os workflows e o mental model dos agentes; reserve-se para uma evolução do pacote se a raiz `.oxe/` tiver de ficar sempre mínima.

**Resumo:** para o fluxo OXE actual, **arquivar em `.oxe/archive/plan-agent-runs/<runId>/` após verify OK** é a forma mais simples de “não precisarem mais existir na raiz” sem perder rastreabilidade. Apagar em massa só com **confirmação explícita** do utilizador.

## Ver também

- [`oxe/workflows/plan-agent.md`](../plan-agent.md)
- [`oxe/workflows/execute.md`](../execute.md)
- [`oxe/schemas/plan-agents.schema.json`](../../schemas/plan-agents.schema.json)
