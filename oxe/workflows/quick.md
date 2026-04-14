# OXE — Workflow: quick

<objective>
Registrar trabalho **rápido a médio** sem SPEC/PLAN completos: objetivo claro, passos curtos e uma verificação. Saída principal: **`.oxe/QUICK.md`** + atualização de **`.oxe/STATE.md`**.

Quando o trabalho envolve **2 ou mais domínios distintos** (ex.: backend + frontend, DB + API, CLI + UI), aplicar também o conceito de **Plan-Driven Dynamic Agents — lean**: agentes focados derivados dos passos do QUICK.md, criados para esta demanda específica, sem reutilização entre demandas. O modo com agentes cria também **`.oxe/quick-agents.json`**.

Usar quando: correção pontual, refactor local, feature pequena ou protótipo que **não** justifica critérios de aceite completos.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-planning.md` em modo lean. Mesmo sem plano formal completo, o quick deve explicitar objetivo, validação, riscos e condição de promoção.
- Seguir `oxe/workflows/references/flow-robustness-contract.md`. Quick continua leve, mas não pode fingir que existe plano formal quando ele não existe.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `QUICK.md` e `quick-agents.json` vivem em `.oxe/<active_session>/plan/`; sem sessão ativa, manter `.oxe/`.
- Ler `.oxe/STATE.md` e, se existirem, `OVERVIEW.md` e `STACK.md` em `.oxe/codebase/` para não contradizer o repo.
- Não apagar `SPEC.md` / `PLAN.md` se existirem; este fluxo é paralelo ou temporário.
- **Blueprint plan-agent:** este fluxo **não** reutiliza papéis (`role` / `scope`) de **`.oxe/plan-agents.json`**. Se existir `plan-agents.json` com **`oxePlanAgentsSchema: 2`** e `lifecycle.status` **não** for já `invalidated`, **invalidar** o blueprint após criar/substituir **`QUICK.md`**: `lifecycle: { "status": "invalidated", "since": "<ISO>", "invalidatedBy": "quick", "invalidatedReason": "oxe-quick substitui trilha focada do blueprint" }`. Actualizar **`.oxe/STATE.md`** — secção **Blueprint de agentes (sessão)**: **lifecycle_status** → `invalidated`, nota "invalidado por quick". Não escrever novas mensagens em **`.oxe/plan-agent-messages/`** para o `runId` invalidado.
- **Quick-agents anterior:** se existir **`.oxe/quick-agents.json`** com `status` diferente de `done` ou `invalidated`, invalidá-lo antes de criar o novo (`status: "invalidated", "since": "<ISO>", "reason": "novo quick iniciado"`).
</context>

<plan_driven_dynamic_agents_lean>
## Plan-Driven Dynamic Agents — lean (integrado ao Quick)

### Os três princípios que guiam este modo

**1. Spec-Driven Design**
O campo `## Objetivo` de **`QUICK.md`** é a **minispec**: define o que pode ser construído, os limites do escopo e o critério de "pronto" (bloco `## Verificar`). Nenhum agente pode adicionar escopo além desse objetivo. A minispec precede e restringe os agentes.

**2. Spec-Driven Development**
Os `## Passos` de **`QUICK.md`** são o **mini-plano**: cada passo é acionável, sequenciado e rastreável ao bloco `## Verificar`. Os agentes são **derivados dos passos** — os passos definem o trabalho; os agentes organizam quem faz o quê. Nunca o contrário.

**3. Plan-Driven Dynamic Agents**
Os agentes são criados **a partir dos passos**, **para esta demanda específica**, e são **invalidados** quando o quick termina ou é superado por um plano completo. Não há reuso de agentes entre demandas distintas. Cada new quick = novos agentes, se aplicável.

### Quando ativar PDDA no Quick

Ativar quando **qualquer** condição for verdadeira:
- Os passos tocam **2 ou mais domínios distintos** (ex.: API e UI, DB e cache, backend e CLI)
- O usuário pede explicitamente com `--agents`
- Há **5 ou mais passos** que se agrupam naturalmente em responsabilidades diferentes

**Não** ativar quando: todos os passos ficam no mesmo módulo ou camada, há ≤ 3 passos, ou o trabalho é puramente de conteúdo (docs, config).

**Se precisar de mais de 3 agentes:** o trabalho não é mais "quick" → promover para **`/oxe-plan-agent`**.

### Formato dos agentes no QUICK.md

Cada passo recebe uma anotação de agente (`<!-- agente: id -->`). Uma seção `## Agentes dinâmicos` é adicionada:

```markdown
## Agentes dinâmicos (lean PDDA)
> Derivados dos passos deste QUICK.md — spec-driven (objetivo restringe escopo) e plan-driven (passos definem tarefas).
> Criados para **esta demanda**. Invalidados ao promover para spec/plan ou ao iniciar novo quick.

| ID | Papel nesta demanda | Passos | Persona |
|----|---------------------|--------|---------|
| auth-backend | Especialista em JWT e middleware Express para este quick | 1–3 | executor |
| login-ui | Especialista em integração do formulário de login React | 4–5 | ui-specialist |
```

