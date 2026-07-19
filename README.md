<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE — Orchestrated eXperience Engineering" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Framework OXE — Orchestrated eXperience Engineering**

Desenvolvimento assistido por IA com especificação, contexto persistente, execução rastreável e verificação por evidências — independente da IDE ou do agente.

```bash
npx oxe-cc@latest
```

**Versão:** `1.16.0` · **Node.js:** `>=18`

</div>

---

## Por que o OXE existe

Agentes de IA escrevem código rapidamente, mas velocidade sem método costuma gerar quatro problemas: contexto perdido entre conversas, requisitos implícitos, mudanças difíceis de auditar e uma falsa sensação de conclusão porque “o código parece pronto”.

O OXE adiciona uma camada de engenharia entre a intenção humana e a execução do agente:

```text
objetivo
   ↓
contexto e decisões persistidos em .oxe/
   ↓
spec → plan → execute → verify
   ↓
código + evidências + aprendizado para o próximo ciclo
```

O framework não substitui a IDE, o modelo ou o processo da equipe. Ele oferece um protocolo comum para que Cursor, GitHub Copilot, Claude, OpenCode, Gemini, Codex, Windsurf e outros runtimes trabalhem sobre o mesmo estado canônico.

### O que muda na prática

| Sem uma camada de método | Com OXE |
|---|---|
| O contexto fica preso no chat | Estado e decisões ficam em `.oxe/` |
| Cada agente interpreta a demanda de um jeito | Workflows canônicos definem o contrato de cada etapa |
| O plano descreve tarefas, mas não prova conclusão | Cada tarefa nasce com uma forma explícita de verificar |
| Trocar de IDE significa recomeçar a explicação | As integrações projetam o mesmo núcleo para cada runtime |
| “Terminou” significa apenas que o código foi gerado | `verify` exige critérios, evidências, integração e riscos |
| Erros e decisões se perdem entre ciclos | Memory e Learning Kernel alimentam os próximos planos |

### Benefícios esperados

- **Menos reexplicação:** o agente reconstrói contexto a partir de artefatos pequenos e selecionados por workflow.
- **Escopo mais previsível:** requisitos, decisões e exclusões são registrados antes da mutação.
- **Execução auditável:** runs, eventos, checkpoints, gates e evidências formam uma trilha operacional.
- **Verificação independente:** o resultado é confrontado com critérios de aceite, não apenas com o plano produzido.
- **Portabilidade:** o método permanece igual mesmo quando a equipe troca de IDE, CLI ou modelo.
- **Escala proporcional:** tarefas pequenas usam um fluxo lean; entregas complexas ganham sessões, ondas e agentes especializados.

---

## Evidência operacional do projeto

O OXE procura demonstrar suas próprias promessas no pipeline do repositório. O snapshot abaixo vem da validação local registrada em **18 de julho de 2026**; não representa métricas de adoção externa ou produtividade humana.

| Indicador verificável | Resultado |
|---|---:|
| Quality gates obrigatórios | **10/10 aprovados** |
| Testes raiz validados no Node 18 | **628/628** |
| Testes do runtime TypeScript | **384/384** |
| Cenários smoke, runtime real, recovery e multiagente | **30/30** |
| Cobertura de linhas/statements | **83,05%** |
| Cobertura de funções | **92,48%** |
| Cobertura de branches | **61,76%** |
| Vulnerabilidades reportadas por `npm audit` | **0** |
| Participantes ativados em VS Code Extension Host real | **13/13** |
| Arquivos validados no tarball npm | **507** |

Esses números são recalculados pelos gates do repositório. Consulte [QUALITY-GATES.md](docs/QUALITY-GATES.md) e [RELEASE-READINESS.md](docs/RELEASE-READINESS.md) para o contrato completo. Métricas de produto devem ser interpretadas como sinais: cobertura não substitui bons critérios, contagem de testes não mede valor entregue e número de agentes não equivale a produtividade.

