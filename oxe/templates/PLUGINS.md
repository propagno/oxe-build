# OXE — Plugin System

Plugins OXE são módulos CJS colocados em **`.oxe/plugins/`** que se executam em resposta a eventos do ciclo de vida dos workflows.

## Instalação

Crie um arquivo `.cjs` em `.oxe/plugins/`:

```js
// .oxe/plugins/meu-plugin.cjs
module.exports = {
  name: 'meu-plugin',
  version: '1.0.0',
  hooks: {
    async onAfterVerify({ projectRoot, result }) {
      if (result === 'verify_complete') {
        console.log('[meu-plugin] Entrega verificada com sucesso!');
      }
    },
  },
};
```

## Hooks disponíveis

| Hook | Quando dispara | Contexto (`ctx`) |
|------|---------------|------------------|
| `onBeforeScan` | Antes do scan iniciar | `{ projectRoot }` |
| `onAfterScan` | Após os 7 mapas serem gerados | `{ projectRoot, maps: string[] }` |
| `onBeforeSpec` | Antes do workflow spec | `{ projectRoot }` |
| `onAfterSpec` | Após SPEC.md ser gerado | `{ projectRoot, specPath: string }` |
| `onBeforePlan` | Antes do workflow plan | `{ projectRoot }` |
| `onAfterPlan` | Após PLAN.md ser gerado | `{ projectRoot, planPath: string }` |
| `onPlanGenerated` | Alias de `onAfterPlan` | `{ projectRoot, planPath: string }` |
| `onBeforeExecute` | Antes de iniciar uma onda | `{ projectRoot, wave: number }` |
| `onAfterExecute` | Após onda concluída | `{ projectRoot, wave: number, tasks: string[] }` |
| `onBeforeVerify` | Antes do workflow verify | `{ projectRoot }` |
| `onAfterVerify` | Após VERIFY.md ser gerado | `{ projectRoot, result: 'verify_complete'\|'verify_failed' }` |
| `onVerifyComplete` | Quando verify_complete | `{ projectRoot, verifyPath: string }` |
| `onVerifyFailed` | Quando verify_failed | `{ projectRoot, verifyPath: string, gaps: string[] }` |
| `onMilestoneNew` | Novo milestone criado | `{ projectRoot, milestoneId: string, name: string }` |
| `onMilestoneComplete` | Milestone encerrado | `{ projectRoot, milestoneId: string, archivePath: string }` |
| `onWorkstreamNew` | Novo workstream criado | `{ projectRoot, workstream: string }` |

## Exemplos de uso

### Notificação Slack

```js
// .oxe/plugins/slack-notify.cjs
const https = require('https');

module.exports = {
  name: 'slack-notify',
  version: '1.0.0',
  hooks: {
    async onVerifyComplete({ projectRoot }) {
      const webhookUrl = process.env.SLACK_WEBHOOK_OXE;
      if (!webhookUrl) return;
      // enviar notificação...
    },
  },
};
```

### Geração de changelog

```js
// .oxe/plugins/changelog.cjs
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'changelog',
  version: '1.0.0',
  hooks: {
    async onMilestoneComplete({ projectRoot, milestoneId }) {
      const entry = `## ${milestoneId} — ${new Date().toISOString().split('T')[0]}\n\n`;
      const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
      const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
      fs.writeFileSync(changelogPath, entry + existing, 'utf8');
    },
  },
};
```

## Erros em plugins

Erros em hooks individuais são capturados e logados como warnings — não interrompem o workflow. Use `oxe-cc doctor` para validar plugins:

```bash
oxe-cc doctor --plugins
```

## Regras

1. Plugins devem ter extensão `.cjs`.
2. Plugins devem exportar `name` (string) e `hooks` (objeto).
3. Hooks são assíncronos por padrão mas podem ser síncronos.
4. Plugins não devem alterar artefatos OXE diretamente (STATE.md, PLAN.md, etc.) — use os outputs do contexto.
5. Máximo recomendado: 20 plugins por projeto.
