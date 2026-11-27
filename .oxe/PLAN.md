# OXE — Plano

> Gerado a partir de `.oxe/SPEC.md`. Cada tarefa deve ter bloco **Verificar**.

## Resumo

- **Spec vinculada:** `.oxe/SPEC.md` — cobertura e qualidade `oxe-cc` (critérios A1–A5)
- **Ondas:** 4 (ondas 1–3 concluídas ao nível de comandos; onda 4 fecha gap A3)
- **Tarefas ativas:** 3 (T6–T8); histórico T1–T5 em **Replanejamento**

## Dependências globais

- Manter `tests/isolated-home-env.cjs` em novos spawns que simulem `HOME` (A1).
- Não alterar `prepublishOnly` de forma a retirar sync antes dos testes (A2).

## Replanejamento

> Após **verify_failed** (`.oxe/VERIFY.md`, 2026-03-31).

- **Data / motivo:** 2026-03-31 — c8 e `npm test` verdes, mas **A3** falha: limiar em `package.json` é `--lines 80` (SPEC ≥82%); cobertura medida **80,73%**; `scripts/oxe-assets-scan.cjs` a **89,09%** linhas (ramos de match + `exit(1)` não cobertos).
- **Lições de VERIFY / SUMMARY:** Fechar A3 por implementação (testes + limiar) mantém a SPEC atual; alternativa seria baixar exigências na SPEC (não é objeto deste replano).
- **Alterações ao plano anterior:** T1–T5 consideradas **entregues** para A1, A2, A4, A5 e para a infraestrutura de A3 (c8, subprocessos). **Novas** tarefas T6–T8 substituem a “onda 3” como trabalho restante para A3 literal.
- **T1–T5 (arquivo):** Ambiente isolado + Cursor sync; scripts npm/c8; testes `bin/lib`, SDK, CLI e scripts; STATE/verify documentados. Evidência: `.oxe/VERIFY.md`.

## Tarefas

### T6 — Cobertura total de `oxe-assets-scan.cjs` (ramos de falha)

- **Arquivos prováveis:** `scripts/oxe-assets-scan.cjs`, `tests/oxe-scripts.test.cjs`
- **Depende de:** —
- **Onda:** 4
- **Implementação:** Cobrir linhas que reportam match de padrão e `process.exit(1)` quando `failures > 0`. Se o script só ler `ROOT` fixo ao pacote, expor raiz configurável por variável de ambiente (padrão: comportamento atual), replicando o padrão de `OXE_SYNC_REPO_ROOT` no sync — criar árvore mínima sob `tmpdir` (`oxe/`, `.github/`, `commands/`, `bin/lib/` conforme `DIRS`) com um `.md` que dispare um padrão de teste seguro (ex. sequência estilo `sk-` com comprimento válido para o regex, ou outro padrão da lista); assert `status === 1`, `stderr` com `[oxe-assets-scan]` e mensagem de findings.
- **Verificar:**
  - Comando: `npm test`
  - Manual: `npx c8 --reporter=text npm test` — ficheiro `scripts/oxe-assets-scan.cjs` a **100%** linhas
- **Aceite vinculado:** A3, A4

### T7 — Limiar global c8 linhas ≥ 82%

- **Arquivos prováveis:** `package.json`
- **Depende de:** T6
- **Onda:** 4
- **Implementação:** No script npm `test:coverage` em `package.json`, alterar `--lines 80` para `--lines 82` (e rever `--statements` se o projeto alinhar statements ao mesmo alvo). Garantir que `npm run test:coverage` continua a passar após T6; se falhar por margem global, registar resultado para T8.
- **Verificar:**
  - Comando: `npm run test:coverage`
- **Aceite vinculado:** A3, A5

### T8 — Cobertura global até passar o limiar (se necessário)

- **Arquivos prováveis:** `tests/*.test.cjs`, `bin/oxe-cc.js`, `bin/lib/*.cjs` (conforme relatório)
- **Depende de:** T7
- **Onda:** 4
- **Implementação:** Só se `npm run test:coverage` falhar após T7: usar `npx c8 --reporter=text npm test` para identificar ficheiros abaixo do limiar com mais linhas não cobertas; acrescentar testes de subprocesso ou unitários estáveis (com `isolatedHomeEnv` quando aplicável) até o resumo **Lines** ≥ 82%. Prioridade típica: ramos em `bin/lib/oxe-agent-install.cjs` ou `bin/oxe-cc.js` conforme impacto.
- **Verificar:**
  - Comando: `npm run test:coverage` e `npm test`
- **Aceite vinculado:** A3

---

**Mapeamento SPEC (replan):** **A1, A2, A4, A5** — satisfeitos pelas entregas T1–T5 documentadas em `.oxe/VERIFY.md` (sem tarefas ativas). **A3** — T6–T8. **A5** — scripts `test`, `test:coverage`, `sync:cursor` mantidos; T7 pode ajustar apenas argumentos do script `test:coverage`.
