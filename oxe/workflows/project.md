# OXE — Workflow: project (gestão de projeto)

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-session`.
> Use: `/oxe-session milestone <ação>` ou `/oxe-session workstream <ação>`.
> Checkpoints agora via `/oxe-execute --checkpoint "<nome>"`.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Ponto de entrada unificado para as três operações de gestão de projeto OXE:

- **milestone** — marcos de entrega (M-NN): `new`, `complete`, `status`, `audit`
- **workstream** — trilhas paralelas: `new <nome>`, `switch <nome>`, `list`, `close <nome>`
- **checkpoint** — snapshot nomeado de sessão: `[slug]`

Detecta a operação pelo primeiro token do input e delega ao workflow canônico correspondente.
</objective>

<context>
- Este workflow é um **dispatcher**: lê o input, identifica a operação e executa o workflow correto.
- Workflows canônicos: `oxe/workflows/milestone.md`, `oxe/workflows/workstream.md`, `oxe/workflows/checkpoint.md`.
- Se o input for ambíguo, apresentar as 3 operações disponíveis e pedir escolha.
- Sem input: mostrar o estado atual de milestones e workstreams ativos lendo `STATE.md`, `.oxe/global/MILESTONES.md` e `CHECKPOINTS.md` do escopo atual da sessão.
</context>

<dispatch_table>
| Input começa com | Delega para | Exemplos |
|------------------|-------------|---------|
| `milestone new ...` | `milestone.md` + subcomando `new` | `/oxe-project milestone new v1.0` |
| `milestone complete` | `milestone.md` + subcomando `complete` | `/oxe-project milestone complete` |
| `milestone status` | `milestone.md` + subcomando `status` | `/oxe-project milestone status` |
| `milestone audit` | `milestone.md` + subcomando `audit` | `/oxe-project milestone audit` |
| `workstream new <nome>` | `workstream.md` + subcomando `new` | `/oxe-project workstream new auth` |
| `workstream switch <nome>` | `workstream.md` + subcomando `switch` | `/oxe-project workstream switch auth` |
| `workstream list` | `workstream.md` + subcomando `list` | `/oxe-project workstream list` |
| `workstream close <nome>` | `workstream.md` + subcomando `close` | `/oxe-project workstream close auth` |
| `checkpoint [slug]` | `checkpoint.md` | `/oxe-project checkpoint pre-refactor` |
| *(sem input)* | Status atual | `/oxe-project` |
</dispatch_table>

<process>
1. Ler o input do usuário (texto após o comando).
2. Identificar o primeiro token:
   - `milestone` → carregar e executar `oxe/workflows/milestone.md` passando o restante como subcomando.
   - `workstream` → carregar e executar `oxe/workflows/workstream.md` passando o restante como subcomando.
   - `checkpoint` → carregar e executar `oxe/workflows/checkpoint.md` passando o slug (se houver).
   - *(vazio)* → ler `STATE.md`, `MILESTONES.md` (se existir) e listar: milestone ativo (M-NN / nenhum), workstreams abertos, último checkpoint. Sugerir próxima operação.
   - *(ambíguo)* → listar as 3 operações disponíveis com exemplos de uso.
3. Executar o workflow delegado integralmente.
</process>

<success_criteria>
- [ ] O workflow correto foi executado com base no input.
- [ ] Sem input: STATUS atual de milestone ativo, workstreams e último checkpoint mostrado.
- [ ] Input ambíguo: máximo 3 opções apresentadas com exemplos, não listas longas.
</success_criteria>
