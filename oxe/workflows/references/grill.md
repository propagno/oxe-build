# Referência — Grill: a descoberta da spec como árvore de decisões

O upstream decide o sucesso do desenvolvimento. O grill entrevista o usuário até não sobrar ambiguidade que afete a v1. É o modo padrão da Fase 1 do `/oxe-spec`; com `--fast`, valem os blocos de perguntas de antes.

## Regras da conversa

1. **Explore antes de perguntar.** Se o código, o scan (`.oxe/codebase/`), a SPEC antiga, o DISCUSS, as LESSONS ou as OBS já respondem, registre a resposta como fato e **não pergunte**:
   `oxe-cc grill fact --branch <ramo> --text "…" --source "src/x.ts:12"`
2. **Uma pergunta por mensagem.** Nunca em bloco. Antes de mostrar a pergunta, registre-a:
   `oxe-cc grill ask --branch <ramo> --question "…" --options "A | B | C" --recommended "B" --why "…" [--affects R2,A5,US-1] [--depends Q-3] [--decision]`
3. **Formato da pergunta para o usuário:**
   - a pergunta;
   - **O que ela decide:** o campo e o artefato (por exemplo, "o critério A3 e a história US-2");
   - as opções numeradas, cada uma com a consequência em uma linha;
   - **Recomendada:** a opção e o porquê;
   - "Responda `ok` para a recomendada, o número da opção ou o seu texto."
4. **Registre a resposta:** `oxe-cc grill answer Q-n ok|<n>` ou `--text "…"`. Use `--decision` quando a escolha for de arquitetura, de produto ou de trade-off (vira um ADR no close).
5. **Resposta que contradiz uma anterior:** registre `oxe-cc grill conflict Q-a,Q-b --note "…"` e pergunte qual vale. Responder de novo uma das duas resolve. Uma resposta que muda reabre sozinha as perguntas e os ramos que dependiam dela, e o `answer` lista as reabertas.
6. **"Não sei agora":** `oxe-cc grill defer Q-n --reason "…"`. Vira suposição explícita na SPEC e no plano, nunca silêncio.
7. **Termos do domínio:** cada substantivo de negócio ambíguo vira um termo:
   `oxe-cc grill term "Pedido" --definition "…" --synonyms "ordem | compra"`
   Os sinônimos ficam proibidos na SPEC, no PRD e no código. Se não houver termos, use `--none`.
8. **Playback ao fechar um ramo:** resuma o ramo em 3 a 5 linhas e peça confirmação. Com o "sim" do usuário numa resposta **separada** (nunca no mesmo turno da última resposta do ramo), rode `oxe-cc grill confirm <ramo> --playback "<o resumo que ele confirmou>"`. Se o ramo não se aplica, rode `confirm <ramo> --empty --reason "…"`.
9. **Sessões e cards ALM (`--card <KEY>`):** para o programa inteiro, o estado fica em `.oxe/grill/grill.ndjson`. **Ao refinar um card isolado de ALM/Jira**, passe sempre `--card <KEY>` (`oxe-cc grill start --card OXE-n`, `ask`, `answer`, `fact`, `confirm`, `close`, `report`): o estado, os ADRs (`--decision`) e o relatório ficam isolados em `.oxe/alm/grill/<KEY>/` (decisões em `.oxe/alm/grill/<KEY>/decisions.ndjson`, ADRs em `.oxe/alm/grill/<KEY>/adr/`, relatório em `.oxe/alm/grill/grooming-quality.md`), nunca sobrescrevendo `.oxe/grill/`, `.oxe/SPEC.md` nem poluindo `docs/adr/` da árvore git. Numa nova sessão, `oxe-cc grill status [--card <KEY>]` mostra onde parou e qual é o próximo ramo; continue dali.

## A árvore (em ordem de dependência)

Um ramo só começa depois que os ramos de que ele depende estiverem confirmados. O `grill status` indica o `next_branch`.