---

## Comece em cinco minutos

### 1. Instale no projeto

```bash
cd meu-projeto
npx oxe-cc@latest
```

O instalador cria um `.oxe/` enxuto e adiciona as integrações escolhidas. Artefatos como `SPEC.md`, `PLAN.md`, runs, sessões e mapas nascem sob demanda.

### 2. Confirme a saúde

```bash
npx oxe-cc doctor
npx oxe-cc status --full
```

### 3. Entregue um objetivo

```text
/oxe adicionar importação de CSV com validação e histórico
```

O Conductor classifica a complexidade, recupera contexto, seleciona personas e escolhe entre execução individual e Swarm Mode.

### 4. Ou controle o ciclo manualmente

```text
/oxe-spec
/oxe-plan
/oxe-execute
/oxe-verify
```

Ao terminar, o projeto contém não só a implementação, mas também os requisitos, decisões, evidências e lições que explicam como ela foi construída.

---

## Escolha o fluxo certo

### Nano — mudança pequena e isolada

```text
/oxe-quick → objetivo → passos curtos → implementação → verify
```

Use para texto, configuração, estilo, teste pontual ou bug local. O Quick evita SPEC e PLAN longos, mas preserva objetivo e verificação. Promova para o ciclo Standard quando surgirem API pública, segurança, muitos arquivos ou mais de dois domínios.

### Standard — padrão para features e refatorações

```text
/oxe → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify
```

É o fluxo recomendado para a maioria das entregas. A spec define o problema, o plan converte critérios em tarefas verificáveis, o execute implementa com tracking e o verify fecha o ciclo por evidência.

### Full — entregas complexas ou de equipe

```text
/oxe-session new <nome>
  → /oxe-spec --full --research
  → /oxe-plan --agents
  → /oxe-execute por onda
  → /oxe-dashboard
  → /oxe-verify --gaps --security --pr
  → /oxe-session close
```

Use quando existirem três ou mais domínios, trabalho paralelo, risco operacional, modernização brownfield ou necessidade de aprovação intermediária.

### Guia rápido de decisão

| Situação | Fluxo sugerido |
|---|---|
| Correção local bem compreendida | `/oxe-quick` |
| Nova feature ou refatoração relevante | ciclo Standard |
| UI com contrato visual | `/oxe-spec --ui` → ciclo Standard → `/oxe-verify --ui` |
| Segurança, autenticação ou dados sensíveis | profile `strict` + `--research` + `--security` |
| Bug intermitente durante execução | `/oxe-execute --debug` |
| Falha persistente após tentativas | `/oxe-execute --deep-diagnosis` |
| Modernização de legado | sessão + `--full --research` + execução por onda |
| Revisão antes do merge | `/oxe-verify --pr --gaps` |
| Trabalho simultâneo em frentes diferentes | `/oxe-session workstream new <nome>` |
| Não sei onde o ciclo parou | `/oxe` ou `oxe-cc status --full` |

---

## A trilha principal

São seis comandos para o uso cotidiano:

| Comando | Responsabilidade |
|---|---|
| `/oxe` | Entrada universal: situação, ajuda, pergunta contextual ou objetivo autônomo |
| `/oxe-quick` | Demanda pequena com miniobjetivo, passos e verificação |
| `/oxe-spec` | Perguntas → pesquisa opcional → requisitos → roteiro → aprovação |
| `/oxe-plan` | Plano test-first por ondas; `--agents` gera blueprint multiagente |
| `/oxe-execute` | Implementação completa, por onda ou por tarefa, com runtime tracking |
| `/oxe-verify` | Critérios, evidências, integração, riscos, UAT e retrospectiva |

### Flags que absorvem fluxos especializados

