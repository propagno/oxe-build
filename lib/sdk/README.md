# OXE SDK (`oxe-cc`)

API programática estável para scripts, CI e integrações. O binário `oxe-cc` usa os mesmos módulos em `bin/lib/`.

## Instalação

```bash
npm install oxe-cc
```

## Uso

```javascript
const oxe = require('oxe-cc');

const dir = process.cwd();
const { ok, errors, warnings, healthReport, workflowShape } = oxe.runDoctorChecks({
  projectRoot: dir,
  // packageRoot: opcional — por omissão é a raiz do pacote `oxe-cc` instalado
  // includeWorkflowLint: false — omite avisos de estrutura dos `.md` em workflows/
});
if (!ok) {
  console.error(errors);
  process.exit(1);
}

const next = oxe.health.suggestNextStep(dir, {
  discuss_before_plan: oxe.health.loadOxeConfigMerged(dir).config.discuss_before_plan,
});

const wf = oxe.workflows.resolveWorkflowsDir(dir);
const { options, warnings: w } = oxe.install.resolveOptionsFromConfig(dir, {
  ignoreInstallConfig: false,
  explicitScope: false,
  oxeOnly: false,
  integrationsUnset: true,
  installAssetsGlobal: false,
  vscode: false,
});
```

## Superfície pública

| Área | Funções |
|------|---------|
| **Meta** | `version`, `name`, `PACKAGE_ROOT`, `readPackageMeta`, `readMinNode` |
| **health** | `loadOxeConfigMerged`, `validateConfigShape`, `buildHealthReport`, `suggestNextStep`, `oxePaths`, constantes de config |
| **workflows** | `resolveWorkflowsDir`, `listWorkflowMdFiles`, `diffWorkflows`, `validateWorkflowShapes` (avisos `WORKFLOW_SHAPE`) |
| **install** | `resolveOptionsFromConfig` |
| **manifest** | `loadFileManifest`, `writeFileManifest`, `sha256File`, `collectFilesRecursive` |
| **agents** | `adjustWorkflowPathsForNestedLayout`, `parseCursorCommandFrontmatter` |
| **doctor** | `runDoctorChecks` — resultado estruturado (erros + avisos + diff de workflows + `workflowShape` com lint leve dos `.md`) |

TypeScript: ver `index.d.ts` junto deste ficheiro.
