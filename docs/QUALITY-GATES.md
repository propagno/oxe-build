# OXE quality gates

O pipeline de qualidade produz evidência legível por máquina e por pessoas em:

- `.oxe/release/quality-gates-report.json`
- `.oxe/release/quality-gates-report.md`
- `coverage/coverage-summary.json`

O relatório registra resultado e duração de cada gate, cobertura, tamanho e quantidade de arquivos do pacote npm e tamanho do VSIX. Cada indicador é comparado ao baseline verificado da versão 1.15.0. A comparação é informativa; os thresholds e ratchets executáveis continuam sendo a fonte de bloqueio.

## Execução local

```bash
node scripts/quality-report.cjs reset
node scripts/quality-report.cjs exec --name tests -- npm run test:coverage
node scripts/quality-report.cjs exec --name extension-host -- npm test --workspace oxe-agents
node scripts/quality-report.cjs exec --name vsix -- npm run build:vscode-ext
node scripts/quality-report.cjs finalize
```

`exec` sempre grava o resultado antes de devolver o exit code do processo filho. `finalize` também devolve código diferente de zero quando algum gate falhou ou quando cobertura, pacote npm ou VSIX estão ausentes. Com isso, a telemetria nunca transforma uma execução vermelha em sucesso.

## Extension Host

O teste usa `@vscode/test-electron` e executa as fontes de produção no VS Code 1.95.3 real. Ele comprova:

- descoberta da extensão `oxe-cc.oxe-agents`;
- ativação no Extension Development Host;
- contrato e registro efetivo dos 13 chat participants.

O Copilot Chat proprietário não é baixado no CI. Uma extensão fixture mínima, com o mesmo identificador de dependência, é carregada como segundo development path. Ela apenas satisfaz a resolução da dependência; não substitui nem altera o manifesto OXE. Portanto, o teste não valida autenticação, disponibilidade de modelos, quotas ou respostas reais do Copilot. Esses comportamentos exigem um smoke separado com credenciais.

## Segurança da automação

Os workflows aplicam permissões mínimas, timeouts, cancelamento de CI obsoleta, ações fixadas por SHA completo e `persist-credentials: false`. A publicação npm usa OIDC Trusted Publishing, Node 22.14+ e npm 11.5.1+, sem token de escrita persistente. Antes da primeira release, o pacote `oxe-cc` precisa autorizar `.github/workflows/release.yml` como trusted publisher no npm e o environment GitHub `npm` deve existir.

Dependabot monitora o lockfile único do workspace npm e os SHAs das GitHub Actions. O comentário de versão na mesma linha de cada SHA permite que o Dependabot preserve a identificação da release.

Referências oficiais:

- [GitHub: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub: concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)
- [GitHub: Dependabot para Actions](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions)
- [VS Code: Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [VS Code: Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [npm: Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
