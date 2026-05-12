# OXE — Workflow: swarm/scout (Scout Agent)

<objective>
Executar reconhecimento do codebase antes que qualquer Builder toque um arquivo.
Produz o mapa completo de arquivos relevantes, padrões, riscos e candidatos a testes —
informação que permite ao Coordinator fazer decomposição e File Ownership sem surpresas.
</objective>

<context>
- Invocado por `swarm-mode.md` Fase 2.
- Aplicar `oxe/workflows/references/reasoning-discovery.md`: explorar antes de concluir; separar fatos, inferências e lacunas.
- Persona: `researcher.md` (exploração) + instinto de `executor.md` (write set mínimo — Scout não modifica código).
- Nunca modifica arquivos do projeto. Apenas lê e produz artefatos em `.oxe/swarm/scout/`.
- Parâmetros de entrada: `objective`, `intent_tags`, `run_id`.
</context>

---

## Fase 1 — Mapeamento de Módulos

Com base nos `intent_tags`, identificar os módulos do projeto relevantes ao objetivo:

1. Usar Glob para localizar diretórios e arquivos por padrão (ex.: `src/**/*.ts`, `app/**/*.tsx`)
2. Para cada módulo relevante:
   - Nome do módulo
   - Caminho raiz
   - Responsabilidade (inferida de exports, README local, comentários de topo de arquivo)
   - Tamanho (estimativa de linhas, arquivos)
   - Dependências internas (quais outros módulos ele importa)

Gravar `.oxe/swarm/scout/CODEBASE-MAP.md`:
```markdown
# Codebase Map — <run_id>

**Objetivo:** <texto>
**Domínios relevantes:** <intent_tags>

## Módulos identificados

| Módulo | Caminho | Responsabilidade | Arquivos | Dependências |
|--------|---------|-----------------|----------|--------------|
| auth   | src/auth/ | Autenticação JWT | 8 | db, config |
```

---

## Fase 2 — Padrões de Código

Identificar as convenções em uso nos módulos relevantes:

- Naming conventions (camelCase? snake_case? PascalCase para classes?)
- Estrutura de arquivos (barrel exports? index.ts por pasta?)
- Padrão de imports (absolute paths? aliases? relative?)
- Padrão de testes (Jest? Vitest? Localização dos testes? `__tests__/` ou `.spec.ts` colocado?)
- Padrão de erros (throw? Result type? Either? callbacks?)
- Padrão de tipos (interfaces separadas? types inline? schemas Zod?)

Gravar `.oxe/swarm/scout/PATTERNS.md`:
```markdown
# Padrões Detectados — <run_id>

## Naming
- ...

## Estrutura de arquivos
- ...

## Testes
- ...

## Tipos
- ...
```

---

## Fase 3 — Mapa de Riscos

Para cada arquivo candidato a modificação:

| Critério | Risk Level |
|----------|-----------|
| Importado por 5+ outros módulos | high |
| Contém lógica de auth / pagamento / dados sensíveis | high |
| Arquivo de configuração global (env, db config) | high |
| Módulo com cobertura de testes < 50% | med |
| Arquivo tocado nos últimos 7 dias (git log) | med |
| Arquivo isolado com testes adequados | low |

Gravar `.oxe/swarm/scout/RISK-MAP.md`:
```markdown
# Risk Map — <run_id>

| Arquivo | Risk Level | Motivo | Agente sugerido |
|---------|-----------|--------|----------------|
| src/auth/jwt.ts | high | auth crítica + 12 importadores | builder-backend |
```

---

## Fase 4 — File Candidates

Para cada arquivo que provavelmente precisa ser criado ou modificado para satisfazer o objetivo:

Gravar `.oxe/swarm/scout/FILE-CANDIDATES.json`:
```json
[
  {
    "file": "src/import/import.service.ts",
    "action": "create | modify",
    "domain": "backend",
    "risk_level": "low",
    "suggested_agent": "builder-backend",
    "rationale": "novo service de importação"
  }
]
```

---

## Fase 5 — Test Candidates

Para cada arquivo de código candidato, identificar o arquivo de teste correspondente:

Gravar `.oxe/swarm/scout/TEST-CANDIDATES.json`:
```json
[
  {
    "code_file": "src/import/import.service.ts",
    "test_file": "src/import/import.service.spec.ts",
    "exists": false,
    "existing_coverage_pct": null,
    "test_strategy": "unit | integration | e2e"
  }
]
```

---

## Fase 6 — Handoff para Coordinator

Emitir mensagem em `.oxe/swarm/MESSAGES.ndjson`:
```json
{
  "ts": "ISO8601",
  "from": "scout",
  "to": "coordinator",
  "type": "handoff_summary",
  "run_id": "...",
  "payload": {
    "modules_mapped": N,
    "files_candidates": M,
    "high_risk_files": K,
    "patterns_detected": ["..."],
    "ready_for_task_graph": true
  }
}
```

Atualizar `.oxe/swarm/SWARM-RUN.json` → `agents.scout.status = "done"`.

<success_criteria>
- [ ] CODEBASE-MAP.md com todos os módulos relevantes ao objetivo.
- [ ] PATTERNS.md com pelo menos naming, estrutura e testes.
- [ ] RISK-MAP.md com risk_level para cada arquivo candidato.
- [ ] FILE-CANDIDATES.json com ação (create/modify) e agente sugerido.
- [ ] TEST-CANDIDATES.json com estratégia por arquivo.
- [ ] Nenhum arquivo do projeto foi modificado.
- [ ] Mensagem de handoff emitida para coordinator.
</success_criteria>
