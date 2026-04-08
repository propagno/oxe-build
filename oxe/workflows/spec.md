# OXE — Workflow: spec

<objective>
Conduzir as **5 fases** do processo de especificação e produzir dois artefatos:

1. **`.oxe/SPEC.md`** — contrato formal com critérios de aceite estáveis (A1, A2, …) e coluna **Como verificar**.
2. **`.oxe/ROADMAP.md`** — fases de entrega mapeadas a requisitos (R-ID) e critérios (A*).

**Foco em redução de requisições:** as fases são estruturadas para extrair o máximo de informação por rodada — nunca uma pergunta por vez, sempre blocos coesos.

Para trabalho **muito pequeno** que não justifica spec completa: redirecionar para **`oxe:quick`**.

Se **`.oxe/config.json`** tiver `discuss_before_plan: true`: mencionar no final da Fase 5 que o próximo passo é **`oxe:discuss`** antes do plano.
</objective>

<context>
**Pré-requisito preferível:** scan executado. Se não existir, mencionar na spec que o mapa está pendente.

**Contrato de robustez:** seguir `oxe/workflows/references/flow-robustness-contract.md`. Antes de escrever, resolver artefatos obrigatórios, validar pré-condições e só então produzir a spec. O output desta fase deve deixar evidência estruturada suficiente para o `plan` decidir se o plano é realmente o melhor disponível.

**Resolução de sessão:** antes de ler ou escrever artefatos desta trilha, resolver `active_session` em `.oxe/STATE.md` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa:
- `SPEC.md`, `ROADMAP.md` e `DISCUSS.md` vivem em `.oxe/<active_session>/spec/`
- `OBSERVATIONS.md`, `RESEARCH.md` e `research/` seguem o escopo da sessão
- `LESSONS.md` continua global em `.oxe/global/LESSONS.md`
- sem sessão ativa, manter o modo legado na raiz `.oxe/`

Ler no início:
- `.oxe/STATE.md` — fase atual, decisões, workstream ativo
- `.oxe/codebase/OVERVIEW.md` e `STACK.md` se existirem — não contradizer o repo
- **OBS do escopo ativo** — se houver entradas `pendente` com impacto `spec` ou `all`, incorporá-las na Fase 3 (Requisitos) e marcá-las `incorporada → spec (data)` após uso
- **`.oxe/global/LESSONS.md`** — se existir, ler entradas com `Aplicar em: spec` e status `ativo`. Usar como restrições explícitas ou alertas durante a Fase 1 (perguntas) e Fase 3 (requisitos). Exemplo: se uma lição diz "perguntar explicitamente sobre integração com X", adicionar essa pergunta no Bloco B da Fase 1.

**Brownfield (COBOL, JCL, copybooks, VB6, SP):** quando o objetivo for documentar ou planear migração, ver **`oxe/workflows/references/legacy-brownfield.md`** — épicos por trilha, critérios A* verificáveis por Grep/leitura/checklist.

Usar templates: **`oxe/templates/SPEC.template.md`** e **`oxe/templates/ROADMAP.template.md`**.
</context>

<fase_1_perguntas>
## Fase 1 — Perguntas

**Objetivo:** entender completamente a ideia antes de qualquer escrita de artefato.

**Regra de ouro:** nunca uma pergunta por vez — sempre um **bloco coeso** de 3-5 perguntas por rodada. Máximo **3 rodadas**; sinalize quando achar que tem entendimento completo e peça confirmação antes de avançar.

**Blocos de perguntas (adaptar ao contexto):**

*Bloco A — Objetivo e motivação:*
- Qual o problema central que isso resolve? Quem se beneficia?
- Há uma solução atual (mesmo que ruim)? O que falha nela?
- Como o sucesso será medido — qual o indicador mais importante?

*Bloco B — Restrições e tecnologia:*
- Quais tecnologias ou frameworks são obrigatórios ou proibidos?
- Há restrições de prazo, orçamento, tamanho do time ou infraestrutura?
- Quais integrações existentes precisam ser mantidas?

*Bloco C — Casos extremos e escopo:*
- Quais cenários de erro ou casos extremos são críticos de tratar na v1?
- O que definitivamente está **fora** do escopo desta entrega?
- Há comportamento esperado que você sabe que não é óbvio?

**Estratégia de rodadas:**
- Rodada 1: blocos A + B (entendimento geral)
- Rodada 2: bloco C + clarificações específicas (se necessário)
- Rodada 3 (máx): apenas se ainda houver ambiguidade crítica
- Após rodada 3: avançar para Fase 2 mesmo com suposições explícitas

**Ao final:** "Acho que entendi completamente. Confirma antes de avançarmos para pesquisa/requisitos? [resumo em 3-5 bullets]"
</fase_1_perguntas>

<fase_2_pesquisa>
## Fase 2 — Pesquisa (opcional, recomendada)