```text
/oxe-spec --refresh           atualiza o mapa do codebase
/oxe-spec --full              força scan completo
/oxe-spec --research          pesquisa ou spike técnico
/oxe-spec --deep              aumenta profundidade da investigação
/oxe-spec --ui                produz UI-SPEC

/oxe-execute --note "texto"   registra observação contextual
/oxe-execute --debug          diagnóstico técnico inline
/oxe-execute --deep-diagnosis investigação pós-falha persistente
/oxe-execute --checkpoint "x" snapshot nomeado
/oxe-execute --iterative      retries controlados por onda

/oxe-verify --gaps            auditoria de cobertura dos critérios
/oxe-verify --security        auditoria OWASP aderente ao stack
/oxe-verify --ui              compara implementação com UI-SPEC
/oxe-verify --pr              revisão do PR/diff
/oxe-verify --diff A...B      revisão de intervalo específico
/oxe-verify --skip-retro      não gera retrospectiva ao fechar
```

Os antigos comandos `scan`, `research`, `debug`, `forensics`, `checkpoint`, `security`, `ui-review`, `review-pr` e `retro` continuam reconhecidos, mas os estágios acima são a interface preferencial.

---

## Modo autônomo e agentes dinâmicos

Quando recebe `/oxe <objetivo>`, o Conductor aplica uma heurística explícita:

| Complexidade | Sinal típico | Modo |
|---|---|---|
| simples | 1 domínio e até 3 arquivos esperados | Agent Mode |
| média | 1–2 domínios e aproximadamente 3–8 arquivos | Agent Mode |
| complexa | 3+ domínios, 8+ arquivos ou integração transversal | Swarm Mode |

### Agent Mode

O próprio Conductor executa a demanda com a persona adequada. A sessão fica registrada em `.oxe/agent/AGENT-SESSION.json` e passa por verificação antes de fechar.

### Swarm Mode

O trabalho é decomposto em tarefas e ondas. Agentes recebem papéis específicos, ownership de arquivos, dependências e `model_hint`. Um reviewer adversarial e um verifier independente avaliam a integração. O run fica em `.oxe/swarm/<run-id>/`.

### Personas builtin

`executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist` e `db-specialist`. Personas customizadas podem ser adicionadas em `.oxe/personas/`.

O princípio é **Plan-Driven Dynamic Agents**: os agentes derivam do plano da demanda atual e são invalidados ao terminar. Eles não são uma equipe genérica permanente.

---

## Como o OXE mantém contexto sem inflar o prompt

### Estado canônico em disco

`.oxe/STATE.md` é a porta de entrada curta. Os demais artefatos aparecem quando necessários:

```text
.oxe/
├── STATE.md                 fase e próximo passo
├── config.json              profile e políticas
├── SPEC.md                  requisitos e critérios
├── PLAN.md                  ondas, tarefas e verificação
├── VERIFY.md                evidências e resultado
├── context/packs/           contexto selecionado por workflow
├── runs/                    estado operacional e journal
├── sessions/                ciclos isolados
├── memory/                  memória persistente
├── swarm/                   coordenação multiagente
└── release/                 evidências dos gates de publicação
```

Use `oxe-cc map` para distinguir o que já existe do que será criado sob demanda.

### Context Engine

Cada workflow declara artefatos obrigatórios, opcionais, tier de contexto e política de freshness. O engine seleciona e comprime apenas o necessário:

```bash
oxe-cc context build --workflow plan
oxe-cc context inspect --workflow verify --json
```

### Memory e Learning Kernel

Memória de repositório, decisões, observações e lições são recuperadas antes de novos runs. Ao final do `verify`, a retrospectiva automática destila padrões úteis e evita que o próximo ciclo dependa da lembrança de uma conversa antiga.

---

## Runtime enterprise: execução como estado, não como narrativa

Em `execute` e `verify`, o caminho recomendado é runtime-first. O runtime compila SPEC e PLAN para um grafo formal, registra transições e depois projeta Markdown para leitura humana.

