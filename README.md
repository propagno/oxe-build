<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Versão:** `0.6.4` · [package.json](package.json)

```bash
npx oxe-cc@latest
```

</div>

---

## O que é o OXE

OXE é um **framework de desenvolvimento assistido por IA** baseado em três princípios:

- **Spec-driven design** — antes de escrever código, você define *o que* construir e *como saber que está pronto*. Essa especificação restringe e guia tudo o que vem depois.
- **Context engineering** — o estado do trabalho fica em arquivos pequenos dentro de `.oxe/`, não na memória do chat. O agente lê o que precisa, quando precisa — sem sobrecarregar o contexto com decisões já tomadas.
- **Plan-Driven Dynamic Agents** — quando há múltiplos domínios, o plano cria agentes específicos para *aquela demanda*. Agentes não são reaproveitados entre projetos ou demandas.

O resultado: **menos requisições**, **mais coerência**, e um fluxo que funciona do mesmo jeito em qualquer IDE.

---

## Os 8 comandos que você precisa conhecer

```
/oxe              → onde estou / o que faço / help
/oxe-obs          → registrei algo importante (incorporado automaticamente)
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-scan         → mapeia o projeto (ou atualiza se já mapeado)
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
/oxe-plan         → tarefas por onda (--agents para multi-agente)
/oxe-execute      → implementar (A: completo | B: por onda | C: por tarefa)
/oxe-verify       → validar que está pronto
```

Tudo o mais é ativado automaticamente por contexto ou chamado só quando necessário.

---

## Sessões OXE

Sessões organizam um ciclo completo em `.oxe/sessions/sNNN-slug/` sem misturar artefatos de entregas diferentes na raiz. Nesta versão, o suporte fica no layer de **workflows Markdown**: `spec`, `plan`, `execute`, `verify`, `checkpoint`, `research` e afins passam a respeitar `active_session` em `.oxe/STATE.md`, enquanto `oxe-cc status` e `oxe-cc doctor` continuam legados.

```text
.oxe/
├── STATE.md
├── SESSIONS.md
├── global/
│   ├── LESSONS.md
│   └── MILESTONES.md
├── codebase/
└── sessions/
    └── s001-exemplo/
        ├── SESSION.md
        ├── spec/
        ├── plan/
        ├── execution/
        ├── verification/
        ├── checkpoints/
        ├── research/
        └── workstreams/
```

| Subcomando | O que faz |
|------------|-----------|
| `/oxe-session new <nome>` | Cria a sessão e define `active_session` |
| `/oxe-session list` | Lista sessões em `.oxe/SESSIONS.md` |
| `/oxe-session switch <id>` | Alterna a sessão ativa |
| `/oxe-session resume <id>` | Alias de `switch` |
| `/oxe-session status` | Mostra os metadados da sessão ativa |
| `/oxe-session close` | Arquiva a sessão ativa |
| `/oxe-session migrate <nome>` | Cria sessão nova e move artefatos session-scoped da raiz |

Exemplo de ciclo:

```text
/oxe-session new auth-redesign
/oxe-spec
/oxe-plan
/oxe-execute
/oxe-verify
/oxe-session close
```

Com sessão ativa:

- `spec/` contém `SPEC.md`, `ROADMAP.md`, `DISCUSS.md`, `UI-SPEC.md`
- `plan/` contém `PLAN.md`, `QUICK.md`, `plan-agents.json`, `quick-agents.json`
- `execution/` contém o `STATE.md` operacional da trilha, `OBSERVATIONS.md`, `DEBUG.md`, `FORENSICS.md`
- `verification/` contém `VERIFY.md`, `VALIDATION-GAPS.md`, `SECURITY.md`, `UI-REVIEW.md`
- `LESSONS.md`, `MILESTONES.md`, `codebase/`, `SESSIONS.md` e o `STATE.md` global permanecem fora da sessão

---

## A cadeia

