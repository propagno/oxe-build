# OXE — Workflow: distill (Learning Kernel)

<objective>
Ao final de um Swarm Run (ou Agent Mode run), extrair padrões do que aconteceu,
detectar lições reutilizáveis e candidatas a novas skills, atualizar LESSONS.md com dedup,
e enfileirar na PROMOTION-QUEUE.md as skills candidatas para revisão humana.
</objective>

<context>
- Invocado por `swarm-mode.md` Fase 8 (após Verifier) ou por `/oxe-verify` com `--retro`.
- Reaproveitamento: LESSONS.md taxonomy e regras de dedup de `.oxe/global/LESSONS.md`.
- Reaproveitamento: `LessonPromoted` event type de `packages/runtime/src/events/catalog.ts`.
- Não modifica arquivos de código. Apenas lê run artifacts e grava em `.oxe/learning/` e `.oxe/global/`.
- Parâmetros de entrada: `run_id`, `mode` (swarm|agent).
</context>

---

## Fase 1 — Coleta de evidências do run

Ler os seguintes artefatos do run (pular silenciosamente se não existirem):

**Para Swarm Mode:**
- `.oxe/swarm/SWARM-RUN.json` — status geral, agentes, waves
- `.oxe/swarm/FINAL-INTEGRATION.md` — resultado da integração
- `.oxe/swarm/BLOCKERS.ndjson` — bloqueios que ocorreram
- `.oxe/swarm/reviews/*.md` — resultados das revisões
- `.oxe/swarm/DECISIONS.md` — decisões tomadas pelo coordinator

**Para Agent Mode:**
- `.oxe/agent/AGENT-SESSION.json` — status, work_items, reconciliation
- `.oxe/agent/RECONCILIATION.md` — resultado final

**Sempre:**
- `.oxe/OBSERVATIONS.md` — observações adicionadas durante o run
- `.oxe/VERIFY.md` (se existir) — resultado de verificação

---

## Fase 2 — Detecção de padrões (candidatos)

Para cada evidência coletada, identificar padrões nas categorias:

| Categoria | Sinal de detecção |
|-----------|------------------|
| **blocker_pattern** | Mesmo tipo de bloqueio em 2+ tasks do mesmo run |
| **success_pattern** | Approach que funcionou e pode ser replicado |
| **anti_pattern** | Abordagem que causou revisão reprovada ou retrabalho |
| **file_conflict_pattern** | Conflito de file ownership que exigiu serialização |
| **integration_gap** | Falha na integração que não foi detectada nas tasks individuais |
| **scope_expansion** | Observation de tipo `new_constraint` que alargou o escopo |

Para cada padrão detectado, criar entrada em `.oxe/learning/CANDIDATES.ndjson`:
```json
{"id": "CAND-001", "type": "lesson|skill", "category": "blocker_pattern", "source_run": "swarm-YYYYMMDD-001", "pattern": "descrição do padrão detectado", "draft": "lição prescritiva em 1 frase: faça X ao invés de Y", "evidence": ["BLOCKERS.ndjson#T2", "reviews/T2-REVIEW.md"], "ts": "ISO8601"}
```

---

## Fase 3 — Atualização de LESSONS.md

Para cada candidato com `type = "lesson"`:

1. Verificar se já existe lição com mesma raiz (mesma categoria + padrão similar) em `.oxe/global/LESSONS.md`
2. **Se existe:** incrementar `Frequência` + atualizar `Última aplicação` (não duplicar)
3. **Se não existe:** adicionar nova entrada `C-NN-L1` com:
   - `Lição`: texto prescritivo (o que fazer, não o que aconteceu)
   - `Raiz`: causa raiz identificada
   - `Tipo`: spec | plan | execute | verify | process | agents
   - `Aplicar em`: qual workflow consome esta lição
   - `Status`: ativo
   - `Frequência`: 1
   - `Impacto`: alto | médio | baixo (baseado no severity do padrão)
   - `Última aplicação`: data do run

Atualizar índice (tabela de conteúdos) em LESSONS.md.

---

## Fase 4 — Atualização de lessons-metrics.json

Se `.oxe/lessons-metrics.json` existir (ou criar a partir do template):

Para cada lição atualizada ou criada:
```json
{
  "id": "C-NN-L1",
  "cycle": "C-NN",
  "applied_cycles": ["swarm-YYYYMMDD-001"],
  "outcomes": [{"run_id": "...", "result": "success|partial|failure", "ts": "..."}],
  "success_rate": 1.0,
  "status": "active",
  "deprecation_threshold": 0.5
}
```

**Regra de depreciação automática:** se `success_rate < 0.5` e `apply_count >= 3` → `status = deprecated`.

---

## Fase 5 — Candidatas a Skill

Para candidatos com `type = "skill"` (padrões recorrentes que podem virar persona/capability):

Verificar critérios de promoção:
- Padrão apareceu em 2+ runs diferentes, OU
- Padrão é um `success_pattern` com alta reprodutibilidade

Adicionar à `.oxe/learning/PROMOTION-QUEUE.md`:
```markdown
## SKILL-001 — <nome sugerido>

**Fonte:** <run_id>
**Categoria:** <category>
**Padrão:** <descrição>
**Draft do skill:** <esboço do comportamento que o skill encapsularia>
**Ação:** [ ] Revisar e promover com `/oxe-skill new <id>`
```

---

## Fase 6 — Atualização de REPO-MEMORY.md

Se o run gerou decisões arquiteturais ou pitfalls novos:

Adicionar entradas em `.oxe/memory/REPO-MEMORY.md`:
- Seção "Decisões Arquiteturais" para decisões tomadas pelo Coordinator
- Seção "Pitfalls Conhecidos" para blockers que ocorreram
- Seção "Padrões Validados" para success_patterns confirmados

Se o arquivo não existir, criá-lo a partir de `.oxe/templates/REPO-MEMORY.template.md`.

---

## Fase 7 — Eventos

Emitir para `.oxe/OXE-EVENTS.ndjson`:
```json
{"type": "RetroPublished", "payload": {"run_id": "...", "lessons_added": N, "lessons_updated": M}}
{"type": "LessonPromoted", "payload": {"lesson_id": "C-NN-L1", "frequency": N, "impact": "alto"}}
```

---

## Saída para o usuário (quando invocado explicitamente)

```
Learning Kernel — concluído
Run: <run_id>
Candidatos detectados: N
Lições adicionadas: X | atualizadas: Y | depreciadas: Z
Skills candidatas para revisão: M (ver .oxe/learning/PROMOTION-QUEUE.md)
REPO-MEMORY atualizado: sim | não
```

<success_criteria>
- [ ] CANDIDATES.ndjson populado com padrões detectados do run.
- [ ] LESSONS.md atualizado com dedup correto (sem duplicatas, Frequência incrementada).
- [ ] lessons-metrics.json atualizado com outcomes e success_rate.
- [ ] PROMOTION-QUEUE.md com skills candidatas (se houver).
- [ ] REPO-MEMORY.md atualizado com decisões e pitfalls.
- [ ] Eventos LessonPromoted emitidos.
- [ ] Nenhum arquivo de código do projeto modificado.
</success_criteria>