**Objetivo:** investigar domínios incertos antes de escrever requisitos.

**Proposta ao usuário:** com base na Fase 1, listar 2-4 áreas de investigação sugeridas e perguntar quais investigar. Exemplos:
- "Há 3 áreas com incerteza técnica: autenticação JWT, integração com Stripe, e deploy em edge. Quer investigar alguma antes de avançar para requisitos?"

**Se aprovado:**
- Criar notas de pesquisa datadas em `research/YYYY-MM-DD-<slug>.md` no escopo ativo (usar fluxo de `research.md`)
- Atualizar `RESEARCH.md` no mesmo escopo
- Consolidar descobertas relevantes antes de avançar para Fase 3

**Se pulado:** registrar em `SPEC.md` as áreas de incerteza como suposições explícitas.

**Explorações grandes / sistemas legado:** ver **`oxe/workflows/references/legacy-brownfield.md`** — progressive disclosure por área, multiple sessions, epicos por trilha.
</fase_2_pesquisa>

<fase_3_requisitos>
## Fase 3 — Requisitos

**Objetivo:** extrair uma tabela clara de requisitos com versionamento (v1/v2/fora).

**Incorporar primeiro:** verificar `.oxe/OBSERVATIONS.md` por entradas `pendente` com impacto `spec` ou `all` — incorporar aqui antes de finalizar a tabela.

**Formato da tabela:**

| R-ID | Requisito | Versão | Critério de aceite |
|------|-----------|--------|--------------------|
| R1 | [o que o sistema deve fazer] | v1 | A1 — [como verificar] |
| R2 | [outro requisito] | v1 | A2 — [como verificar] |
| R3 | [requisito futuro] | v2 | A3 — [quando implementado] |
| R4 | [fora do escopo] | fora | — |

**Definições:**
- **v1** = MVP essencial; entra no próximo `/oxe-plan`
- **v2** = evolução futura; entra em ciclos seguintes
- **fora** = explicitamente descartado desta entrega

**Apresentar ao usuário para validação** antes de avançar para Fase 4. Se ajustar: atualizar tabela e repetir até aprovação.
</fase_3_requisitos>

<fase_4_roteiro>
## Fase 4 — Roteiro

**Objetivo:** criar fases de entrega mapeadas aos requisitos v1 e escrever `ROADMAP.md` no escopo ativo da sessão.

**Lógica de agrupamento:**
- Agrupar requisitos v1 em fases por **dependência técnica** e **valor entregável**
- Cada fase deve ter resultado demonstrável (não apenas código interno)
- Fase 1 = o que `/oxe-plan` implementará no próximo ciclo
- Fases 2+ = ciclos futuros de spec→plan→execute→verify

**Escrever `ROADMAP.md`** usando `oxe/templates/ROADMAP.template.md` no escopo ativo:

```markdown
---
oxe_doc: roadmap
status: draft
updated: <data>
spec_ref: SPEC.md
---

## Fase 1 — [Nome]
**Requisitos:** R1, R3
**Critérios de aceite:** A1, A2, A3
**Escopo:** ...

## Fase 2 — [Nome]
**Requisitos:** R2, R5
**Critérios de aceite:** A4, A5
**Escopo:** ...

## Fora do escopo (v2+)
- R4: [descrição] — motivo
```
</fase_4_roteiro>

<auto_reflexao>
## Auto-reflexão semântica (executa automaticamente antes da Fase 5)

**Objetivo:** o agente critica a própria spec antes de apresentá-la ao usuário. Sem requisição extra — é um passe interno de qualidade semântica.

Percorrer esta lista de verificação:

| # | Verificação | Ação se falhar |
|---|-------------|----------------|
| 1 | **Contradições:** algum requisito v1 contradiz diretamente uma resposta da Fase 1? (ex.: usuário disse "sem auth" mas R4 implica sessões) | Voltar à Fase 3 e corrigir o requisito |
| 2 | **Verificabilidade:** todo critério A* tem "Como verificar" executável sem acesso ao ambiente de produção do usuário? | Refinar para verificação possível no CI/agente ou marcar "verificação manual necessária" |
| 3 | **Escopo creep:** algum requisito v1 foi adicionado que NÃO emergiu da Fase 1 nem da Fase 2? | Mover para v2 ou justificar inclusão em v1 |
| 4 | **Conflito com stack:** algum requisito v1 pressupõe tecnologia ou capacidade que `STACK.md` indica ausente? (ex.: requer WebSocket mas stack usa REST puro) | Marcar como suposição explícita ou remover |
| 5 | **Critérios vagos:** algum A* usa linguagem não-mensurável ("deve ser rápido", "interface amigável") sem métrica? | Refinar: "resposta < 200ms p95", "WCAG 2.1 AA" |
| 6 | **Dependências implícitas:** algum requisito v1 pressupõe que outro requisito (v2 ou fora) já esteja implementado? | Tornar dependência explícita ou reordenar versioning |

