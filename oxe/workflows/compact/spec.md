<!-- variante compacta de oxe/workflows/spec.md (OXB-132): gerada por scripts/build-compact-workflows.cjs. Em dúvida, leia a completa. -->
# OXE — Workflow: spec
<objective>
1. **`.oxe/SPEC.md`** — contrato formal com critérios de aceite estáveis (A1, A2, …) e coluna **Como verificar**.
2. **`.oxe/ROADMAP.md`** — fases de entrega mapeadas a requisitos (R-ID) e critérios (A*).
**Foco em redução de requisições:** as fases são estruturadas para extrair o máximo de informação por rodada — nunca uma pergunta por vez, sempre blocos coesos.
Para trabalho **muito pequeno** que não justifica spec completa: redirecionar para **`oxe:quick`**.
Se **`.oxe/config.json`** tiver `discuss_before_plan: true`: mencionar no final da Fase 5 que o próximo passo é **`oxe:discuss`** antes do plano.
</objective>
<context>
**Contrato de robustez:** seguir `oxe/workflows/references/flow-robustness-contract.md`. Antes de escrever, resolver artefatos obrigatórios, validar pré-condições e só então produzir a spec. O output desta fase deve deixar evidência estruturada suficiente para o `plan` decidir se o plano é realmente o melhor disponível.
**Contrato de indução da SPEC:** a SPEC deve sair forte o suficiente para que o usuário não precise compensar lacunas "no braço" durante o PLAN. Sempre extrair ou materializar explicitamente:
- restrições técnicas obrigatórias e proibições relevantes;
- fluxos obrigatórios da v1;
- blocos obrigatórios da interface;
- `EXECUTION-RUNTIME.md`, `CHECKPOINTS.md` e `memory/` do escopo ativo se existirem — usar como contexto auxiliar, nunca como substituto da SPEC
- Se o problema tocar Azure, ler `.oxe/cloud/azure/profile.json`, `auth-status.json` e `INVENTORY.md` antes de fechar requisitos; se o inventário estiver ausente ou stale, exigir discovery via `oxe-cc azure sync` antes de consolidar a spec
</context>
## Fase 1 — Perguntas
**Regra de ouro:** nunca uma pergunta por vez — sempre um **bloco coeso** de 3-5 perguntas por rodada. Máximo **3 rodadas**; sinalize quando achar que tem entendimento completo e peça confirmação antes de avançar.
- Quais tecnologias ou frameworks são obrigatórios ou proibidos?
- quais anchors, fixtures ou investigações serão obrigatórios para permitir `Confiança > 90%` no plano.
## Fase 2 — Pesquisa (opcional, recomendada)
<domain_question_library>
## Biblioteca de perguntas por domínio
Complemento adaptativo para a Fase 1. Quando o domínio for confirmado (via scan ou resposta da Fase 1), adicionar o bloco correspondente às perguntas de rodada 2 ou 3. **Nunca adicionar todos os blocos** — usar apenas os relevantes.
### Domínio: API REST / GraphQL
- Como erros de validação devem ser retornados (formato JSON, campos obrigatórios)?
### Domínio: Autenticação e Autorização
### Domínio: Banco de dados e Migrations
### Domínio: UI e Frontend
- Há design system ou biblioteca de componentes obrigatória (ex.: Material, Tailwind)?
- Quais blocos da página são obrigatórios acima da dobra e abaixo da dobra?
### Domínio: Filas, Eventos e Processamento Assíncrono
### Domínio: Dados, ETL e Pipelines
- Quais são as métricas de qualidade de dados obrigatórias (completude, unicidade)?
### Domínio: Infraestrutura e Deploy
- Há downtime aceitável? Ou é obrigatório zero-downtime (rolling deploy)?
</domain_question_library>
## Fase 3 — Requisitos
## Fase 3.5 — Elevação de Robustez (automática)
1. **Detectar domínios** presentes: AUTH, API, DB, FRONTEND, FILE — via scan artifacts ou inferência da Fase 1.
2. **Para cada domínio detectado**, percorrer o catálogo abaixo e filtrar critérios já cobertos por A* existentes.
3. **Propor** os critérios restantes como R-RB-NN com prioridade sugerida.
4. **Apresentar ao usuário** em bloco único — domínios detectados, critérios propostos com justificativa breve para os v1 críticos.
5. **Aguardar decisão** — usuário confirma, ajusta versão ou descarta.
6. **Incorporar aprovados** na tabela da Fase 3; registrar descartados com justificativa em "Suposições e riscos".
**Regra:** nunca forçar inclusão. Se o usuário descartar um v1 crítico, registrar o motivo explicitamente para auditoria futura.
### Catálogo de critérios por domínio
#### AUTH — critérios de segurança de autenticação
| R-RB-A01 | Senha nunca retornada em resposta de API (nem em log) | v1 crítico | Vazamento via resposta ou observabilidade |
#### API REST — critérios de segurança de endpoint
| R-RB-R04 | Paginação obrigatória em listas (sem retornar N ilimitado) | v1 | DoS por dump de tabela grande |
| R-RB-R06 | CORS configurado explicitamente — nunca `Access-Control-Allow-Origin: *` em produção | v1 se frontend externo | Acesso cross-origin não intencional |
#### DB — critérios de segurança de banco de dados
#### FRONTEND — critérios de segurança de UI
#### FILE / Storage — critérios de segurança de upload
| R-RB-S04 | Nome do arquivo sanitizado — nunca usar nome original do cliente | v1 | Path traversal no sistema de arquivos |
## Fase 4 — Roteiro
**Programa por fases (aplicações com 2+ fases):** depois da aprovação, rodar `oxe-cc runtime program init` (lê o `ROADMAP.md` e grava `.oxe/program/PROGRAM.json`) e `oxe-cc runtime program start`. A partir daí cada fase é um ciclo completo que fecha pelo gate `oxe-cc runtime program close`: verify concluído, **regressão das fases anteriores verde**, contratos do IMPLEMENTATION-PACK cumpridos e commit local da fase. As interfaces entregues por uma fase entram no contexto da seguinte. ROADMAP de fase única dispensa o programa.
<auto_reflexao>
## Auto-reflexão semântica (executa automaticamente antes da Fase 5)
**Resultado obrigatório antes de avançar:**
**Saída estruturada obrigatória para o plan:** após esta reflexão, a SPEC final deve deixar explícitos:
</auto_reflexao>
<spec_anti_patterns>
## Anti-padrões de especificação
### Critério A* não verificável
### Escopo creep implícito
### Suposição técnica não registrada
### Requisito v1 que depende de v2
### Critérios que conflitam entre si
### Fase 3.5 pulada sem justificativa
**Solução:** sempre executar Fase 3.5. Se o stack não se encaixa em nenhum domínio, registrar: "Fase 3.5 não aplicável: CLI puro sem HTTP, sem DB, sem auth".
### ROADMAP sem resultado demonstrável por fase
### Setup externo invisível na SPEC
**Solução:** adicionar seção obrigatória `## Setup externo e pré-condições` com: variáveis de ambiente necessárias, contas/recursos a criar, e quem é responsável por cada item.
### Requisito verificável apenas em produção
</spec_anti_patterns>
## Fase 5 — Aprovação e próximo passo
<process>
0. **Processar flags recebidas:**
1. Ler `.oxe/STATE.md`, `OVERVIEW.md`, `STACK.md` e `OBSERVATIONS.md` do escopo ativo (verificar pendentes).
2. Fazer uma exploração inicial do repo e dos artefatos antes da primeira rodada de perguntas. Consolidar internamente: fatos confirmados, inferências e lacunas.
3. Aplicar `adaptive-discovery.md`: classificar a demanda, verificar se há capabilities úteis e se investigações anteriores reduzem incerteza.
4. **Fase 1 — Perguntas:** enviar bloco coeso de 3-5 perguntas; máx 3 rodadas; confirmar entendimento.
5. **Fase 2 — Pesquisa:** propor áreas de investigação; aguardar aprovação; executar se aprovado.
6. **Fase 3 — Requisitos:** extrair tabela R-ID com v1/v2/fora e critérios A*; incorporar OBS pendentes; apresentar para validação.
7. **Fase 4 — Roteiro:** agrupar requisitos v1 em fases (incluindo R-RB aprovados); escrever `ROADMAP.md` no escopo ativo.
8. Escrever **`SPEC.md`** usando `oxe/templates/SPEC.template.md` no escopo ativo:
8b. **Auto-reflexão:** executar integralmente o bloco `<auto_reflexao>` antes de avançar. Corrigir a spec conforme necessário. Não apresentar a lista de verificação ao usuário — apenas a spec corrigida.
9. **Fase 5 — Aprovação:** apresentar resumo, aguardar aprovação do roteiro, redirecionar.
10. Atualizar **`.oxe/STATE.md`** global: `phase: spec_ready`, próximo passo e referência curta à sessão ativa quando existir.
11. Marcar OBS incorporadas em `OBSERVATIONS.md` do escopo ativo se houver pendentes de impacto `spec`.
</process>
<success_criteria>
- [ ] Usuário foi consultado no gate da Fase 5 e escolheu o próximo passo.
</success_criteria>
