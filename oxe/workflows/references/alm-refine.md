# Referência — `alm refine`: card do Jira → spec guiado

**Objetivo:** cada card vira um spec seguro, que diga o que entregar, como provar e o que fica de fora, sem nada inventado.

## Fluxo

1. **Coletar (só leitura):** `oxe-cc alm refine OXE-20 OXE-103` ou `--jql "…" --max-cards 10`.
   - Grava `.oxe/alm/refine/<KEY>.json`: resumo, descrição, comentários, ligações, épico, versão, PRs/commits/builds, referências de design e o código citado.
   - Grava também o esqueleto `.oxe/alm/specs/<KEY>.md`, com as seções do tipo.
2. **Reescrever** o esqueleto. Isso é com você, o agente da sessão; o `oxe-cc` não chama modelo nenhum. Siga as regras abaixo.
3. **Lint:** `oxe-cc alm refine lint <KEY>`. Corrija até passar.
4. **Mostrar ao usuário** o spec e a diferença em relação ao card. O formato e cada regra nova precisam do OK dele.
5. **Aplicar**, só na sessão escritora (`OXE_ALM_WRITER`): `oxe-cc alm refine apply <KEY> --apply` (antes, `--dry-run` mostra o que gravaria e nunca grava). `oxe-cc alm refine <KEY> --claim --apply` leva o card a "Em refinamento" enquanto o spec é escrito, e cada card diz se moveu e por quê.
   - A descrição vira o spec, com títulos.
   - O texto original vai para um comentário "Texto original (antes do refine)".
   - O card ganha o rótulo `spec-v1`. Se houver "A confirmar", ganha também `needs-info`, com as perguntas num comentário.
   - Se alguém editou o card depois da coleta, nada é gravado: colete de novo ou, depois de revisar a diferença, use `--confirm-overwrite`.

## Regras da reescrita (nunca inventar)

- **Fontes válidas, nesta ordem:**
  1. o card, com descrição e comentários;
  2. os cards ligados e o épico;
  3. o código citado, que você lê;
  4. as decisões registradas (`oxe-cc decision list`, ADRs);
  5. a SPEC e o PRD do projeto;
  6. os testes existentes.

  Cite a fonte da regra entre parênteses: `(card)`, `(comentário de 12/11)`, `(src/x.ts:40)`, `(D-07)`.
- **Pergunta de produto com decisão do usuário já registrada** (numa sessão, num comentário, numa decisão D-NN) é respondida com essa decisão, e o spec cita a fonte: `(decisão do usuário de 13/11, sessão da marca)`. Ela não vira needs-info.
- **O que nenhuma fonte diz fica "A confirmar"**, com uma pergunta concreta em **Perguntas em aberto**. Regra de negócio sem fonte nunca vira regra.
- **Critérios de aceite:**
  - formato: `1. **CA-n** — Dado <contexto>, quando <ação>, então <resultado observável> · Teste: <arquivo › nome do teste>`;
  - mensuráveis: nada de "melhorar", "rápido", "intuitivo" sem número ou limiar;
  - cada CA tem o teste que o prova: um teste que existe ou o teste novo a criar, com o caminho proposto.
- **Regras de negócio (RN-n)** dizem o que o produto faz e por quê.
- **Regras técnicas (RT-n)** dizem como, quando restringe a entrega: arquivos, contratos/IPC, migração, orçamento de desempenho, testes congelados afetados, compatibilidade com o celular.
- **Fora de escopo** nunca fica vazio. Pense no que alguém esperaria e esta entrega não faz.
- **Bug:** passos numerados reproduzíveis, esperado × obtido, ambiente e versão, causa (ou "desconhecida"), critérios de correção (CA) e o **teste de regressão** que falha antes e passa depois.
- **Épico:** objetivo, escopo, fora de escopo, métricas de sucesso (M-n, com linha de base e meta) e os cards filhos.
- **Títulos:** história, "Como <persona>, quero <ação>, para <benefício>" na seção História; bug, o sintoma visível.

## Ligação com a trilha (CA ↔ A, explícito nos dois lados)

- `oxe-cc alm refine import <KEY…> --by <papel> [--phase Fn] [--risk P2] [--dry-run]` leva os CA do card refinado para a SPEC do programa:
  - um CA sem critério vira um `A-n` novo. O texto cita a chave do card, o teste vira "Como verificar" e o `· Risco: Px` do CA vai para a coluna Risco;
  - o `(A-n)` é escrito de volta no CA: `**CA-2 (A14)**`;
  - um CA que já tem o seu A é conferido: o A existe e cita a chave.
- Com a SPEC do programa presente, o `alm refine lint` avisa CA sem `(A-n)` e reprova CA que aponta para um A inexistente.
- O teste citado em cada CA vira o teste de aceite congelado do plano.
- Com `alm.ready_gate: true`, um item sem `spec-v1` não vai para "Em andamento" e o sync diz por quê: o card só entra em execução com o spec fechado.

## Custo

A coleta só lê, e a reescrita é feita pelo agente da sessão. Em lote, `--max-cards` (padrão 20) limita a coleta. Lote maior, ou `apply` em massa, só com o OK do usuário, depois de ele aprovar o formato num piloto.
