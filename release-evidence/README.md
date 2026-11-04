# Evidência de release (versionada)

Esta pasta guarda a evidência que o CI não consegue produzir sozinho, porque depende de um executor real. O `doctor --release` lê o `scorecard-report.json` daqui quando não existe o de `.oxe/release/`.

- `scorecard-report.json`: scorecard de maturidade dos projetos reais (≥ 2, cada um com ≥ 10 tarefas e dentro das metas), com `oxe_version`, a versão do OXE que produziu a evidência.
- `reference-projects-report.json`: execução de ponta a ponta dos projetos de referência (`scripts/reference-projects.cjs`), por fase. Traz o resultado do oráculo independente, os gates, os turnos e o custo.

Para regenerar: `node scripts/reference-projects.cjs --fresh` e, depois, copie os dois relatórios de `.oxe/release/` para cá, sem caminhos locais.
