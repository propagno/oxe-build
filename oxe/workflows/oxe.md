# OXE — Workflow: oxe (entrada universal)

<objective>
Ponto de entrada inteligente do OXE. Faz uma de três coisas dependendo do input do usuário:

1. **Sem input / "o que faço agora?"** → lê `STATE.md` e recomenda exatamente 1 próximo passo (lógica de `next.md`).
2. **Input em linguagem natural** (ex.: "quero adicionar login", "preciso revisar um PR") → traduz para o comando OXE correto e executa ou orienta (lógica de `route.md`).
3. **"help", "o que é OXE" ou "comandos"** → apresenta o fluxo dos 8 comandos essenciais e a cadeia canônica.

**Princípio:** o usuário não precisa decorar o nome do comando — `/oxe [contexto]` resolve.
</objective>

<context>
- Este workflow **não gera artefatos** por conta própria. Ele orienta ou delega para o workflow correto.
- Lê `STATE.md` quando disponível para personalizar a resposta ao estado atual do projeto.
- Quando o input for claro o suficiente para um workflow específico, **executar diretamente** esse workflow (carregar e seguir o `.md` correspondente) em vez de só sugerir o comando.
- Quando houver ambiguidade genuína, apresentar 2 opções e pedir escolha — nunca listas longas.
</context>

<modo_status>
## Modo: Status + Próximo Passo (sem input ou "o que faço agora?")

Aplicar a lógica completa de `oxe/workflows/next.md`:

1. Se `.oxe/` ou `STATE.md` não existir → **scan** (`npx oxe-cc@latest` primeiro se OXE não instalado)
2. Se `.oxe/codebase/` incompleto e não for quick isolado → **scan**
3. Se `quick_active` ou `QUICK.md` sem `PLAN.md` → avaliar promoção (ver `next.md`)
4. Se sem `SPEC.md` → **spec**
5. Se SPEC mas sem PLAN → verificar `discuss_before_plan` → **discuss** ou **plan**
6. Se PLAN sem VERIFY pós-implementação → **execute** ou **verify**
7. Se VERIFY com falha → **plan --replan**
8. Se VERIFY OK → próxima feature ou milestone

**Saída:** exatamente 1 passo, 1 comando, 1 frase de justificativa.
</modo_status>

<modo_route>
## Modo: Roteamento de Linguagem Natural (input com contexto)

Mapear o input para o workflow correto e executar ou orientar:

| Se o usuário disser | Executar |
|---------------------|----------|
| "quero [feature / tarefa / entrega]" | Verificar estado → **spec** ou **quick** |
| "analisa / mapeia o projeto" | **scan** (modo refresh se codebase/ existir) |
| "pesquisa / spike / quero entender X" | **research** |
| "revisa PR / diff" | **review-pr** |
| "auditoria de segurança" | **security** |
| "valida / verifica" | **verify** |
| "milestone / release / versão" | **project milestone** |
| "trilha paralela / workstream" | **project workstream** |
| "snapshot / checkpoint" | **project checkpoint** |
| "recuperação / erro / algo quebrou" | **forensics** |
| "debug / teste falhando" | **debug** |
| "obs / observação / nota" | **obs** |
| "atualiza / update OXE" | **update** |

Se o input não mapear claramente → apresentar 2 opções mais prováveis e perguntar.
</modo_route>

<modo_help>
## Modo: Help (quando o usuário pede "help", "o que é OXE", "comandos")

Apresentar de forma concisa:

### Os 8 comandos que você precisa conhecer

```
/oxe              → onde estou / o que faço / help
/oxe-obs          → registrei algo importante agora
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-scan         → mapeia o projeto (ou atualiza o mapa)
/oxe-spec         → nova feature ou entrega: perguntas → requisitos → roteiro
/oxe-plan         → detalhar em tarefas (--agents para multi-agente)
/oxe-execute      → implementar (A: completo | B: por onda | C: por tarefa)
/oxe-verify       → validar que está pronto
```

### A cadeia

```
/oxe-obs (qualquer momento)
     ↓
/oxe-scan → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify
                                  ↓
                           /oxe-quick (trabalho pequeno)
```

### Para saber o próximo passo agora

```
/oxe
```

### Escape hatches (não precisa decorar — aparecem quando necessários)

`/oxe-research`, `/oxe-forensics`, `/oxe-debug`, `/oxe-loop`, `/oxe-security`,
`/oxe-validate-gaps`, `/oxe-ui-spec`, `/oxe-ui-review`, `/oxe-review-pr`,
`/oxe-project` (milestone, workstream, checkpoint)
</modo_help>

<process>
1. Verificar se há input adicional na mensagem:
   - **Sem input ou "next / o que faço / status":** aplicar `<modo_status>`.
   - **"help / comandos / o que é OXE":** aplicar `<modo_help>`.
   - **Qualquer outra coisa (linguagem natural com contexto):** aplicar `<modo_route>` e, se o workflow for claro, carregar e executar diretamente o `oxe/workflows/<nome>.md` correspondente.
2. Nunca produzir listas longas de alternativas. Um passo, um comando, uma frase.
3. Se o workflow executado diretamente gerar artefatos, reportar no chat conforme esse workflow.
</process>

<success_criteria>
- [ ] Usuário recebe exatamente 1 próximo passo (modo status) OU 1 workflow executado (modo route) OU o bloco help compacto (modo help).
- [ ] Nenhum artefato criado por este workflow diretamente (a menos que o workflow delegado o faça).
- [ ] Nunca lista mais de 2 alternativas ao mesmo tempo.
</success_criteria>
