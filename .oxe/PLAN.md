# PLAN

> Gerado por `oxe-cc plan build` a partir de F3.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-34: Suporte a --plan-model/--execute-model e compareReferenceReports em scripts/reference-projects.cjs

- **Arquivos prováveis:** `scripts/reference-projects.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a10-model-split-roi.test.cjs`
- **Aceite vinculado:** A10

## Onda 2

### T2 — OB-35: Adicionar 3o projeto de referencia em Python 3 stdlib (pycsv) com 2 fases e 10 tarefas

- **Arquivos prováveis:** `scripts/reference-projects.cjs`, `scripts/reference-projects/pycsv.cjs`, `scripts/reference-projects/solutions/pycsv/src/pycsv/__init__.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/parser.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/schema.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/filters.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/normalize.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/dedupe.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/aggregate.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/formatters.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/stats.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/pipeline.py`, `scripts/reference-projects/solutions/pycsv/src/pycsv/cli.py`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a11-pycsv-python.test.cjs`
- **Aceite vinculado:** A11

## Onda 3

### T3 — OB-36: Sincronizar versao 1.22.1, CHANGELOG.md e validar dependencias seguras

- **Arquivos prováveis:** `package.json`, `package-lock.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, `README.md`, `CHANGELOG.md`
- **Depende de:** T1, T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a12-release-1221.test.cjs tests/oxe-sdk-types.test.cjs`
- **Aceite vinculado:** A12
