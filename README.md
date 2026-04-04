<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Versão:** `0.5.0` · [package.json](package.json)

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

O resultado: **menos requisições**, **mais coerência**, e um fluxo de desenvolvimento que funciona do mesmo jeito em qualquer IDE — Cursor, Claude Code, Copilot, Codex ou qualquer outra suportada.

---

## A cadeia

```
/oxe-obs  ← registrar uma observação a qualquer momento
     ↓ (incorporada automaticamente no próximo passo)

/oxe-scan → /oxe-spec → /oxe-plan ──────────────────→ /oxe-execute → /oxe-verify
                ↓              ↓
           /oxe-discuss   /oxe-plan-agent (com agentes)
           (decisões)
                              ↓ atalho para trabalho pequeno
                         /oxe-quick (spec + plan + agentes, tudo lean)
```

Cada passo lê o anterior como contexto e escreve seu artefato em `.oxe/`. Nenhum passo depende de você re-explicar o que já foi decidido.

---

## Comandos

### Fluxo principal

| Comando | O que faz | Artefato |
|---------|-----------|----------|
| `/oxe-scan` | Mapeia o repositório: stack, estrutura, testes, convenções. Base para spec e plan. | `.oxe/codebase/*.md` |
| `/oxe-spec` | Conduz 5 fases: perguntas → pesquisa → requisitos (v1/v2/fora) → roteiro → aprovação. Produz o contrato da entrega. | `.oxe/SPEC.md` + `.oxe/ROADMAP.md` |
| `/oxe-discuss` | Registra decisões de implementação com IDs estáveis (D-01, D-02, …) antes de planejar. | `.oxe/DISCUSS.md` |
| `/oxe-plan` | Gera tarefas atômicas em ondas, cada uma com bloco de verificação e critérios vinculados à SPEC. | `.oxe/PLAN.md` |
| `/oxe-plan-agent` | Igual ao plan + blueprint de agentes por domínio: roles específicos, ondas paralelas, handoffs. Agentes são novos por demanda. | `.oxe/PLAN.md` + `.oxe/plan-agents.json` |
| `/oxe-execute` | Executa o plano. Pergunta UMA vez como executar: **Completo** (1 sessão), **Por onda**, ou **Por tarefa**. | `.oxe/STATE.md` |
| `/oxe-verify` | Validação em 4 camadas: auditoria do PLAN, critérios da SPEC, fidelidade das decisões D-NN, checklist UAT. | `.oxe/VERIFY.md` |

### Atalhos e suporte

| Comando | O que faz |
|---------|-----------|
| `/oxe-obs [texto]` | Registra uma observação (restrição, descoberta, preferência) que é incorporada automaticamente no próximo spec/plan/execute — sem re-explicar. |
| `/oxe-quick` | Fluxo lean para trabalho pequeno: objetivo (minispec) → passos (mini-plano) → agentes por domínio se necessário → verificar. |
| `/oxe-research` | Cria notas de pesquisa datadas (spike, mapa de sistema, engenharia reversa) antes de planejar. |
| `/oxe-validate-gaps` | Auditoria de cobertura pós-verify: gaps de teste e evidência fraca. |
| `/oxe-next` | Sugere o próximo passo lógico a partir do `STATE.md`. |
| `/oxe-route` | Traduz linguagem natural para o comando OXE correto. |
| `/oxe-forensics` | Diagnóstico pós-falha: linha do tempo, hipótese de causa, reentrada na trilha. |
| `/oxe-debug` | Ciclo hipótese → experimento → evidência durante a execução. |

### Contexto e sessão

| Comando | O que faz |
|---------|-----------|
| `/oxe-compact` | Atualiza os mapas `.oxe/codebase/` com o estado atual do repo + delta do que mudou. |
| `/oxe-checkpoint` | Snapshot nomeado da sessão atual. |
| `/oxe-milestone new\|complete\|status\|audit` | Marcos de entrega (M-01, M-02, …). `complete` arquiva SPEC/PLAN/VERIFY em `.oxe/milestones/M-NN/`. |
| `/oxe-workstream new\|switch\|list\|close` | Trilhas paralelas de desenvolvimento. Cada trilha tem artefatos independentes em `.oxe/workstreams/<nome>/`. |

### UI e revisão

