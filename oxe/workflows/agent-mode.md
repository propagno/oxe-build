# OXE — Workflow: agent-mode (Agent Mode)

<objective>
Execução autônoma de objetivos de complexidade simples ou média por um único Conductor Agent.
O Conductor age diretamente como implementador, adotando a persona primária selecionada pelo `conduct.md`, produzindo o resultado em uma sessão sem necessidade de equipe multi-agente.
</objective>

<context>
- Invocado por `conduct.md` quando `intent_score` é simples ou médio.
- Aplicar `oxe/workflows/references/reasoning-execution.md` durante a implementação.
- Persona primária já foi selecionada e está disponível como parâmetro de entrada.
- Gravar artefatos em `.oxe/agent/`.
- Ao final, emitir eventos básicos para `OXE-EVENTS.ndjson` (RunStarted, WorkItemCompleted, RunCompleted).
</context>

---

## Fase 1 — Inicialização da Sessão

Criar `.oxe/agent/AGENT-SESSION.json` com:

```json
{
  "session_id": "agent-<YYYYMMDD>-<seq>",
  "started_at": "<ISO8601>",
  "status": "running",
  "objective": "<objetivo do usuário>",
  "intent_score": "<simples|médio>",
  "intent_tags": [],
  "primary_persona": "<id>",
  "memory_applied": false,
  "tool_calls": [],
  "work_items": [],
  "reconciliation": null
}
```

Registrar entrada em `.oxe/agent/INTENT-LOG.ndjson`:
```json
{"ts": "<ISO8601>", "objective": "<texto>", "score": "<score>", "tags": [], "persona": "<id>"}
```

---

## Fase 2 — Discovery (reasoning-execution: "reconhecimento curto")

Antes de mutar qualquer arquivo, executar um reconhecimento mínimo:

1. Ler arquivos relevantes ao objetivo (usar Glob + Grep conforme intent_tags)
2. Identificar:
   - **Arquivos que serão modificados** (write_set)
   - **Padrões existentes** a seguir (naming, estrutura, imports)
   - **Riscos imediatos** (arquivo crítico? Arquivo compartilhado? Arquivo com testes?)
3. Se o write_set for maior que o esperado para `intent_score=simples` (> 5 arquivos): **parar e elevar para Swarm Mode**

Registrar discovery em `.oxe/agent/AGENT-SESSION.json` → campo `work_items`.

---

## Fase 3 — Execução (sob persona selecionada)

Adotar os princípios da persona primária de `oxe/personas/<primary_persona>.md`:

- **Write set mínimo** — tocar apenas os arquivos identificados no discovery
- **Verificar antes de avançar** — executar verificação ao completar cada item
- **Discoveries fora de escopo** → `.oxe/OBSERVATIONS.md` (não expandir silenciosamente)
- **Segredos nunca em código**

Para cada `work_item`:
1. Implementar conforme objetivo
2. Verificar (comando ou checklist)
3. Atualizar `AGENT-SESSION.json` → `work_items[i].status = "done" | "failed"`
4. Registrar em `INTENT-LOG.ndjson`: `{"ts": "...", "item": "...", "status": "...", "files_changed": []}`

---

## Fase 4 — Reconciliação

Ao finalizar todos os `work_items`:

1. Listar todos os arquivos modificados
2. Confirmar que o objetivo foi satisfeito (sim/parcialmente/não)
3. Listar discoveries relevantes registrados em OBSERVATIONS.md

Atualizar `AGENT-SESSION.json`:
```json
{
  "status": "completed | partial | failed",
  "completed_at": "<ISO8601>",
  "files_changed": ["lista de arquivos"],
  "reconciliation": {
    "objective_satisfied": true,
    "observations_added": 0,
    "next_suggested": "<próximo passo se houver>"
  }
}
```

Gravar `.oxe/agent/RECONCILIATION.md` com:
```markdown
## Reconciliação — <session_id>

**Objetivo:** <texto>
**Resultado:** satisfeito | parcial | falhou
**Arquivos alterados:** <lista>
**Observações adicionadas:** <N>
**Próximo passo:** <texto ou "—">
```

---

## Fase 5 — Eventos

Emitir no final para `.oxe/OXE-EVENTS.ndjson` (append, uma linha NDJSON por evento):

```json
{"id": "<uuid>", "type": "RunStarted", "timestamp": "<ISO8601>", "session_id": "<id>", "run_id": "<session_id>", "payload": {"mode": "agent", "objective": "<texto>", "persona": "<id>"}}
{"id": "<uuid>", "type": "WorkItemCompleted", "timestamp": "<ISO8601>", "session_id": "<id>", "run_id": "<session_id>", "payload": {"items_completed": N, "files_changed": []}}
{"id": "<uuid>", "type": "RunCompleted", "timestamp": "<ISO8601>", "session_id": "<id>", "run_id": "<session_id>", "payload": {"status": "completed", "objective_satisfied": true}}
```

**Se `OXE-EVENTS.ndjson` não existir:** criar com o primeiro evento.

---

## Saída para o usuário

Ao final, reportar:

```
Agent Mode — concluído
Objetivo: <texto resumido>
Persona: <id>
Arquivos alterados: N
Verificação: passou | falhou

<lista de arquivos>

Próximo passo: <recomendação ou "—">
```

<success_criteria>
- [ ] AGENT-SESSION.json criado e atualizado ao longo da execução.
- [ ] Persona primária adotada (princípios de operação aplicados).
- [ ] Write set mínimo respeitado.
- [ ] Verificação executada por work_item.
- [ ] RECONCILIATION.md gerado.
- [ ] OXE-EVENTS.ndjson atualizado (RunStarted + WorkItemCompleted + RunCompleted).
- [ ] Discoveries fora de escopo → OBSERVATIONS.md, não expansão silenciosa.
</success_criteria>