```text
SPEC + PLAN
   ↓ runtime compile
ExecutionGraph + verification suite
   ↓ execute / events / gates
ACTIVE-RUN + journal + evidence
   ↓ runtime verify
verification manifest + risk ledger
   ↓ project
VERIFY.md e demais projeções
```

Comandos principais:

```bash
oxe-cc runtime status
oxe-cc runtime compile
oxe-cc runtime execute
oxe-cc runtime verify
oxe-cc runtime gates list
oxe-cc runtime recover
oxe-cc runtime promote --target pr_draft
```

Isso permite pausar, retomar, repetir uma onda, recuperar um journal interrompido e exigir aprovação formal sem depender do histórico do chat.

---

## Sessões, workstreams e milestones

Sessões isolam ciclos longos e evitam colisão entre artefatos:

```text
/oxe-session new checkout
/oxe-session status
/oxe-session switch sessions/s002-checkout
/oxe-session close
```

Workstreams organizam frentes paralelas; milestones agrupam entregas maiores:

```text
/oxe-session workstream new backend
/oxe-session workstream switch frontend
/oxe-session milestone new beta
/oxe-session milestone audit
```

Para trabalho diário, `oxe-cc status --full` é a inspeção preferencial. O `oxe-cc dashboard` é opt-in para revisão visual de planos, ondas, agentes, checkpoints, gates e evidências.

---

## Instalação por ambiente

### Instalação padrão

```bash
npx oxe-cc@latest
```

### Todas as integrações suportadas

```bash
npx oxe-cc@latest --all-agents
```

| Ambiente | Superfície instalada/invocação |
|---|---|
| Cursor | comandos em `~/.cursor/commands/`; use `/oxe` |
| GitHub Copilot no VS Code | `.github/copilot-instructions.md` + `.github/prompts/`; habilite `chat.promptFiles` |
| Copilot CLI | skills em `~/.copilot/skills/`; recarregue com `/skills reload` |
| Claude Code | comandos em `~/.claude/commands/` |
| OpenCode | comandos nas pastas de configuração OpenCode |
| Gemini CLI | comandos em `~/.gemini/commands/`; use `/commands reload` |
| Codex | skills em `~/.agents/skills` e prompts em `~/.codex/prompts` |
| Windsurf | workflows globais do Windsurf |
| Antigravity | skills na árvore do Gemini Antigravity |

Flags relevantes:

| Flag | Uso |
|---|---|
| `--cursor`, `--copilot`, `--copilot-cli` | instala uma integração específica |
| `--opencode`, `--gemini`, `--codex`, `--windsurf`, `--antigravity` | instala somente o runtime indicado |
| `--ide-local` | mantém integrações suportadas dentro do repositório |
| `--ide-global` | instala integrações no HOME do usuário |
| `--local` | layout mínimo em `.oxe/` |
| `--global` | layout clássico com `oxe/` canônico na raiz |
| `--oxe-only` | instala o núcleo sem integrações de IDE |
| `--dry-run` | mostra as alterações sem gravar |
| `--force` | atualiza/sobrescreve artefatos gerenciados |

CI sem interação:

```bash
OXE_NO_PROMPT=1 npx oxe-cc@latest --oxe-only --no-global-cli
```

Atualização e remoção:

```bash
npx oxe-cc update --check
npx oxe-cc update --if-newer
npx oxe-cc uninstall --ide-only
npx oxe-cc uninstall --global-cli
```

No WSL, use uma instalação do Node dentro do próprio WSL.

---

## Profiles de execução

Defina `profile` em `.oxe/config.json`:

| Profile | Indicado para | Comportamento |
|---|---|---|
| `balanced` | maioria das features | cerimônia e verificação moderadas |
| `fast` | manutenção de baixo risco | menos discussão e verificação rápida |
| `strict` | segurança, API pública, dados e releases | discussão, verificação profunda e UAT |
| `legacy` | brownfield e stacks pouco conhecidas | investigação e verificação thorough |

