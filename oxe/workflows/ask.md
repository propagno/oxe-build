# OXE — Workflow: ask

<objective>
Responder perguntas sobre a situação atual do trabalho OXE com máxima robustez, usando o contexto real do repositório, a sessão ativa quando existir, e os artefatos mais recentes da trilha.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-discovery.md` como postura cognitiva deste passo.
- Resolver `active_session` via `oxe/workflows/references/session-path-resolution.md`.
- Ler sempre `.oxe/STATE.md` global primeiro.
- Antes de abrir o conjunto amplo de artefatos, tentar o contexto resolvido em `.oxe/context/packs/ask.md` e `.oxe/context/packs/ask.json` como entrada prioritária.
- Se o pack existir e estiver fresco/coerente, ler primeiro o resumo do pack e depois inspecionar apenas os artefatos listados em `read_order` / `selected_artifacts` antes de expandir a leitura.
- Se o pack estiver ausente, stale ou com lacunas críticas, fazer fallback explícito para leitura direta e declarar esse fallback na resposta.
- Com sessão ativa, priorizar artefatos em `.oxe/<active_session>/...` antes do modo legado.
- Usar `.oxe/codebase/` como mapa do repositório, não como substituto dos artefatos da trilha.
- Se a pergunta estiver ambígua, responder em modo “situação atual + próximos riscos + melhor próxima ação”.
- Aplicar discovery adaptativo leve: classificar se a pergunta é sobre estado atual, bloqueio, estratégia, execução, verificação, instalação ou investigação antes de decidir o conjunto de artefatos prioritários.
</context>

<process>
1. Ler `.oxe/STATE.md` global e determinar se há `active_session`.
2. Resolver o contexto estruturado primeiro:
   - tentar `.oxe/context/packs/ask.md` / `.oxe/context/packs/ask.json` (ou `oxe-cc context inspect --workflow ask --json`) para obter `read_order`, `selected_artifacts`, `gaps`, `conflicts` e `freshness`;
   - se o pack estiver fresco e sem lacunas críticas, usá-lo como mapa primário de leitura;
   - se o pack estiver stale, incompleto ou ausente, declarar `fallback para leitura direta` antes de abrir os artefatos brutos.
3. Se houver pack válido, ler primeiro:
   - o resumo humano do pack (`.md`);
   - os artefatos de `read_order`;
   - quaisquer artefatos adicionais de `selected_artifacts` necessários para responder com evidência.
4. Se houver sessão ativa e o pack não bastar, ler nesta ordem:
   - `SESSION.md`
   - `spec/SPEC.md`, `spec/ROADMAP.md`, `spec/DISCUSS.md`, `spec/UI-SPEC.md` se existirem
   - `plan/PLAN.md`, `plan/QUICK.md`, `plan/plan-agents.json`, `plan/quick-agents.json` se existirem
   - `execution/STATE.md`, `execution/EXECUTION-RUNTIME.md`, `execution/CHECKPOINTS.md`, `execution/OBSERVATIONS.md`, `execution/DEBUG.md`, `execution/FORENSICS.md`, `execution/SUMMARY.md` se existirem
   - `research/INVESTIGATIONS.md`, `research/RESEARCH.md`, `research/investigations/` se existirem
   - `verification/VERIFY.md`, `verification/VALIDATION-GAPS.md`, `verification/SECURITY.md`, `verification/UI-REVIEW.md` se existirem
5. Sem sessão ativa e se o pack não bastar, ler o equivalente legado na raiz `.oxe/`.
6. Em ambos os casos, ler também:
   - `.oxe/codebase/OVERVIEW.md`
   - `.oxe/codebase/STACK.md`
   - `.oxe/codebase/CONCERNS.md`
   - `.oxe/CAPABILITIES.md` e `.oxe/capabilities/` se a pergunta tocar execução, pesquisa, automação ou integrações
   - `.oxe/INVESTIGATIONS.md` se a pergunta tocar incertezas, descoberta ou evidência
   - `.oxe/memory/` se existir memória persistente relevante ao assunto
   - `.oxe/global/LESSONS.md` se existir, com fallback para `.oxe/LESSONS.md`
   - `.oxe/SESSIONS.md` se a pergunta mencionar sessões, histórico ou retomada
   - `.oxe/cloud/azure/INVENTORY.md`, `SERVICEBUS.md`, `EVENTGRID.md`, `SQL.md` e `auth-status.json` se a pergunta tocar Azure, cloud, infraestrutura, mensageria, integração ou banco gerido
7. Se a pergunta exigir evidência fora do pack, expandir a leitura apenas para os artefatos adicionais estritamente necessários e mencionar a expansão na resposta.
8. Responder à pergunta do utilizador com base em evidência explícita dos artefatos lidos.
9. Se faltar artefato crítico para responder com segurança, dizer exatamente o que falta e qual comando OXE fecha essa lacuna.
10. Estruturar a resposta conforme o contrato de saída:
   - **Fatos** — o que os artefatos confirmam sem ambiguidade
   - **Inferências** — conclusões derivadas dos artefatos
   - **Lacunas** — o que não pode ser afirmado com segurança
   - **Próximo passo** — apenas quando fizer sentido operacional

## Modo diagnóstico padrão

Se o utilizador só disser algo genérico como “o que está acontecendo?”, “qual a situação?” ou “me contextualize”, responder com:

- **Situação atual**
- **Escopo ativo**
- **Artefatos relevantes**
- **Riscos ou lacunas**
- **Próximo passo recomendado**

## Regras de robustez

- Não assumir que `doctor` ou `status` sejam session-aware; eles não substituem a leitura direta dos artefatos da sessão.
- O context pack acelera e comprime a leitura, mas não substitui a evidência. Se ele estiver stale ou insuficiente, o fallback deve ser explícito.
- Se houver conflito entre `.oxe/STATE.md` global e `execution/STATE.md` da sessão, explicitar o conflito.
- Se houver `CHECKPOINTS.md` com itens `pending_approval`, isso tem precedência operacional sobre o “próximo passo” implícito.
- Se `EXECUTION-RUNTIME.md` ou `INVESTIGATIONS.md` existirem, tratá-los como evidência tática complementar para explicar bloqueios, handoffs, riscos e lacunas.
- Se `VERIFY.md` existir e contradizer o estado declarado, priorizar a evidência do `VERIFY.md` e mencionar a incoerência.
- Se existir inventário Azure materializado, priorizar esse inventário sobre suposições sobre recursos cloud.
- Se o mapa `.oxe/codebase/` estiver ausente ou incompleto, dizer isso explicitamente antes de extrapolar sobre o repositório.
</process>

<output>
- **Fatos**
- **Inferências**
- **Lacunas**
- **Próximo passo** (quando necessário)
- Referência curta aos artefatos usados
</output>

<success_criteria>
- [ ] A resposta parte de `.oxe/STATE.md` global e resolve corretamente a sessão ativa quando existir.
- [ ] O contexto da sessão ativa tem precedência sobre artefatos legados.
- [ ] Conflitos ou lacunas entre artefatos são explicitados.
- [ ] A saída responde à pergunta sem inventar estado que não esteja nos arquivos.
</success_criteria>
