# PLAN — F1

> Gerado por `oxe-cc plan build` a partir de F1.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-40: Path-aware phase_gates (paths/globs) + preflight.triggers no runtime verify + suggestPathGates

- **Arquivos prováveis:** `bin/lib/oxe-phase-gates.cjs`, `bin/lib/oxe-preflight.cjs`, `bin/lib/oxe-operational.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a1-path-gates.test.cjs tests/oxe-phase-gates.test.cjs tests/oxe-1230-lote2-ci-rework.test.cjs`
- **Aceite vinculado:** A1

### T2 — OB-41: Saida --json compacta (< 4 KB) por padrao em runtime verify, plan lint e status (--full opt-in)

- **Arquivos prováveis:** `bin/oxe-cc.js`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a2-compact-json.test.cjs tests/oxe-status-summary.test.cjs tests/oxe-cli-purity.test.cjs`
- **Aceite vinculado:** A2

## Onda 2

### T3 — OB-42: oxe-cc sync com sync.version_pins, electron/main/db/migrations e hook no runtimePromote

- **Arquivos prováveis:** `bin/lib/oxe-sync.cjs`, `bin/lib/oxe-operational.cjs`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a3-sync-version-pins.test.cjs tests/oxe-1230-lote2-ci-rework.test.cjs`
- **Aceite vinculado:** A3

## Onda 3

### T4 — OB-43: oxe-cc plan scope add --auto-cr atomico com reabertura automatica de tarefa done

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`
- **Depende de:** T2, T3
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a4-scope-auto-cr.test.cjs tests/oxe-1212-amend-scope.test.cjs`
- **Aceite vinculado:** A4