| Comando | O que faz |
|---------|-----------|
| `/oxe-ui-spec` | Contrato de UI/UX derivado da SPEC (estados, acessibilidade, breakpoints). |
| `/oxe-ui-review` | Auditoria da implementação de UI contra o UI-SPEC. |
| `/oxe-review-pr` | Revisão de PR/diff: riscos, testes sugeridos, checklist. |

---

## Conceitos-chave

### Context engineering — estado em disco, não no chat

O problema: agentes perdem contexto entre sessões, e re-explicar tudo em cada sessão é caro. A solução do OXE: cada decisão, requisito e tarefa fica em um arquivo pequeno em `.oxe/`. O agente lê o que precisa, quando precisa.

```
.oxe/
├── STATE.md          ← fase atual, próximo passo, decisões ativas
├── SPEC.md           ← o contrato: critérios A1, A2, …
├── ROADMAP.md        ← fases de entrega mapeadas a requisitos
├── DISCUSS.md        ← decisões D-01, D-02, … com rastreabilidade
├── PLAN.md           ← tarefas Tn com verificação por item
├── VERIFY.md         ← resultado da verificação em 4 camadas
├── OBSERVATIONS.md   ← observações que se incorporam automaticamente
├── codebase/         ← mapa do repo (stack, estrutura, testes, …)
├── milestones/       ← arquivo de entregas M-NN
└── workstreams/      ← trilhas paralelas de desenvolvimento
```

### /oxe-spec — spec em 5 fases, máx 3 rodadas de perguntas

Em vez de 10 idas e vindas para clarificar o que você quer, o spec estrutura a conversa:

1. **Perguntas** — blocos de 3-5 perguntas por rodada, máximo 3 rodadas
2. **Pesquisa** — investigação de domínio antes de escrever requisitos (opcional)
3. **Requisitos** — tabela R-ID com versão v1 (agora), v2 (depois), fora (nunca)
4. **Roteiro** — fases de entrega mapeadas a requisitos → `.oxe/ROADMAP.md`
5. **Aprovação** — você confirma e escolhe: `/oxe-plan` ou `/oxe-plan-agent`

### /oxe-execute — economia de requisições explícita

Quando o plano tem 2+ ondas, o execute pergunta **uma vez**:

```
A) Completo   → todas as ondas em 1 sessão  (ideal: Copilot, Claude, Gemini)
B) Por onda   → onda 1, você verifica, chama de novo  (N sessões)
C) Por tarefa → máximo controle  (N tarefas = N sessões)
```

Modo A é o padrão para quem quer gastar menos requisições. A escolha fica salva no `STATE.md`.

### /oxe-obs — observação sem re-explicar

Percebeu uma restrição durante a execução? Registre em 1 request:

```
/oxe-obs JWT expiration deve ser configurável via env var, não hardcoded
```

O próximo `/oxe-plan`, `/oxe-spec` ou `/oxe-execute` lê `.oxe/OBSERVATIONS.md` e incorpora a observação automaticamente — sem você precisar repetir.

### Plan-Driven Dynamic Agents — agentes por demanda, não genéricos

Quando você usa `/oxe-plan-agent`, os agentes são criados **para aquele plano específico**:
- Cada `runId` é único — nunca reutilizado entre demandas
- O `role` descreve o domínio da demanda: "Especialista em autenticação JWT para este plano", não "Backend Developer"
- Agentes são invalidados quando o plano termina ou uma nova demanda começa

O `/oxe-quick` tem a versão lean: até 3 agentes derivados dos passos, criados para aquele quick task, sem handoff de mensagens.

---

## Instalação

**Requisito:** Node.js 18+

```bash
# Na raiz do seu projeto
npx oxe-cc@latest
```

O instalador interativo pergunta: (1) quais IDEs integrar, (2) layout (mínimo só `.oxe/` ou clássico `oxe/` + `.oxe/`). Ao final mostra o que foi criado e sugere o primeiro passo (`/oxe-scan`).

**Confirmar que funcionou:**

| IDE | Comando |
|-----|---------|
| Cursor | `/oxe-help` |
| Copilot (VS Code) | `/oxe-help` (requer `"chat.promptFiles": true`) |
| Claude Code | `/oxe-help` ou `oxe:help` |
| Gemini CLI | `/oxe` após `/commands reload` |
| Codex | `/prompts:oxe-help` |

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
# Atualizar workflows no projeto
npx oxe-cc@latest --force
# ou via Cursor:
/oxe-update

