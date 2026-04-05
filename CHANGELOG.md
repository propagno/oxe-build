# Changelog — OXE CLI (`oxe-cc`)

Todas as versões seguem [Semantic Versioning](https://semver.org/). As mudanças mais recentes aparecem primeiro.

---

## [0.6.3] — 2026-04-04

### Corrigido
- `security_in_verify` agora é reconhecido como chave válida em `.oxe/config.json` (não mais rejeitado pelo doctor como "unknown key")
- `plan-agents.schema.json`: enum atualizado de `[1, 2]` para `[2, 3]`; campos `persona` e `model_hint` adicionados ao schema dos agentes

### Adicionado
- **`/oxe-retro` sugerido automaticamente** pelo `oxe-cc status` quando `phase: verify_complete` e `.oxe/LESSONS.md` ainda não existe
- **`health.parseLastRetroDate(stateText)`** — parseia campo `last_retro: YYYY-MM-DD` do STATE.md
- **`health.isStaleLessons(retroDate, maxDays)`** — detecta se LESSONS.md está desatualizado (par de `isStaleScan`)
- **`health.planAgentsWarnings(target)`** — avisa sobre schema 1 (legado) e `model_hint` inválido em `plan-agents.json`
- **`parseState()`** retorna novo campo `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `config.template.json` inclui `security_in_verify: false` por padrão
- `plan-agents.template.json` inclui campo `persona` no agente-exemplo
- Melhorias de workflow: `obs.md` (tabela de classificação de impacto), `verify.md` (success_criteria camadas 5+6), `next.md` (flag de promoção QUICK→spec), `quick.md` (incorporação de OBSERVATIONS), `plan.md` (nota de replan + plan-agents sync)
- `AGENTS.md` atualizado para v0.6.x

### Tipos TypeScript
- `ParsedState` inclui `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `health.*` expõe `parseLastRetroDate`, `isStaleLessons`, `planAgentsWarnings`

---

## [0.6.2] — 2026-04-04

### Adicionado
- **`/oxe-retro`** — workflow de retrospectiva de ciclo; sintetiza 3–5 lições prescritivas em `.oxe/LESSONS.md`
- `oxe/templates/LESSONS.template.md`
- Correções de consistência de schema (plan-agent.md, verify.md): referências atualizadas para schema v3

### Alterado
- README: tabela "Como cada comando fica mais inteligente" expandida com loop, security, research thinking_depth, model_hint
- Cadeia de help (`oxe.md`) atualizada para incluir `/oxe-retro` após verify

---

## [0.6.1] — 2026-04-04

### Adicionado
- **`/oxe-security`** — auditoria OWASP Top 10 filtrada pelo stack; produz `.oxe/SECURITY.md` com achados P0/P1/P2
- **`/oxe-loop`** — execução iterativa de onda com retries automáticos e diagnóstico inline
- **Model hints** em `plan-agents.json` schema v3: campo `model_hint` (`fast | balanced | powerful`) por agente
- **Thinking depth** em `/oxe-research`: classificação `surface | standard | deep` com raciocínio estendido para `deep`
- Integração automática de security no verify via `security_in_verify: true` (Camada 6)
- `oxe/templates/SECURITY.template.md`

---

## [0.6.0] — 2026-04-04

### Adicionado
- Workflow `/oxe-project` unificando `milestone`, `workstream`, `checkpoint`
- `/oxe-obs` com propagação automática para R-IDs e Tns afetados
- Auto-reflexão semântica em `/oxe-spec` (Fase 4b): detecta contradições e escopo creep antes da aprovação
- Modo de execução A/B/C em `/oxe-execute` (Completo / Por onda / Por tarefa)
- Debug inline automático em falhas de execute
- 4 profiles de execução: `balanced`, `strict`, `fast`, `legacy`
- Sistema de personas para agentes (`oxe/personas/`)
- Plugin lifecycle (`.oxe/plugins/*.cjs`)
- `scale_adaptive`: scan sugere profile pelo tamanho do projeto

---

## [0.5.0] — anterior

Versões anteriores não documentadas neste arquivo.
