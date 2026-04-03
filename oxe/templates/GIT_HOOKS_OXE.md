# Git hooks OXE (opt-in, não bloqueante)

Estes exemplos **não** bloqueiam commit nem push; apenas imprimem lembretes no terminal para reforçar a rotina **`/oxe-compact`** e **`/oxe-checkpoint`** em momentos chave (ver `oxe/workflows/help.md`, secção *Momentos chave*).

## Pré-requisitos

- [Husky](https://typicode.github.io/husky/) (ou outro gestor de hooks) no projeto alvo.
- O fluxo OXE já instalado (`.oxe/` com workflows).

## Exemplo: lembrete após merge (`post-merge`)

Ficheiro `.husky/post-merge` (ou equivalente):

```sh
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo ""
echo "[OXE] Após merge grande: considere /oxe-compact para alinhar .oxe/codebase/ ao repo."
echo "[OXE] Antes de spike arriscado: /oxe-checkpoint com slug (ver oxe/workflows/checkpoint.md)."
echo ""
```

## Exemplo: lembrete antes de push (`pre-push`)

Apenas eco — **nunca** `exit 1` aqui se o objetivo for hábito, não gate:

```sh
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo ""
echo "[OXE] Pre-push: mapa desatualizado? npx oxe-cc status --hints"
echo ""
```

## CI opcional

Para falhar ou avisar quando `compact_max_age_days` / `scan_max_age_days` estiverem configurados e o `STATE.md` estiver velho, use **`require('oxe-cc').runDoctorChecks({ projectRoot })`** e inspecione **`healthReport`** (o binário `oxe-cc doctor` já imprime os mesmos avisos). Exemplo:

```javascript
const oxe = require('oxe-cc');
const { healthReport } = oxe.runDoctorChecks({ projectRoot: process.cwd() });
if (healthReport.stale?.stale) {
  console.warn('[OXE] Scan acima de scan_max_age_days — considere /oxe-scan ou atualizar STATE.');
}
if (healthReport.staleCompact?.stale) {
  console.warn('[OXE] Compact acima de compact_max_age_days — considere /oxe-compact.');
}
```

Em **`oxe-cc status --json`**, os mesmos objetos aparecem como **`staleScan`** e **`staleCompact`** (schema **`oxeStatusSchema: 2`**).
