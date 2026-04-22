# OXE — Runtime Smoke Matrix

> Estado de suporte por runtime de IA. Atualizado em v1.5.1.
>
> `✓` = suportado e testado | `~` = suportado parcialmente | `✗` = não suportado | `?` = não testado

Este documento descreve a matrix estável da release. O artefato operacional consumido por `doctor --release` é `.oxe/release/runtime-smoke-report.json`.

---

## Matriz de operações × runtimes

| Runtime       | install | `/oxe` | plan | execute | verify | runtime-first |
|---------------|:-------:|:------:|:----:|:-------:|:------:|:-------------:|
| Cursor        | ✓       | ✓      | ✓    | ✓       | ✓      | ✓             |
| Copilot VS Code | ✓     | ✓      | ✓    | ✓       | ✓      | ~             |
| Claude Code   | ✓       | ✓      | ✓    | ✓       | ✓      | ✓             |
| Codex CLI     | ✓       | ✓      | ✓    | ✓       | ~      | ✗             |
| Gemini CLI    | ✓       | ✓      | ~    | ~       | ~      | ✗             |
| OpenCode      | ✓       | ✓      | ✓    | ✓       | ✓      | ~             |
| Windsurf      | ✓       | ✓      | ✓    | ✓       | ✓      | ~             |
| Antigravity   | ~       | ~      | ~    | ?       | ?      | ✗             |

---

## Definição de operações

| Operação | O que significa |
|----------|----------------|
| `install` | `npx oxe-cc@latest` completa sem erro; `doctor` retorna ✓ |
| `/oxe` | Router lê STATE.md e retorna próximo passo correto |
| `plan` | `/oxe-plan` gera PLAN.md com ondas e tarefas válidas |
| `execute` | `/oxe-execute` implementa tarefas e as marca como concluídas |
| `verify` | `/oxe-verify` produz VERIFY.md com evidências para critérios A* |
| `runtime-first` | `npx oxe-cc runtime gates/promote/recover` funcionam sem fallback |

---

## Pressupostos por runtime

### Cursor

- Lê `.cursor/commands/oxe-*.md` via slash commands
- Suporte completo a runtime-first via terminal integrado
- Contexto de arquivo `.oxe/STATE.md` disponível automaticamente
- **Limitação:** multi-agent requer Cursor Agent mode (não Background Agents)

### Copilot VS Code

- Lê `.github/prompts/oxe-*.prompt.md` via `#` references
- `runtime-first` é parcial: `runtime verify` e `runtime gates list` funcionam; `runtime promote` requer terminal externo
- **Limitação:** prompts longos podem ser truncados na janela de contexto do Copilot Chat

### Claude Code

- Lê `commands/oxe/*.md` (Claude Code slash commands)
- Suporte completo a runtime-first via CLI integrado
- Raciocínio em cadeia (CoT) é nativo — contratos de raciocínio funcionam sem adaptação
- **Pressuposto:** `~/.claude/commands/` ou `commands/` no projeto configurado

### Codex CLI

- Lê `.github/prompts/` via `--instructions` flag
- `verify` parcial: gera VERIFY.md mas evidências são menos detalhadas (sem análise de AST)
- `runtime-first` não suportado: Codex CLI não tem acesso a subprocessos Node
- **Limitação:** não suporta contexto multi-arquivo simultâneo em tasks longas

### Gemini CLI

- `plan` e `execute` parciais: segue o fluxo mas pode divergir dos critérios A* do SPEC
- `verify` parcial: produz VERIFY.md mas com menor cobertura de evidências
- `runtime-first` não suportado: sem integração com `oxe-cc` CLI
- **Limitação:** não lê `.oxe/STATE.md` nativamente — requer instrução explícita no prompt

### OpenCode

- Suporte completo ao ciclo spec→plan→execute→verify
- `runtime-first` parcial: `runtime gates list` e `runtime recover` funcionam; `runtime promote` requer verificação manual de output
- **Pressuposto:** modo de agente ativo (não completions puras)

### Windsurf

- Suporte completo ao ciclo principal
- `runtime-first` parcial: comandos `npx oxe-cc runtime *` funcionam via terminal integrado mas sem UX nativa
- **Pressuposto:** Cascade mode ativo para execução de tarefas multi-step

### Antigravity

- `install` parcial: `npx oxe-cc@latest` funciona; `doctor` pode reportar warnings em alguns ambientes
- `/oxe` parcial: router funciona mas leitura de STATE.md depende de configuração manual
- `plan`, `execute` parciais: testados apenas em POC inicial
- `runtime-first` não suportado: sem testes realizados neste runtime
- **Status:** em avaliação — abrir issue no repositório com resultados de testes

---

## Comportamentos suportados vs. não suportados (por todos os runtimes)

### Suportados em todos os runtimes com `✓`

- Geração de SPEC.md, PLAN.md, VERIFY.md
- Marcação de tarefas concluídas (`[x]`)
- Leitura de STATE.md para roteamento
- `oxe-cc doctor` e `oxe-cc status` via terminal

### Não suportados em nenhum runtime

- Execução automática de `npm test` sem aprovação explícita do usuário
- Push para branch remota sem confirmação
- Modificação de `.oxe/config.json` em runtime (requer restart do agente)

### Comportamentos específicos por runtime

| Comportamento | Runtimes afetados |
|---------------|-------------------|
| Truncamento de prompts longos | Copilot, Codex |
| CoT nativo sem instrução explícita | Claude Code |
| Requer modo agente explícito | OpenCode, Windsurf |
| Leitura de STATE.md automática | Cursor, Claude Code |

---

## Como reportar um problema de compatibilidade

1. Identificar qual operação falhou e em qual runtime
2. Coletar: output do comando, versão do runtime, `oxe-cc --version`
3. Abrir issue no repositório com label `runtime-compat`
4. Incluir o output de `npx oxe-cc doctor` e `npx oxe-cc status --full`