**Resultado obrigatório antes de avançar:**
- **0 problemas** → avançar para Fase 5 normalmente.
- **1–2 problemas** → corrigir inline na spec, anotar o que foi ajustado em 1 linha.
- **3+ problemas** → apresentar lista ao usuário com a Fase 3 revisada (não reiniciar do zero).

O resultado desta reflexão é **invisível ao usuário** — é trabalho interno do agente. Somente os ajustes feitos aparecem na spec final.

**Saída estruturada obrigatória para o plan:** após esta reflexão, a SPEC final deve deixar explícitos:
- requisitos estáveis;
- ambiguidades restantes;
- conflitos resolvidos ou ainda abertos;
- evidências faltantes que podem reduzir a confiança do plano.
</auto_reflexao>

<fase_5_aprovacao>
## Fase 5 — Aprovação e próximo passo

**Objetivo:** confirmar o roteiro com o usuário e redirecionar para o plano.

**Apresentar resumo:**
- Objetivo em 1 frase
- Requisitos v1 (N itens), v2 (M itens), fora (K itens)
- Roteiro: Fase 1 → N critérios; Fase 2 → M critérios
- Critérios de aceite da Fase 1: A1, A2, …

**Perguntar ao usuário:**
> "Roteiro aprovado? Quer gerar o plano agora ou ajustar algo antes?"

**Se aprovado — oferecer os próximos passos:**

| Opção | Quando usar | Próximo passo |
|-------|-------------|---------------|
| Plano simples | Tarefa clara, sem orquestração multi-agente | `/oxe-plan` |
| Plano com agentes | Time distribuído, domínios distintos, ondas paralelas | `/oxe-plan-agent` |
| Discutir antes | `discuss_before_plan: true` em config, ou risco técnico | `/oxe-discuss` → `/oxe-plan` |

**Se ajustar:** voltar à fase indicada (Requisitos, Roteiro ou Perguntas) e repetir.

**Ao finalizar:**
- Marcar `ROADMAP.md` → `status: approved`
- Atualizar `STATE.md`: `phase: spec_ready`, próximo passo conforme escolha
</fase_5_aprovacao>

<process>
1. Ler `.oxe/STATE.md`, `OVERVIEW.md`, `STACK.md` e `OBSERVATIONS.md` do escopo ativo (verificar pendentes).
2. **Fase 1 — Perguntas:** enviar bloco coeso de 3-5 perguntas; máx 3 rodadas; confirmar entendimento.
3. **Fase 2 — Pesquisa:** propor áreas de investigação; aguardar aprovação; executar se aprovado.
4. **Fase 3 — Requisitos:** extrair tabela R-ID com v1/v2/fora e critérios A*; incorporar OBS pendentes; apresentar para validação.
5. **Fase 4 — Roteiro:** agrupar requisitos v1 em fases; escrever `ROADMAP.md` no escopo ativo.
6. Escrever **`SPEC.md`** usando `oxe/templates/SPEC.template.md` no escopo ativo:
   - Frontmatter YAML (`oxe_doc: spec`, `status`, `updated`, `inputs`)
   - Objetivo, Escopo (dentro/fora), Critérios de aceite (tabela A*), Suposições e riscos, Referências
   - Preservar chaves existentes se SPEC.md já existir; atualizar `updated:`
6b. **Auto-reflexão:** executar integralmente o bloco `<auto_reflexao>` antes de avançar. Corrigir a spec conforme necessário. Não apresentar a lista de verificação ao usuário — apenas a spec corrigida.
7. **Fase 5 — Aprovação:** apresentar resumo, aguardar aprovação do roteiro, redirecionar.
8. Atualizar **`.oxe/STATE.md`** global: `phase: spec_ready`, próximo passo e referência curta à sessão ativa quando existir.
9. Marcar OBS incorporadas em `OBSERVATIONS.md` do escopo ativo se houver pendentes de impacto `spec`.
</process>

<success_criteria>
- [ ] `SPEC.md` existe no escopo correto (`spec/` da sessão ou `.oxe/` legado) com critérios A* e coluna Como verificar; `STATE.md` global atualizado.
- [ ] `ROADMAP.md` existe no mesmo escopo com fases mapeadas a R-IDs e A*, status `approved` (ou `draft` se usuário não confirmou).
- [ ] Tabela de requisitos R-ID foi apresentada e validada (v1/v2/fora) antes do roteiro.
- [ ] Usuário foi consultado no gate da Fase 5 e escolheu o próximo passo.
- [ ] OBS pendentes com impacto `spec` foram incorporadas e marcadas `incorporada`.
- [ ] Máximo 3 rodadas de perguntas utilizadas — não mais.
</success_criteria>