# Verificar se há versão nova sem atualizar
npx oxe-cc update --check

# Desinstalar integrações do HOME (mantém .oxe/ no repo)
npx oxe-cc uninstall --ide-only
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

Para testar no seu projeto: `npm link` aqui, depois `npm link oxe-cc` no projeto alvo.

</details>

---

## CLI (`oxe-cc`)

Comandos de terminal para usar em CI ou sem chat aberto:

| Comando | O que faz |
|---------|-----------|
| `oxe-cc` / `oxe-cc install` | Instala workflows e integrações |
| `oxe-cc doctor` | Diagnóstico completo: Node, workflows, config, STATE, scan/compact antigos, SPEC, PLAN |
| `oxe-cc status` | Diagnóstico leve + um único próximo passo sugerido |
| `oxe-cc status --json` | Mesmo, em JSON (para pipelines e automações) |
| `oxe-cc update` | Atualiza workflows do projeto para a versão mais recente |
| `oxe-cc init-oxe` | Só bootstrap do `.oxe/` (STATE, config, codebase/) |
| `oxe-cc uninstall` | Remove integrações OXE do HOME e do repo |

---

## Configuração

Arquivo `.oxe/config.json` criado no install. Principais opções:

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `profile` | `"balanced"` | `strict` / `balanced` / `fast` / `legacy` — expande em múltiplas opções |
| `scale_adaptive` | `true` | `/oxe-scan` sugere o profile automaticamente pelo tamanho do projeto |
| `discuss_before_plan` | `false` | Exige `/oxe-discuss` antes do `/oxe-plan` |
| `verification_depth` | `"standard"` | `quick` / `standard` / `thorough` |
| `after_verify_suggest_uat` | `false` | Gera checklist UAT (Camada 4) ao final do verify |
| `scan_max_age_days` | — | `doctor` avisa quando o scan estiver velho |
| `plugins` | — | Habilita hooks de lifecycle em `.oxe/plugins/*.cjs` |

Referência completa: [`oxe/templates/CONFIG.md`](oxe/templates/CONFIG.md)

---

## SDK

```js
const oxe = require('oxe-cc');

// Parsear artefatos
const plan  = oxe.parsePlan(fs.readFileSync('.oxe/PLAN.md', 'utf8'));
const spec  = oxe.parseSpec(fs.readFileSync('.oxe/SPEC.md', 'utf8'));
const state = oxe.parseState(fs.readFileSync('.oxe/STATE.md', 'utf8'));

// Validar que as decisões D-NN foram cobertas no plano
const fidelity = oxe.validateDecisionFidelity(discussMd, planMd);

// Doctor com verificação de segurança
const result = oxe.runDoctorChecks({ projectRoot: process.cwd(), includeSecurity: true });

// Profiles e health
const expanded = oxe.health.expandExecutionProfile('strict');
```

Namespaces: `oxe.health`, `oxe.workflows`, `oxe.security`, `oxe.plugins`, `oxe.install`.
TypeScript: [`lib/sdk/index.d.ts`](lib/sdk/index.d.ts) · Docs: [`lib/sdk/README.md`](lib/sdk/README.md)

---

## Resolução de problemas

| Situação | O que tentar |
|----------|-------------|
| Comandos não aparecem no Cursor | Confirme `~/.cursor/commands/`; reinicie o Cursor |
| `/oxe-*` não aparecem no Copilot | Ative `"chat.promptFiles": true`; confirme prompts em `~/.copilot/prompts/` |
| Copilot CLI não reconhece `/oxe` | Use `--copilot-cli` no install e rode `/skills reload` |
| Arquivos não atualizam | Reinstale com `--force` |
| `ETARGET` / versão não encontrada | `npm cache clean --force` ou `npx oxe-cc@0.5.0` |
| Erro no WSL sobre Node | Use Node instalado dentro do WSL |

`oxe-cc --help` · `oxe-cc doctor` · `OXE_NO_BANNER=1` desativa o banner

---

## Licença

[GPL-3.0](LICENSE)
