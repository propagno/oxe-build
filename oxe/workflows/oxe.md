# OXE — Workflow: oxe (entrada universal)

<objective>
Ponto de entrada inteligente do OXE. Faz uma de três coisas dependendo do input do usuário:

1. **Sem input / "o que faço agora?"** → lê `STATE.md` e recomenda exatamente 1 próximo passo (lógica de `next.md`).
2. **Input em linguagem natural** (ex.: "quero adicionar login", "preciso revisar um PR") → traduz para o comando OXE correto e executa ou orienta (lógica de `route.md`).
3. **"help", "o que é OXE" ou "comandos"** → apresenta a trilha principal, a trilha avançada e a cadeia canônica.

**Princípio:** o usuário não precisa decorar o nome do comando — `/oxe [contexto]` resolve.
</objective>

<context>
- Este workflow **não gera artefatos** por conta própria. Ele orienta ou delega para o workflow correto.
- Lê `STATE.md` quando disponível para personalizar a resposta ao estado atual do projeto.
- Quando o input for claro o suficiente para um workflow específico, **executar diretamente** esse workflow (carregar e seguir o `.md` correspondente) em vez de só sugerir o comando.
- Quando houver ambiguidade genuína, apresentar 2 opções e pedir escolha — nunca listas longas.
</context>

<modo_status>
## Modo: Status + Próximo Passo (sem input ou "o que faço agora?")

Aplicar a lógica completa de `oxe/workflows/next.md`. **Com o `oxe-cc` disponível, a resposta é `nextStep` / `cursorCmd` / `reason` de `oxe-cc status --json`** (ver `references/next-step-footer.md`), que já cobre o grill e a aprovação da spec, o ALM, o RFC da fase e a entrega. A lista abaixo é o fallback; `oxe-cc status --journey` mostra o mapa das etapas 0 a 9.

0. Se existir `.oxe/program/PROGRAM.json` com fase aberta → seguir a **fase ativa** (`oxe-cc runtime program status`): `pending` → `runtime program start`; `planning` → **plan** só da fase (a menos que `PLAN.json` já declare essa fase → **execute**, ou **verify** se todas as tarefas estão done); `executing` → **execute**; `verifying` com verify verde → `runtime program close`, com verify reprovado → **execute**. Sempre dizer "Fase k/N — Fx". O PLAN/run de uma fase fechada nunca é reaproveitado.
1. Se `.oxe/` ou `STATE.md` não existir → `oxe-cc init-oxe` (instalar o oxe-cc antes, se faltar)
2. Sem `SPEC.md` num projeto novo → **spec** (`/oxe-spec`); mapa do codebase só com `/oxe-spec --refresh` em projeto existente
3. Se `quick_active` ou `QUICK.md` sem `PLAN.md` → avaliar promoção (ver `next.md`)
4. Se sem `SPEC.md` → **spec**
5. Se SPEC mas sem PLAN → verificar `discuss_before_plan` → **discuss** ou **plan**
6. Se PLAN sem VERIFY pós-implementação → **execute** ou **verify**
7. Se VERIFY com falha → **plan --replan**
8. Se VERIFY OK → **`/oxe-ship`** (entregar); entregue → próxima entrega em **`/oxe-spec`** ou **`/oxe-quick`**

**Saída:** exatamente 1 passo, 1 comando, 1 frase de justificativa.
</modo_status>

<modo_pergunta>
## Modo: Pergunta Situacional (input em linguagem natural — ex.: "onde estou?", "qual o risco?")

Aplicar a lógica de `oxe/workflows/ask.md`:

1. Ler `.oxe/STATE.md` global.
2. Resolver sessão ativa → ler artefatos do escopo correto.
3. Responder com: **Fatos** · **Inferências** · **Lacunas** · **Próximo passo**.

Se a pergunta for genérica ("situação?", "o que está acontecendo?"), responder com:
- Situação atual · Escopo ativo · Artefatos relevantes · Riscos / lacunas · Próximo passo recomendado.
</modo_pergunta>

<modo_route>
## Modo: Roteamento de Linguagem Natural (input com contexto de tarefa/ação)

Mapear o input para o workflow correto e executar ou orientar:

| Se o usuário disser | Executar |
|---------------------|----------|
| "quero [feature / tarefa / entrega]", "cria / implementa / corrige X" | regra única de `<process>` passo 1: **`/oxe-quick`** se for pequeno, senão **`/oxe-spec`** |
| "analisa / mapeia o projeto" | **`/oxe-spec --refresh`** (incremental) ou **`/oxe-scan`** (scan completo) |
| "o que faz esse módulo / o que usa esse projeto" | **`/oxe "pergunta"`** com base nos artefatos existentes |
| "pesquisa / spike / quero entender X" | **`/oxe-spec --research`** |
| "executa tudo / faz tudo / modo automático" | **`/oxe-execute`** |
| "executa sem parar" (plano já existe) | **`/oxe-execute`** |
| "faz sozinho de ponta a ponta / modo autônomo" (pedido explícito) | **`oxe/workflows/conduct.md`** (Conductor: Agent ou Swarm Mode) |
| "revisa PR / diff" | **`/oxe-verify --pr`** |
| "auditoria de segurança" | **`/oxe-verify --security`** |
| "valida / verifica" | **verify** |
| "entrega / abre o PR / deploy / ship" | **`/oxe-ship`** (PR, CI e merge, deploy, close); "só commita" → **`/oxe-ship --local`** |
| "achei um bug em produção / defeito depois do deploy" | **`/oxe-ship --defect "…" --origin US-n`** |
| "muda o critério A3 / põe A8 na F2 / critério novo / fase nova / tira ou junta tarefas / pausa / fecha pelo CI" | seguir **`oxe/workflows/references/change-management.md`** (tabela pedido → comando; sempre `--dry-run` antes, quando houver) |
| "decide a proposta técnica / RFC" | **`/oxe-discuss --rfc`** |
| "configura Jira / Azure DevOps / ALM" | **`/oxe-alm`** |
| "onde estou na jornada / mapa" | **`oxe-cc status --journey`** |
| "milestone / release / versão" | **`/oxe-session milestone`** |
| "trilha paralela / workstream" | **`/oxe-session workstream`** |
| "snapshot / checkpoint" | **`/oxe-execute --checkpoint "<nome>"`** |
| "recuperação / erro / algo quebrou" | primeiro **`oxe-cc status --json`**: o próximo passo nomeia a saída (pausa, checkpoint falho, CR aberto, adiamento, verify vermelho). Sem estado de falha reconhecido → **`/oxe-execute --deep-diagnosis`** |
| "debug / teste falhando" | **`/oxe-execute --debug`** |
| "obs / observação / nota" | **`/oxe-execute --note "..."`** |
| "atualiza / update OXE" | **update** |

