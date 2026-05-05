# Release Readiness — OXE

Este é o contrato mínimo para publicar uma versão estável do OXE sem drift entre pacote, runtime, wrappers e operação enterprise.

## Gate local

```bash
npm test
npm run scan:assets
npm run build:vscode-ext
npm run release:pack-check
npx oxe-cc doctor --release --write-manifest
```

O `doctor --release` deve bloquear a publicação quando encontrar:

- árvore canónica `oxe/workflows/`, `oxe/workflows/references/` ou `commands/oxe/` ausente
- `workflow-runtime-contracts.json` ausente ou inválido
- drift de versão entre `package.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, `README.md`, `CHANGELOG.md` e banner
- topo do `CHANGELOG` ausente, sem data ou sem highlights
- runtime não compilado em `lib/runtime/index.js`
- wrappers dirty após `sync-runtime-metadata` e `sync:cursor`
- drift semântico entre workflows canónicos e superfícies geradas
- ausência ou falha dos relatórios obrigatórios da release
- tarball npm contendo `.tgz`, `.vsix`, `.oxe/` ou sem arquivos obrigatórios do pacote

## Relatórios obrigatórios

Todos os artefatos abaixo devem existir em `.oxe/release/`:

- `release-manifest.json`
- `runtime-smoke-report.json`
- `runtime-real-report.json`
- `recovery-fixture-report.json`
- `multi-agent-soak-report.json`
- `multi-agent-real-report.json` para versões `>=1.9.1`

Na linha `>=1.10.0`, `runtime-real-report.json` deve cobrir cenários representativos além do happy path simples: multi-wave, multi-file, verify parcial, gate pendente e promoção bloqueada. O `multi-agent-real-report.json` deve provar merge com evidência, diff summary, arquivos aplicados e verify status por task; o release doctor valida esse conteúdo, não apenas a presença do arquivo.

## Defaults estáveis desta publicação

- `execute` e `verify`: `runtime-first`
- `promotion`: somente `pr_draft`
- `multi-agent`: GA apenas com `git_worktree`
- `branch_push`: capability avançada, fora da superfície estável

## CI

O pipeline de CI e o pipeline de release devem rodar o mesmo gate:

1. `npm test`
2. `npm run scan:assets`
3. `npm run release:pack-check`
4. `npm run release:doctor`

Se qualquer etapa falhar, a release não está pronta.

## Observações operacionais

- `status` e `status --full` distinguem agora `workspaceMode: product_package` de `workspaceMode: oxe_project`.
- No repositório do pacote, readiness passa a ser de publicação; o CLI deixa de bloquear por ausência de `PLAN.md` executável quando não há ciclo ativo declarado.
