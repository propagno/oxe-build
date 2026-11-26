# OXE — Workflow: alm (Jira / Azure DevOps)

<objective>
Configurar e operar o ALM do projeto: as histórias do PRD e as tarefas do plano viram itens no Jira ou no Azure DevOps, sem duplicar, e o ciclo do OXE move esses itens. Sem ALM, o fluxo do OXE segue igual, e este comando só diz isso.

Subcomandos (argumento livre): `setup` (padrão quando não há bloco `alm`), `status`, `push`, `queue`, `refine`, `defect`.
</objective>

<context>
- Detalhe de cada etapa: `oxe/workflows/references/product-docs-alm.md`. Chaves do bloco: `oxe/templates/CONFIG.md`, seção ALM.
- Credenciais **nunca** entram em arquivo, log, commit ou mensagem. Com `transport: "rest"`, o bloco só nomeia as variáveis de ambiente; com `transport: "mcp"`, o login é o do servidor MCP da sessão.
- Toda escrita no ALM passa antes por `--dry-run` e só acontece com o OK do usuário.
</context>

<process>

### setup — montar o bloco `alm` (uma pergunta por vez, com a recomendada)
1. **Provedor:** Jira ou Azure DevOps? Confira antes se a sessão tem ferramentas MCP de um deles.
2. **Transporte:** a recomendada é `mcp` quando a sessão tem o servidor MCP (sem token; a fila anda quando há agente) e `rest` quando o fluxo roda também sem agente (CI, hooks; o token fica numa variável de ambiente).
3. **Projeto:** a chave do Jira (ex.: `OXE`) ou o projeto do Azure; `program` (o rótulo de idempotência `ref-<program>-<ref>`).
4. **Épico e versão:** um épico existente ou criado pelo OXE a partir do PRD; `fix_version`, um valor ou um por fase.
5. **Estados do quadro, pelo nome real:** pergunte ou leia do ALM (no MCP, as transições de um item; no REST, `oxe-cc alm move` mostra os estados disponíveis quando o nome não existe). Mapeie `in_progress`, `in_review`, `queued`, `merged` e `released`.
6. **`track`:** quais etapas o OXE move. Se uma action do repositório já move o PR e a tag, deixe só `["in_progress"]`.
7. **Códigos antigos** (`adopt_prefixes`) e `ledger_guard` quando o projeto já tem itens criados por outra ferramenta.
8. Mostre o bloco final, grave no `.oxe/config.json` com o OK e rode `oxe-cc alm status`. Ele deve vir sem pendências; no REST, ele nomeia as variáveis de ambiente que faltam.

### status
`oxe-cc alm status`: provedor, transporte, itens ligados, pendências de sync e fila do MCP.

### push
`oxe-cc alm push --stories-only --dry-run` (depois da spec) ou `--tasks-only --dry-run` (depois do plano). Mostre o que seria criado e o que seria adotado e, com o OK, rode sem `--dry-run`.

### queue (transporte MCP)
`oxe-cc alm queue --json`. Execute **na ordem** com as ferramentas MCP:
- **`ensure`:** busque primeiro com o `search` (`jql`/`wiql`); se achar, adote, senão crie. Depois, `oxe-cc alm ack <id> --key <chave>`.
- **`transition`, `link`, `comment`, `release_version`:** faça a operação e rode `oxe-cc alm ack <id>`.
- **Falha:** `oxe-cc alm ack <id> --error "…"` e siga para a próxima.

### refine — card do Jira → spec guiado
`oxe-cc alm refine <KEY…>` (ou `--jql "…" --max-cards N`) só lê: coleta o card inteiro e grava o esqueleto do tipo em `.oxe/alm/specs/<KEY>.md`. Reescreva cada spec seguindo `references/alm-refine.md` (nunca invente: sem fonte, fica "A confirmar" com a pergunta), rode `oxe-cc alm refine lint`, mostre ao usuário e, com o OK, rode `oxe-cc alm refine apply <KEY> --dry-run` e depois `--apply` na sessão escritora.

### defect
Defeito depois do deploy: `oxe-cc alm defect --title "…" --origin <US-n|Fn-Tn> --apply`. Abra também o CR (`oxe-cc runtime feedback --class defect …`); o caminho completo está em `/oxe-ship --defect`.
</process>

<success_criteria>
- [ ] Bloco `alm` gravado com o OK do usuário, sem nenhuma credencial em arquivo, e `oxe-cc alm status` sem pendências de configuração.
- [ ] Toda escrita passou antes pelo `--dry-run`; a fila do MCP terminou vazia ou com cada falha registrada.
- [ ] Terminou com o **Próximo passo** de `oxe-cc status --json` (ver `references/next-step-footer.md`).
</success_criteria>