```json
{
  "profile": "strict",
  "security_in_verify": true,
  "plan_confidence_threshold": 90,
  "runtime": {
    "quotas": {
      "max_retries_per_task": 2
    }
  }
}
```

Chaves explícitas prevalecem sobre os defaults do profile.

---

## Capabilities, plugins e Azure

Capabilities são extensões nativas declarativas do projeto:

```bash
oxe-cc capabilities list
oxe-cc capabilities install <id>
oxe-cc capabilities update
```

Plugins adicionam hooks de lifecycle. A instalação via CLI aceita somente pacotes npm validados; plugins por path devem ser criados e referenciados explicitamente no `config.json`:

```bash
oxe-cc plugins list
oxe-cc plugins install <pacote> [versão]
```

O provider Azure é local-first e usa Azure CLI, inventário materializado, dry-run e checkpoint antes de mutações:

```bash
oxe-cc azure auth login --tenant <tenant-id>
oxe-cc azure auth set-subscription --subscription <dev-sub-id>
oxe-cc azure sync --diff
oxe-cc azure find api --type servicebus
oxe-cc azure operations list
```

---

## CLI de referência

| Comando | Função |
|---|---|
| `oxe-cc install` | instala núcleo e integrações |
| `oxe-cc doctor` | valida estrutura, configuração e saúde lógica |
| `oxe-cc doctor --release --write-manifest` | executa o gate de release e grava o manifesto |
| `oxe-cc status --full` | mostra próximo passo, coverage matrix e active run |
| `oxe-cc status --json` | saída estruturada para hosts e CI |
| `oxe-cc map --json` | catálogo dos artefatos existentes e lazy |
| `oxe-cc context build\|inspect` | produz ou inspeciona context packs |
| `oxe-cc events --tail 50 --json` | lê eventos operacionais incrementalmente |
| `oxe-cc dashboard` | inicia a interface web local |
| `oxe-cc runtime ...` | controla compile, execute, verify, gates, recovery e promotion |
| `oxe-cc update` | atualiza os artefatos gerenciados |
| `oxe-cc uninstall` | remove integrações e, conforme flags, o núcleo |

Ajuda completa:

```bash
npx oxe-cc@latest --help
```

---

## SDK para automação

O mesmo núcleo pode ser consumido programaticamente:

```js
const oxe = require('oxe-cc');

const health = oxe.runDoctorChecks({ projectRoot: process.cwd() });
const plan = oxe.parsePlan(planMarkdown);
const spec = oxe.parseSpec(specMarkdown);

if (!health.ok || !oxe.validateDecisionFidelity(discussMarkdown, planMarkdown).ok) {
  process.exitCode = 1;
}
```

O SDK também expõe bridges operacionais para runtime, gates, verificação, promotion e recovery. Tipos: [index.d.ts](lib/sdk/index.d.ts) · fonte das declarações: [index.types.ts](lib/sdk/index.types.ts) · [documentação do SDK](lib/sdk/README.md).

---

## Uso em equipe

Uma adoção saudável costuma seguir três estágios:

1. **Individual:** `/oxe-quick`, ciclo Standard e `status --full`.
2. **Equipe:** profiles compartilhados, sessões, revisão de SPEC/PLAN e dashboard.
3. **Governado:** runtime-first, gates formais, CI, evidências de release e promotion controlada.

Métricas úteis para acompanhar a adoção:

| Dimensão | Métrica recomendada | Interpretação |
|---|---|---|
| Fluxo | ciclos que terminam em `verify_complete` | mede fechamento, não apenas início |
| Requisitos | critérios A* com evidência | revela cobertura real da entrega |
| Planejamento | tarefas com comando de verificação | mede executabilidade do plano |
| Qualidade | gaps e riscos residuais por ciclo | mostra onde o método ainda é frágil |
| Operação | retries, gates e recoveries por run | indica instabilidade ou políticas excessivas |
| Aprendizado | lições reutilizadas em ciclos posteriores | mede memória útil, não volume de documentação |
| Eficiência | tempo por gate e por onda | ajuda a localizar gargalos sem premiar pressa |