**Regras de desenho:**
- **`role`** deve ser específico ao domínio da demanda: não "Backend Developer" genérico, mas "Especialista em JWT para autenticação neste quick"
- **`persona`** usa as personas disponíveis: `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`
- Cada agente cobre steps **contíguos ou logicamente agrupados** (não intercalar responsabilidades)
- Máximo **3 agentes** por quick

### Arquivo `.oxe/quick-agents.json`

Criar junto ao QUICK.md quando PDDA estiver ativo (usar como base `oxe/templates/quick-agents.template.json`):

```json
{
  "oxeQuickAgentsSchema": 1,
  "quickId": "quick-<YYYY-MM-DD>-<6hex>",
  "quickRef": ".oxe/QUICK.md",
  "status": "active",
  "since": "<ISO agora>",
  "agents": [
    {
      "id": "auth-backend",
      "role": "Especialista em JWT e middleware Express para este quick",
      "persona": "executor",
      "steps": [1, 2, 3],
      "focus": "Implementar signing/verification de JWT e middleware de auth"
    },
    {
      "id": "login-ui",
      "role": "Especialista em integração do formulário de login React",
      "persona": "ui-specialist",
      "steps": [4, 5],
      "focus": "Integrar token JWT no componente Login e feedback de erro"
    }
  ]
}
```

**Lifecycle de `status`:** `active` → `done` (verify concluído com sucesso) | `invalidated` (novo quick/plan/plan-agent iniciado)

### Como `/oxe-execute` usa quick-agents

Quando **`quick-agents.json`** tiver `status: active` e QUICK.md existir:
- `/oxe-execute` adota o `role` e `persona` de cada agente para os steps atribuídos
- Cada agente trabalha **somente** nos steps listados em `steps[]`
- Não há protocolo de handoff entre agentes (lean: sem `.oxe/plan-agent-messages/`)
- Ao concluir todos os steps: sugerir `/oxe-verify` e marcar `quick-agents.json` → `status: done`

### Invalidação de quick-agents

| Evento | Ação sobre `quick-agents.json` |
|--------|-------------------------------|
| Novo `/oxe-quick` iniciado | `status: "invalidated"`, `reason: "novo quick"` |
| `/oxe-plan` ou `/oxe-plan-agent` chamado | `status: "invalidated"`, `reason: "promovido a plano"` |
| `/oxe-verify` confirma sucesso total | `status: "done"` |
| Invalidação manual pelo usuário | `status: "invalidated"`, `reason: "manual"` |
</plan_driven_dynamic_agents_lean>

## Perfil fast (modo trivial)

Uso **sem** novo slash: é o mesmo `/oxe-quick` com redação mínima.

- **Objetivo** — uma frase no `.oxe/QUICK.md`.
- **Passos** — lista numerada, **máximo 10**; cada passo acionável numa linha.
- **Verificar** — um comando de terminal **ou** checklist manual explícito.
- **Agentes dinâmicos** — seção opcional quando PDDA estiver ativo (ver acima).
- **Promover para spec/plan?** — preencher sempre; se qualquer gatilho abaixo for verdadeiro, resposta **sim** e parar de acumular trabalho no QUICK — passar a **`/oxe-spec`** (e depois discuss/plan conforme config).
- **Confiança formal do plano:** se ainda não houver `PLAN.md`, declarar explicitamente no QUICK que **não houve plano formal**; não inventar percentagem de confiança aqui.

O perfil fast **não** é uma segunda trilha: continua sujeito à mesma promoção obrigatória quando o trabalho deixa de ser trivial.

## Quando promover para spec + plan (obrigatório declarar no QUICK.md)

Promova **nesta sessão ou na próxima** se **qualquer** condição for verdadeira:

- Mais de **~8 arquivos** tocados ou previstos.
- Mudança de **contrato público** (API HTTP, schema de dados exposto, eventos, SDK).
- **Segurança**, **dados pessoais**, **auth** ou **conformidade** envolvidos.
- O próprio quick ficar com **mais de 10 passos** — dividir ou passar a SPEC.
- PDDA lean precisaria de **mais de 3 agentes** — promover para **`/oxe-plan-agent`**.

No final de **`.oxe/QUICK.md`**, mantenha a linha:

- **Promover para spec/plan?** `sim` | `não` + **uma linha** com o critério que aplicou.

Se **sim**, o próximo passo recomendado no chat é **`/oxe-spec`** (depois discuss/plan conforme config).