```
/oxe-obs (qualquer momento)
     ↓
/oxe-scan → /oxe-spec → /oxe-plan ──────────→ /oxe-execute → /oxe-verify → /oxe-retro
                              ↓                                                  ↓
                         /oxe-quick (trabalho pequeno)             .oxe/global/LESSONS.md
                                                                               ↓
                                                                    (alimenta o próximo ciclo)
```

Cada passo lê o anterior como contexto e escreve seu artefato no escopo correto: raiz `.oxe/` em modo legado, ou `.oxe/sessions/sNNN-slug/` quando `active_session` está definido. Nenhum passo depende de você re-explicar o que já foi decidido.

---

## Como cada comando funciona

| Comando | O que entrega |
|---------|--------------|
| `/oxe` | Sem input → próximo passo. Com texto → roteamento. Com "help" → 8 comandos. |
| `/oxe-scan` | Se `.oxe/codebase/` já existe → modo refresh automático. `--full` força scan completo. |
| `/oxe-spec` | **Auto-reflexão semântica** antes da aprovação: detecta contradições, critérios vagos, escopo creep e conflitos com stack — sem requisição extra. Lê `.oxe/global/LESSONS.md` para não repetir erros do ciclo anterior. |
| `/oxe-plan` | **Test-first:** `Verificar` vem antes de `Implementar` em cada tarefa. `Complexidade: S/M/L/XL` — tarefas XL bloqueiam o gate sem sub-tarefas. Com `--agents`: `model_hint` por agente orienta qual tier de modelo usar (schema v3). |
| `/oxe-execute` | Execução A/B/C. Se uma tarefa falha: **diagnóstico inline automático** (2-3 hipóteses + fix + retry) — sem precisar de comando separado. Exibe `model_hint` ao iniciar cada agente do blueprint. |
| `/oxe-verify` | Até 6 camadas por config: audit + critérios + decisões + UAT + gaps (`verification_depth: thorough`) + OWASP (`security_in_verify: true`). Sugere `/oxe-retro` ao concluir. |
| `/oxe-retro` | Sintetiza 3–5 lições prescritivas em `.oxe/global/LESSONS.md` — consumidas automaticamente pelo próximo spec/plan. |
| `/oxe-obs` | Registra observação → propaga automaticamente para R-IDs e Tns afetados no próximo plan/spec/execute. |
| `/oxe-quick` | Objetivo → passos → agentes opcionais (PDDA lean) → verify. Para correções pontuais e features pequenas. |
| `/oxe-project` | `milestone` + `workstream` + `checkpoint` em um único comando. |
| `/oxe-session` | Cria, alterna, retoma, fecha e migra sessões OXE sem misturar artefatos de ciclos diferentes. |

---

## Quando usar cada modo do execute

```
A) Completo   → todas as ondas numa só execução  (ideal: Claude, Copilot, Gemini)
B) Por onda   → onda 1, você verifica, chama de novo  (1 rodada por onda)
C) Por tarefa → máximo controle  (1 rodada por tarefa)
```

Se uma tarefa falha: diagnóstico inline automático (2-3 hipóteses → fix → retry). O Modo B inclui loop iterativo com escalada automática para diagnóstico profundo quando necessário.

---

## Comandos especializados

Estes não precisam ser decorados — aparecem quando o contexto pede ou quando a situação específica justifica.

| Comando | Quando usar |
|---------|-------------|
| `/oxe-research` | Spike, mapa de sistema, engenharia reversa — antes de spec ou plano |
| `/oxe-forensics` | Falha persistente após múltiplas tentativas — diagnóstico profundo |
| `/oxe-ui-spec` | Contrato UI/UX derivado da SPEC (quando UI é domínio crítico) |
| `/oxe-ui-review` | Auditoria da implementação UI contra o contrato |
| `/oxe-review-pr` | Revisão de PR ou diff de branches |
| `/oxe-checkpoint` | Snapshot nomeado do estado da sessão |

---

## Conceitos-chave

### Context engineering — estado em disco, não no chat

