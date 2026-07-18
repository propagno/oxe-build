# Release Readiness — OXE

Este é o contrato mínimo para publicar uma versão estável do OXE sem drift entre pacote, runtime, wrappers e operação enterprise.

## Gate local

```bash
npm run lint
npm run format:check
npm run test:sdk-types
npm run test:coverage
npm run test:packed-consumer
npm run test:vscode-ext
npm audit
npm run scan:assets
npm run build:vscode-ext
npm run release:pack-check
npx oxe-cc doctor --release --write-manifest
npm run quality:report
```

`test:coverage` já executa `npm test` e aplica o ratchet global e dos módulos críticos. `test:packed-consumer` valida o pacote instalado em projeto temporário limpo. `test:vscode-ext` ativa a extensão num VS Code Extension Host real. `test:sdk-types` bloqueia drift do contrato TypeScript público. Lint e `format:check` são somente leitura.

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

O nome `runtime-real` indica que os cenários atravessam o runtime operacional verdadeiro, em vez de mocks do runtime. A suíte continua sendo local e determinística: não chama um modelo externo. A integração live com um provedor LLM é validada separadamente por `npm run test:runtime-llm`; esse teste é opt-in, exige configuração explícita de credenciais/provedor e não integra o gate determinístico de publicação.

## Defaults estáveis desta publicação

- `execute` e `verify`: `runtime-first`
- `promotion`: somente `pr_draft`
- `multi-agent`: GA apenas com `git_worktree`
- `branch_push`: capability avançada, fora da superfície estável

## CI

O pipeline de CI e o pipeline de release devem rodar o mesmo gate:

1. `npm run lint`
2. `npm run format:check`
3. `npm run test:sdk-types`
4. `npm run test:coverage` (inclui `npm test`)
5. `npm run test:packed-consumer`
6. `npm run test:vscode-ext`
7. `npm audit`
8. `npm run scan:assets`
9. `npm run build:vscode-ext`
10. `npm run release:pack-check`
11. `npm run release:manifest` (doctor de release com `--write-manifest`)
12. `npm run quality:report`

Se qualquer etapa falhar, a release não está pronta.

O gate completo roda em Node 20. Um job de compatibilidade separado compila o runtime e executa os testes raiz em Node 18 e 22, cobrindo o `engines.node >=18` sem triplicar as suítes pesadas do runtime e da release.

Em checkout limpo, um único `npm ci` na raiz instala as dependências da raiz, do runtime e da extensão por npm workspaces. Não mantenha lockfiles aninhados: o `package-lock.json` raiz é a fonte única de resolução.

O workflow de release valida a tag, executa os gates, empacota o VSIX e cria a GitHub Release sem publicar no npm. A promoção ao registry é manual e posterior. As GitHub Actions ficam fixadas por SHA, e o Dependabot acompanha as revisões desses SHAs.

## Observações operacionais

- `status` e `status --full` distinguem agora `workspaceMode: product_package` de `workspaceMode: oxe_project`.
- No repositório do pacote, readiness passa a ser de publicação; o CLI deixa de bloquear por ausência de `PLAN.md` executável quando não há ciclo ativo declarado.