| Ramo | Pergunta-guia | Alimenta |
|---|---|---|
| `problem` | qual dor, de quem, como é hoje, qual resultado observável define sucesso | PRD Problema, SPEC Objetivo/Outcome |
| `personas` | quem usa, em que contexto, jornadas principal e secundárias | PRD Personas, histórias US-n |
| `scope` | o que entra na v1, o que fica fora, o que é v2 | SPEC Escopo, R-ID v1/v2/fora |
| `flows` | passos de cada fluxo obrigatório, estados (loading/empty/error/success) | SPEC Fluxos, critérios A* |
| `rules` | regras, cálculos, validações, entidades e campos, termos | SPEC Regras, GLOSSARY.md |
| `edges` | limites, vazio, concorrência, falhas externas, o que NÃO pode | SPEC Bordas/Proibições, A* de erro |
| `nfr` | desempenho, segurança, privacidade, a11y, observabilidade | A* não funcionais, Fase 3.5 |
| `integrations` | sistemas, contratos, credenciais, ambientes, quem provê | Setup externo e pré-condições |
| `rollout` | entrada em produção, migração, flag, rollback | ROADMAP, critérios de deploy |
| `metrics` | linha de base, meta, onde é coletada | PRD Métricas M-n |
| `risks` | o que pode dar errado, impacto, mitigação | coluna Risco (P0/P1/P2), RFC |

O tipo da demanda (`grill start --type`) define quais ramos são obrigatórios:

| Tipo | Ramos obrigatórios |
|---|---|
| `feature`, `ui`, `integração`, `migração`, `dados`, `segurança` | todos |
| `infra` | problem, scope, flows, edges, nfr, integrations, rollout, risks |
| `bugfix` | problem, scope, flows, edges, rollout, risks |
| `refactor` | problem, scope, flows, edges, nfr, rollout, risks |
| `investigação` | problem, scope, risks |

Os demais ramos continuam disponíveis quando forem relevantes. Use a "Biblioteca de perguntas por domínio" do `spec.md` para escolher as perguntas de cada ramo.

## Boas perguntas

- **Concretas e com exemplo:** "um pedido com 0 itens pode ser salvo como rascunho?", nunca "e os casos de borda?".
- **Uma decisão por pergunta.** Se a resposta muda dois critérios, liste os dois em `--affects`.
- **A recomendação vem do que você viu** no código, no scan ou nas lições, e o `--why` cita a evidência. Sem evidência, a recomendação é a opção mais simples que atende o outcome.
- **Pergunte o que custa caro errar:** contrato público, dado persistido, segurança, migração e UX de fluxo principal. Detalhe cosmético fica para depois.

## Fechar e gerar os documentos

1. `oxe-cc grill close` só fecha quando cada ramo obrigatório tem decisão, nenhuma pergunta aberta, playback confirmado, nenhuma contradição pendente e glossário preenchido (ou `--none`). Se recusar, mostre o que falta e continue o grill.
2. Ao fechar:
   - o glossário vai para `.oxe/GLOSSARY.md`, entre marcadores, preservando o texto humano;
   - as respostas marcadas `--decision` viram decisões (D-NN), com as opções não escolhidas como alternativas recusadas, e saem como ADRs.
3. Escreva os documentos a partir do `GRILL.md`, sem inventar nada que não esteja nele:
   - **SPEC:** objetivo, escopo, R-ID, A* com Risco e Como verificar, bordas, setup externo, e suposições a partir das perguntas adiadas;
   - **ROADMAP:** fases com resultado demonstrável, a partir de `scope` e `rollout`;
   - **PRD:** problema, personas, métricas M-n e histórias US-n ligadas a R e A;
   - **RFC:** para cada critério P0/P1 ou componente novo, `oxe-cc rfc new --title "…"`, já com as alternativas discutidas no grill.
4. Cada critério, história e termo deve ser rastreável a uma pergunta (`--affects`). Um item sem origem no grill é um item que o usuário não confirmou: pergunte antes de escrever.
