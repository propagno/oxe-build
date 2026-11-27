# SPEC — Cobertura de testes e qualidade `oxe-cc`

## Objetivo

Garantir **cobertura de linhas e funções próxima ou igual a 100%** no código JavaScript publicado (`bin/`, `lib/sdk/`, `scripts/`), com **testes estáveis** (HOME isolado, sem dependência de variáveis IDE do utilizador) e **artefactos Cursor** gerados a partir da fonte única `.github/prompts/`.

## Critérios de aceite

| ID | Critério |
|----|----------|
| **A1** | `npm test` passa no Windows e em CI; `tests/isolated-home-env.cjs` usado em spawns que simulam `~`. |
| **A2** | Pasta `.cursor/commands/` existe no repo (gerada por `scripts/sync-cursor-from-prompts.cjs`); `prepublishOnly` corre o sync antes dos testes. |
| **A3** | `npm run test:coverage` com **c8** aplica limiar global de **linhas ≥ 82%** (repositório inteiro instrumentado). Biblioteca `oxe-install-resolve.cjs` e `oxe-assets-scan.cjs` mantêm **100%** linhas com a suíte atual; o CLI `oxe-cc.js` (~1,9k linhas) fica deliberadamente abaixo de 100% até refactor ou mais testes de integração. |
| **A4** | `scripts/oxe-assets-scan.cjs` e `scripts/sync-cursor-from-prompts.cjs` têm verificação por teste de subprocesso. |
| **A5** | Documentação mínima: `package.json` scripts `test`, `test:coverage`, `sync:cursor`. |

## Fora de âmbito

- Refactor grande do `bin/oxe-cc.js` em módulos (não solicitado).
- Testes E2E com IDEs reais.
