# OXE — Workflow: conduct (Conductor Agent)

<objective>
Ponto de entrada para objetivos em linguagem natural que requerem execução autônoma.
O Conductor classifica a complexidade do objetivo, recupera memória relevante, carrega as personas adequadas e decide se o trabalho será feito em **Agent Mode** (Conductor age sozinho) ou **Swarm Mode** (equipe de agentes especializados).

Invocado automaticamente por `oxe.md` quando o input é um **objetivo ou tarefa de implementação** — não uma pergunta situacional, não um pedido de roteamento simples.
</objective>

<context>
- Este workflow **gera artefatos**: `AGENT-SESSION.json` (Agent Mode) ou `SWARM-RUN.json` (Swarm Mode).
- Aplicar `oxe/workflows/references/reasoning-planning.md` para a fase de decisão.
- Aplicar `oxe/workflows/references/reasoning-execution.md` quando agir diretamente (Agent Mode).
- Lê: `.oxe/STATE.md`, `.oxe/memory/REPO-MEMORY.md` (se existir), `.oxe/global/LESSONS.md`.
- Nunca expande escopo além do objetivo declarado. Discoveries vão para OBSERVATIONS.md.
</context>

---

## Fase 1 — Intent Classification

Ler o objetivo do usuário e classificar em uma das três categorias:

| Score | Critérios | Modo |
|-------|-----------|------|
| **simples** | 1 domínio, ≤ 3 arquivos esperados, mudança isolada (texto, config, estilo, bug local) | Agent Mode |
| **médio** | 1–2 domínios, 3–8 arquivos, lógica nova mas contida (endpoint, componente, função) | Agent Mode |
| **complexo** | 3+ domínios, 8+ arquivos, ou: nova feature com storage + backend + frontend + testes | Swarm Mode |

**Sinais de complexidade que forçam Swarm Mode:**
- Objetivo menciona: "módulo", "sistema", "fluxo completo", "histórico", "relatório", "pipeline"
- Objetivo envolve: banco de dados + API + UI simultaneamente
- Objetivo requer scaffold de múltiplos arquivos em diretórios diferentes
- Estimativa de ondas > 2 no PLAN.md

**Saída desta fase:**
```
intent_score: simples | médio | complexo
intent_tags: [lista de domínios detectados: backend, frontend, storage, auth, infra, test, docs, config]
objective_summary: resumo em 1 frase do que o usuário quer
```

---

## Fase 2 — Memory Retrieval

Ler as camadas de memória na ordem:

1. `.oxe/STATE.md` — estado atual da trilha (fase, sessão ativa, run ativo)
2. `.oxe/memory/REPO-MEMORY.md` — memória cross-session (decisões, pitfalls, preferências) — **se existir**
3. `.oxe/global/LESSONS.md` — lições de ciclos anteriores com `Status: ativo` e `Impacto: alto` — **se existir**
4. `.oxe/OBSERVATIONS.md` — observações pendentes com `Status: pendente` — **se existir**

Para cada camada lida, extrair apenas o que é **relevante ao objetivo atual** (usar intent_tags como filtro).

Gravar snapshot do contexto injetado:
- Agent Mode → `.oxe/agent/MEMORY-INJECTIONS.md`
- Swarm Mode → `.oxe/swarm/DECISIONS.md` (seção "Contexto de Memória")

**Se `.oxe/memory/` não existir:** pular silenciosamente e continuar.

---

## Fase 3 — Skill Loading

Com base nos `intent_tags`, selecionar as personas aplicáveis:

| Tag | Persona primária | Persona secundária |
|-----|------------------|--------------------|
| backend | executor | architect |
| frontend | ui-specialist | executor |
| storage | db-specialist | architect |
| auth | architect | executor |
| infra | architect | — |
| test | executor | verifier |
| docs | executor | — |
| config | executor | — |
| research | researcher | — |
| debug | debugger | — |

Registrar personas selecionadas em:
- Agent Mode → `.oxe/agent/SKILLS-LOADED.json`
- Swarm Mode → informação vai para fase de atribuição de papéis

**Resolução:** tentar `oxe/personas/<id>.md` (global) → `.oxe/skills/active/<id>.md` (projeto). Usar o primeiro encontrado.

---

## Fase 4 — Decisão de Modo

Com base no `intent_score`:

### Se simples ou médio → Agent Mode

Executar `oxe/workflows/agent-mode.md` com:
- `objective`: objetivo original do usuário
- `intent_tags`: tags detectadas
- `primary_persona`: persona primária selecionada
- `memory_context`: contexto de memória extraído

### Se complexo → Swarm Mode

Executar `oxe/workflows/swarm-mode.md` com:
- `objective`: objetivo original do usuário
- `intent_tags`: tags detectadas
- `memory_context`: contexto de memória extraído

**Comunicar ao usuário antes de prosseguir:**

Para Agent Mode:
```
Conductor: modo Agent (complexidade: [score])
Persona: [primary_persona]
Domínios: [intent_tags]
Memória aplicada: [sim/não — N lições, M pitfalls]

Executando...
```

Para Swarm Mode:
```
Conductor: modo Swarm (complexidade: complexo)
Domínios: [intent_tags]
Agentes: Scout + [N] Builders + Reviewer + Verifier
Memória aplicada: [sim/não — N lições, M pitfalls]

Iniciando Scout...
```

---

## Artefatos gerados por este workflow

| Artefato | Modo | Caminho |
|----------|------|---------|
| AGENT-SESSION.json | Agent | `.oxe/agent/AGENT-SESSION.json` |
| SKILLS-LOADED.json | Agent | `.oxe/agent/SKILLS-LOADED.json` |
| MEMORY-INJECTIONS.md | Agent | `.oxe/agent/MEMORY-INJECTIONS.md` |
| SWARM-RUN.json | Swarm | `.oxe/swarm/SWARM-RUN.json` |
| DECISIONS.md | Swarm | `.oxe/swarm/DECISIONS.md` |

<success_criteria>
- [ ] Intent score determinado (simples/médio/complexo).
- [ ] Memória lida e filtrada por intent_tags.
- [ ] Persona(s) selecionada(s) e registrada(s).
- [ ] Usuário informado do modo escolhido antes da execução.
- [ ] Delegação correta: agent-mode.md ou swarm-mode.md.
- [ ] Nenhum artefato de SPEC/PLAN criado por este workflow.
</success_criteria>
