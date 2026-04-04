<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Versão:** `0.6.0` · [package.json](package.json)

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
/oxe-execute      → implementar (A: 1 sessão | B: por onda | C: por tarefa)
/oxe-verify       → validar que está pronto
```

Tudo o mais é ativado automaticamente por contexto ou existe como escape hatch.

---

## A cadeia

```
/oxe-obs (qualquer momento)
     ↓
/oxe-scan → /oxe-spec → /oxe-plan ──────────→ /oxe-execute → /oxe-verify
                              ↓
                         /oxe-quick (trabalho pequeno)
```

Cada passo lê o anterior como contexto e escreve seu artefato em `.oxe/`. Nenhum passo depende de você re-explicar o que já foi decidido.

---

## Como cada comando fica mais inteligente

| Comando | Inteligência embutida |
|---------|----------------------|
| `/oxe` | Sem input → próximo passo. Com texto → roteamento. Com "help" → 8 comandos. |
| `/oxe-scan` | Se `.oxe/codebase/` já existe → modo refresh automático. `--full` força scan completo. |
| `/oxe-plan` | 3+ domínios → sugere `--agents`. Com `--agents` → gera blueprint com `model_hint` por agente. |
| `/oxe-execute` | Verificar falha → diagnóstico inline (2-3 hipóteses + fix). Sem precisar chamar `/oxe-debug`. |
| `/oxe-verify` | `verification_depth: "thorough"` → gaps automático. `security_in_verify: true` → OWASP automático. |
| `/oxe-project` | `milestone` + `workstream` + `checkpoint` em um único comando. |

---

## Comandos completos

### Fluxo principal

| Comando | O que faz | Artefato |
|---------|-----------|----------|
| `/oxe` | Entrada universal: próximo passo, roteamento ou help | — |
| `/oxe-scan` | Mapeia o repo (bootstrap) ou atualiza mapas (refresh automático) | `.oxe/codebase/*.md` |
| `/oxe-spec` | Spec em 5 fases: perguntas → pesquisa → requisitos R-ID → roteiro → aprovação | `.oxe/SPEC.md` + `.oxe/ROADMAP.md` |
| `/oxe-plan` | Plano por ondas. `--agents` ativa blueprint com `model_hint` por agente | `.oxe/PLAN.md` [+ `plan-agents.json`] |
| `/oxe-execute` | Execução A/B/C com debug inline automático em falhas | `.oxe/STATE.md` |
| `/oxe-verify` | Até 6 camadas por config: audit + critérios + decisões + UAT + gaps + segurança | `.oxe/VERIFY.md` |
| `/oxe-obs` | Registra observação → auto-incorporada nos próximos workflows | `.oxe/OBSERVATIONS.md` |
| `/oxe-quick` | Lean: objetivo → passos → agentes opcionais → verify | `.oxe/QUICK.md` |
| `/oxe-project` | Unifica: `milestone`, `workstream`, `checkpoint` | vários |

### Escape hatches (não precisam ser decorados)

| Comando | Quando usar |
|---------|-------------|
| `/oxe-research` | Spike, mapa de sistema, engenharia reversa |
| `/oxe-forensics` | Sugerido automaticamente pelo execute/verify em falha persistente |
| `/oxe-debug` | Diagnóstico técnico standalone (integrado ao execute) |
| `/oxe-loop` | Retry iterativo de onda standalone (integrado ao Modo B do execute) |
| `/oxe-security` | Auditoria OWASP standalone (automático no verify via config) |
| `/oxe-validate-gaps` | Auditoria de cobertura standalone (automático no verify via config) |
| `/oxe-ui-spec` | Contrato UI/UX derivado da SPEC |
| `/oxe-ui-review` | Auditoria da implementação UI |
| `/oxe-review-pr` | Revisão de PR/diff |
| `/oxe-discuss` | Decisões D-NN (ativado via `discuss_before_plan: true`) |
| `/oxe-compact` | Refresh explícito do codebase (equivalente a `/oxe-scan` em modo refresh) |

---

## Conceitos-chave

### Context engineering — estado em disco, não no chat

```
.oxe/
├── STATE.md          ← fase atual, próximo passo, decisões ativas
├── SPEC.md           ← contrato: critérios A1, A2, …
├── ROADMAP.md        ← fases de entrega mapeadas a requisitos
├── PLAN.md           ← tarefas Tn com verificação por item
├── VERIFY.md         ← resultado da verificação em até 6 camadas
├── OBSERVATIONS.md   ← observações incorporadas automaticamente
├── codebase/         ← mapa do repo (stack, estrutura, testes, …)
├── milestones/       ← arquivo de entregas M-NN
└── workstreams/      ← trilhas paralelas de desenvolvimento
```

### `/oxe-spec` — spec em 5 fases, máx 3 rodadas de perguntas

1. **Perguntas** — blocos de 3-5 por rodada, máximo 3 rodadas
2. **Pesquisa** — proposta inline na Fase 2 (sem sair do spec)
3. **Requisitos** — tabela R-ID com v1/v2/fora e critérios A*
4. **Roteiro** — fases de entrega → `.oxe/ROADMAP.md`
5. **Aprovação** → instrui `/oxe-plan` ou `/oxe-plan --agents`

### `/oxe-execute` — economia de requisições com debug automático

```
A) Completo   → todas as ondas em 1 sessão  (ideal: Claude, Copilot, Gemini)
B) Por onda   → onda 1, você verifica, chama de novo  (N sessões)
C) Por tarefa → máximo controle  (N tarefas = N sessões)
```

Se uma tarefa falha: diagnóstico inline automático (2-3 hipóteses → fix → retry). Sem precisar chamar `/oxe-debug` separadamente.

### `/oxe-obs` — observação sem re-explicar

```
/oxe-obs JWT expiration deve ser configurável via env var, não hardcoded
```

O próximo `/oxe-plan`, `/oxe-spec` ou `/oxe-execute` incorpora automaticamente — sem prompt extra.

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
npm test          # 144 testes
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
| `discuss_before_plan` | `false` | Exige `/oxe-discuss` antes do `/oxe-plan` |
| `scale_adaptive` | `true` | Scan sugere o profile pelo tamanho do projeto |
| `scan_max_age_days` | — | Doctor avisa quando o scan estiver velho |
| `plugins` | — | Hooks de lifecycle em `.oxe/plugins/*.cjs` |

---

## SDK

```js
const oxe = require('oxe-cc');

const plan  = oxe.parsePlan(fs.readFileSync('.oxe/PLAN.md', 'utf8'));
const spec  = oxe.parseSpec(fs.readFileSync('.oxe/SPEC.md', 'utf8'));
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
| `ETARGET` / versão não encontrada | `npm cache clean --force` ou `npx oxe-cc@0.6.0` |
| Erro no WSL sobre Node | Use Node instalado dentro do WSL |

`oxe-cc --help` · `oxe-cc doctor` · `OXE_NO_BANNER=1` desativa o banner

---

## Licença

[GPL-3.0](LICENSE)