Não use quantidade de prompts, agentes ou linhas geradas como métrica isolada de sucesso. O objetivo é reduzir retrabalho e aumentar confiança na entrega.

Guias: [adoção por papéis](docs/ROLES.md) · [adoção em equipe](docs/TEAM-ADOPTION.md) · [walkthrough](docs/WALKTHROUGH.md) · [playbook de incidentes](docs/INCIDENT-PLAYBOOK.md).

---

## Desenvolvimento e qualidade do próprio OXE

```bash
git clone https://github.com/propagno/oxe-build.git
cd oxe-build
npm ci
npm test
```

O repositório usa um único lockfile e npm workspaces para raiz, runtime e extensão.

Gates principais:

```bash
npm run lint
npm run format:check
npm run test:sdk-types
npm run test:coverage
npm run test:packed-consumer
npm run test:vscode-ext
npm audit
npm run scan:assets
npm run build:vscode-ext
npm run release:manifest
npm run release:pack-check
npm run quality:report
```

O consumidor empacotado instala o tarball em um projeto temporário limpo e valida CLI, SDK, runtime e TypeScript. O teste da extensão ativa os 13 participantes em um VS Code Extension Host real. O ratchet de cobertura impede regressão dos pisos globais e dos módulos críticos.

O pipeline de release usa GitHub Actions fixadas por SHA, valida correspondência entre tag e versão e produz o VSIX antes de criar a GitHub Release. A publicação no npm é uma promoção manual e separada, executada pelo mantenedor depois da aprovação da release.

---

## Solução de problemas

| Sintoma | Diagnóstico sugerido |
|---|---|
| Não sei qual é o próximo passo | `npx oxe-cc status --full` |
| Workflows ausentes ou incoerentes | `npx oxe-cc doctor` |
| Comandos não aparecem no Cursor | confira `~/.cursor/commands/` e reinicie a IDE |
| Prompts não aparecem no Copilot | habilite `"chat.promptFiles": true` e confira `.github/prompts/` |
| Copilot CLI não atualizou skills | execute `/skills reload` |
| Gemini não atualizou comandos | execute `/commands reload` |
| Context pack está stale | `oxe-cc context build --workflow <slug>` |
| Execute falha repetidamente | `/oxe-execute --deep-diagnosis` |
| Runtime interrompido | `oxe-cc runtime recover` |
| `npx` usa uma versão antiga | `npx clear-npx-cache` e repita com `@latest` |

---

## Documentação complementar

- [Quickstart](QUICKSTART.md)
- [Walkthrough completo](docs/WALKTHROUGH.md)
- [Papéis e responsabilidades](docs/ROLES.md)
- [Adoção em equipe](docs/TEAM-ADOPTION.md)
- [Matriz de cenários do runtime](docs/RUNTIME-SMOKE-MATRIX.md)
- [Quality gates](docs/QUALITY-GATES.md)
- [Release readiness](docs/RELEASE-READINESS.md)
- [SDK](lib/sdk/README.md)
- [Workflows canônicos](oxe/workflows/)
- [Referência brownfield](oxe/workflows/references/legacy-brownfield.md)

---

## Princípios de uso

1. Comece por `/oxe`; aumente a estrutura apenas quando o risco exigir.
2. Trate `.oxe/` como estado do trabalho, não como documentação decorativa.
3. Defina como verificar antes de implementar.
4. Prefira runtime-first para `execute` e `verify`.
5. Não encerre um ciclo sem evidência ou risco residual explícito.
6. Use agentes por domínio e por demanda; não por disponibilidade.
7. Faça o próximo ciclo aprender com o anterior.

---

## Licença

[MIT](LICENSE)