```
.oxe/
├── STATE.md              ← índice global: fase resumida, sessão ativa, próximo passo
├── SESSIONS.md           ← índice de sessões
├── global/
│   ├── LESSONS.md        ← lições prescritivas cumulativas
│   └── MILESTONES.md     ← marcos globais de entrega
├── codebase/             ← mapa do repo (stack, estrutura, testes, …)
└── sessions/
    └── sNNN-slug/
        ├── spec/         ← SPEC.md, ROADMAP.md, DISCUSS.md, UI-SPEC.md
        ├── plan/         ← PLAN.md, QUICK.md, blueprints de agentes
        ├── execution/    ← STATE.md local, OBSERVATIONS.md, DEBUG.md, FORENSICS.md
        ├── verification/ ← VERIFY.md, VALIDATION-GAPS.md, SECURITY.md, UI-REVIEW.md
        ├── checkpoints/
        ├── research/
        └── workstreams/
```

### `/oxe-spec` — spec em 5 fases com auto-reflexão semântica

1. **Perguntas** — blocos de 3-5 por rodada, máximo 3 rodadas
2. **Pesquisa** — proposta inline na Fase 2 (sem sair do spec)
3. **Requisitos** — tabela R-ID com v1/v2/fora e critérios A*
4. **Roteiro** — fases de entrega → `.oxe/ROADMAP.md`
5. **Auto-reflexão** *(automática, sem requisição extra)* — detecta contradições, critérios vagos, escopo creep, conflitos com stack. Corrige antes de apresentar ao usuário.
6. **Aprovação** → instrui `/oxe-plan` ou `/oxe-plan --agents`

A spec lê `.oxe/global/LESSONS.md` antes de iniciar — lições do ciclo anterior informam as perguntas e os critérios.

### `/oxe-plan` — test-first com complexidade explícita

Cada tarefa usa a ordem **Verificar → Implementar** (test-first):
```
Verificar: como saberei que está pronto?   ← definido PRIMEIRO
Implementar: o mínimo para passar o Verificar
Complexidade: S | M | L | XL
```

Tarefas `XL` bloqueiam o gate sem sub-tarefas ou justificativa. `/oxe-obs` propaga automaticamente constraints para os R-IDs e Tns afetados.

### `/oxe-retro` — loop de aprendizado

```
/oxe-verify completo
     ↓
/oxe-retro → 3–5 lições prescritivas → .oxe/global/LESSONS.md
                                              ↓
                              /oxe-spec (próximo ciclo lê LESSONS)
                              /oxe-plan (próximo ciclo lê LESSONS)
```

Lições não são diário — são instruções para o próximo ciclo. Exemplo:
> "Tarefas com integração de terceiros: `Complexidade: L` mínimo + `Verificar` com mock fallback"

### Plan-Driven Dynamic Agents — agentes por demanda

Com `/oxe-plan --agents` (ou sugerido quando 3+ domínios detectados):
- `runId` único por demanda — nunca reutilizado
- `role` específico ao domínio desta entrega
- `model_hint` por agente: `"fast"` / `"balanced"` / `"powerful"`
- Execute exibe o hint ao iniciar cada agente para o usuário configurar o modelo

---

## Instalação

**Requisito:** Node.js 18+

```bash
npx oxe-cc@latest
```

**Confirmar que funcionou:**

| IDE | Comando |
|-----|---------|
| Cursor | `/oxe` |
| Copilot (VS Code) | `/oxe` (requer `"chat.promptFiles": true`) |
| Claude Code | `/oxe` ou `oxe` |
| Gemini CLI | `/oxe` após `/commands reload` |
| Codex | `/prompts:oxe` |

<details>
<summary><strong>Flags de instalação</strong></summary>

| Flag | Efeito |
|------|--------|
| `--cursor` / `--copilot` | Só uma das stacks |
| `--all-agents` | Cursor + Copilot + Claude + OpenCode + Gemini + Codex + Windsurf + Antigravity |
| `--global` | Layout clássico: `oxe/` na raiz + `.oxe/` |
| `--local` | Layout mínimo: só `.oxe/` (padrão) |
| `--force` / `-f` | Sobrescreve arquivos existentes (use para atualizar) |
| `--dry-run` | Lista ações sem escrever |
| `--oxe-only` | Só workflows em `.oxe/`, sem integrações IDE |
| `--no-global-cli` / `-l` | Não instala `oxe-cc` globalmente (útil em CI) |
| `OXE_NO_PROMPT=1` | Modo não-interativo (CI) |