<process>
0. **Git safety check (pré-execução):** antes de criar ou substituir QUICK.md, verificar `git status` do projeto (se `.git` existir). Se houver mudanças não commitadas **não relacionadas** ao objetivo deste quick, alertar: *"Existem mudanças não commitadas. Quer commitar antes de começar este quick?"* — não bloquear a execução, apenas perguntar. Prosseguir se o usuário confirmar ou se não houver git.
1. Garantir `.oxe/` (usar template de STATE só se `STATE.md` não existir). Verificar `OBSERVATIONS.md` do escopo resolvido — se houver entradas `pendente` com impacto `all`, registrar como restrições nos **Passos** ou no **Contexto** do QUICK.md antes de finalizar; marcar as OBS como `incorporada → quick (data)`.
2. Avaliar se PDDA lean se aplica (ver `<plan_driven_dynamic_agents_lean>` — domínios distintos, 5+ passos, ou flag `--agents`).
3. Criar ou substituir **`QUICK.md`** no escopo resolvido com:
   - **Objetivo** — uma frase. *(Esta é a minispec: restringe o escopo de todos os agentes e passos.)*
   - **Contexto** — 2–5 bullets (arquivos/pastas já vistos).
   - **Passos** — lista numerada, **máximo 10** passos acionáveis; se PDDA ativo, anotar `<!-- agente: id -->` em cada passo.
   - **Agentes dinâmicos** *(somente se PDDA ativo)* — tabela com ID, papel, steps, persona.
   - **Verificar** — pelo menos um: comando de terminal (ex.: `npm test`) **ou** checklist manual explícito. *(Este é o critério de aceite da minispec.)*
   - **Promover para spec/plan?** — conforme seção acima.
   - **Plano formal existente?** — `não`; usar `sim` apenas se este quick estiver ancorado a um `PLAN.md` já aprovado no mesmo escopo.
   - **Scope check (inline):** durante a implementação, ao fim de cada passo, verificar se algum critério de promoção foi atingido (>8 arquivos, contrato público, segurança, >10 passos). Se sim, pausar e apresentar: *"O escopo deste quick cresceu: [critério atingido]. Recomendar promoção para /oxe-spec. Continuar mesmo assim?"*
4. Se PDDA ativo, criar **`quick-agents.json`** no escopo resolvido usando `oxe/templates/quick-agents.template.json`:
   - Gerar `quickId` novo (`quick-<YYYY-MM-DD>-<6hex>`).
   - `status: "active"`, `since: "<ISO agora>"`.
   - Preencher `agents[]` derivando de cada grupo de passos do QUICK.md.
5. Se existir **`.oxe/plan-agents.json`** com schema 2 e lifecycle ainda não `invalidated`, aplicar a invalidação descrita em **context** (actualizar JSON + **STATE.md** — blueprint de agentes).
6. Se existir **`.oxe/quick-agents.json`** anterior com `status` não-terminal, invalidá-lo (ver **context**).
7. Atualizar **`.oxe/STATE.md`**: fase `quick_active`, próximo passo `oxe:execute` ou implementação manual + `oxe:verify`; se PDDA ativo, registrar `quick_agents_status: active` e `quick_id: <quickId>`.
8. Responder no chat com resumo em ≤10 linhas, nesta ordem:
   - **Objetivo**
   - **Plano**
   - **Validação**
   - **Riscos / assumptions**
   - **Próximo passo**
   Se promover = sim, destacar **`/oxe-spec`** como próximo passo lógico; se blueprint plan-agent foi invalidado, mencionar **`/oxe-plan-agent`** para novo roteiro.
9. **Sugestão de commit (pós-verify bem-sucedido):** após o bloco **Verificar** passar, sugerir ao usuário: *"Quick concluído. Commitar? `git add -p && git commit -m 'quick: <objetivo em uma linha>'`"* — apenas sugerir, não executar automaticamente.
</process>

<success_criteria>
- [ ] `.oxe/QUICK.md` existe com objetivo (minispec), passos (mini-plano) e bloco **Verificar** (critério de aceite).
- [ ] `STATE.md` reflete fase `quick_active` e próximo passo coerente.
- [ ] Fica explícito quando **promover** para spec/plan (regra acima + campo no arquivo).
- [ ] Scope creep gate verificado ao fim de cada passo; se critério atingido, pausa apresentada ao usuário.
- [ ] Após verify bem-sucedido, sugestão de commit apresentada (não executada automaticamente).
- [ ] Se havia blueprint schema 2 activo, `plan-agents.json` e `STATE.md` reflectem **`invalidated`** por quick.
- [ ] Se PDDA ativo: `quick-agents.json` existe com `status: active`, `quickId` único, agentes com `role` específico à demanda, `steps` alinhados aos passos do QUICK.md; seção `## Agentes dinâmicos` presente no QUICK.md.
- [ ] Se PDDA ativo: máximo 3 agentes; se mais necessário, QUICK.md declara `Promover para spec/plan?: sim` com razão "necessita > 3 agentes".
</success_criteria>