Se o input não mapear claramente → apresentar 2 opções mais prováveis e perguntar.
</modo_route>

<modo_help>
## Modo: Help (quando o usuário pede "help", "o que é OXE", "comandos")

Apresentar de forma concisa:

### A trilha principal (7 comandos)

```
/oxe              → onde estou / o que faço / help (entrada universal)
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
                    (absorve scan, research e ui-spec quando necessário)
/oxe-plan         → detalhar em tarefas (--agents para multi-agente)
/oxe-execute      → implementar A/B/C
                    (absorve obs, debug, forensics, checkpoint, loop)
/oxe-verify       → validar e fechar o ciclo
                    (absorve gaps, security, ui-review, review-pr, retro)
/oxe-ship         → entregar: PR → CI/merge → deploy → docs → close
                    (--local só commita; --defect registra defeito pós-entrega)
```

### A cadeia

```
/oxe → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify → /oxe-ship
          ↓
     /oxe-quick (trabalho pequeno) → oxe-cc quick done → /oxe-ship
```

### Trilha avançada

```
/oxe-session      → criar, alternar, retomar, fechar ou migrar sessões
/oxe-dashboard    → visualizar runtime, ondas, checkpoints e estado operacional
```

### Para saber o próximo passo agora

```
/oxe
```

### Comportamentos especializados (ativados automaticamente ou por flag)

Não precisam ser decorados como comandos separados:
- scan/refresh → `/oxe-spec --refresh` ou `/oxe-spec --full`
- research/spike → `/oxe-spec --research`
- ui-spec → `/oxe-spec --ui`
- obs/nota → `/oxe-execute --note "..."`
- debug → `/oxe-execute --debug`
- forensics → `/oxe-execute --deep-diagnosis`
- gaps → `/oxe-verify --gaps`
- security → `/oxe-verify --security`
- ui-review → `/oxe-verify --ui`
- review-pr → `/oxe-verify --pr`
</modo_help>

<process>
1. Verificar se há input adicional na mensagem:
   - **Sem input ou "next / o que faço / status":** aplicar `<modo_status>`.
   - **"help / comandos / o que é OXE":** aplicar `<modo_help>`.
   - **Pergunta situacional** ("onde estou?", "qual o risco?", "o que está acontecendo?", "me contextualize"): aplicar `<modo_pergunta>`.
   - **Objetivo de implementação** (linguagem natural descrevendo uma tarefa, feature ou mudança — ex.: "cria X", "implementa Y", "adiciona Z", "corrige W"): **regra única** — se cabe nos critérios do quick (até ~10 passos, poucos arquivos, sem contrato público, segurança ou dados pessoais) → executar `oxe/workflows/quick.md`; senão → executar `oxe/workflows/spec.md`. Com programa ou plano em andamento, o `nextStep` do `oxe-cc status --json` prevalece, e um pedido de **mudança** (critério novo, escopo novo, "muda o A3") é um CR: siga `references/change-management.md` — registre a mudança, mostre o impacto e pare no próximo passo. Não implemente código de CR a partir do `/oxe` nem rode `spec approve` sem o OK humano nesta conversa. O Conductor (`oxe/workflows/conduct.md`) só entra quando o usuário pede explicitamente o modo autônomo.
   - **Input de roteamento simples** (pedido que mapeia diretamente a um comando OXE existente sem necessidade de execução): aplicar `<modo_route>` e, se o workflow for claro, carregar e executar diretamente o `oxe/workflows/<nome>.md` correspondente.
2. Nunca produzir listas longas de alternativas. Um passo, um comando, uma frase.
3. Se o workflow executado diretamente gerar artefatos, reportar no chat conforme esse workflow.
</process>

<success_criteria>
- [ ] Usuário recebe exatamente 1 próximo passo (modo status) OU 1 workflow executado (modo route) OU o bloco help compacto (modo help) OU resposta situacional (modo pergunta).
- [ ] Nenhum artefato criado por este workflow diretamente (a menos que o workflow delegado o faça).
- [ ] Nunca lista mais de 2 alternativas ao mesmo tempo.
- [ ] Help mostra apenas os 7 comandos da trilha principal + 2 avançados; comandos especializados aparecem apenas como flags/comportamentos.
</success_criteria>