</details>

<details>
<summary><strong>Atualizar e desinstalar</strong></summary>

```bash
npx oxe-cc@latest --force   # atualizar workflows
npx oxe-cc update --check   # verificar versão sem atualizar
npx oxe-cc uninstall --ide-only  # remove integrações (mantém .oxe/)
```

</details>

<details>
<summary><strong>Desenvolvimento (contribuir)</strong></summary>

```bash
git clone https://github.com/propagno/oxe-build.git
cd oxe-build
npm test          # 165 testes
node bin/oxe-cc.js --help
```

</details>

---

## CLI (`oxe-cc`)

| Comando | O que faz |
|---------|-----------|
| `oxe-cc` / `oxe-cc install` | Instala workflows e integrações |
| `oxe-cc doctor` | Diagnóstico completo: Node, workflows, config, STATE, scan antigo |
| `oxe-cc status` | Próximo passo sugerido |
| `oxe-cc status --json` | Mesmo, em JSON (para pipelines) |
| `oxe-cc update` | Atualiza workflows para a versão mais recente |
| `oxe-cc init-oxe` | Bootstrap do `.oxe/` (STATE, config, codebase/) |
| `oxe-cc uninstall` | Remove integrações OXE do HOME e do repo |

---

## Configuração

Arquivo `.oxe/config.json`. Principais opções:

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `profile` | `"balanced"` | `strict` / `balanced` / `fast` / `legacy` |
| `verification_depth` | `"standard"` | `"thorough"` ativa gaps automático no verify (Camada 5) |
| `security_in_verify` | `false` | `true` ativa OWASP automático no verify (Camada 6) |
| `discuss_before_plan` | `false` | Exige aprovação de decisões antes do plano |
| `scale_adaptive` | `true` | Scan sugere o profile pelo tamanho do projeto |
| `scan_max_age_days` | `0` | Doctor avisa quando o scan estiver velho |
| `lessons_max_age_days` | `0` | Doctor avisa quando a última retro estiver velho |
| `plugins` | `[]` | Hooks de lifecycle em `.oxe/plugins/*.cjs` |

---

## SDK

```js
const oxe = require('oxe-cc');

const plan  = oxe.parsePlan(fs.readFileSync('.oxe/PLAN.md', 'utf8')); // ou .oxe/sessions/<id>/plan/PLAN.md
const spec  = oxe.parseSpec(fs.readFileSync('.oxe/SPEC.md', 'utf8')); // ou .oxe/sessions/<id>/spec/SPEC.md
const state = oxe.parseState(fs.readFileSync('.oxe/STATE.md', 'utf8'));

const fidelity = oxe.validateDecisionFidelity(discussMd, planMd);
const result   = oxe.runDoctorChecks({ projectRoot: process.cwd() });
const expanded = oxe.health.expandExecutionProfile('strict');
```

TypeScript: [`lib/sdk/index.d.ts`](lib/sdk/index.d.ts) · Docs: [`lib/sdk/README.md`](lib/sdk/README.md)

---

## Resolução de problemas

| Situação | O que tentar |
|----------|-------------|
| Comandos não aparecem no Cursor | Confirme `~/.cursor/commands/`; reinicie o Cursor |
| `/oxe-*` não aparecem no Copilot | Ative `"chat.promptFiles": true`; confirme `~/.copilot/prompts/` |
| Arquivos não atualizam | Reinstale com `--force` |
| `ETARGET` / versão não encontrada | `npm cache clean --force` |
| Erro no WSL sobre Node | Use Node instalado dentro do WSL |

`oxe-cc --help` · `oxe-cc doctor` · `OXE_NO_BANNER=1` desativa o banner

---

## Licença

[GPL-3.0](LICENSE)
