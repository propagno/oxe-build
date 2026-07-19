# Integração com hosts (IDEs, OXESpace, …)

Este documento descreve o **contrato estável** que o `oxe-cc` expõe para um *host* — um app que embute o oxe-cc e mostra o estado de um projeto OXE (ex.: o [OXESpace](https://github.com/propagno) embute o painel OXE).

O `oxe-cc` e o host têm **releases independentes**. Para que evoluam sem se quebrar:

- Toda saída de máquina é **versionada** com um campo `oxe*Schema` próprio (independente da versão do pacote).
- Os campos são **aditivos**: campos novos podem aparecer; campos existentes não mudam de tipo nem somem dentro da mesma `*Schema`.
- O host deve **degradar graciosamente**: detectar a versão / o schema e usar o caminho antigo quando um recurso novo não existir.

Detecte a versão com `oxe --version` (imprime `oxe-cc vX.Y.Z`). Tabela de disponibilidade:

| Recurso | Desde | Schema |
|---|---|---|
| `status --json` (completo) | 1.0 | `oxeStatusSchema: 5` |
| `status --json --summary` | 1.13.0 | `oxeSummarySchema: 1` |
| `agentSkills[]` no `status --json` + `agentSkills` no summary | 1.13.0 | — |
| `events --tail --json` | 1.14.0 | `oxeEventsSchema: 1` |
| `dashboard --json` + `--port 0` efêmero | 1.14.0 | `oxeDashboardSchema: 1` |
| `map --json` (mapa de artefatos do `.oxe/`) | 1.15.0 | `oxeMapSchema: 1` |

> **Estável:** `status --json --summary`, `agentSkills`, `events --json`, `dashboard --json`, `map --json`.
> **Experimental (pode mudar):** o conteúdo de `payload` dentro de cada evento; o HTML servido pelo dashboard; o corpo de `status --json` completo (`oxeStatusSchema`) além dos campos listados abaixo.

---

## 1. Glance barato — `status --json --summary`

Em vez do `status --json` completo (~100KB), use a projeção compacta no *hot path* (atualizações frequentes):

```bash
oxe status --json --summary --dir <projeto>
```

```jsonc
{
  "oxeSummarySchema": 1,
  "projectRoot": "/abs/path",
  "workspaceMode": "oxe_project",
  "phase": "execute",
  "healthStatus": "warning",
  "activeSession": "sessions/s003-foo",
  "nextStep": "execute",
  "cursorCmd": "/oxe-execute",
  "reason": "…",
  "eventsCount": 42,
  "warningsCount": 7,
  "agentSkills": [ { "agent": "copilot-cli", "skillsInstalled": false } ]
}
```

O `status --json` completo (`oxeStatusSchema: 5`) continua disponível para a vista detalhada (diagnósticos, `criticalExecutionGaps`, `planSelfEvaluation`, artefatos, `agentSkills[]` detalhado).

---

## 2. Skills por-agente — `agentSkills`

O summary traz um `agentSkills` compacto (`{ agent, skillsInstalled }`). O `status --json` completo traz a forma detalhada:

```jsonc
{
  "agent": "copilot-cli",        // copilot-vscode | codex | copilot-cli | cursor | …
  "detected": true,               // o agente está configurado neste ambiente
  "skillsInstalled": false,       // as skills /oxe-* estão instaladas neste workspace
  "skillsPath": "/abs/.../skills",
  "status": "no_skills",
  "issues": ["…"]                 // por que falhou (caminho ausente, frontmatter, versão)
}
```

Via SDK, sem shell: `require('oxe-cc').health.agentSkillsReport(target)`.

**Uso típico do host:** se algum agente relevante tem `skillsInstalled:false`, ofereça instalar as skills daquele agente **antes** de lançá-lo (resolve o "Failed to load N skills"). Hoje o host dispara a instalação via os comandos `install` do oxe-cc (no terminal); uma saída `install --json` silenciosa está planejada (ver §5).

---

## 3. Reatividade — observar eventos

O `oxe-cc` mantém um log **append-only** em:

```
.oxe/OXE-EVENTS.ndjson                                  # projeto sem sessão ativa
.oxe/<session>/execution/OXE-EVENTS.ndjson              # quando há sessão ativa (ex.: sessions/s003-foo)
```

Cada linha é um JSON (NDJSON). Campos estáveis por evento:

```jsonc
{
  "event_id": "evt-...",      // único; use como cursor em --since
  "type": "RunStarted",       // RunStarted, WorkItemReady, ToolInvoked, GateRequested, RunCompleted, …
  "timestamp": "2026-05-30T10:00:00.000Z",
  "run_id": "run-1" | null,
  "session_id": "sessions/s003-foo" | null,
  "wave_id": 1 | null,
  "task_id": "T1" | null,
  "payload": { /* experimental — específico do tipo */ }
}
```

**Padrão recomendado (reativo + barato):**

1. O host faz `fs.watch` do `OXE-EVENTS.ndjson` (com debounce ~400ms).
2. A cada mudança, re-chama `status --json --summary` para atualizar a UI.
3. Um poll lento de segurança (~15s) cobre o caso de o watch falhar (rede/symlink).

Para **ler os eventos** sem reparsear o arquivo inteiro, use o comando read-only:

```bash
oxe events --tail 50 --json --dir <projeto>
oxe events --since evt-abc123 --json --dir <projeto>   # só os novos desde um event_id
```

```jsonc
{
  "oxeEventsSchema": 1,
  "projectRoot": "/abs/path",
  "activeSession": "sessions/s003-foo" | null,
  "summary": { "total": 3, "byType": { "RunStarted": 1, "…": 1 }, "lastEvent": { /* … */ } },
  "events": [ /* … */ ]
}
```

Via SDK: `oxe.operational.readEvents(root, session)` e `oxe.operational.summarizeEvents(events)`.

---

## 4. Dashboard embutível — `dashboard --json`

O dashboard é um servidor HTTP local (serve `/` HTML + `/api/context` + endpoints de review/runtime). Para embutir num webview/iframe, suba-o em modo host:

```bash
oxe dashboard --no-open --port 0 --json --dir <projeto>
```

A **primeira linha** do stdout é, assim que o servidor está ouvindo, e o processo **continua servindo** até ser morto:

```json
{"oxeDashboardSchema":1,"projectRoot":"/abs/path","url":"http://127.0.0.1:52555/","port":52555,"readOnly":false}
```

- `--port 0` → o SO escolhe uma porta efêmera; leia a porta real do `port`/`url`.
- `--read-only` → UI visual sem persistir mudanças (embed seguro).
- O servidor é localhost-only (`127.0.0.1`), sem autenticação — adequado a embed local.

**Ciclo de vida (host):** faça spawn do processo, leia a primeira linha JSON, carregue `url` no webview, e **mate o processo** ao fechar o workspace/app. Fallback para versões < 1.14: rode `dashboard` sem `--json` e raspe a linha `URL: …`, ou abra no navegador externo.

---

## 5. Mapa de artefatos — `map --json`

A partir da `1.15.0` o `.oxe/` é **enxuto no install** (só `STATE.md`, `config.json` e o `README.md`-legenda); o resto nasce sob demanda. Para projetar o estado real do diretório — o que já existe, o que está disponível sob demanda, e o estado de cada item — use:

```bash
oxe map --json --dir <projeto>
```

```jsonc
{
  "oxeMapSchema": 1,
  "projectRoot": "/abs/path",
  "oxeExists": true,
  "groups": [ { "key": "core", "label": "…", "present": [ … ], "available": [ … ] } ],
  "present":   [ { "path": "STATE.md", "kind": "file", "purpose": "…", "createdBy": "install", "group": "core", "state": "active" } ],
  "available": [ { "path": "codebase/", "kind": "dir", "purpose": "…", "createdBy": "scan", "group": "discovery", "state": "absent" } ],
  "extras": ["WHATEVER.md"],
  "counts": { "total": 56, "present": 6, "active": 5, "empty": 1, "stale": 0, "available": 50, "extras": 1 }
}
```

- `state`: `active` (com conteúdo) · `empty` (existe mas vazio/zero-byte) · `stale` (scan desatualizado) · `absent` (disponível sob demanda).
- `createdBy`: a origem do artefato (workflow/CLI/kernel) — use `SOURCE_LABELS` no SDK para rótulos amigáveis.
- O mesmo modelo está no SDK: `require('oxe-cc').artifacts.buildMapModel(projectRoot)` e `renderLegend()` (o conteúdo do `.oxe/README.md`).

O texto humano (`oxe map`, sem `--json`) imprime a árvore anotada e agrupa os itens "disponível sob demanda" por comando de origem.

---

## 6. Roadmap de integração (ainda não estável)

- **`install … --json`** — saída idempotente `{ ok, agents:[{agent, installedPaths[]}], skipped[], errors[] }` para instalar skills sem terminal. Hoje a instalação é via os comandos `install` (no terminal) + reconferir com `agentSkills`.
- **`events --follow` / streaming (SSE)** — hoje a reatividade é via `fs.watch` + `events --tail`/`--since`.
